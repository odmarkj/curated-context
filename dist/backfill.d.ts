export interface BackfillOptions {
    projectPath: string;
    dryRun?: boolean;
    skipApi?: boolean;
    noRateLimit?: boolean;
    clear?: boolean;
    verbose?: boolean;
}
export interface BackfillReport {
    sessionsDiscovered: number;
    sessionsProcessed: number;
    sessionsSkipped: number;
    sessionsFailed: number;
    memoriesFromStructural: number;
    memoriesFromApi: number;
    apiCallsMade: number;
    totalMemories: number;
    durationMs: number;
}
interface SessionFile {
    path: string;
    sessionId: string;
    mtime: number;
    sizeBytes: number;
}
/**
 * Convert a project path to the slug format used by ~/.claude/projects/
 * e.g. /workspaces/lde-dash -> -workspaces-lde-dash
 */
export declare function projectToSlug(projectPath: string): string;
/**
 * Discover claude-mem session JSONL files for a given project.
 * Returns files sorted by modification time (oldest first).
 */
export declare function discoverClaudeMemSessions(projectPath: string): SessionFile[];
/**
 * Run backfill: process claude-mem session history through curated-context's
 * extraction pipeline to retroactively build the memory store.
 */
export declare function runBackfill(options: BackfillOptions): Promise<BackfillReport>;
/**
 * Print a human-readable backfill report.
 */
export declare function printReport(report: BackfillReport): void;
export {};
//# sourceMappingURL=backfill.d.ts.map