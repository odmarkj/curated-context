/**
 * Compaction Resilience (Phase 2.4)
 *
 * Checkpoint/restore system for surviving Claude Code context compaction.
 * Saves high-value session discoveries before compaction, restores after.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { StoredMemory } from './memory-store.js';

function checkpointDir(): string {
  const ccDir = process.env.CC_DIR || join(homedir(), '.curated-context');
  return join(ccDir, 'checkpoints');
}

export interface Checkpoint {
  sessionId: string;
  projectRoot: string;
  timestamp: number;
  epoch: number; // increments on each compaction
  memories: CheckpointMemory[];
}

export interface CheckpointMemory {
  key: string;
  category: string;
  value: string;
  protected: boolean;
}

/**
 * Save a checkpoint of high-value memories for a session.
 * Called before context compaction.
 */
export function saveCheckpoint(
  sessionId: string,
  projectRoot: string,
  memories: StoredMemory[],
): void {
  const dir = checkpointDir();
  mkdirSync(dir, { recursive: true });

  // Load existing checkpoint to increment epoch
  const existing = loadCheckpoint(sessionId);
  const epoch = existing ? existing.epoch + 1 : 1;

  // Select high-value memories: protected, high-confidence, or recently updated
  const highValue = memories.filter((m) => {
    if (m.status && m.status !== 'active') return false;
    if (m.protected) return true;
    if (m.confidence >= 0.85) return true;
    // Updated in last 30 minutes
    if (Date.now() - m.updatedAt < 30 * 60 * 1000) return true;
    return false;
  });

  const checkpoint: Checkpoint = {
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
export function loadCheckpoint(sessionId: string): Checkpoint | null {
  const path = join(checkpointDir(), `${sessionId}.json`);
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Format checkpoint memories for injection into conversation context.
 * Returns a compact markdown summary suitable for additionalContext.
 */
export function formatCheckpointForInjection(checkpoint: Checkpoint): string {
  if (checkpoint.memories.length === 0) return '';

  const lines = [
    `## Session Context (restored after compaction, epoch ${checkpoint.epoch})`,
    '',
  ];

  // Group by category
  const grouped = new Map<string, CheckpointMemory[]>();
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
