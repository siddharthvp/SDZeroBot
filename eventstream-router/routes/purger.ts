import {Route} from "../app";
import {RecentChangeStreamEvent} from "../RecentChangeStreamEvent";
import {bot} from "../../botbase";
import {setDifference} from "../../utils";

export default class Purger extends Route {
    readonly name = "purger";

    readonly CONF_PAGE = "User:SDZeroBot/Purge list";

    existingEntries: Map<string, NodeJS.Timeout> = new Map();

    async init() {
        super.init();
        const entries = await this.parseEntries();
        this.registerChanges(entries, new Set());
    }

    filter(data: RecentChangeStreamEvent): boolean {
        return data.wiki === 'enwiki' && data.title === this.CONF_PAGE;
    }

    async worker(data: RecentChangeStreamEvent) {
        const entries = await this.parseEntries();

        const addedEntries = setDifference(entries, new Set(this.existingEntries.keys()));
        const removedEntries = setDifference(new Set(this.existingEntries.keys()), entries);

        this.registerChanges(addedEntries, removedEntries);
    }

    registerChanges(addedEntries: Set<string>, removedEntries: Set<string>) {
        for (let entry of removedEntries) {
            clearInterval(this.existingEntries.get(entry));
            this.existingEntries.delete(entry);
        }
        for (let entry of addedEntries) {
            const interval = parseInt(entry.split('|')[1]) * 8.64e7;
            this.existingEntries.set(entry, setInterval(() => this.purge(entry), interval));
        }
    }

    async purge(entry: string) {
        const title = entry.split('|')[0];
        try {
            await bot.purge(title);
            this.log(`[+] Purged ${title}`);
        } catch (e) {
            this.log(`[E] Failed to purge ${title}`)
            this.log(e);
        }

    }

    async parseEntries() {
        const text = (await bot.read(this.CONF_PAGE)).revisions[0].content;
        // "title|interval"
        return new Set(text.split('\n'));
    }

}
