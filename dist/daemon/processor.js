import { existsSync } from 'fs';
import { parseTranscript } from '../extraction/transcript.js';
import { parseDecisionLog, clearDecisionLog, parseGlobalDecisionLog, clearGlobalDecisionLog } from '../extraction/decision-log.js';
import { extractStructural } from '../extraction/structural.js';
import { triageMessages } from '../extraction/triage.js';
import { extractWithClaude } from '../extraction/llm.js';
import { loadStore, saveStore } from '../storage/memory-store.js';
import { writeRulesFiles } from '../storage/rules-writer.js';
import { writeClaudeMdSection } from '../storage/claude-md.js';
import { getPendingSessions, markSessionProcessed, getProjectSessions, markProjectSessionProcessed } from './queue.js';
/**
 * Process all pending session files through the cascade pipeline.
 * If projectRoot is provided, also scans project-local sessions (devcontainer support).
 */
export async function processQueue(projectRoot) {
    const stats = {
        sessionsProcessed: 0,
        memoriesFromDecisionLog: 0,
        memoriesFromStructural: 0,
        memoriesFromApi: 0,
        apiCallsMade: 0,
    };
    // Get sessions from central dir
    const centralSessions = getPendingSessions();
    // Also get sessions from project-local dir if projectRoot provided
    const projectSessions = projectRoot ? getProjectSessions(projectRoot) : [];
    // Merge and deduplicate by sessionId (central takes precedence)
    const seenIds = new Set();
    const allSessions = [];
    for (const session of centralSessions) {
        seenIds.add(session.sessionId);
        allSessions.push({
            sessionId: session.sessionId,
            transcriptPath: session.latestTranscriptPath,
            projectRoot: session.projectRoot,
            isProjectLocal: false,
        });
    }
    for (const session of projectSessions) {
        if (!seenIds.has(session.sessionId)) {
            seenIds.add(session.sessionId);
            allSessions.push({
                sessionId: session.sessionId,
                transcriptPath: session.latestTranscriptPath,
                projectRoot: session.projectRoot,
                isProjectLocal: true,
            });
        }
    }
    if (allSessions.length === 0)
        return stats;
    for (const session of allSessions) {
        try {
            await processSession(session.transcriptPath, session.projectRoot, stats);
            // Clean up from both locations
            markSessionProcessed(session.sessionId);
            if (session.projectRoot) {
                markProjectSessionProcessed(session.projectRoot, session.sessionId);
            }
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
    // Parse transcript early — needed for sessionId across all tiers
    const transcript = parseTranscript(transcriptPath);
    // Load existing store for this project
    const store = loadStore(projectRoot);
    const allNewMemories = [];
    // === Tier 1: Decision Log (highest signal, free) ===
    const decisionLogEntries = parseDecisionLog(projectRoot);
    const globalDecisionLogEntries = parseGlobalDecisionLog();
    // Partition project decision log entries by scope
    const projectEntries = decisionLogEntries.filter((e) => e.scope === 'project');
    const globalFromProject = decisionLogEntries.filter((e) => e.scope === 'global');
    // All entries from the global log are global-scoped
    const allGlobalEntries = [...globalFromProject, ...globalDecisionLogEntries];
    for (const entry of projectEntries) {
        allNewMemories.push({
            category: entry.category,
            key: entry.key,
            value: entry.value,
            confidence: entry.confidence,
        });
    }
    // Route global decision log entries to global store
    if (allGlobalEntries.length > 0) {
        const globalStore = loadStore('__global__');
        const globalMemories = allGlobalEntries.map((e) => ({
            category: e.category,
            key: e.key,
            value: e.value,
            confidence: e.confidence,
        }));
        applyMemories(globalStore, globalMemories, transcript.sessionId);
        saveStore('__global__', globalStore);
        writeRulesFiles('__global__', globalStore);
        writeClaudeMdSection(null, globalStore);
    }
    stats.memoriesFromDecisionLog += projectEntries.length + allGlobalEntries.length;
    // Clear decision logs after reading
    if (decisionLogEntries.length > 0) {
        clearDecisionLog(projectRoot);
    }
    if (globalDecisionLogEntries.length > 0) {
        clearGlobalDecisionLog();
    }
    // === Tier 2: Structural Extraction (free) ===
    const structuralMemories = extractStructural(transcript.toolEvents);
    // Partition structural memories by scope
    const projectStructural = structuralMemories.filter((m) => m.scope !== 'global');
    const globalStructural = structuralMemories.filter((m) => m.scope === 'global');
    // Only add project structural memories that aren't already covered by decision log
    const decisionKeys = new Set(allNewMemories.map((m) => m.key));
    for (const mem of projectStructural) {
        if (!decisionKeys.has(mem.key)) {
            allNewMemories.push(mem);
            stats.memoriesFromStructural++;
        }
    }
    // Route global structural preferences to global store with confidence reinforcement
    if (globalStructural.length > 0) {
        const globalStore = loadStore('__global__');
        const reinforcedMemories = globalStructural.map((mem) => {
            const existing = globalStore.memories[mem.key];
            // Reinforce confidence when seen again across projects (cap at 0.9)
            const confidence = existing
                ? Math.min(0.9, existing.confidence + 0.1)
                : mem.confidence;
            return {
                category: mem.category,
                key: mem.key,
                value: mem.value,
                confidence,
            };
        });
        applyMemories(globalStore, reinforcedMemories, transcript.sessionId);
        saveStore('__global__', globalStore);
        writeRulesFiles('__global__', globalStore);
        writeClaudeMdSection(null, globalStore);
        stats.memoriesFromStructural += globalStructural.length;
    }
    // === Tier 3: Deterministic Triage (advisory) ===
    const triage = triageMessages(transcript.messages);
    // === Tier 4: Classification via claude -p ===
    // Use triage high-signal messages if available, otherwise send all assistant messages.
    // claude -p uses the subscription (no API key needed) and classifies better than heuristics.
    const messagesToClassify = triage.highSignalMessages.length > 0
        ? triage.highSignalMessages
        : transcript.messages.filter((m) => m.role === 'assistant' && m.content.length > 50);
    if (messagesToClassify.length > 0) {
        // Check if decision log + structural already captured the gist
        const existingKeys = new Set([
            ...Object.keys(store.memories),
            ...allNewMemories.map((m) => m.key),
        ]);
        // Filter out messages already captured by existing memories
        const uncapturedMessages = messagesToClassify.filter((msg) => {
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
                    writeRulesFiles('__global__', globalStore);
                    writeClaudeMdSection(null, globalStore);
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
    else {
        // Bootstrap: write Memory Protocol to CLAUDE.md even with no memories yet,
        // so the next session knows to write to decisions.log
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