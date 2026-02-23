import { readdirSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
const CC_DIR = join(homedir(), '.curated-context');
const SESSIONS_DIR = join(CC_DIR, 'sessions');
export function ensureDirectories() {
    mkdirSync(SESSIONS_DIR, { recursive: true });
}
export function getPendingSessions() {
    ensureDirectories();
    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.jsonl'));
    const sessions = [];
    for (const file of files) {
        const filePath = join(SESSIONS_DIR, file);
        const sessionId = file.replace('.jsonl', '');
        try {
            const raw = readFileSync(filePath, 'utf8');
            const events = raw
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line));
            if (events.length === 0)
                continue;
            // Use the latest event's transcript path
            const latest = events[events.length - 1];
            sessions.push({
                sessionId,
                events,
                latestTranscriptPath: latest.transcriptPath,
                projectRoot: latest.projectRoot,
            });
        }
        catch {
            // Skip malformed session files
            continue;
        }
    }
    return sessions;
}
export function markSessionProcessed(sessionId) {
    const sessionFile = join(SESSIONS_DIR, `${sessionId}.jsonl`);
    const hashFile = join(SESSIONS_DIR, `${sessionId}.hash`);
    try {
        if (existsSync(sessionFile))
            unlinkSync(sessionFile);
    }
    catch {
        // Best effort
    }
    try {
        if (existsSync(hashFile))
            unlinkSync(hashFile);
    }
    catch {
        // Best effort
    }
}
export function getQueueDepth() {
    try {
        return readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.jsonl')).length;
    }
    catch {
        return 0;
    }
}
//# sourceMappingURL=queue.js.map