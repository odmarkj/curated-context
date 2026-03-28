/**
 * Activity Visibility (Phase 2.3)
 *
 * Event emitter for memory lifecycle events.
 * Supports SSE streaming and JSONL persistence.
 */
import type { ServerResponse } from 'http';
export type EventType = 'memory_created' | 'memory_updated' | 'memory_evicted' | 'memory_contradicted' | 'memory_superseded' | 'memory_verified' | 'extraction_started' | 'extraction_complete' | 'tier_skipped' | 'session_processed' | 'checkpoint_saved';
export interface MemoryEvent {
    type: EventType;
    timestamp: number;
    key?: string;
    category?: string;
    detail?: string;
}
/**
 * Emit a memory lifecycle event.
 * Broadcasts to SSE clients and persists to events.jsonl.
 */
export declare function emitEvent(event: MemoryEvent): void;
/**
 * Register an SSE client for event streaming.
 */
export declare function addSseClient(res: ServerResponse): void;
/**
 * Convenience emitters for common events.
 */
export declare const events: {
    memoryCreated: (key: string, category: string) => void;
    memoryUpdated: (key: string, detail?: string) => void;
    memoryEvicted: (key: string) => void;
    memoryContradicted: (key: string, by: string) => void;
    memorySuperseded: (key: string, by: string) => void;
    memoryVerified: (key: string) => void;
    extractionStarted: (tier: string) => void;
    extractionComplete: (tier: string, count: number) => void;
    tierSkipped: (tier: string, reason: string) => void;
    sessionProcessed: (sessionId: string, memoriesCount: number) => void;
    checkpointSaved: (sessionId: string, epoch: number) => void;
};
//# sourceMappingURL=events.d.ts.map