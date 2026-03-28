/**
 * Compaction Resilience (Phase 2.4)
 *
 * Checkpoint/restore system for surviving Claude Code context compaction.
 * Saves high-value session discoveries before compaction, restores after.
 */
import type { StoredMemory } from './memory-store.js';
export interface Checkpoint {
    sessionId: string;
    projectRoot: string;
    timestamp: number;
    epoch: number;
    memories: CheckpointMemory[];
}
export interface CheckpointMemory {
    key: string;
    category: string;
    value: string;
    protected: boolean;
}
/**
 * Save a checkpoint of high-value memories for a session.
 * Called before context compaction.
 */
export declare function saveCheckpoint(sessionId: string, projectRoot: string, memories: StoredMemory[]): void;
/**
 * Load a checkpoint for a session, if one exists.
 */
export declare function loadCheckpoint(sessionId: string): Checkpoint | null;
/**
 * Format checkpoint memories for injection into conversation context.
 * Returns a compact markdown summary suitable for additionalContext.
 */
export declare function formatCheckpointForInjection(checkpoint: Checkpoint): string;
//# sourceMappingURL=checkpoint.d.ts.map