import { execFile } from 'child_process';
import { promisify } from 'util';
import { loadStore, saveStore, getMemoriesByCategory, type StoredMemory } from './memory-store.js';
import { writeRulesFiles } from './rules-writer.js';
import { writeClaudeMdSection } from './claude-md.js';

const execFileAsync = promisify(execFile);

const CONSOLIDATION_THRESHOLD = 20; // Consolidate every N extractions
const MAX_ENTRIES_BEFORE_CONSOLIDATION = 100;

/**
 * Check if consolidation is needed for a project.
 */
export function needsConsolidation(projectRoot: string): boolean {
  const store = loadStore(projectRoot);
  const entryCount = Object.keys(store.memories).length;

  if (entryCount >= MAX_ENTRIES_BEFORE_CONSOLIDATION) return true;

  // Check if enough time has passed since last consolidation
  const daysSinceLast = (Date.now() - store.lastConsolidated) / 86400_000;
  if (daysSinceLast > 7 && entryCount > 20) return true;

  return false;
}

/**
 * Consolidate memories using the Claude API.
 * Merges duplicates, resolves contradictions, removes obsolete entries.
 */
export async function consolidateMemories(projectRoot: string): Promise<void> {
  const store = loadStore(projectRoot);
  const memories = Object.values(store.memories);

  if (memories.length < 5) return; // Not enough to consolidate

  const memoriesJson = memories.map((m) => ({
    key: m.key,
    category: m.category,
    value: m.value,
    confidence: m.confidence,
    age_days: Math.floor((Date.now() - m.updatedAt) / 86400_000),
  }));

  const prompt = `You are a memory consolidation agent. Given a set of project memories:

1. Merge duplicates (same concept under different keys) — keep the more descriptive one
2. Resolve contradictions — prefer newer entries (lower age_days)
3. Remove obsolete entries — things that are clearly outdated or superseded
4. Improve clarity — make values more concise where possible

Return JSON only:
{
  "keep": [
    { "key": "...", "category": "...", "value": "...", "confidence": 0.0-1.0 }
  ],
  "removed_keys": ["keys that were merged or removed"],
  "reason": "brief summary of changes"
}

Memories to consolidate:
${JSON.stringify(memoriesJson)}`;

  try {
    const { stdout } = await execFileAsync('claude', [
      '-p', prompt,
      '--output-format', 'json',
      '--max-turns', '1',
      '--model', 'sonnet',
    ], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });

    const output = JSON.parse(stdout);
    const text = typeof output.result === 'string' ? output.result : stdout;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const result = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(result.keep)) return;

    // Rebuild store with consolidated memories
    const now = Date.now();
    const newMemories: Record<string, StoredMemory> = {};

    for (const kept of result.keep) {
      const existing = store.memories[kept.key];

      newMemories[kept.key] = {
        key: kept.key,
        category: kept.category,
        value: kept.value,
        confidence: kept.confidence ?? existing?.confidence ?? 0.8,
        source: existing?.source,
        filePattern: existing?.filePattern,
        createdAt: existing?.createdAt ?? now,
        updatedAt: existing?.updatedAt ?? now,
        sessionId: existing?.sessionId ?? 'consolidation',
      };
    }

    store.memories = newMemories;
    store.lastConsolidated = now;
    store.lastUpdated = now;

    saveStore(projectRoot, store);
    writeRulesFiles(projectRoot, store);
    if (projectRoot === '__global__') {
      writeClaudeMdSection(null, store);
    } else {
      writeClaudeMdSection(projectRoot, store);
    }

    console.log(
      `[cc] Consolidated ${memories.length} → ${Object.keys(newMemories).length} memories` +
        (result.reason ? `: ${result.reason}` : ''),
    );
  } catch (error) {
    console.error('[cc] Consolidation failed:', error);
  }
}
