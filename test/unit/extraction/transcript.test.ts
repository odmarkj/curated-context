import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.js';
import { TRANSCRIPT_DECISIONS, TRANSCRIPT_NOISE, TRANSCRIPT_MIXED } from '../../helpers/fixtures.js';
import { parseTranscript, computeTranscriptHash } from '../../../src/extraction/transcript.js';

describe('parseTranscript', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('extracts user and assistant messages from JSONL', () => {
    const path = join(env.projectRoot, 'transcript.jsonl');
    writeFileSync(path, TRANSCRIPT_DECISIONS);

    const result = parseTranscript(path);
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0]).toEqual({ role: 'user', content: expect.stringContaining('Tailwind CSS') });
    expect(result.messages[1]).toEqual({ role: 'assistant', content: expect.stringContaining('blue-600') });
  });

  it('extracts tool_use events from assistant messages', () => {
    const path = join(env.projectRoot, 'transcript.jsonl');
    writeFileSync(path, TRANSCRIPT_DECISIONS);

    const result = parseTranscript(path);
    expect(result.toolEvents.length).toBeGreaterThanOrEqual(3);
    expect(result.toolEvents[0].tool).toBe('Write');
    expect(result.toolEvents[0].input).toHaveProperty('file_path');
  });

  it('captures projectRoot from first entry with cwd', () => {
    const path = join(env.projectRoot, 'transcript.jsonl');
    writeFileSync(path, TRANSCRIPT_DECISIONS);

    const result = parseTranscript(path);
    expect(result.projectRoot).toBe('/tmp/test-project');
  });

  it('captures sessionId from first entry', () => {
    const path = join(env.projectRoot, 'transcript.jsonl');
    writeFileSync(path, TRANSCRIPT_DECISIONS);

    const result = parseTranscript(path);
    expect(result.sessionId).toBe('test-sess-1');
  });

  it('skips queue-operation and file-history-snapshot lines', () => {
    const path = join(env.projectRoot, 'transcript.jsonl');
    writeFileSync(path, TRANSCRIPT_MIXED);

    const result = parseTranscript(path);
    // Should only have 1 user + 1 assistant message, not the queue-op or snapshot
    expect(result.messages).toHaveLength(2);
    expect(result.sessionId).toBe('test-sess-mixed');
  });

  it('gracefully skips malformed JSON lines', () => {
    const path = join(env.projectRoot, 'transcript.jsonl');
    const content = 'not-valid-json\n' + TRANSCRIPT_DECISIONS;
    writeFileSync(path, content);

    const result = parseTranscript(path);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('returns empty arrays when transcript has no messages', () => {
    const path = join(env.projectRoot, 'transcript.jsonl');
    writeFileSync(path, JSON.stringify({ type: 'queue-operation', data: {} }));

    const result = parseTranscript(path);
    expect(result.messages).toHaveLength(0);
    expect(result.toolEvents).toHaveLength(0);
  });
});

describe('computeTranscriptHash', () => {
  it('produces consistent hash for same input', () => {
    const messages = [{ role: 'user' as const, content: 'hello' }];
    const h1 = computeTranscriptHash(messages);
    const h2 = computeTranscriptHash(messages);
    expect(h1).toBe(h2);
  });

  it('produces different hash for different input', () => {
    const h1 = computeTranscriptHash([{ role: 'user', content: 'hello' }]);
    const h2 = computeTranscriptHash([{ role: 'user', content: 'world' }]);
    expect(h1).not.toBe(h2);
  });
});
