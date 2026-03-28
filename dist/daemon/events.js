/**
 * Activity Visibility (Phase 2.3)
 *
 * Event emitter for memory lifecycle events.
 * Supports SSE streaming and JSONL persistence.
 */
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
// Connected SSE clients
const sseClients = new Set();
function eventsLogPath() {
    const ccDir = process.env.CC_DIR || join(homedir(), '.curated-context');
    return join(ccDir, 'events.jsonl');
}
/**
 * Emit a memory lifecycle event.
 * Broadcasts to SSE clients and persists to events.jsonl.
 */
export function emitEvent(event) {
    const json = JSON.stringify(event);
    // Persist to JSONL log
    try {
        const ccDir = process.env.CC_DIR || join(homedir(), '.curated-context');
        mkdirSync(ccDir, { recursive: true });
        appendFileSync(eventsLogPath(), json + '\n');
    }
    catch { /* best effort */ }
    // Broadcast to SSE clients
    for (const client of sseClients) {
        try {
            client.write(`data: ${json}\n\n`);
        }
        catch {
            sseClients.delete(client);
        }
    }
}
/**
 * Register an SSE client for event streaming.
 */
export function addSseClient(res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });
    // Send initial connected event
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);
    sseClients.add(res);
    res.on('close', () => {
        sseClients.delete(res);
    });
}
/**
 * Convenience emitters for common events.
 */
export const events = {
    memoryCreated: (key, category) => emitEvent({ type: 'memory_created', timestamp: Date.now(), key, category }),
    memoryUpdated: (key, detail) => emitEvent({ type: 'memory_updated', timestamp: Date.now(), key, detail }),
    memoryEvicted: (key) => emitEvent({ type: 'memory_evicted', timestamp: Date.now(), key }),
    memoryContradicted: (key, by) => emitEvent({ type: 'memory_contradicted', timestamp: Date.now(), key, detail: `contradicted by ${by}` }),
    memorySuperseded: (key, by) => emitEvent({ type: 'memory_superseded', timestamp: Date.now(), key, detail: `superseded by ${by}` }),
    memoryVerified: (key) => emitEvent({ type: 'memory_verified', timestamp: Date.now(), key }),
    extractionStarted: (tier) => emitEvent({ type: 'extraction_started', timestamp: Date.now(), detail: tier }),
    extractionComplete: (tier, count) => emitEvent({ type: 'extraction_complete', timestamp: Date.now(), detail: `${tier}: ${count} memories` }),
    tierSkipped: (tier, reason) => emitEvent({ type: 'tier_skipped', timestamp: Date.now(), detail: `${tier}: ${reason}` }),
    sessionProcessed: (sessionId, memoriesCount) => emitEvent({ type: 'session_processed', timestamp: Date.now(), key: sessionId, detail: `${memoriesCount} memories` }),
    checkpointSaved: (sessionId, epoch) => emitEvent({ type: 'checkpoint_saved', timestamp: Date.now(), key: sessionId, detail: `epoch ${epoch}` }),
};
//# sourceMappingURL=events.js.map