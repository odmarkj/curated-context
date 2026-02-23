import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.js';
import { writeClaudeMdSection } from '../../../src/storage/claude-md.js';
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

const now = Date.now();

const SAMPLE_MEMORIES = {
  color: {
    key: 'primary-color',
    category: 'design',
    value: 'blue-600',
    confidence: 0.9,
    createdAt: now,
    updatedAt: now,
    sessionId: 's1',
  },
  orm: {
    key: 'orm',
    category: 'architecture',
    value: 'Drizzle',
    confidence: 0.9,
    createdAt: now,
    updatedAt: now,
    sessionId: 's1',
  },
};

describe('writeClaudeMdSection', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('creates new CLAUDE.md with markers when file does not exist', () => {
    const store = makeStore(env.projectRoot, SAMPLE_MEMORIES);
    writeClaudeMdSection(env.projectRoot, store);

    const claudeMdPath = join(env.projectRoot, 'CLAUDE.md');
    expect(existsSync(claudeMdPath)).toBe(true);

    const content = readFileSync(claudeMdPath, 'utf8');
    expect(content).toContain('<!-- curated-context:start -->');
    expect(content).toContain('<!-- curated-context:end -->');
    expect(content).toContain('blue-600');
  });

  it('replaces existing marker section preserving surrounding content', () => {
    const claudeMdPath = join(env.projectRoot, 'CLAUDE.md');
    writeFileSync(
      claudeMdPath,
      '# My Project\n\nSome notes.\n\n<!-- curated-context:start -->\nold stuff\n<!-- curated-context:end -->\n\n## Footer\n',
    );

    const store = makeStore(env.projectRoot, SAMPLE_MEMORIES);
    writeClaudeMdSection(env.projectRoot, store);

    const content = readFileSync(claudeMdPath, 'utf8');
    expect(content).toContain('# My Project');
    expect(content).toContain('## Footer');
    expect(content).not.toContain('old stuff');
    expect(content).toContain('blue-600');
  });

  it('includes Memory Protocol for project CLAUDE.md', () => {
    const store = makeStore(env.projectRoot, SAMPLE_MEMORIES);
    writeClaudeMdSection(env.projectRoot, store);

    const content = readFileSync(join(env.projectRoot, 'CLAUDE.md'), 'utf8');
    expect(content).toContain('Memory Protocol');
    expect(content).toContain('decisions.log');
  });

  it('omits Memory Protocol for global CLAUDE.md (null projectRoot)', () => {
    mkdirSync(join(env.base, '.claude'), { recursive: true });
    const store = makeStore('__global__', SAMPLE_MEMORIES);
    writeClaudeMdSection(null, store);

    const content = readFileSync(env.globalClaudeMd, 'utf8');
    expect(content).toContain('<!-- curated-context:start -->');
    expect(content).not.toContain('Memory Protocol');
  });

  it('uses .claude/CLAUDE.md if it already exists', () => {
    const dotClaudeMd = join(env.projectRoot, '.claude', 'CLAUDE.md');
    writeFileSync(dotClaudeMd, '# Existing\n');

    const store = makeStore(env.projectRoot, SAMPLE_MEMORIES);
    writeClaudeMdSection(env.projectRoot, store);

    const content = readFileSync(dotClaudeMd, 'utf8');
    expect(content).toContain('<!-- curated-context:start -->');
    expect(content).toContain('blue-600');
  });
});
