import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.js';
import { loadStore, saveStore, getMemoriesByCategory, computeEffectiveConfidence, isDecisionMemory, autoProtect, searchMemories, closeAllDbs, inferTopicKey, computeContentHash, type MemoryStore, type StoredMemory } from '../../../src/storage/memory-store.js';

describe('memory-store', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('loadStore returns empty store for new project', () => {
    const store = loadStore(env.projectRoot);
    expect(store.version).toBe(1);
    expect(store.projectRoot).toBe(env.projectRoot);
    expect(Object.keys(store.memories)).toHaveLength(0);
  });

  it('saveStore writes JSON that can be loaded back', () => {
    const store = loadStore(env.projectRoot);
    store.memories['test-key'] = {
      key: 'test-key',
      category: 'design',
      value: 'blue-600',
      confidence: 0.9,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: 'sess-1',
    };
    store.lastUpdated = Date.now();

    saveStore(env.projectRoot, store);

    const loaded = loadStore(env.projectRoot);
    expect(loaded.memories['test-key']).toBeDefined();
    expect(loaded.memories['test-key'].value).toBe('blue-600');
  });

  it('saveStore enforces MAX_ENTRIES_PROJECT (1000) by evicting lowest confidence', () => {
    const store = loadStore(env.projectRoot);
    const now = Date.now();

    // Add 1010 entries
    for (let i = 0; i < 1010; i++) {
      store.memories[`key-${i}`] = {
        key: `key-${i}`,
        category: 'design',
        value: `val-${i}`,
        confidence: i < 10 ? 0.5 : 0.9, // first 10 are low confidence
        createdAt: now,
        updatedAt: now + i,
        sessionId: 'sess-1',
      };
    }

    saveStore(env.projectRoot, store);
    const loaded = loadStore(env.projectRoot);

    expect(Object.keys(loaded.memories).length).toBeLessThanOrEqual(1000);
    // Low confidence entries should have been evicted
    expect(loaded.memories['key-0']).toBeUndefined();
  });

  it('loadStore migrates memories to add lastAccessed', () => {
    const store = loadStore(env.projectRoot);
    const now = Date.now();
    // Simulate a pre-migration memory (no lastAccessed)
    store.memories['old-key'] = {
      key: 'old-key',
      category: 'design',
      value: 'old-value',
      confidence: 0.8,
      createdAt: now,
      updatedAt: now,
      sessionId: 'sess-old',
    } as StoredMemory;
    saveStore(env.projectRoot, store);

    const loaded = loadStore(env.projectRoot);
    expect(loaded.memories['old-key'].lastAccessed).toBe(now);
  });

  it('saveStore skips protected memories during eviction', () => {
    const store = loadStore(env.projectRoot);
    const now = Date.now();

    for (let i = 0; i < 1010; i++) {
      store.memories[`key-${i}`] = {
        key: `key-${i}`,
        category: 'design',
        value: `val-${i}`,
        confidence: i < 5 ? 0.1 : 0.9,
        createdAt: now,
        updatedAt: now + i,
        lastAccessed: now + i,
        sessionId: 'sess-1',
        protected: i < 5, // first 5 are low-confidence BUT protected
      };
    }

    saveStore(env.projectRoot, store);
    const loaded = loadStore(env.projectRoot);

    // Protected low-confidence entries should survive
    expect(loaded.memories['key-0']).toBeDefined();
    expect(loaded.memories['key-4']).toBeDefined();
  });

  it('saveStore evicts stale below-floor memories via TTL sweep', () => {
    const store = loadStore(env.projectRoot);
    const now = Date.now();
    const oneHundredDaysAgo = now - 100 * 24 * 60 * 60 * 1000;

    store.memories['stale'] = {
      key: 'stale',
      category: 'design',
      value: 'old-fact',
      confidence: 0.15, // low enough that power-law decay brings it to floor
      createdAt: oneHundredDaysAgo,
      updatedAt: oneHundredDaysAgo,
      lastAccessed: oneHundredDaysAgo,
      sessionId: 'sess-old',
    };
    store.memories['fresh'] = {
      key: 'fresh',
      category: 'design',
      value: 'new-fact',
      confidence: 0.3,
      createdAt: now,
      updatedAt: now,
      lastAccessed: now,
      sessionId: 'sess-new',
    };

    saveStore(env.projectRoot, store);
    const loaded = loadStore(env.projectRoot);

    expect(loaded.memories['stale']).toBeUndefined();
    expect(loaded.memories['fresh']).toBeDefined();
  });

  it('getMemoriesByCategory groups correctly', () => {
    const store: MemoryStore = {
      version: 1,
      projectRoot: env.projectRoot,
      memories: {
        color: {
          key: 'color',
          category: 'design',
          value: 'blue',
          confidence: 0.9,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          sessionId: 's1',
        },
        orm: {
          key: 'orm',
          category: 'architecture',
          value: 'Drizzle',
          confidence: 0.9,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          sessionId: 's1',
        },
        font: {
          key: 'font',
          category: 'design',
          value: 'Inter',
          confidence: 0.9,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          sessionId: 's1',
        },
      },
      lastConsolidated: 0,
      lastUpdated: Date.now(),
    };

    const grouped = getMemoriesByCategory(store);
    expect(grouped['design']).toHaveLength(2);
    expect(grouped['architecture']).toHaveLength(1);
  });
});

