import {Query} from "./app";

export interface MetadataStore {
    init(): Promise<void>;
    updateMetadata(page: string, queries: Query[]): Promise<void>;
    getAllPages(): Promise<Array<string>>;
    removeOthers(pages: Set<string>): Promise<void>;
    updateLastTimestamp(query: Query): Promise<void>;
    recordFailure(query: Query): Promise<void>;
    getQueriesToRun(): Promise<Record<string, Query[]>>;
    getAllLuaSources(): Promise<Array<string>>;
    getPagesWithLuaSource(luaSource: string): Promise<Array<string>>;
}
