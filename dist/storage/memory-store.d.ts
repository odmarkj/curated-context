/**
 * Compute effective confidence using hybrid decay model:
 * - Exponential decay during consolidation phase (<3 days)
 * - Power-law decay for long-term (≥3 days)
 * Protected memories are exempt from decay.
 */
export declare function computeEffectiveConfidence(mem: StoredMemory, now?: number): number;
/**
 * Touch a memory's lastAccessed timestamp (reactivation).
 */
export declare function touchMemory(mem: StoredMemory): void;
/**
 * Check if a memory value contains decision language.
 */
export declare function isDecisionMemory(value: string): boolean;
/**
 * Auto-protect a memory if it contains decision language.
 */
export declare function autoProtect(mem: StoredMemory): void;
export interface StoredMemory {
    key: string;
    category: string;
    value: string;
    confidence: number;
    source?: string;
    filePattern?: string;
    createdAt: number;
    updatedAt: number;
    lastAccessed: number;
    sessionId: string;
    protected?: boolean;
    topicKey?: string;
    revisionCount?: number;
    contentHash?: string;
    duplicateCount?: number;
    status?: 'active' | 'superseded' | 'contradicted';
    supersededBy?: string;
    contradictedBy?: string;
    verified?: boolean;
    observedSessions?: number;
    helpfulnessEma?: number;
}
/**
 * Generate a topic key from category + normalized key.
 * Returns undefined for hub-only keys.
 */
export declare function inferTopicKey(category: string, key: string): string | undefined;
/**
 * Compute SHA-256 content hash for deduplication.
 */
export declare function computeContentHash(value: string): string;
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
/**
 * Full-text search across memories using FTS5.
 * Returns memories ranked by FTS5 relevance combined with effective confidence.
 */
export declare function searchMemories(projectRoot: string, query: string, limit?: number): StoredMemory[];
/**
 * Recall memories with topic-scoped soft boosting (Phase 2.11).
 * Returns memories formatted for conversation injection.
 *
 * Unlike searchMemories (raw FTS results), recall applies:
 * - Soft topic boosting (boosts matching category, doesn't exclude others)
 * - Token budget awareness
 * - Formatted markdown output
 */
export declare function recallMemories(projectRoot: string, query: string, options?: {
    topic?: string;
    maxTokens?: number;
    limit?: number;
}): {
    memories: StoredMemory[];
    formatted: string;
};
/**
 * Close all cached database connections. Used in tests.
 */
export declare function closeAllDbs(): void;
//# sourceMappingURL=memory-store.d.ts.map