describe('computeEffectiveConfidence', () => {
  it('returns full confidence for recently-accessed memory', () => {
    const now = Date.now();
    const mem: StoredMemory = {
      key: 'k', category: 'design', value: 'v', confidence: 0.9,
      createdAt: now, updatedAt: now, lastAccessed: now, sessionId: 's',
    };
    expect(computeEffectiveConfidence(mem, now)).toBeCloseTo(0.9, 1);
  });

  it('decays exponentially within 3 days', () => {
    const now = Date.now();
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
    const mem: StoredMemory = {
      key: 'k', category: 'design', value: 'v', confidence: 0.9,
      createdAt: twoDaysAgo, updatedAt: twoDaysAgo, lastAccessed: twoDaysAgo, sessionId: 's',
    };
    const eff = computeEffectiveConfidence(mem, now);
    expect(eff).toBeLessThan(0.9);
    expect(eff).toBeGreaterThan(DECAY_FLOOR);
  });

  it('uses power-law decay after 3 days', () => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const mem: StoredMemory = {
      key: 'k', category: 'design', value: 'v', confidence: 0.9,
      createdAt: thirtyDaysAgo, updatedAt: thirtyDaysAgo, lastAccessed: thirtyDaysAgo, sessionId: 's',
    };
    const eff = computeEffectiveConfidence(mem, now);
    // Power-law: 0.9 * 30^(-0.3) ≈ 0.9 * 0.331 ≈ 0.298
    expect(eff).toBeGreaterThan(0.2);
    expect(eff).toBeLessThan(0.5);
  });

  it('never drops below floor', () => {
    const now = Date.now();
    const yearAgo = now - 365 * 24 * 60 * 60 * 1000;
    const mem: StoredMemory = {
      key: 'k', category: 'design', value: 'v', confidence: 0.1,
      createdAt: yearAgo, updatedAt: yearAgo, lastAccessed: yearAgo, sessionId: 's',
    };
    expect(computeEffectiveConfidence(mem, now)).toBeGreaterThanOrEqual(DECAY_FLOOR);
  });

  it('returns full confidence for protected memories', () => {
    const now = Date.now();
    const yearAgo = now - 365 * 24 * 60 * 60 * 1000;
    const mem: StoredMemory = {
      key: 'k', category: 'architecture', value: 'chose Kamal over Coolify', confidence: 0.9,
      createdAt: yearAgo, updatedAt: yearAgo, lastAccessed: yearAgo, sessionId: 's',
      protected: true,
    };
    expect(computeEffectiveConfidence(mem, now)).toBe(0.9);
  });
});

