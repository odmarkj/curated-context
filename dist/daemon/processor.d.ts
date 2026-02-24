interface ProcessingStats {
    sessionsProcessed: number;
    memoriesFromDecisionLog: number;
    memoriesFromStructural: number;
    memoriesFromApi: number;
    apiCallsMade: number;
}
/**
 * Process all pending session files through the cascade pipeline.
 * If projectRoot is provided, also scans project-local sessions (devcontainer support).
 */
export declare function processQueue(projectRoot?: string): Promise<ProcessingStats>;
export {};
//# sourceMappingURL=processor.d.ts.map