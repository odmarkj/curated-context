/**
 * Entity / Knowledge Graph (Phase 2.1)
 *
 * Lightweight entity model layered on top of the memory store.
 * Entities represent things (tools, services, dependencies, etc.)
 * with typed relationships between them.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
// --- Database ---
function storeDir() {
    const ccDir = process.env.CC_DIR || join(homedir(), '.curated-context');
    return join(ccDir, 'store');
}
function projectHash(projectRoot) {
    if (projectRoot === '__global__')
        return 'global';
    return createHash('md5').update(projectRoot).digest('hex').slice(0, 12);
}
const entityDbCache = new Map();
function getEntityDb(projectRoot) {
    const dir = storeDir();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${projectHash(projectRoot)}.db`);
    const cached = entityDbCache.get(path);
    if (cached) {
        try {
            cached.pragma('journal_mode');
            return cached;
        }
        catch {
            entityDbCache.delete(path);
        }
    }
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    // Entity tables (colocated in the same DB as memories)
    db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      state TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entity_relationships (
      subject_id TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object_id TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (subject_id, predicate, object_id),
      FOREIGN KEY (subject_id) REFERENCES entities(id),
      FOREIGN KEY (object_id) REFERENCES entities(id)
    );

    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    CREATE INDEX IF NOT EXISTS idx_entity_rel_subject ON entity_relationships(subject_id);
    CREATE INDEX IF NOT EXISTS idx_entity_rel_object ON entity_relationships(object_id);
  `);
    entityDbCache.set(path, db);
    return db;
}
// --- 4-Tier Entity Dedup ---
function normalizeEntityName(name) {
    return name.toLowerCase().trim();
}
function stemName(name) {
    // Simple stemming: lowercase, remove common suffixes, strip non-alpha
    return name.toLowerCase()
        .replace(/\.js$|\.ts$|\.py$|\.rs$/i, '')
        .replace(/[^a-z0-9]/g, '');
}
/**
 * Find an existing entity matching the given name using 4-tier dedup:
 * 1. Exact match
 * 2. Case-insensitive match
 * 3. Stemmed match
 * 4. (Embedding similarity — deferred, requires vector store)
 */
function findExistingEntity(db, name, type) {
    // Tier 1: exact name match
    const exact = db.prepare('SELECT * FROM entities WHERE name = ? AND type = ?').get(name, type);
    if (exact)
        return rowToEntity(exact);
    // Tier 2: case-insensitive
    const normalized = normalizeEntityName(name);
    const rows = db.prepare('SELECT * FROM entities WHERE type = ?').all(type);
    for (const row of rows) {
        if (normalizeEntityName(row.name) === normalized)
            return rowToEntity(row);
    }
    // Tier 3: stemmed
    const stemmed = stemName(name);
    for (const row of rows) {
        if (stemName(row.name) === stemmed)
            return rowToEntity(row);
    }
    return null;
}
function rowToEntity(row) {
    return {
        id: row.id,
        name: row.name,
        type: row.type,
        state: row.state || undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function generateEntityId(name, type) {
    return createHash('md5').update(`${type}:${name.toLowerCase()}`).digest('hex').slice(0, 12);
}
// --- Public API ---
/**
 * Create or update an entity, using 4-tier dedup to avoid duplicates.
 */
export function upsertEntity(projectRoot, name, type, state) {
    const db = getEntityDb(projectRoot);
    const now = Date.now();
    const existing = findExistingEntity(db, name, type);
    if (existing) {
        // Update state if provided
        if (state && state !== existing.state) {
            db.prepare('UPDATE entities SET state = ?, updated_at = ? WHERE id = ?')
                .run(state, now, existing.id);
            existing.state = state;
            existing.updatedAt = now;
        }
        return existing;
    }
    // Create new entity
    const id = generateEntityId(name, type);
    db.prepare('INSERT OR REPLACE INTO entities (id, name, type, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, name, type, state || null, now, now);
    return { id, name, type, state, createdAt: now, updatedAt: now };
}
/**
 * Create a relationship between two entities.
 */
export function addRelationship(projectRoot, subjectId, predicate, objectId, confidence = 1.0) {
    const db = getEntityDb(projectRoot);
    db.prepare(`INSERT OR REPLACE INTO entity_relationships (subject_id, predicate, object_id, confidence, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(subjectId, predicate, objectId, confidence, Date.now());
}
/**
 * Query entities by type.
 */
export function getEntitiesByType(projectRoot, type) {
    const db = getEntityDb(projectRoot);
    const rows = db.prepare('SELECT * FROM entities WHERE type = ? ORDER BY updated_at DESC').all(type);
    return rows.map(rowToEntity);
}
/**
 * Query relationships for an entity.
 */
export function getRelationships(projectRoot, entityId) {
    const db = getEntityDb(projectRoot);
    const rows = db.prepare(`
    SELECT * FROM entity_relationships
    WHERE subject_id = ? OR object_id = ?
    ORDER BY created_at DESC
  `).all(entityId, entityId);
    return rows.map((r) => ({
        subjectId: r.subject_id,
        predicate: r.predicate,
        objectId: r.object_id,
        confidence: r.confidence,
        createdAt: r.created_at,
    }));
}
/**
 * Close all cached entity database connections.
 */
export function closeAllEntityDbs() {
    for (const db of entityDbCache.values()) {
        try {
            db.close();
        }
        catch { /* ignore */ }
    }
    entityDbCache.clear();
}
//# sourceMappingURL=entity-store.js.map