interface ProcessingStats {
    sessionsProcessed: number;
    memoriesFromDecisionLog: number;
    memoriesFromStructural: number;
    memoriesFromApi: number;
    apiCallsMade: number;
}
/**
 * Process all pending session files through the cascade pipeline.
 */
export declare function processQueue(): Promise<ProcessingStats>;
export {};
//# sourceMappingURL=processor.d.ts.map