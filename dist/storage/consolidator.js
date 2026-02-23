import Anthropic from '@anthropic-ai/sdk';
import { loadStore, saveStore } from './memory-store.js';
import { writeRulesFiles } from './rules-writer.js';
import { writeClaudeMdSection } from './claude-md.js';
const CONSOLIDATION_THRESHOLD = 20; // Consolidate every N extractions
const MAX_ENTRIES_BEFORE_CONSOLIDATION = 100;
/**
 * Check if consolidation is needed for a project.
 */
export function needsConsolidation(projectRoot) {
    const store = loadStore(projectRoot);
    const entryCount = Object.keys(store.memories).length;
    if (entryCount >= MAX_ENTRIES_BEFORE_CONSOLIDATION)
        return true;
    // Check if enough time has passed since last consolidation
    const daysSinceLast = (Date.now() - store.lastConsolidated) / 86400_000;
    if (daysSinceLast > 7 && entryCount > 20)
        return true;
    return false;
}
/**
 * Consolidate memories using the Claude API.
 * Merges duplicates, resolves contradictions, removes obsolete entries.
 */
export async function consolidateMemories(projectRoot) {
    const store = loadStore(projectRoot);
    const memories = Object.values(store.memories);
    if (memories.length < 5)
        return; // Not enough to consolidate
    const client = new Anthropic();
    const memoriesJson = memories.map((m) => ({
        key: m.key,
        category: m.category,
        value: m.value,
        confidence: m.confidence,
        age_days: Math.floor((Date.now() - m.updatedAt) / 86400_000),
    }));
    try {
        const response = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            system: `You are a memory consolidation agent. Given a set of project memories:

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
}`,
            messages: [
                {
                    role: 'user',
                    content: JSON.stringify(memoriesJson),
                },
            ],
        });
        const text = response.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('');
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch)
            return;
        const result = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(result.keep))
            return;
        // Rebuild store with consolidated memories
        const now = Date.now();
        const newMemories = {};
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
        writeClaudeMdSection(projectRoot, store);
        console.log(`[cc] Consolidated ${memories.length} → ${Object.keys(newMemories).length} memories` +
            (result.reason ? `: ${result.reason}` : ''));
    }
    catch (error) {
        console.error('[cc] Consolidation failed:', error);
    }
}
//# sourceMappingURL=consolidator.js.map