import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.js';
import { DECISIONS_LOG } from '../../helpers/fixtures.js';
import { parseDecisionLog, clearDecisionLog } from '../../../src/extraction/decision-log.js';

describe('parseDecisionLog', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('parses valid [category] key: value lines', () => {
    mkdirSync(join(env.projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(env.projectRoot, '.claude', 'decisions.log'), DECISIONS_LOG);

    const entries = parseDecisionLog(env.projectRoot);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({
      category: 'architecture',
      key: 'orm',
      value: 'Drizzle ORM with PostgreSQL',
      confidence: 0.9,
      scope: 'project',
    });
    expect(entries[1].category).toBe('design');
    expect(entries[2].category).toBe('conventions');
    expect(entries[3].category).toBe('tooling');
  });

  it('returns empty array when file does not exist', () => {
    const entries = parseDecisionLog(env.projectRoot);
    expect(entries).toEqual([]);
  });

  it('skips lines that do not match the pattern', () => {
    mkdirSync(join(env.projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(env.projectRoot, '.claude', 'decisions.log'),
      'some random line\n[design] primary-color: blue\n# comment\n',
    );

    const entries = parseDecisionLog(env.projectRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('primary-color');
  });

  it('all entries have confidence 0.9', () => {
    mkdirSync(join(env.projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(env.projectRoot, '.claude', 'decisions.log'), DECISIONS_LOG);

    const entries = parseDecisionLog(env.projectRoot);
    for (const entry of entries) {
      expect(entry.confidence).toBe(0.9);
    }
  });
});

describe('clearDecisionLog', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('empties the file without deleting it', () => {
    mkdirSync(join(env.projectRoot, '.claude'), { recursive: true });
    const logPath = join(env.projectRoot, '.claude', 'decisions.log');
    writeFileSync(logPath, DECISIONS_LOG);

    clearDecisionLog(env.projectRoot);

    const content = readFileSync(logPath, 'utf8');
    expect(content).toBe('');
  });

  it('does nothing when file does not exist', () => {
    expect(() => clearDecisionLog(env.projectRoot)).not.toThrow();
  });
});