const DECAY_FLOOR = 0.05;

describe('isDecisionMemory', () => {
  it('detects "chose X over Y"', () => {
    expect(isDecisionMemory('chose Kamal over Coolify for deploys')).toBe(true);
  });

  it('detects "decided to"', () => {
    expect(isDecisionMemory('decided to use PostgreSQL')).toBe(true);
  });

  it('detects "switched from X to Y"', () => {
    expect(isDecisionMemory('switched from Prisma to Drizzle')).toBe(true);
  });

  it('detects "went with X because"', () => {
    expect(isDecisionMemory('went with Auth.js because it handles CSRF')).toBe(true);
  });

  it('does not flag normal descriptions', () => {
    expect(isDecisionMemory('primary color is blue-600')).toBe(false);
  });

  it('does not flag config values', () => {
    expect(isDecisionMemory('port: 3000')).toBe(false);
  });
});

describe('autoProtect', () => {
  it('sets protected=true for decision memories', () => {
    const mem: StoredMemory = {
      key: 'k', category: 'architecture', value: 'chose Prisma over Drizzle', confidence: 0.9,
      createdAt: Date.now(), updatedAt: Date.now(), lastAccessed: Date.now(), sessionId: 's',
    };
    autoProtect(mem);
    expect(mem.protected).toBe(true);
  });

  it('does not set protected for non-decision memories', () => {
    const mem: StoredMemory = {
      key: 'k', category: 'design', value: 'primary color is blue', confidence: 0.9,
      createdAt: Date.now(), updatedAt: Date.now(), lastAccessed: Date.now(), sessionId: 's',
    };
    autoProtect(mem);
    expect(mem.protected).toBeFalsy();
  });

  it('does not override existing protected=true', () => {
    const mem: StoredMemory = {
      key: 'k', category: 'design', value: 'just a color', confidence: 0.9,
      createdAt: Date.now(), updatedAt: Date.now(), lastAccessed: Date.now(), sessionId: 's',
      protected: true,
    };
    autoProtect(mem);
    expect(mem.protected).toBe(true);
  });
});

describe('searchMemories (FTS5)', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
    env.activate();
  });
  afterEach(() => {
    closeAllDbs();
    env.cleanup();
  });

  it('finds memories by keyword in value', () => {
    const store = loadStore(env.projectRoot);
    const now = Date.now();
    store.memories['auth-provider'] = {
      key: 'auth-provider', category: 'architecture', value: 'Uses Auth.js v5 for Next.js App Router authentication',
      confidence: 0.9, createdAt: now, updatedAt: now, lastAccessed: now, sessionId: 's1',
    };
    store.memories['color'] = {
      key: 'color', category: 'design', value: 'Primary color is blue-600',
      confidence: 0.9, createdAt: now, updatedAt: now, lastAccessed: now, sessionId: 's1',
    };
    saveStore(env.projectRoot, store);

    const results = searchMemories(env.projectRoot, 'authentication');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].key).toBe('auth-provider');
  });

  it('returns empty for no matches', () => {
    const store = loadStore(env.projectRoot);
    const now = Date.now();
    store.memories['color'] = {
      key: 'color', category: 'design', value: 'Primary color is blue-600',
      confidence: 0.9, createdAt: now, updatedAt: now, lastAccessed: now, sessionId: 's1',
    };
    saveStore(env.projectRoot, store);

    const results = searchMemories(env.projectRoot, 'kubernetes');
    expect(results).toHaveLength(0);
  });

  it('finds memories by category', () => {
    const store = loadStore(env.projectRoot);
    const now = Date.now();
    store.memories['k1'] = {
      key: 'k1', category: 'architecture', value: 'uses microservices',
      confidence: 0.9, createdAt: now, updatedAt: now, lastAccessed: now, sessionId: 's1',
    };
    store.memories['k2'] = {
      key: 'k2', category: 'design', value: 'rounded corners',
      confidence: 0.9, createdAt: now, updatedAt: now, lastAccessed: now, sessionId: 's1',
    };
    saveStore(env.projectRoot, store);

    const results = searchMemories(env.projectRoot, 'architecture');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].key).toBe('k1');
  });
});

