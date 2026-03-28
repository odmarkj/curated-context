import { type ParsedTranscript } from '../extraction/transcript.js';
export interface ProcessingStats {
    sessionsProcessed: number;
    memoriesFromDecisionLog: number;
    memoriesFromStructural: number;
    memoriesFromApi: number;
    apiCallsMade: number;
}
export interface ProcessingOptions {
    skipDecisionLog?: boolean;
    skipApi?: boolean;
    skipOutputFiles?: boolean;
    skipRateLimit?: boolean;
}
/**
 * Process all pending session files through the cascade pipeline.
 * If projectRoot is provided, also scans project-local sessions (devcontainer support).
 */
export declare function processQueue(projectRoot?: string): Promise<ProcessingStats>;
/**
 * Core processing logic for a parsed transcript.
 * Reusable by both the daemon (normal flow) and backfill (claude-mem import).
 */
export declare function processSessionCore(transcript: ParsedTranscript, projectRoot: string, stats: ProcessingStats, options?: ProcessingOptions): Promise<void>;
//# sourceMappingURL=processor.d.ts.map