import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.js';
import { writeRulesFiles } from '../../../src/storage/rules-writer.js';
import type { MemoryStore } from '../../../src/storage/memory-store.js';

function makeStore(projectRoot: string, memories: Record<string, any>): MemoryStore {
  return {
    version: 1,
    projectRoot,
    memories,
    lastConsolidated: 0,
    lastUpdated: Date.now(),
  };
}

describe('writeRulesFiles', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('creates cc-{category}.md files in .claude/rules/', () => {
    const store = makeStore(env.projectRoot, {
      color: {
        key: 'primary-color',
        category: 'design',
        value: 'blue-600',
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
    });

    writeRulesFiles(env.projectRoot, store);

    const rulesDir = join(env.projectRoot, '.claude', 'rules');
    const files = readdirSync(rulesDir).filter((f) => f.startsWith('cc-'));
    expect(files).toContain('cc-design.md');
    expect(files).toContain('cc-architecture.md');
  });

  it('files have frontmatter and markdown bullets', () => {
    const store = makeStore(env.projectRoot, {
      color: {
        key: 'primary-color',
        category: 'design',
        value: 'blue-600',
        confidence: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 's1',
      },
    });

    writeRulesFiles(env.projectRoot, store);

    const content = readFileSync(join(env.projectRoot, '.claude', 'rules', 'cc-design.md'), 'utf8');
    expect(content).toContain('---');
    expect(content).toContain('description:');
    expect(content).toContain('- **primary-color**: blue-600');
  });

  it('enforces 1KB size limit per file', () => {
    const memories: Record<string, any> = {};
    for (let i = 0; i < 50; i++) {
      memories[`key-${i}`] = {
        key: `a-very-long-key-name-${i}`,
        category: 'design',
        value: `This is a fairly long value string that should help us exceed the 1KB limit when repeated ${i}`,
        confidence: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now() + i,
        sessionId: 's1',
      };
    }
    const store = makeStore(env.projectRoot, memories);

    writeRulesFiles(env.projectRoot, store);

    const content = readFileSync(join(env.projectRoot, '.claude', 'rules', 'cc-design.md'), 'utf8');
    expect(Buffer.byteLength(content, 'utf8')).toBeLessThanOrEqual(1024);
  });

  it('cleans up stale cc-*.md files for removed categories', () => {
    const rulesDir = join(env.projectRoot, '.claude', 'rules');
    // Pre-create a stale file
    writeFileSync(join(rulesDir, 'cc-stale.md'), 'old content');

    const store = makeStore(env.projectRoot, {
      color: {
        key: 'primary-color',
        category: 'design',
        value: 'blue',
        confidence: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 's1',
      },
    });

    writeRulesFiles(env.projectRoot, store);

    const files = readdirSync(rulesDir);
    expect(files).not.toContain('cc-stale.md');
    expect(files).toContain('cc-design.md');
  });

  it('does nothing for __global__ projectRoot', () => {
    const store = makeStore('__global__', {});
    expect(() => writeRulesFiles('__global__', store)).not.toThrow();
  });
});
