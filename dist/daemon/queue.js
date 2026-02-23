import { readdirSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
function ccDir() {
    return process.env.CC_DIR || join(homedir(), '.curated-context');
}
function sessionsDir() {
    return join(ccDir(), 'sessions');
}
export function ensureDirectories() {
    mkdirSync(sessionsDir(), { recursive: true });
}
export function getPendingSessions() {
    ensureDirectories();
    const dir = sessionsDir();
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    const sessions = [];
    for (const file of files) {
        const filePath = join(dir, file);
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
    const dir = sessionsDir();
    const sessionFile = join(dir, `${sessionId}.jsonl`);
    const hashFile = join(dir, `${sessionId}.hash`);
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
        return readdirSync(sessionsDir()).filter((f) => f.endsWith('.jsonl')).length;
    }
    catch {
        return 0;
    }
}
//# sourceMappingURL=queue.js.map