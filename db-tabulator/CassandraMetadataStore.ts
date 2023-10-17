import {Cassandra} from "../cassandra";
import {fetchQueriesForPage, Query} from "./app";
import {MetadataStore} from "./MetadataStore";

export class CassandraMetadataStore implements MetadataStore {
    cs: Cassandra

    async init() {
        this.cs = new Cassandra();
        await this.cs.connect();
    }

    async updateMetadata(page: string, queries: Query[]) {
        await this.cs.execute('DELETE FROM dbreports WHERE page = ?', [page]);
        for (let query of queries) {
            await this.cs.execute('INSERT INTO dbreports(page, idx, interval, lastUpdate) VALUES (?, ?, ?, ?)',
                [query.page, query.idx, query.config.interval, null]);
        }
    }

    async removeOthers(pages: Set<string>) {
        const questionMarks = Array(pages.size).fill('?').join(',')
        await this.cs.execute(
            `DELETE FROM dbreports WHERE page NOT IN (${questionMarks})`,
            [...pages]
        )
    }

    async getQueriesToRun(): Promise<Record<string, Query[]>> {
        await this.cs.connect();
        // TODO: add fail-safe if unavailable
        const data = await this.cs.execute(`
            SELECT page, idx FROM dbreports
            WHERE lastUpdate < toTimestamp(now() - interval '1' day * interval)
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
        const result = await this.cs.execute(
            `UPDATE lastUpdate = UTC_TIMESTAMP() WHERE page = ? AND idx = ?`
            , [query.page, query.idx]);
        // TODO: log warning if rows affected != 1
    }

}
