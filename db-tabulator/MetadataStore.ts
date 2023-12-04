import {Query} from "./app";

export interface MetadataStore {
    init(): Promise<void>;
    updateMetadata(page: string, queries: Query[]): Promise<void>;
    removeOthers(pages: Set<string>): Promise<void>;
    updateLastTimestamp(query: Query): Promise<void>;
    getQueriesToRun(): Promise<Record<string, Query[]>>;
}
