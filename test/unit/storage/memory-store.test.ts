import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.js';
import { loadStore, saveStore, getMemoriesByCategory, type MemoryStore } from '../../../src/storage/memory-store.js';

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

  it('saveStore enforces MAX_ENTRIES_PROJECT (200) by evicting lowest confidence', () => {
    const store = loadStore(env.projectRoot);
    const now = Date.now();

    // Add 210 entries
    for (let i = 0; i < 210; i++) {
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

    expect(Object.keys(loaded.memories).length).toBeLessThanOrEqual(200);
    // Low confidence entries should have been evicted
    expect(loaded.memories['key-0']).toBeUndefined();
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
