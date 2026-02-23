import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
const DECISION_LOG_FILENAME = 'decisions.log';
const LINE_PATTERN = /^\[(\w+)\]\s+(.+?):\s+(.+)$/;
/**
 * Parse .claude/decisions.log written by the running Claude session
 * via the Memory Protocol instruction in CLAUDE.md.
 *
 * Format: [category] key: value
 */
export function parseDecisionLog(projectRoot) {
    const logPath = join(projectRoot, '.claude', DECISION_LOG_FILENAME);
    if (!existsSync(logPath)) {
        return [];
    }
    let raw;
    try {
        raw = readFileSync(logPath, 'utf8');
    }
    catch {
        return [];
    }
    const entries = [];
    const lines = raw.split('\n').filter(Boolean);
    for (const line of lines) {
        const match = line.match(LINE_PATTERN);
        if (match) {
            entries.push({
                category: match[1].toLowerCase(),
                key: match[2].trim(),
                value: match[3].trim(),
                confidence: 0.9, // High — Claude explicitly tagged this
            });
        }
    }
    return entries;
}
/**
 * Clear processed entries from the decision log.
 */
export function clearDecisionLog(projectRoot) {
    const logPath = join(projectRoot, '.claude', DECISION_LOG_FILENAME);
    if (!existsSync(logPath))
        return;
    try {
        writeFileSync(logPath, '');
    }
    catch {
        // Best effort — file may be locked by active session
    }
}
//# sourceMappingURL=decision-log.js.map