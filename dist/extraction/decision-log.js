import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
const DECISION_LOG_FILENAME = 'decisions.log';
// Matches [category] or [global:category] followed by key: value
const LINE_PATTERN = /^\[(?:(global):)?(\w+)\]\s+(.+?):\s+(.+)$/;
function ccDir() {
    return process.env.CC_DIR || join(homedir(), '.curated-context');
}
/**
 * Parse .claude/decisions.log written by the running Claude session
 * via the Memory Protocol instruction in CLAUDE.md.
 *
 * Format: [category] key: value           (project-scoped)
 *         [global:category] key: value    (global-scoped)
 */
export function parseDecisionLog(projectRoot) {
    const logPath = join(projectRoot, '.claude', DECISION_LOG_FILENAME);
    return parseLogFile(logPath);
}
/**
 * Parse the global decision log at ~/.curated-context/decisions.log
 * All entries from this file are scoped as global.
 */
export function parseGlobalDecisionLog() {
    const logPath = join(ccDir(), DECISION_LOG_FILENAME);
    return parseLogFile(logPath, 'global');
}
function parseLogFile(logPath, forceScope) {
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
            const isGlobalPrefix = match[1] === 'global';
            entries.push({
                category: match[2].toLowerCase(),
                key: match[3].trim(),
                value: match[4].trim(),
                confidence: 0.9, // High — Claude explicitly tagged this
                scope: forceScope ?? (isGlobalPrefix ? 'global' : 'project'),
            });
        }
    }
    return entries;
}
/**
 * Clear processed entries from the project decision log.
 */
export function clearDecisionLog(projectRoot) {
    const logPath = join(projectRoot, '.claude', DECISION_LOG_FILENAME);
    clearLogFile(logPath);
}
/**
 * Clear processed entries from the global decision log.
 */
export function clearGlobalDecisionLog() {
    const logPath = join(ccDir(), DECISION_LOG_FILENAME);
    clearLogFile(logPath);
}
function clearLogFile(logPath) {
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