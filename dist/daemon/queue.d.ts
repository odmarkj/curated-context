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
//# sourceMappingURL=queue.d.ts.map