import {Route} from "../app";
import {RecentChangeStreamEvent} from "../RecentChangeStreamEvent";
import {bot} from "../../botbase";
import {arrayChunk, setDifference} from "../../utils";
import {Template} from "mwn/build/wikitext";
import {ActionQueue, BufferedQueue} from "../../queue";
import {ApiPurgeParams} from "mwn/build/api_params";

export default class Purger extends Route {
    readonly name = "purger";

    readonly CONF_PAGE = "User:MDanielsBot/Purge list";

    scheduledPurges: Map<PurgeEntry, NodeJS.Timeout> = new Map();

    purgeBatchQueue = new BufferedQueue<PurgeEntry>(2000, this.queuePurgeRequest.bind(this));
    purgeRequestQueue = new ActionQueue<ApiPurgeParams>(1, this.executePurgeRequest.bind(this));

    async init() {
        super.init();
        const entries = await this.parseEntries();
        this.registerChanges(entries, new Set(), true);
    }

    filter(data: RecentChangeStreamEvent): boolean {
        return data.wiki === 'commonswiki' && data.type === 'edit' && data.title === this.CONF_PAGE;
    }

    async worker(data: RecentChangeStreamEvent) {
        const entries = await this.parseEntries();

        const addedEntries = setDifference(entries, new Set(this.scheduledPurges.keys()));
        const removedEntries = setDifference(new Set(this.scheduledPurges.keys()), entries);

        this.registerChanges(addedEntries, removedEntries);
    }

    registerChanges(addedEntries: Set<PurgeEntry>, removedEntries: Set<PurgeEntry>, onRestart = false) {
        for (let entry of removedEntries) {
            clearInterval(this.scheduledPurges.get(entry));
            this.scheduledPurges.delete(entry);
        }
        for (let entry of addedEntries) {
            if (!Number.isNaN(entry.intervalDays)) {
                const interval = entry.intervalDays * 8.64e7;
                this.scheduledPurges.set(entry, setInterval(() => this.purgeBatchQueue.push(entry), interval));
            } else {
                if (!onRestart) {
                    // no interval, so trigger a one-off purge
                    this.purgeBatchQueue.push(entry);
                }
            }
        }
        // XXX: if there are multiple {{database report}}s on a page, update of one would trigger unnecessary
        // one-off purges of pages in other query results.
        // If we purge only newly added links, we may miss pages which actually need to be re-purged.
    }

    async queuePurgeRequest(entries: Array<PurgeEntry>) {
        // 3 permutations
        [
            entries.filter(e => e.forceRecursiveLinkUpdate),
            entries.filter(e => e.forceLinkUpdate && !e.forceRecursiveLinkUpdate),
            entries.filter(e => !e.forceLinkUpdate && !e.forceRecursiveLinkUpdate),
        ].forEach(batch => {
            const subBatches = arrayChunk(batch, 20);
            subBatches.forEach(subBatch => {
                this.purgeRequestQueue.push({
                    action: 'purge',
                    titles: subBatch.map(e => e.page),
                    forcelinkupdate: subBatch[0].forceLinkUpdate,
                    forcerecursivelinkupdate: subBatch[0].forceRecursiveLinkUpdate,
                });
            });
        });
    }

    async executePurgeRequest(purgeParams: ApiPurgeParams) {
        try {
            const response = await bot.request(purgeParams);
            const invalidPurges = response.purge.filter(r => r.invalid);
            this.log(`[+] Purged batch of ${purgeParams.titles.length} pages` +
                (invalidPurges.length ? `, of which ${invalidPurges.length} were invalid` : ''));
            if (invalidPurges.length) {
                this.log(`[E] Invalid purges: ${invalidPurges.map(e => e.title)}`);
            }
            await bot.sleep(1000); // Sleep interval between successive purges
        } catch (e) {
            this.log(`[V] Failed to purge titles ${purgeParams.titles}`);
            this.log(`[E] Failed to purge batch of ${purgeParams.titles.length} pages`);
            this.log(e);
            await bot.sleep(500);
        }
    }

    async parseEntries() {
        const rev = (await bot.read(this.CONF_PAGE, { rvprop: ['content', 'timestamp', 'ids'] })).revisions[0];
        const text = rev.content;
        const entries = bot.Wikitext.parseTemplates(text, {
            namePredicate: name => name === '/Entry'
        });
        this.log(`[V] Parsed ${entries.length} titles from ${this.CONF_PAGE} (revid ${rev.revid})`);

        const existingEntries = Object.fromEntries(
            [...this.scheduledPurges.keys()].map(e => [e.serialize(), e])
        );
        const parsedEntries = entries.map(e => new PurgeEntry(e))
            // filter out invalid ones
            .filter(e => e.page)
            // use reference to existing entry if present, as that facilitates easy setDifference
            .map(e => existingEntries[e.serialize()] ?? e);

        return new Set(parsedEntries);
    }

}

class PurgeEntry {
    page: string
    intervalDays: number
    forceLinkUpdate: boolean
    forceRecursiveLinkUpdate: boolean
    constructor(entry: Template) {
        const pageParam = entry.getParam(1) || entry.getParam('page');
        if (!pageParam) {
            return;
        }
        // strip link syntax from page name, maybe generated due to database report
        this.page = pageParam.value.replace(/^\s*\[\[(.*?)\]\]\s*$/, '$1');
        this.intervalDays = parseInt(entry.getParam('interval')?.value);

        // any non-empty value represents true!
        this.forceLinkUpdate = Boolean(entry.getParam('forcelinkupdate')?.value);
        this.forceRecursiveLinkUpdate = Boolean(entry.getParam('forcerecursivelinkupdate')?.value);
    }
    serialize() {
        return `${this.page}__${this.intervalDays}__${this.forceLinkUpdate}__${this.forceRecursiveLinkUpdate}`;
    }
}
