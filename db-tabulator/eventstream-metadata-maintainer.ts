import {BOT_NAME, fetchQueriesForPage, SUBSCRIPTIONS_CATEGORY, metadataStore, Query} from "./app";
import {pageFromCategoryEvent, Route} from "../eventstream-router/app";
import {bot} from "../botbase";
import {HybridMetadataStore} from "./HybridMetadataStore";
import {NoMetadataStore} from "./NoMetadataStore";
import {createLocalSSHTunnel, setDifference} from "../utils";
import {ENWIKI_DB_HOST} from "../db";
import {RecentChangeStreamEvent} from "../eventstream-router/RecentChangeStreamEvent";
import {Template} from "mwn/build/wikitext";

/**
 * If there are a large number of reports, we want to identify which reports need updating without reading in the pages.
 * Use EventStream to listen to addition/removal of pages from the subscriptions category. Maintain the list in-memory
 * (restored from db on service restart). Use EventStream edit events to also keep track of edits made to pages within
 * the category. For each such edit, update metadata in the database.
 * Poll this database periodically to check for reports to update.
 */
export default class DbTabulatorMetadata extends Route {
    name = "db-tabulator-metadata";

    subscriptions: Set<string>;

     // Store metadata along with last update

    async init() {
        super.init();
        this.log('[S] Started');
        await createLocalSSHTunnel(ENWIKI_DB_HOST);
        this.subscriptions = new Set((await new bot.Category(SUBSCRIPTIONS_CATEGORY).members()).map(e => e.title));
        await metadataStore.init();
        if (metadataStore instanceof HybridMetadataStore) {
            if (metadataStore.activeStore instanceof NoMetadataStore) {
                this.log("[E] Active store is NoMetadataStore, which cannot be used for collecting metadata");
                // Retry loops are problematic as until init() completes, all messages are buffered.
                // So, just bail out after 10 minutes.
                this.log(`[E] Scheduling restart in 10 minutes`)
                setTimeout(() => {
                    // TODO: centralize this in eventstream-router core?
                    this.log(`[E] Restart triggered due to ${this.name} handler failing to init`)
                    process.exit(1);
                }, 10 * 60 * 1000);
                return Promise.reject();
            }
        }
        await this.refreshExistingMetadata();
    }

    filter(data: RecentChangeStreamEvent): boolean {
        return data.wiki === 'enwiki' &&
            ((data.type === 'categorize' && data.title === 'Category:' + SUBSCRIPTIONS_CATEGORY) ||
            ((data.type === 'edit' || (data.type === 'log' && (data.log_action === 'move' || data.log_action === 'delete')))
                && this.subscriptions.has(data.title) && data.user !== BOT_NAME));
    }

    async worker(data: RecentChangeStreamEvent) {
        if (data.type === 'categorize') {
            let page = pageFromCategoryEvent(data);
            if (page.added) {
                this.subscriptions.add(page.title);
                this.updateMetadata(page.title, true);
            } else {
                this.subscriptions.delete(page.title);
                this.updateMetadata(page.title);
            }

        } else if (data.log_action === 'move') {
            this.updateMetadata(data.title);
            this.subscriptions.delete(data.title);
            this.updateMetadata(data.log_params.target);
            this.subscriptions.add(data.log_params.target);

        } else if (data.log_action === 'delete') {
            this.updateMetadata(data.title);
            this.subscriptions.delete(data.title);

        } else { // edit
            this.updateMetadata(data.title);
        }
    }

    async updateMetadata(page: string, recordIfNone = false) {
        this.log(`[+] Updating metadata for ${page}`);
        const queries = await fetchQueriesForPage(page);
        queries.forEach(q => q.parseQuery());
        let validQueries = queries.filter(q => q.isValid);
        if (validQueries.length === 0 && recordIfNone) {
            // This deals with pages that transclude pages with reports - they are in the category but have no template.
            // Add a dummy query to the database.
            validQueries = [ new Query(new Template('{{}}'), page, 0) ];
        }
        await metadataStore.updateMetadata(page, validQueries);
    }

    /**
     * The category array may have changed with the restart, reconcile the database for newly
     * added or removed pages. Checking for untracked edits to pages in the category is not
     * necessary. They will be processed anyway as eventstream-router keeps track of last edit
     * timestamp it saw.
     */
    async refreshExistingMetadata() {
        // Remove existing rows in db which are no longer in subscriptions
        await metadataStore.removeOthers(this.subscriptions);

        // Add pages which are now present in category but are not in db
        let pagesInDb = new Set(await metadataStore.getAllPages());
        let pagesInCategory = this.subscriptions;
        let newPages = [...setDifference(pagesInCategory, pagesInDb)];
        if (newPages.length) {
            this.log(`[+] Found untracked new pages in category: ${newPages.join(', ')}`);
        }
        await bot.batchOperation(newPages, page => this.updateMetadata(page, true), 10)
            .catch((data) => {
                for (let [pg, err] of Object.entries(data.failures)) {
                    this.log(`[E] Failed updating metadata for ${pg}:`, err);
                }
            });
    }
}
