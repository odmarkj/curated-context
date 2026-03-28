import { readFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import Database from 'better-sqlite3';
function storeDir() {
    const ccDir = process.env.CC_DIR || join(homedir(), '.curated-context');
    return join(ccDir, 'store');
}
const MAX_ENTRIES_PROJECT = 1000;
const MAX_ENTRIES_GLOBAL = 500;
// Decay constants
const CONSOLIDATION_LAMBDA = 0.02; // exponential decay rate (per hour) for <3 days
const POWER_LAW_EXPONENT = -0.3; // power-law exponent for ≥3 days
const DECAY_FLOOR = 0.05; // effective confidence never drops below this
const CONSOLIDATION_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000; // 3 days in ms
const EVICTION_THRESHOLD_DAYS = 90; // evict below-floor memories older than this
/**
 * Compute effective confidence using hybrid decay model:
 * - Exponential decay during consolidation phase (<3 days)
 * - Power-law decay for long-term (≥3 days)
 * Protected memories are exempt from decay.
 */
export function computeEffectiveConfidence(mem, now) {
    if (mem.protected)
        return mem.confidence;
    const currentTime = now ?? Date.now();
    const msSinceAccess = currentTime - (mem.lastAccessed || mem.updatedAt);
    if (msSinceAccess <= 0)
        return mem.confidence;
    let decayFactor;
    if (msSinceAccess < CONSOLIDATION_THRESHOLD_MS) {
        // Exponential decay: e^(-λ * hours)
        const hours = msSinceAccess / (60 * 60 * 1000);
        decayFactor = Math.exp(-CONSOLIDATION_LAMBDA * hours);
    }
    else {
        // Power-law decay: days^(-0.3)
        const days = msSinceAccess / (24 * 60 * 60 * 1000);
        decayFactor = Math.pow(days, POWER_LAW_EXPONENT);
    }
    return Math.max(mem.confidence * decayFactor, DECAY_FLOOR);
}
/**
 * Touch a memory's lastAccessed timestamp (reactivation).
 */
export function touchMemory(mem) {
    mem.lastAccessed = Date.now();
}
// Decision language patterns for auto-protection
const DECISION_PATTERNS = [
    /chose\s+.+\s+over\b/i,
    /decided\s+to\b/i,
    /switched\s+from\s+.+\s+to\b/i,
    /went\s+with\s+.+\s+because\b/i,
    /rejected\s+.+\s+in\s+favor\s+of\b/i,
    /picked\s+.+\s+instead\s+of\b/i,
    /migrat(?:ed|ing)\s+(?:from|to)\b/i,
    /(?:will|going to)\s+use\s+.+\s+(?:for|as|instead)\b/i,
];
/**
 * Check if a memory value contains decision language.
 */
export function isDecisionMemory(value) {
    return DECISION_PATTERNS.some((pattern) => pattern.test(value));
}
/**
 * Auto-protect a memory if it contains decision language.
 */
export function autoProtect(mem) {
    if (!mem.protected && isDecisionMemory(mem.value)) {
        mem.protected = true;
    }
}
// Hub exclusion list — over-generic terms that pollute topic key matching
const HUB_TERMS = new Set([
    'error', 'system', 'claude', 'file', 'code', 'project', 'config',
    'test', 'build', 'run', 'fix', 'update', 'change', 'add', 'remove',
]);
/**
 * Generate a topic key from category + normalized key.
 * Returns undefined for hub-only keys.
 */
export function inferTopicKey(category, key) {
    // Normalize: lowercase, replace separators with /
    const normalized = key.toLowerCase().replace(/[-_\s]+/g, '-');
    const words = normalized.split('-').filter(Boolean);
    // If all words are hub terms, skip topic key assignment
    if (words.every((w) => HUB_TERMS.has(w)))
        return undefined;
    return `${category}/${normalized}`;
}
/**
 * Compute SHA-256 content hash for deduplication.
 */
export function computeContentHash(value) {
    const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
    return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
function projectHash(projectRoot) {
    if (projectRoot === '__global__')
        return 'global';
    return createHash('md5').update(projectRoot).digest('hex').slice(0, 12);
}
// --- SQLite database management ---
const SCHEMA_VERSION = 1;
function dbPath(projectRoot) {
    return join(storeDir(), `${projectHash(projectRoot)}.db`);
}
function jsonStorePath(projectRoot) {
    return join(storeDir(), `${projectHash(projectRoot)}.json`);
}
// Cache open database handles per path to avoid repeated opens
const dbCache = new Map();
function getDb(projectRoot) {
    const path = dbPath(projectRoot);
    const cached = dbCache.get(path);
    if (cached) {
        try {
            // Verify the handle is still valid
            cached.pragma('journal_mode');
            return cached;
        }
        catch {
            dbCache.delete(path);
        }
    }
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    initSchema(db);
    dbCache.set(path, db);
    return db;
}
function initSchema(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      key TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL NOT NULL,
      source TEXT,
      file_pattern TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_accessed INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      protected INTEGER NOT NULL DEFAULT 0,
      topic_key TEXT,
      revision_count INTEGER NOT NULL DEFAULT 1,
      content_hash TEXT,
      duplicate_count INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      superseded_by TEXT,
      contradicted_by TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      observed_sessions INTEGER NOT NULL DEFAULT 1,
      helpfulness_ema REAL NOT NULL DEFAULT 0.5
    );

    CREATE INDEX IF NOT EXISTS idx_memories_topic_key ON memories(topic_key);
    CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash);
    CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- FTS5 virtual table for full-text search
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      key, value, category,
      content=memories,
      content_rowid=rowid
    );

    -- Triggers to keep FTS index in sync (engram pattern)
    CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, key, value, category)
      VALUES (new.rowid, new.key, new.value, new.category);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, key, value, category)
      VALUES ('delete', old.rowid, old.key, old.value, old.category);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, key, value, category)
      VALUES ('delete', old.rowid, old.key, old.value, old.category);
      INSERT INTO memories_fts(rowid, key, value, category)
      VALUES (new.rowid, new.key, new.value, new.category);
    END;
  `);
    // Set schema version
    db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
}
function rowToMemory(row) {
    const mem = {
        key: row.key,
        category: row.category,
        value: row.value,
        confidence: row.confidence,
        source: row.source || undefined,
        filePattern: row.file_pattern || undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastAccessed: row.last_accessed,
        sessionId: row.session_id,
        protected: row.protected === 1 ? true : undefined,
        topicKey: row.topic_key || undefined,
        revisionCount: row.revision_count || 1,
        contentHash: row.content_hash || undefined,
        duplicateCount: row.duplicate_count || 1,
        status: row.status || 'active',
        supersededBy: row.superseded_by || undefined,
        contradictedBy: row.contradicted_by || undefined,
        verified: row.verified === 1 ? true : undefined,
        observedSessions: row.observed_sessions || 1,
        helpfulnessEma: row.helpfulness_ema ?? 0.5,
    };
    return mem;
}
/**
 * Migrate a JSON store to SQLite if the JSON file exists but the DB doesn't.
 */
function migrateJsonToSqlite(projectRoot, db) {
    const jsonPath = jsonStorePath(projectRoot);
    if (!existsSync(jsonPath))
        return;
    // Check if DB already has data (avoid double-migration)
    const count = db.prepare('SELECT COUNT(*) as cnt FROM memories').get();
    if (count.cnt > 0)
        return;
    try {
        const store = JSON.parse(readFileSync(jsonPath, 'utf8'));
        const insert = db.prepare(`
      INSERT OR REPLACE INTO memories (key, category, value, confidence, source, file_pattern,
        created_at, updated_at, last_accessed, session_id, protected,
        topic_key, revision_count, content_hash, duplicate_count,
        status, superseded_by, contradicted_by,
        verified, observed_sessions, helpfulness_ema)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const tx = db.transaction(() => {
            for (const mem of Object.values(store.memories)) {
                // Apply migrations during import
                const lastAccessed = mem.lastAccessed || mem.updatedAt;
                let isProtected = mem.protected ? 1 : 0;
                if (!mem.protected && isDecisionMemory(mem.value))
                    isProtected = 1;
                const topicKey = inferTopicKey(mem.category, mem.key);
                const contentHash = computeContentHash(mem.value);
                insert.run(mem.key, mem.category, mem.value, mem.confidence, mem.source || null, mem.filePattern || null, mem.createdAt, mem.updatedAt, lastAccessed, mem.sessionId, isProtected, topicKey || null, 1, contentHash, 1, 'active', null, null, 0, 1, 0.5);
            }
            // Store metadata
            const metaInsert = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
            metaInsert.run('project_root', store.projectRoot);
            metaInsert.run('last_consolidated', String(store.lastConsolidated || 0));
            metaInsert.run('last_updated', String(store.lastUpdated || 0));
        });
        tx();
        // Preserve JSON as backup
        const backupPath = jsonPath + '.bak';
        if (!existsSync(backupPath)) {
            renameSync(jsonPath, backupPath);
        }
    }
    catch {
        // Migration failed — DB will start empty, JSON preserved
    }
}
// --- Public API (same interface as before) ---
export function loadStore(projectRoot) {
    const dir = storeDir();
    mkdirSync(dir, { recursive: true });
    const db = getDb(projectRoot);
    migrateJsonToSqlite(projectRoot, db);
    const memories = {};
    const rows = db.prepare('SELECT * FROM memories').all();
    for (const row of rows) {
        const mem = rowToMemory(row);
        memories[mem.key] = mem;
    }
    // Read metadata
    const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
    const lastConsolidated = Number(getMeta.get('last_consolidated')?.value ?? 0);
    const lastUpdated = Number(getMeta.get('last_updated')?.value ?? 0);
    return {
        version: 1,
        projectRoot,
        memories,
        lastConsolidated,
        lastUpdated,
    };
}
export function saveStore(projectRoot, store) {
    const dir = storeDir();
    mkdirSync(dir, { recursive: true });
    const isGlobal = projectRoot === '__global__';
    const maxEntries = isGlobal ? MAX_ENTRIES_GLOBAL : MAX_ENTRIES_PROJECT;
    const now = Date.now();
    // TTL sweep: evict below-floor memories that haven't been accessed in 90+ days
    const evictionCutoff = now - EVICTION_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
    for (const [key, mem] of Object.entries(store.memories)) {
        if (mem.protected)
            continue;
        const lastTouch = mem.lastAccessed || mem.updatedAt;
        if (lastTouch < evictionCutoff && computeEffectiveConfidence(mem, now) <= DECAY_FLOOR) {
            delete store.memories[key];
        }
    }
    // Enforce size limits using effective confidence
    const entries = Object.entries(store.memories);
    if (entries.length > maxEntries) {
        entries.sort((a, b) => {
            if (a[1].protected && !b[1].protected)
                return 1;
            if (!a[1].protected && b[1].protected)
                return -1;
            const effA = computeEffectiveConfidence(a[1], now);
            const effB = computeEffectiveConfidence(b[1], now);
            if (effA !== effB)
                return effA - effB;
            return a[1].updatedAt - b[1].updatedAt;
        });
        const toKeep = entries.slice(entries.length - maxEntries);
        store.memories = Object.fromEntries(toKeep);
    }
    // Write to SQLite
    const db = getDb(projectRoot);
    const tx = db.transaction(() => {
        // Clear and rewrite (simple approach, preserves FTS trigger sync)
        db.prepare('DELETE FROM memories').run();
        const insert = db.prepare(`
      INSERT INTO memories (key, category, value, confidence, source, file_pattern,
        created_at, updated_at, last_accessed, session_id, protected,
        topic_key, revision_count, content_hash, duplicate_count,
        status, superseded_by, contradicted_by,
        verified, observed_sessions, helpfulness_ema)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        for (const mem of Object.values(store.memories)) {
            insert.run(mem.key, mem.category, mem.value, mem.confidence, mem.source || null, mem.filePattern || null, mem.createdAt, mem.updatedAt, mem.lastAccessed || mem.updatedAt, mem.sessionId, mem.protected ? 1 : 0, mem.topicKey || null, mem.revisionCount || 1, mem.contentHash || null, mem.duplicateCount || 1, mem.status || 'active', mem.supersededBy || null, mem.contradictedBy || null, mem.verified ? 1 : 0, mem.observedSessions || 1, mem.helpfulnessEma ?? 0.5);
        }
        // Update metadata
        const metaUpsert = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
        metaUpsert.run('project_root', store.projectRoot);
        metaUpsert.run('last_consolidated', String(store.lastConsolidated || 0));
        metaUpsert.run('last_updated', String(store.lastUpdated || now));
    });
    tx();
}
export function getMemoriesByCategory(store) {
    const grouped = {};
    for (const mem of Object.values(store.memories)) {
        // Only include active memories in rules output
        if (mem.status && mem.status !== 'active')
            continue;
        if (!grouped[mem.category]) {
            grouped[mem.category] = [];
        }
        grouped[mem.category].push(mem);
    }
    return grouped;
}
/**
 * Full-text search across memories using FTS5.
 * Returns memories ranked by FTS5 relevance combined with effective confidence.
 */
export function searchMemories(projectRoot, query, limit = 20) {
    const dir = storeDir();
    mkdirSync(dir, { recursive: true });
    const db = getDb(projectRoot);
    const now = Date.now();
    // FTS5 search with rank
    const rows = db.prepare(`
    SELECT m.*, fts.rank
    FROM memories_fts fts
    JOIN memories m ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ?
    ORDER BY fts.rank
    LIMIT ?
  `).all(query, limit * 2); // over-fetch for re-ranking
    const results = rows.map((row) => {
        const mem = rowToMemory(row);
        const ftsRank = Math.abs(row.rank); // FTS5 rank is negative (lower = better)
        const effConf = computeEffectiveConfidence(mem, now);
        return { mem, score: effConf * (1 + ftsRank) };
    });
    // Sort by combined score (desc) and return top results
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map((r) => r.mem);
}
/**
 * Recall memories with topic-scoped soft boosting (Phase 2.11).
 * Returns memories formatted for conversation injection.
 *
 * Unlike searchMemories (raw FTS results), recall applies:
 * - Soft topic boosting (boosts matching category, doesn't exclude others)
 * - Token budget awareness
 * - Formatted markdown output
 */
export function recallMemories(projectRoot, query, options) {
    const limit = options?.limit || 10;
    const maxTokens = options?.maxTokens || 2000;
    const topic = options?.topic;
    const now = Date.now();
    const dir = storeDir();
    mkdirSync(dir, { recursive: true });
    const db = getDb(projectRoot);
    // FTS5 search
    const rows = db.prepare(`
    SELECT m.*, fts.rank
    FROM memories_fts fts
    JOIN memories m ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ?
    ORDER BY fts.rank
    LIMIT ?
  `).all(query, limit * 3);
    const scored = rows.map((row) => {
        const mem = rowToMemory(row);
        const ftsRank = Math.abs(row.rank);
        const effConf = computeEffectiveConfidence(mem, now);
        // Soft topic boost: +30% for matching category, no penalty for non-matching
        let topicBoost = 1.0;
        if (topic && mem.category === topic)
            topicBoost = 1.3;
        if (topic && mem.topicKey?.startsWith(topic + '/'))
            topicBoost = 1.3;
        const score = effConf * (1 + ftsRank) * topicBoost;
        return { mem, score };
    });
    scored.sort((a, b) => b.score - a.score);
    // Apply token budget (rough: 4 chars per token)
    const memories = [];
    let tokenEstimate = 0;
    for (const { mem } of scored) {
        const memTokens = Math.ceil((mem.key.length + mem.value.length + 20) / 4);
        if (tokenEstimate + memTokens > maxTokens && memories.length > 0)
            break;
        memories.push(mem);
        tokenEstimate += memTokens;
        if (memories.length >= limit)
            break;
    }
    // Format as markdown for conversation injection
    const lines = [];
    for (const mem of memories) {
        const prefix = mem.protected ? '(decision) ' : '';
        const verified = mem.verified ? ' ✓' : '';
        lines.push(`- **${mem.key}**${verified}: ${prefix}${mem.value}`);
    }
    const formatted = lines.join('\n');
    return { memories, formatted };
}
/**
 * Close all cached database connections. Used in tests.
 */
export function closeAllDbs() {
    for (const db of dbCache.values()) {
        try {
            db.close();
        }
        catch { /* ignore */ }
    }
    dbCache.clear();
}
//# sourceMappingURL=memory-store.js.map