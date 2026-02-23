import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
function storeDir() {
    const ccDir = process.env.CC_DIR || join(homedir(), '.curated-context');
    return join(ccDir, 'store');
}
const MAX_ENTRIES_PROJECT = 200;
const MAX_ENTRIES_GLOBAL = 100;
function projectHash(projectRoot) {
    if (projectRoot === '__global__')
        return 'global';
    return createHash('md5').update(projectRoot).digest('hex').slice(0, 12);
}
function storePath(projectRoot) {
    return join(storeDir(), `${projectHash(projectRoot)}.json`);
}
export function loadStore(projectRoot) {
    const dir = storeDir();
    mkdirSync(dir, { recursive: true });
    const path = storePath(projectRoot);
    if (existsSync(path)) {
        try {
            return JSON.parse(readFileSync(path, 'utf8'));
        }
        catch {
            // Corrupted store — start fresh
        }
    }
    return {
        version: 1,
        projectRoot,
        memories: {},
        lastConsolidated: 0,
        lastUpdated: 0,
    };
}
export function saveStore(projectRoot, store) {
    const dir = storeDir();
    mkdirSync(dir, { recursive: true });
    const path = storePath(projectRoot);
    const isGlobal = projectRoot === '__global__';
    const maxEntries = isGlobal ? MAX_ENTRIES_GLOBAL : MAX_ENTRIES_PROJECT;
    // Enforce size limits
    const entries = Object.entries(store.memories);
    if (entries.length > maxEntries) {
        // Sort by confidence (asc) then by updatedAt (asc) — evict lowest confidence, oldest first
        entries.sort((a, b) => {
            if (a[1].confidence !== b[1].confidence) {
                return a[1].confidence - b[1].confidence;
            }
            return a[1].updatedAt - b[1].updatedAt;
        });
        // Keep the top maxEntries
        const toKeep = entries.slice(entries.length - maxEntries);
        store.memories = Object.fromEntries(toKeep);
    }
    // Atomic write
    const tmpPath = path + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(store, null, 2));
    renameSync(tmpPath, path);
}
export function getMemoriesByCategory(store) {
    const grouped = {};
    for (const mem of Object.values(store.memories)) {
        if (!grouped[mem.category]) {
            grouped[mem.category] = [];
        }
        grouped[mem.category].push(mem);
    }
    return grouped;
}
//# sourceMappingURL=memory-store.js.map