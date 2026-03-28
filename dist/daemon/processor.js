import { existsSync } from 'fs';
import { parseTranscript } from '../extraction/transcript.js';
import { parseDecisionLog, clearDecisionLog, parseGlobalDecisionLog, clearGlobalDecisionLog } from '../extraction/decision-log.js';
import { extractStructural } from '../extraction/structural.js';
import { triageMessages, classifyConversationMode } from '../extraction/triage.js';
import { extractWithClaude } from '../extraction/llm.js';
import { loadStore, saveStore, autoProtect, inferTopicKey, computeContentHash } from '../storage/memory-store.js';
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
    const transcript = parseTranscript(transcriptPath);
    await processSessionCore(transcript, projectRoot, stats);
}
/**
 * Core processing logic for a parsed transcript.
 * Reusable by both the daemon (normal flow) and backfill (claude-mem import).
 */
export async function processSessionCore(transcript, projectRoot, stats, options) {
    // Load existing store for this project
    const store = loadStore(projectRoot);
    const allNewMemories = [];
    // === Tier 1: Decision Log (highest signal, free) ===
    if (!options?.skipDecisionLog) {
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
    // === Conversation Mode Gating (Phase 2.9) ===
    const mode = classifyConversationMode(transcript.messages);
    // Casual sessions: skip Tier 3/4 entirely — structural + decision log is enough
    if (mode === 'casual') {
        if (allNewMemories.length > 0) {
            applyMemories(store, allNewMemories, transcript.sessionId);
            saveStore(projectRoot, store);
            if (!options?.skipOutputFiles) {
                writeRulesFiles(projectRoot, store);
                writeClaudeMdSection(projectRoot, store);
            }
        }
        else if (!options?.skipOutputFiles) {
            writeClaudeMdSection(projectRoot, store);
        }
        return;
    }
    // === Tier 3: Deterministic Triage (advisory) ===
    const triage = triageMessages(transcript.messages);
    // === Tier 4: Classification via claude -p ===
    // Send high-signal messages to Claude for extraction, batched to avoid overloading.
    // claude -p uses the subscription (no API key needed) and classifies better than heuristics.
    // Debugging sessions skip Tier 4 — noise dominates, structural + decision log is sufficient.
    if (!options?.skipApi && mode !== 'debugging') {
        const messagesToClassify = triage.highSignalMessages.length > 0
            ? triage.highSignalMessages
            : transcript.messages.filter((m) => m.role === 'assistant' && m.content.length > 50);
        if (messagesToClassify.length > 0) {
            // Strip code blocks to focus on commentary and decisions
            const cleanedMessages = messagesToClassify.map((msg) => ({
                ...msg,
                content: stripCodeBlocks(msg.content),
            })).filter((msg) => msg.content.length > 20);
            // Batch messages to stay within effective context.
            // Large messages (>5K chars, e.g. architecture docs) get their own batch
            // to ensure focused extraction of dense planning content.
            const BATCH_CHAR_LIMIT = 15_000;
            const batches = [];
            let currentBatch = [];
            let currentChars = 0;
            for (const msg of cleanedMessages) {
                // Large messages get their own dedicated batch
                if (msg.content.length > 5_000) {
                    if (currentBatch.length > 0) {
                        batches.push(currentBatch);
                        currentBatch = [];
                        currentChars = 0;
                    }
                    batches.push([msg]);
                    continue;
                }
                if (currentChars + msg.content.length > BATCH_CHAR_LIMIT && currentBatch.length > 0) {
                    batches.push(currentBatch);
                    currentBatch = [];
                    currentChars = 0;
                }
                currentBatch.push(msg);
                currentChars += msg.content.length;
            }
            if (currentBatch.length > 0) {
                batches.push(currentBatch);
            }
            for (const batch of batches) {
                const existingMap = {};
                for (const [key, mem] of Object.entries(store.memories)) {
                    existingMap[key] = { key: mem.key, value: mem.value };
                }
                // Include memories found so far in this session too
                for (const mem of allNewMemories) {
                    existingMap[mem.key] = { key: mem.key, value: mem.value };
                }
                const apiResult = await extractWithClaude(batch, existingMap, projectRoot, { skipRateLimit: options?.skipRateLimit });
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
                    // Handle supersedes — mark as superseded instead of deleting (audit trail)
                    for (const key of apiResult.supersedes) {
                        const superseded = store.memories[key];
                        if (superseded) {
                            superseded.status = 'superseded';
                            superseded.supersededBy = apiResult.project_memories[0]?.key || 'unknown';
                        }
                    }
                }
            }
        }
    }
    // === Write all memories to store ===
    if (allNewMemories.length > 0) {
        applyMemories(store, allNewMemories, transcript.sessionId);
        saveStore(projectRoot, store);
        // Regenerate output files (skipped during backfill — written once at the end)
        if (!options?.skipOutputFiles) {
            writeRulesFiles(projectRoot, store);
            writeClaudeMdSection(projectRoot, store);
        }
    }
    else if (!options?.skipOutputFiles) {
        // Bootstrap: write Memory Protocol to CLAUDE.md even with no memories yet,
        // so the next session knows to write to decisions.log
        writeClaudeMdSection(projectRoot, store);
    }
    // === Feedback Momentum (Phase 2.10) ===
    // Check which existing memory keys/values appear in assistant responses.
    // Update helpfulness EMA for referenced vs unreferenced memories.
    updateFeedbackMomentum(store, transcript.messages);
    saveStore(projectRoot, store);
}
const FEEDBACK_ALPHA = 0.3; // EMA smoothing factor
function updateFeedbackMomentum(store, messages) {
    // Combine all assistant text
    const assistantText = messages
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content.toLowerCase())
        .join(' ');
    if (!assistantText)
        return;
    for (const mem of Object.values(store.memories)) {
        if (mem.status && mem.status !== 'active')
            continue;
        // Check if this memory's key or value snippet appears in assistant responses
        const keyReferenced = assistantText.includes(mem.key.toLowerCase());
        const valueWords = mem.value.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
        const valueReferenced = valueWords.length > 0 &&
            valueWords.filter((w) => assistantText.includes(w)).length >= Math.min(3, valueWords.length);
        const wasUsed = keyReferenced || valueReferenced ? 1 : 0;
        const prev = mem.helpfulnessEma ?? 0.5;
        mem.helpfulnessEma = FEEDBACK_ALPHA * wasUsed + (1 - FEEDBACK_ALPHA) * prev;
    }
}
// Content hash dedup window (1 hour)
const DEDUP_WINDOW_MS = 60 * 60 * 1000;
// Simple string similarity for interference detection (Dice coefficient)
function stringSimilarity(a, b) {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    if (la === lb)
        return 1;
    if (la.length < 2 || lb.length < 2)
        return 0;
    const bigrams = new Set();
    for (let i = 0; i < la.length - 1; i++)
        bigrams.add(la.slice(i, i + 2));
    let matches = 0;
    for (let i = 0; i < lb.length - 1; i++) {
        if (bigrams.has(lb.slice(i, i + 2)))
            matches++;
    }
    return (2 * matches) / (la.length - 1 + lb.length - 1);
}
function applyMemories(store, newMemories, sessionId) {
    const now = Date.now();
    for (const mem of newMemories) {
        const topicKey = inferTopicKey(mem.category, mem.key);
        const contentHash = computeContentHash(mem.value);
        // --- Content hash dedup (Phase 1.5.6) ---
        // Check if identical content was already stored recently
        let deduplicated = false;
        for (const existing of Object.values(store.memories)) {
            if (existing.contentHash === contentHash &&
                existing.category === mem.category &&
                existing.status !== 'superseded' &&
                existing.status !== 'contradicted' &&
                (now - existing.updatedAt) < DEDUP_WINDOW_MS) {
                // Increment duplicate count, skip creating new memory
                existing.duplicateCount = (existing.duplicateCount || 1) + 1;
                existing.lastAccessed = now;
                deduplicated = true;
                break;
            }
        }
        if (deduplicated)
            continue;
        // --- Topic key upsert (Phase 1.5.5) ---
        // Check if a memory with the same topic key already exists
        let upsertTarget;
        if (topicKey) {
            for (const existing of Object.values(store.memories)) {
                if (existing.topicKey === topicKey && existing.status === 'active') {
                    upsertTarget = existing;
                    break;
                }
            }
        }
        const existing = store.memories[mem.key];
        if (upsertTarget && upsertTarget.key !== mem.key) {
            // Upsert: update existing memory in place
            upsertTarget.value = mem.value;
            upsertTarget.confidence = Math.max(upsertTarget.confidence, mem.confidence);
            upsertTarget.updatedAt = now;
            upsertTarget.lastAccessed = now;
            upsertTarget.sessionId = sessionId;
            upsertTarget.revisionCount = (upsertTarget.revisionCount || 1) + 1;
            upsertTarget.contentHash = contentHash;
            autoProtect(upsertTarget);
            continue;
        }
        // --- Interference detection (Phase 1.5.7) ---
        // Check for high-similarity memories in same category that might be contradictions
        for (const existingMem of Object.values(store.memories)) {
            if (existingMem.key !== mem.key &&
                existingMem.category === mem.category &&
                existingMem.status === 'active' &&
                stringSimilarity(existingMem.value, mem.value) >= 0.85) {
                // High similarity but different key — likely a contradiction or update
                // Suppress the older memory
                existingMem.status = 'contradicted';
                existingMem.contradictedBy = mem.key;
            }
        }
        // Track observed sessions for verification
        const prevSessions = existing?.observedSessions || 0;
        const isSameSession = existing?.sessionId === sessionId;
        const observedSessions = isSameSession ? prevSessions : prevSessions + 1;
        // Auto-verify: seen in 2+ sessions with confidence >= 0.85
        const shouldVerify = observedSessions >= 2 && mem.confidence >= 0.85;
        const stored = {
            key: mem.key,
            category: mem.category,
            value: mem.value,
            confidence: mem.confidence,
            source: mem.source,
            filePattern: mem.file_pattern,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            lastAccessed: now,
            sessionId,
            protected: existing?.protected,
            topicKey,
            revisionCount: existing?.revisionCount ? existing.revisionCount + 1 : 1,
            contentHash,
            duplicateCount: existing?.duplicateCount || 1,
            status: 'active',
            verified: existing?.verified || shouldVerify || undefined,
            observedSessions,
            helpfulnessEma: existing?.helpfulnessEma ?? 0.5,
        };
        // Auto-protect decisions (also protects decision-log Tier 1 entries)
        autoProtect(stored);
        store.memories[mem.key] = stored;
    }
    store.lastUpdated = now;
}
/**
 * Strip code blocks and inline code from message content,
 * keeping only the commentary and decision-making text.
 */
function stripCodeBlocks(content) {
    return content
        // Remove fenced code blocks (```...```)
        .replace(/```[\s\S]*?```/g, '[code]')
        // Remove indented code blocks (4+ spaces or tab at line start, consecutive lines)
        .replace(/(?:^(?:[ \t]{4,}|\t).+\n?){3,}/gm, '[code]\n')
        // Remove inline code spans
        .replace(/`[^`]+`/g, '[code]')
        // Remove long file content dumps (lines that look like file output with line numbers)
        .replace(/(?:^\s*\d+[│|:].+\n?){5,}/gm, '[file content]\n')
        // Collapse multiple blank lines
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
//# sourceMappingURL=processor.js.map