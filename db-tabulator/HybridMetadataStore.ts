import {MetadataStore} from "./MetadataStore";
import {Query} from "./app";
import {MariadbMetadataStore} from "./MariadbMetadataStore";
import {NoMetadataStore} from "./NoMetadataStore";

export class HybridMetadataStore implements MetadataStore {

    stores: MetadataStore[] = [
        new MariadbMetadataStore(),
        new NoMetadataStore(),
    ];
    activeStore: MetadataStore;

    async init(): Promise<void> {
        for (const store of this.stores) {
            try {
                await store.init();
                this.activeStore = store;
                break;
            } catch (e) {}
        }
    }

    getQueriesToRun() {
        return this.activeStore.getQueriesToRun();
    }

    removeOthers(pages: Set<string>) {
        return this.activeStore.removeOthers(pages);
    }

    updateLastTimestamp(query: Query) {
        return this.activeStore.updateLastTimestamp(query);
    }

    updateMetadata(page: string, queries: Query[]) {
        return this.activeStore.updateMetadata(page, queries);
    }
}
