import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.js';
import { runHook } from '../../helpers/run-hook.js';

describe('process.js hook', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('exits cleanly with {} when no pending sessions', async () => {
    const result = await runHook('process.js', '', {
      CC_DIR: env.ccDir,
      CC_PORT: '19999', // Use a port nothing listens on
    });
    expect(result.stdout).toBe('{}');
    expect(result.exitCode).toBe(0);
  });

  it('handles pending sessions with no daemon gracefully', async () => {
    // Create a pending session file
    writeFileSync(join(env.sessionsDir, 'sess-1.jsonl'), JSON.stringify({
      timestamp: Date.now(),
      sessionId: 'sess-1',
      projectRoot: env.projectRoot,
      transcriptHash: 'abc',
      messageCount: 4,
      toolEventCount: 2,
      transcriptPath: '/tmp/nonexistent.jsonl',
    }) + '\n');

    const result = await runHook('process.js', '', {
      CC_DIR: env.ccDir,
      CC_PORT: '19999',
      CLAUDE_PLUGIN_ROOT: '/nonexistent/path',
    });

    // Should not crash — daemon start fails gracefully, fetch fails gracefully
    expect(result.stdout).toBe('{}');
    expect(result.exitCode).toBe(0);
  });

  it('completes within 5 seconds', async () => {
    const start = Date.now();
    await runHook('process.js', '', {
      CC_DIR: env.ccDir,
      CC_PORT: '19999',
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });
});
