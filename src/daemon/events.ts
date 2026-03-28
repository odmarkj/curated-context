/**
 * Activity Visibility (Phase 2.3)
 *
 * Event emitter for memory lifecycle events.
 * Supports SSE streaming and JSONL persistence.
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ServerResponse } from 'http';

export type EventType =
  | 'memory_created'
  | 'memory_updated'
  | 'memory_evicted'
  | 'memory_contradicted'
  | 'memory_superseded'
  | 'memory_verified'
  | 'extraction_started'
  | 'extraction_complete'
  | 'tier_skipped'
  | 'session_processed'
  | 'checkpoint_saved';

export interface MemoryEvent {
  type: EventType;
  timestamp: number;
  key?: string;
  category?: string;
  detail?: string;
}

// Connected SSE clients
const sseClients = new Set<ServerResponse>();

function eventsLogPath(): string {
  const ccDir = process.env.CC_DIR || join(homedir(), '.curated-context');
  return join(ccDir, 'events.jsonl');
}

/**
 * Emit a memory lifecycle event.
 * Broadcasts to SSE clients and persists to events.jsonl.
 */
export function emitEvent(event: MemoryEvent): void {
  const json = JSON.stringify(event);

  // Persist to JSONL log
  try {
    const ccDir = process.env.CC_DIR || join(homedir(), '.curated-context');
    mkdirSync(ccDir, { recursive: true });
    appendFileSync(eventsLogPath(), json + '\n');
  } catch { /* best effort */ }

  // Broadcast to SSE clients
  for (const client of sseClients) {
    try {
      client.write(`data: ${json}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

/**
 * Register an SSE client for event streaming.
 */
export function addSseClient(res: ServerResponse): void {
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
  memoryCreated: (key: string, category: string) =>
    emitEvent({ type: 'memory_created', timestamp: Date.now(), key, category }),

  memoryUpdated: (key: string, detail?: string) =>
    emitEvent({ type: 'memory_updated', timestamp: Date.now(), key, detail }),

  memoryEvicted: (key: string) =>
    emitEvent({ type: 'memory_evicted', timestamp: Date.now(), key }),

  memoryContradicted: (key: string, by: string) =>
    emitEvent({ type: 'memory_contradicted', timestamp: Date.now(), key, detail: `contradicted by ${by}` }),

  memorySuperseded: (key: string, by: string) =>
    emitEvent({ type: 'memory_superseded', timestamp: Date.now(), key, detail: `superseded by ${by}` }),

  memoryVerified: (key: string) =>
    emitEvent({ type: 'memory_verified', timestamp: Date.now(), key }),

  extractionStarted: (tier: string) =>
    emitEvent({ type: 'extraction_started', timestamp: Date.now(), detail: tier }),

  extractionComplete: (tier: string, count: number) =>
    emitEvent({ type: 'extraction_complete', timestamp: Date.now(), detail: `${tier}: ${count} memories` }),

  tierSkipped: (tier: string, reason: string) =>
    emitEvent({ type: 'tier_skipped', timestamp: Date.now(), detail: `${tier}: ${reason}` }),

  sessionProcessed: (sessionId: string, memoriesCount: number) =>
    emitEvent({ type: 'session_processed', timestamp: Date.now(), key: sessionId, detail: `${memoriesCount} memories` }),

  checkpointSaved: (sessionId: string, epoch: number) =>
    emitEvent({ type: 'checkpoint_saved', timestamp: Date.now(), key: sessionId, detail: `epoch ${epoch}` }),
};
