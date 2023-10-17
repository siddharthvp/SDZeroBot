import {TOOLS_DB_HOST, toolsdb} from "../db";
import {fetchQueriesForPage, Query} from "./app";
import {MetadataStore} from "./MetadataStore";
import {createLocalSSHTunnel, setDifference} from "../utils";
import * as crypto from "crypto";

export class MariadbMetadataStore implements MetadataStore {
    db: toolsdb;

    async init() {
        this.db = new toolsdb('dbreports_p');
        await createLocalSSHTunnel(TOOLS_DB_HOST);
        await this.db.query(`
            CREATE TABLE IF NOT EXISTS dbreports(
                page VARCHAR(255),
                idx SMALLINT UNSIGNED,
                templateMd5 CHAR(32),
                intervalDays SMALLINT UNSIGNED,
                lastUpdate DATETIME
            )
        `); // Primary key?
    }

    async updateMetadata(page: string, queries: Query[]) {
        const existingQueryMd5s = new Set((await this.db.query('SELECT templateMd5 FROM dbreports'))
            .map(q => q.templateMd5));
        const newQueryMd5s = new Set(queries.map(q => this.makeMd5(q)));

        await this.db.transaction(async conn => {
            setDifference(existingQueryMd5s, newQueryMd5s).forEach(md5 => {
                conn.execute('DELETE FROM dbreports WHERE page = ? AND templateMd5 = ?', [page, md5]);
            });

            // Don't delete lastUpdate values on service restart (or when other reports are added to page)
            for (let query of queries) {
                const md5 = this.makeMd5(query);
                const intervalDays = isNaN(query.config.interval) ? null : query.config.interval;
                if (existingQueryMd5s.has(md5)) {
                    await conn.execute(`
                        UPDATE dbreports SET idx = ?, intervalDays = ?
                        WHERE page = ? AND templateMd5 = ?
                    `, [query.idx, intervalDays, query.page, md5]);
                } else {
                    await conn.execute(`
                        INSERT INTO dbreports(page, idx, templateMd5, intervalDays, lastUpdate)
                        VALUES (?, ?, ?, ?, ?)
                    `, [query.page, query.idx, md5, intervalDays, null]);
                }
            }
        });
    }

    makeMd5(query: Query) {
        return crypto.createHash('md5').update(query.template.wikitext).digest('hex');
    }

    async removeOthers(pages: Set<string>) {
        const questionMarks = Array(pages.size).fill('?').join(',')
        await this.db.run(
            `DELETE FROM dbreports WHERE page NOT IN (${questionMarks})`,
            [...pages]
        )
    }

    async getQueriesToRun() {
        const data = await this.db.query(`
            SELECT page, idx FROM dbreports
            WHERE intervalDays IS NOT NULL 
              AND (lastUpdate IS NULL OR lastUpdate < NOW() - INTERVAL intervalDays DAY)
        `);
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
        const result = await this.db.run(
            `UPDATE dbreports SET lastUpdate = UTC_TIMESTAMP() WHERE page = ? AND idx = ?`
            , [query.page, query.idx]);
        // TODO: log warning if rows affected != 1
    }
}
