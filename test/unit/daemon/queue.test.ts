import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.js';
import { getPendingSessions, markSessionProcessed, getQueueDepth } from '../../../src/daemon/queue.js';

describe('queue', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('getPendingSessions returns empty array when no .jsonl files', () => {
    const sessions = getPendingSessions();
    expect(sessions).toHaveLength(0);
  });

  it('getPendingSessions parses session events and returns latest transcript path', () => {
    const event = {
      timestamp: Date.now(),
      sessionId: 'sess-1',
      projectRoot: env.projectRoot,
      transcriptHash: 'abc',
      messageCount: 4,
      toolEventCount: 2,
      transcriptPath: '/tmp/transcript.jsonl',
    };
    writeFileSync(join(env.sessionsDir, 'sess-1.jsonl'), JSON.stringify(event) + '\n');

    const sessions = getPendingSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('sess-1');
    expect(sessions[0].latestTranscriptPath).toBe('/tmp/transcript.jsonl');
    expect(sessions[0].projectRoot).toBe(env.projectRoot);
  });

  it('markSessionProcessed deletes .jsonl and .hash files', () => {
    writeFileSync(join(env.sessionsDir, 'sess-1.jsonl'), '{}');
    writeFileSync(join(env.sessionsDir, 'sess-1.hash'), 'abc');

    markSessionProcessed('sess-1');

    expect(existsSync(join(env.sessionsDir, 'sess-1.jsonl'))).toBe(false);
    expect(existsSync(join(env.sessionsDir, 'sess-1.hash'))).toBe(false);
  });

  it('getQueueDepth returns count of .jsonl files', () => {
    writeFileSync(join(env.sessionsDir, 'a.jsonl'), '{}');
    writeFileSync(join(env.sessionsDir, 'b.jsonl'), '{}');
    writeFileSync(join(env.sessionsDir, 'c.hash'), 'x'); // not counted

    expect(getQueueDepth()).toBe(2);
  });

  it('gracefully handles malformed session files', () => {
    writeFileSync(join(env.sessionsDir, 'bad.jsonl'), 'not-json\n');

    const sessions = getPendingSessions();
    // Should skip the malformed file
    expect(sessions).toHaveLength(0);
  });
});
