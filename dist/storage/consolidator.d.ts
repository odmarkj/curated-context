/**
 * Check if consolidation is needed for a project.
 */
export declare function needsConsolidation(projectRoot: string): boolean;
/**
 * Consolidate memories using the Claude API.
 * Merges duplicates, resolves contradictions, removes obsolete entries.
 */
export declare function consolidateMemories(projectRoot: string): Promise<void>;
//# sourceMappingURL=consolidator.d.ts.map