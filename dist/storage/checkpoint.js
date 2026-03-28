/**
 * Compaction Resilience (Phase 2.4)
 *
 * Checkpoint/restore system for surviving Claude Code context compaction.
 * Saves high-value session discoveries before compaction, restores after.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
function checkpointDir() {
    const ccDir = process.env.CC_DIR || join(homedir(), '.curated-context');
    return join(ccDir, 'checkpoints');
}
/**
 * Save a checkpoint of high-value memories for a session.
 * Called before context compaction.
 */
export function saveCheckpoint(sessionId, projectRoot, memories) {
    const dir = checkpointDir();
    mkdirSync(dir, { recursive: true });
    // Load existing checkpoint to increment epoch
    const existing = loadCheckpoint(sessionId);
    const epoch = existing ? existing.epoch + 1 : 1;
    // Select high-value memories: protected, high-confidence, or recently updated
    const highValue = memories.filter((m) => {
        if (m.status && m.status !== 'active')
            return false;
        if (m.protected)
            return true;
        if (m.confidence >= 0.85)
            return true;
        // Updated in last 30 minutes
        if (Date.now() - m.updatedAt < 30 * 60 * 1000)
            return true;
        return false;
    });
    const checkpoint = {
        sessionId,
        projectRoot,
        timestamp: Date.now(),
        epoch,
        memories: highValue.map((m) => ({
            key: m.key,
            category: m.category,
            value: m.value,
            protected: !!m.protected,
        })),
    };
    const path = join(dir, `${sessionId}.json`);
    writeFileSync(path, JSON.stringify(checkpoint, null, 2));
}
/**
 * Load a checkpoint for a session, if one exists.
 */
export function loadCheckpoint(sessionId) {
    const path = join(checkpointDir(), `${sessionId}.json`);
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return null;
    }
}
/**
 * Format checkpoint memories for injection into conversation context.
 * Returns a compact markdown summary suitable for additionalContext.
 */
export function formatCheckpointForInjection(checkpoint) {
    if (checkpoint.memories.length === 0)
        return '';
    const lines = [
        `## Session Context (restored after compaction, epoch ${checkpoint.epoch})`,
        '',
    ];
    // Group by category
    const grouped = new Map();
    for (const mem of checkpoint.memories) {
        const list = grouped.get(mem.category) || [];
        list.push(mem);
        grouped.set(mem.category, list);
    }
    for (const [category, mems] of grouped) {
        lines.push(`### ${category}`);
        for (const mem of mems) {
            const prefix = mem.protected ? '(decision) ' : '';
            lines.push(`- **${mem.key}**: ${prefix}${mem.value}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
//# sourceMappingURL=checkpoint.js.map