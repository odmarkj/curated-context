export interface DecisionLogEntry {
    category: string;
    key: string;
    value: string;
    confidence: number;
    scope: 'project' | 'global';
}
/**
 * Parse .claude/decisions.log written by the running Claude session
 * via the Memory Protocol instruction in CLAUDE.md.
 *
 * Format: [category] key: value           (project-scoped)
 *         [global:category] key: value    (global-scoped)
 */
export declare function parseDecisionLog(projectRoot: string): DecisionLogEntry[];
/**
 * Parse the global decision log at ~/.curated-context/decisions.log
 * All entries from this file are scoped as global.
 */
export declare function parseGlobalDecisionLog(): DecisionLogEntry[];
/**
 * Clear processed entries from the project decision log.
 */
export declare function clearDecisionLog(projectRoot: string): void;
/**
 * Clear processed entries from the global decision log.
 */
export declare function clearGlobalDecisionLog(): void;
//# sourceMappingURL=decision-log.d.ts.map