describe('inferTopicKey', () => {
  it('generates category/key format', () => {
    expect(inferTopicKey('architecture', 'auth-model')).toBe('architecture/auth-model');
  });

  it('normalizes key separators', () => {
    expect(inferTopicKey('design', 'primary_color')).toBe('design/primary-color');
  });

  it('returns undefined for hub-only keys', () => {
    expect(inferTopicKey('config', 'error')).toBeUndefined();
    expect(inferTopicKey('config', 'system')).toBeUndefined();
  });

  it('allows keys with some hub terms mixed with specific terms', () => {
    expect(inferTopicKey('architecture', 'error-handler')).toBe('architecture/error-handler');
  });
});

describe('computeContentHash', () => {
  it('produces consistent hash for same content', () => {
    const h1 = computeContentHash('Uses Auth.js v5');
    const h2 = computeContentHash('Uses Auth.js v5');
    expect(h1).toBe(h2);
  });

  it('normalizes whitespace', () => {
    const h1 = computeContentHash('uses  auth.js   v5');
    const h2 = computeContentHash('uses auth.js v5');
    expect(h1).toBe(h2);
  });

  it('is case-insensitive', () => {
    const h1 = computeContentHash('Uses Auth.js');
    const h2 = computeContentHash('uses auth.js');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different content', () => {
    const h1 = computeContentHash('Uses Auth.js');
    const h2 = computeContentHash('Uses Passport.js');
    expect(h1).not.toBe(h2);
  });
});

describe('getMemoriesByCategory filters non-active', () => {
  it('excludes superseded memories', () => {
    const store: MemoryStore = {
      version: 1,
      projectRoot: '/test',
      memories: {
        old: {
          key: 'old', category: 'architecture', value: 'old value', confidence: 0.9,
          createdAt: Date.now(), updatedAt: Date.now(), lastAccessed: Date.now(), sessionId: 's1',
          status: 'superseded', supersededBy: 'new',
        },
        current: {
          key: 'current', category: 'architecture', value: 'new value', confidence: 0.9,
          createdAt: Date.now(), updatedAt: Date.now(), lastAccessed: Date.now(), sessionId: 's1',
          status: 'active',
        },
      },
      lastConsolidated: 0,
      lastUpdated: Date.now(),
    };

    const grouped = getMemoriesByCategory(store);
    expect(grouped['architecture']).toHaveLength(1);
    expect(grouped['architecture'][0].key).toBe('current');
  });

  it('excludes contradicted memories', () => {
    const store: MemoryStore = {
      version: 1,
      projectRoot: '/test',
      memories: {
        contradicted: {
          key: 'contradicted', category: 'design', value: 'dark mode', confidence: 0.9,
          createdAt: Date.now(), updatedAt: Date.now(), lastAccessed: Date.now(), sessionId: 's1',
          status: 'contradicted', contradictedBy: 'light',
        },
        light: {
          key: 'light', category: 'design', value: 'light mode', confidence: 0.9,
          createdAt: Date.now(), updatedAt: Date.now(), lastAccessed: Date.now(), sessionId: 's1',
          status: 'active',
        },
      },
      lastConsolidated: 0,
      lastUpdated: Date.now(),
    };

    const grouped = getMemoriesByCategory(store);
    expect(grouped['design']).toHaveLength(1);
    expect(grouped['design'][0].key).toBe('light');
  });
});
