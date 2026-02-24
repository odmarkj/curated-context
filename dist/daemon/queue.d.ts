export interface SessionEvent {
    timestamp: number;
    sessionId: string;
    projectRoot: string;
    transcriptHash: string;
    messageCount: number;
    toolEventCount: number;
    transcriptPath: string;
}
export interface PendingSession {
    sessionId: string;
    events: SessionEvent[];
    latestTranscriptPath: string;
    projectRoot: string;
}
export declare function ensureDirectories(): void;
export declare function getPendingSessions(): PendingSession[];
export declare function markSessionProcessed(sessionId: string): void;
export declare function getQueueDepth(): number;
/**
 * Get pending sessions from a project-local sessions directory.
 * Used when daemon receives a POST with projectRoot (devcontainer support).
 */
export declare function getProjectSessions(projectRoot: string): PendingSession[];
/**
 * Mark a session processed in the project-local sessions directory.
 * Cleans up session, hash, and transcript files.
 */
export declare function markProjectSessionProcessed(projectRoot: string, sessionId: string): void;
//# sourceMappingURL=queue.d.ts.map