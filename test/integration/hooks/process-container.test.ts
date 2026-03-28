import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createContainerTestEnv, type ContainerTestEnv } from '../../helpers/container-env.js';
import { runHook } from '../../helpers/run-hook.js';

describe('process-local.js — daemon communication fallback', () => {
  let env: ContainerTestEnv;

  beforeEach(() => {
    env = createContainerTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('exits cleanly when daemon is not reachable', async () => {
    // Use a port that nothing is listening on
    const result = await runHook('process-local.js', JSON.stringify({ cwd: env.workspaceDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19999', // unlikely to be in use
    });

    expect(result.exitCode).toBe(0);
  });

  it('exits cleanly with {} on empty input', async () => {
    const result = await runHook('process-local.js', '', {
      CC_DIR: env.ccDir,
    });

    expect(result.exitCode).toBe(0);
  });

  it('handles pending sessions without crashing', async () => {
    // Create a pending session file
    writeFileSync(
      join(env.centralSessionsDir, 'test-pending.jsonl'),
      JSON.stringify({
        timestamp: Date.now(),
        sessionId: 'test-pending',
        projectRoot: env.workspaceDir,
        transcriptHash: 'abc',
        messageCount: 1,
        toolEventCount: 0,
        transcriptPath: '/tmp/nonexistent.jsonl',
      }) + '\n',
    );

    const result = await runHook('process-local.js', JSON.stringify({ cwd: env.workspaceDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19999',
    });

    expect(result.exitCode).toBe(0);
  });
});

describe('process.js — daemon communication fallback', () => {
  let env: ContainerTestEnv;

  beforeEach(() => {
    env = createContainerTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('exits cleanly when daemon is not running and no pending sessions', async () => {
    const result = await runHook('process.js', JSON.stringify({ cwd: env.workspaceDir }), {
      CC_DIR: env.ccDir,
    });

    expect(result.exitCode).toBe(0);
  });

  it('exits cleanly when daemon is not running but sessions are pending', async () => {
    writeFileSync(
      join(env.centralSessionsDir, 'pending.jsonl'),
      JSON.stringify({
        timestamp: Date.now(),
        sessionId: 'pending',
        projectRoot: env.workspaceDir,
        transcriptHash: 'def',
        messageCount: 2,
        toolEventCount: 0,
        transcriptPath: '/tmp/nonexistent.jsonl',
      }) + '\n',
    );

    const result = await runHook('process.js', JSON.stringify({ cwd: env.workspaceDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19998',
    });

    expect(result.exitCode).toBe(0);
  });

  it('completes within 5 seconds even with unreachable daemon', async () => {
    const start = Date.now();

    const result = await runHook('process.js', JSON.stringify({ cwd: env.workspaceDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19997',
    });

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
    expect(result.exitCode).toBe(0);
  });
});
