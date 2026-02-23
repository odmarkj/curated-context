import { existsSync } from 'fs';
import { parseTranscript } from '../extraction/transcript.js';
import { parseDecisionLog, clearDecisionLog } from '../extraction/decision-log.js';
import { extractStructural } from '../extraction/structural.js';
import { triageMessages } from '../extraction/triage.js';
import { extractWithClaude } from '../extraction/llm.js';
import { loadStore, saveStore } from '../storage/memory-store.js';
import { writeRulesFiles } from '../storage/rules-writer.js';
import { writeClaudeMdSection } from '../storage/claude-md.js';
import { getPendingSessions, markSessionProcessed } from './queue.js';
/**
 * Process all pending session files through the cascade pipeline.
 */
export async function processQueue() {
    const stats = {
        sessionsProcessed: 0,
        memoriesFromDecisionLog: 0,
        memoriesFromStructural: 0,
        memoriesFromApi: 0,
        apiCallsMade: 0,
    };
    const sessions = getPendingSessions();
    if (sessions.length === 0)
        return stats;
    for (const session of sessions) {
        try {
            await processSession(session.latestTranscriptPath, session.projectRoot, stats);
            markSessionProcessed(session.sessionId);
            stats.sessionsProcessed++;
        }
        catch (error) {
            console.error(`[cc] Failed to process session ${session.sessionId}:`, error);
        }
    }
    return stats;
}
async function processSession(transcriptPath, projectRoot, stats) {
    if (!existsSync(transcriptPath))
        return;
    // Load existing store for this project
    const store = loadStore(projectRoot);
    const allNewMemories = [];
    // === Tier 1: Decision Log (highest signal, free) ===
    const decisionLogEntries = parseDecisionLog(projectRoot);
    for (const entry of decisionLogEntries) {
        allNewMemories.push({
            category: entry.category,
            key: entry.key,
            value: entry.value,
            confidence: entry.confidence,
        });
    }
    stats.memoriesFromDecisionLog += decisionLogEntries.length;
    // Clear the decision log after reading
    if (decisionLogEntries.length > 0) {
        clearDecisionLog(projectRoot);
    }
    // === Tier 2: Structural Extraction (free) ===
    const transcript = parseTranscript(transcriptPath);
    const structuralMemories = extractStructural(transcript.toolEvents);
    // Only add structural memories that aren't already covered by decision log
    const decisionKeys = new Set(allNewMemories.map((m) => m.key));
    for (const mem of structuralMemories) {
        if (!decisionKeys.has(mem.key)) {
            allNewMemories.push(mem);
            stats.memoriesFromStructural++;
        }
    }
    // === Tier 3: Deterministic Triage (free) ===
    const triage = triageMessages(transcript.messages);
    // === Tier 4: Claude API (last resort, rate-limited) ===
    if (triage.shouldProcess && triage.highSignalMessages.length > 0) {
        // Check if decision log + structural already captured the gist
        const existingKeys = new Set([
            ...Object.keys(store.memories),
            ...allNewMemories.map((m) => m.key),
        ]);
        // Only call API if there are high-signal messages not already captured
        const uncapturedMessages = triage.highSignalMessages.filter((msg) => {
            // Simple heuristic: if any existing memory key appears in the message, it's captured
            return !Array.from(existingKeys).some((key) => msg.content.toLowerCase().includes(key.toLowerCase()));
        });
        if (uncapturedMessages.length > 0) {
            const existingMap = {};
            for (const [key, mem] of Object.entries(store.memories)) {
                existingMap[key] = { key: mem.key, value: mem.value };
            }
            const apiResult = await extractWithClaude(uncapturedMessages, existingMap, projectRoot);
            if (apiResult) {
                stats.apiCallsMade++;
                for (const mem of apiResult.project_memories) {
                    allNewMemories.push(mem);
                    stats.memoriesFromApi++;
                }
                // Handle global memories
                if (apiResult.global_memories.length > 0) {
                    const globalStore = loadStore('__global__');
                    applyMemories(globalStore, apiResult.global_memories, transcript.sessionId);
                    saveStore('__global__', globalStore);
                    writeClaudeMdSection(null, globalStore); // null = global
                }
                // Handle supersedes
                for (const key of apiResult.supersedes) {
                    delete store.memories[key];
                }
            }
        }
    }
    // === Write all memories to store ===
    if (allNewMemories.length > 0) {
        applyMemories(store, allNewMemories, transcript.sessionId);
        saveStore(projectRoot, store);
        // Regenerate output files
        writeRulesFiles(projectRoot, store);
        writeClaudeMdSection(projectRoot, store);
    }
}
function applyMemories(store, newMemories, sessionId) {
    const now = Date.now();
    for (const mem of newMemories) {
        const existing = store.memories[mem.key];
        store.memories[mem.key] = {
            key: mem.key,
            category: mem.category,
            value: mem.value,
            confidence: mem.confidence,
            source: mem.source,
            filePattern: mem.file_pattern,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            sessionId,
        };
    }
    store.lastUpdated = now;
}
//# sourceMappingURL=processor.js.map