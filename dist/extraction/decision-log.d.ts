export interface DecisionLogEntry {
    category: string;
    key: string;
    value: string;
    confidence: number;
}
/**
 * Parse .claude/decisions.log written by the running Claude session
 * via the Memory Protocol instruction in CLAUDE.md.
 *
 * Format: [category] key: value
 */
export declare function parseDecisionLog(projectRoot: string): DecisionLogEntry[];
/**
 * Clear processed entries from the decision log.
 */
export declare function clearDecisionLog(projectRoot: string): void;
//# sourceMappingURL=decision-log.d.ts.map