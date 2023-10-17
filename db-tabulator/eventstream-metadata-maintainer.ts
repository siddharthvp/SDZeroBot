import {BOT_NAME, fetchQueriesForPage, SUBSCRIPTIONS_CATEGORY, metadataStore} from "./app";
import {pageFromCategoryEvent, Route} from "../eventstream-router/app";
import {bot} from "../botbase";
import {HybridMetadataStore} from "./HybridMetadataStore";
import {NoMetadataStore} from "./NoMetadataStore";

/**
 * Stability/scalability:
 * If there are a large number of reports, ideally we should be able to identify which reports need updating without
 * reading in the pages.
 * Use EventStream to listen to addition/removal of pages from the subscriptions category. Maintain the list in-memory
 * (restored from db on service restart). Use EventStream edit events to also keep track of edits made to pages within
 * the category. For each such edit, update metadata in the database.
 * Poll this database periodically to check for reports to update.
 */

export default class DbTabulatorMetadata extends Route {
    name = "db-tabulator-metadata";

    subscriptions: Set<string>;

    /**
     * Store metadata along with last update.
     * In cronjob, query rows WHERE last_update < toTimestamp(now() - interval '1' day * interval);
     * metadata schema:
     *  page string
     *  idx int
     *  interval int
     *  last_update timestamp
     *
     */

    async init() {
        super.init();
        this.log('[S] Started');
        this.subscriptions = new Set((await new bot.Category(SUBSCRIPTIONS_CATEGORY).pages()).map(e => e.title));
        await metadataStore.init();
        if (metadataStore instanceof HybridMetadataStore) {
            while (metadataStore.activeStore instanceof NoMetadataStore) {
                this.log("[E] Active store is NoMetadataStore, which cannot be used for collecting metadata");
                // XXX: this is problematic as until init() completes, all messages are buffered
                await bot.sleep(10000); // TODO: exponential backoff
                await metadataStore.init();
            }
        }
        await this.refreshExistingMetadata();
    }

    filter(data): boolean {
        return data.wiki === 'enwiki' &&
            ((data.type === 'categorize' && data.title === 'Category:' + SUBSCRIPTIONS_CATEGORY) ||
            (data.type === 'edit' && this.subscriptions.has(data.title) && data.user !== BOT_NAME));
    }

    async worker(data) {
        if (data.type === 'categorize') {
            let page = pageFromCategoryEvent(data);
            if (page.added) {
                this.subscriptions.add(page.title);
            } else {
                this.subscriptions.delete(page.title);
            }
            this.updateMetadata(page.title);
        } else {
            this.updateMetadata(data.title);
        }
    }

    async updateMetadata(page: string) {
        this.log(`[+] Updating metadata for ${page}`);
        const queries = await fetchQueriesForPage(page);
        queries.forEach(q => q.parseQuery());
        metadataStore.updateMetadata(page, queries);
    }

    async refreshExistingMetadata() {
        await bot.batchOperation([...this.subscriptions], page => this.updateMetadata(page), 10);
        // Remove pre-existing rows in db which are no longer in subscriptions
        await metadataStore.removeOthers(this.subscriptions);
    }
}
