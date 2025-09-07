import {log} from "../botbase";
import {toolsdb} from "../db";
import {fetchQueriesForPage, Query, MAX_CONSECUTIVE_FAILURES_ALLOWED} from "./app";
import {MetadataStore} from "./MetadataStore";
import {setDifference} from "../utils";
import * as crypto from "crypto";

export class MariadbMetadataStore implements MetadataStore {
    db: toolsdb;

    async init() {
        this.db = new toolsdb('dbreports_p');
    }

    async updateMetadata(page: string, queries: Query[]) {
        const existingQueryMd5s = new Set((await this.db.query(`
            SELECT templateMd5 FROM dbreports
            WHERE page = ?
        `, [page])).map(q => q.templateMd5));
        const newQueryMd5s = new Set(queries.map(q => this.makeMd5(q)));

        await this.db.transaction(async conn => {
            setDifference(existingQueryMd5s, newQueryMd5s).forEach(md5 => {
                conn.execute('DELETE FROM dbreports WHERE page = ? AND templateMd5 = ?', [page, md5]);
            });

            // Don't delete lastUpdate and failure count of unchanged reports when updating metadata
            for (let query of queries) {
                const md5 = this.makeMd5(query);
                const intervalDays = isNaN(query.config.interval) ? null : query.config.interval;
                if (existingQueryMd5s.has(md5)) {
                    await conn.execute(`
                        UPDATE dbreports SET idx = ?, intervalDays = ?, luaSource = ?
                        WHERE page = ? AND templateMd5 = ?
                    `, [query.idx, intervalDays, query.luaSource, query.page, md5]);
                } else {
                    // Debugging: find cause of "Bind parameters must not contain undefined. To pass SQL NULL specify JS null"
                    const params = [query.page, query.idx, md5, intervalDays, query.luaSource, null, null];
                    const bindParams = params
                        .map(e => {
                            if (e === undefined) {
                                log(`[E] Found undefined in params: ${params.join(', ')}`);
                                return null;
                            }
                            return e;
                        });
                    await conn.execute(`
                        INSERT INTO dbreports(page, idx, templateMd5, intervalDays, luaSource, lastUpdate, failures)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, bindParams);
                }
            }
        });
    }

    makeMd5(query: Query) {
        return crypto.createHash('md5').update(query.template.wikitext).digest('hex');
    }

    /**
     * Remove pages from database, except for the pages present in the passed-in set.
     */
    async removeOthers(pages: Set<string>) {
        const questionMarks = Array(pages.size).fill('?').join(',')
        await this.db.run(
            `DELETE FROM dbreports WHERE page NOT IN (${questionMarks})`,
            [...pages]
        )
    }

    async getAllPages() {
        const rows = await this.db.query(`SELECT DISTINCT page FROM dbreports`);
        return rows.map(row => row.page) as string[];
    }

    async getQueriesToRun() {
        const data = await this.db.query(`
            SELECT page, idx FROM dbreports
            WHERE intervalDays IS NOT NULL 
              AND (lastUpdate IS NULL OR lastUpdate < NOW() - INTERVAL intervalDays DAY + INTERVAL 10 MINUTE)
              AND idx != -1
        `);
        // +10 mins helps get the reports update around the same time every day.
        // idx != -1 filters out dummy db rows indicating pages merely transcluding reports.
        let pages: Record<string, Set<number>> = {};
        data.forEach(row => {
            if (!pages[row.page]) {
                pages[row.page] = new Set();
            }
            pages[row.page].add(row.idx as number);
        });
        const result: Record<string, Query[]> = {};
        for (const [page, indices] of Object.entries(pages)) {
            const queries = await fetchQueriesForPage(page);
            result[page] = queries.filter(q => indices.has(q.idx));
        }
        return result;
    }

    async updateLastTimestamp(query: Query): Promise<void> {
        const result = await this.db.run(`
            UPDATE dbreports 
            SET lastUpdate = UTC_TIMESTAMP(),
                failures = NULL
            WHERE page = ? AND idx = ?
        `, [query.page, query.idx]);
        // TODO: log warning if rows affected != 1
    }

    async recordFailure(query: Query): Promise<void> {
        // Increment count of failures.
        // Disable periodic updates if count reaches MAX_CONSECUTIVE_FAILURES_ALLOWED
        await this.db.run(`
            UPDATE dbreports
            SET failures = IF(failures IS NULL, 1, failures + 1),
                intervalDays = IF(failures >= ?, NULL, intervalDays)
            WHERE page = ?
              AND idx = ?
        `, [MAX_CONSECUTIVE_FAILURES_ALLOWED, query.page, query.idx]);
    }

    async getAllLuaSources() {
        const rows = await this.db.query(`SELECT DISTINCT luaSource FROM dbreports`);
        return rows.map(row => row.luaSource) as string[];
    }

    async getPagesWithLuaSource(luaSource: string) {
        const rows = await this.db.query(`
            SELECT DISTINCT page FROM dbreports WHERE luaSource = ?
        `, [luaSource]);
        return rows.map(row => row.page) as string[];
    }
}
