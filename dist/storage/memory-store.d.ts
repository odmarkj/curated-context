export interface StoredMemory {
    key: string;
    category: string;
    value: string;
    confidence: number;
    source?: string;
    filePattern?: string;
    createdAt: number;
    updatedAt: number;
    sessionId: string;
}
export interface MemoryStore {
    version: 1;
    projectRoot: string;
    memories: Record<string, StoredMemory>;
    lastConsolidated: number;
    lastUpdated: number;
}
export declare function loadStore(projectRoot: string): MemoryStore;
export declare function saveStore(projectRoot: string, store: MemoryStore): void;
export declare function getMemoriesByCategory(store: MemoryStore): Record<string, StoredMemory[]>;
//# sourceMappingURL=memory-store.d.ts.map