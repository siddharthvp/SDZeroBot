import {BOT_NAME, Query, getQueriesFromText, SUBSCRIPTIONS_CATEGORY, TEMPLATE} from "./app";
import {bot, enwikidb, log} from "../botbase";
import {MwnDate} from "../../mwn/src/date";
import {MetadataStore} from "./MetadataStore";

export class NoMetadataStore implements MetadataStore {
    wikidb: enwikidb;

    async init() {
        this.wikidb = new enwikidb();
    }

    async updateMetadata(page: string, queries: Query[]) {}

    async removeOthers(pages: Set<string>) {}

    async updateLastTimestamp() {}

    async getQueriesToRun(): Promise<Record<string, Query[]>> {
        // Get the date of the bot's last edit to each of the subscribed pages
        // The API doesn't have an efficient query for this, so using the DB instead
        let [timeTaken, lastEditsDb] = await this.wikidb.timedQuery(`
            SELECT page_namespace, page_title,
                (SELECT MAX(rc_timestamp) FROM recentchanges_userindex
                 JOIN actor_recentchanges ON rc_actor = actor_id AND actor_name = ?
                 WHERE rc_namespace = page_namespace AND rc_title = page_title
                ) AS last_edit
            FROM page 
            JOIN categorylinks ON cl_from = page_id AND cl_to = ?
        `, [BOT_NAME, SUBSCRIPTIONS_CATEGORY.replace(/ /g, '_')]);
        log(`[i] Retrieved last edits data. DB query took ${timeTaken.toFixed(2)} seconds.`);

        const lastEditsData = Object.fromEntries(lastEditsDb.map((row) => [
            new bot.page(row.page_title as string, row.page_namespace as number).toText(),
            row.last_edit && new bot.date(row.last_edit)
        ]));

        let allQueries: Record<string, Query[]> = {};
        let pages = (await new bot.page('Template:' + TEMPLATE).transclusions());
        for await (let pg of bot.readGen(pages)) {
            if (pg.ns === 0) { // sanity check: don't work in mainspace
                continue;
            }
            let text = pg.revisions[0].content;
            allQueries[pg.title] = getQueriesFromText(text, pg.title).filter(q => {
                return this.checkIfUpdateDue(lastEditsData[q.page], q)
            });
        }
        return allQueries;
    }

    checkIfUpdateDue(lastUpdate: MwnDate, query: Query): boolean {
        const interval = query.config.interval;
        if (isNaN(interval)) {
            log(`[+] Skipping ${query} as periodic updates are not configured`);
            return false;
        }
        if (!lastUpdate) {
            return true;
        }
        let daysDiff = (new bot.date().getTime() - lastUpdate.getTime())/8.64e7;
        const isUpdateDue = daysDiff >= interval - 0.5;
        if (!isUpdateDue) {
            log(`[+] Skipping ${query} as update is not due.`);
        }
        return isUpdateDue;
    }

}
