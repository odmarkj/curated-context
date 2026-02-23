import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.js';
import { runHook } from '../../helpers/run-hook.js';
import { TRANSCRIPT_DECISIONS } from '../../helpers/fixtures.js';

describe('capture.js hook', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('creates session JSONL file from transcript', async () => {
    const transcriptPath = join(env.projectRoot, 'transcript.jsonl');
    writeFileSync(transcriptPath, TRANSCRIPT_DECISIONS);

    const stdinData = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'test-sess-1',
    });

    const result = await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });
    expect(result.stdout).toBe('{}');
    expect(result.exitCode).toBe(0);

    const sessionFile = join(env.sessionsDir, 'test-sess-1.jsonl');
    expect(existsSync(sessionFile)).toBe(true);

    const lines = readFileSync(sessionFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);

    const event = JSON.parse(lines[0]);
    expect(event.sessionId).toBe('test-sess-1');
    expect(event.messageCount).toBeGreaterThan(0);
  });

  it('deduplicates identical transcripts via hash', async () => {
    const transcriptPath = join(env.projectRoot, 'transcript.jsonl');
    writeFileSync(transcriptPath, TRANSCRIPT_DECISIONS);

    const stdinData = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'test-sess-dedup',
    });

    // Run twice with same transcript
    await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });
    await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });

    const sessionFile = join(env.sessionsDir, 'test-sess-dedup.jsonl');
    const lines = readFileSync(sessionFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1); // Deduplicated — only 1 event
  });

  it('appends new event when transcript changes', async () => {
    const transcriptPath = join(env.projectRoot, 'transcript.jsonl');
    writeFileSync(transcriptPath, TRANSCRIPT_DECISIONS);

    const stdinData = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'test-sess-change',
    });

    await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });

    // Modify transcript
    writeFileSync(transcriptPath, TRANSCRIPT_DECISIONS + '\n' + JSON.stringify({
      type: 'user',
      uuid: 'u99',
      sessionId: 'test-sess-change',
      cwd: '/tmp/test-project',
      message: { role: 'user', content: [{ type: 'text', text: 'new message' }] },
    }));

    await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });

    const sessionFile = join(env.sessionsDir, 'test-sess-change.jsonl');
    const lines = readFileSync(sessionFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('exits cleanly with {} when transcript_path is missing', async () => {
    const result = await runHook('capture.js', JSON.stringify({ session_id: 's1' }), { CC_DIR: env.ccDir });
    expect(result.stdout).toBe('{}');
    expect(result.exitCode).toBe(0);
  });

  it('exits cleanly with {} when session_id is missing', async () => {
    const result = await runHook('capture.js', JSON.stringify({ transcript_path: '/tmp/x' }), { CC_DIR: env.ccDir });
    expect(result.stdout).toBe('{}');
    expect(result.exitCode).toBe(0);
  });

  it('exits cleanly on empty stdin', async () => {
    const result = await runHook('capture.js', '', { CC_DIR: env.ccDir });
    expect(result.exitCode).toBe(0);
  });
});
