import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createTestEnv, type TestEnv } from '../helpers/test-env.js';
import { startDaemon, type DaemonInstance } from '../helpers/daemon-runner.js';

const execFileAsync = promisify(execFile);

const RUN_E2E = !!process.env.RUN_E2E;
const E2E_PORT = 17378;

describe.skipIf(!RUN_E2E)('E2E: full pipeline', { timeout: 120_000 }, () => {
  let env: TestEnv;
  let daemon: DaemonInstance;

  beforeEach(() => {
    env = createTestEnv(E2E_PORT);
    env.activate();
  });
  afterEach(async () => {
    if (daemon) {
      try { await daemon.stop(); } catch { /* ok */ }
    }
    env.cleanup();
  });

  it('decision-making prompt -> capture -> process -> output files', async () => {
    // Pre-create a decisions.log to test Tier 1
    mkdirSync(join(env.projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(env.projectRoot, '.claude', 'decisions.log'),
      '[design] primary-color: blue-600\n[architecture] framework: Next.js\n',
    );

    // Run claude -p to generate a real transcript
    try {
      await execFileAsync('claude', [
        '-p', 'We decided to use Prisma ORM with PostgreSQL. The accent color is teal-500. Always use arrow functions.',
        '--max-turns', '1',
      ], {
        cwd: env.projectRoot,
        timeout: 45_000,
        env: { ...process.env, CC_DIR: env.ccDir, CC_PORT: String(E2E_PORT) },
      });
    } catch (error: any) {
      if (!error.stdout) throw error;
    }

    // Verify capture hook created session files
    const sessionFiles = readdirSync(env.sessionsDir).filter((f) => f.endsWith('.jsonl'));
    expect(sessionFiles.length).toBeGreaterThanOrEqual(1);

    // Start daemon and process
    daemon = await startDaemon({ CC_DIR: env.ccDir, CC_PORT: String(E2E_PORT) });
    await daemon.waitForReady();

    const res = await fetch(`http://localhost:${E2E_PORT}/process`, { method: 'POST' });
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.stats.sessionsProcessed).toBeGreaterThanOrEqual(1);

    // Verify output files
    const storeFiles = readdirSync(env.storeDir);
    expect(storeFiles.length).toBeGreaterThan(0);
  });

  it('noise-only prompt produces no memories after processing', async () => {
    try {
      await execFileAsync('claude', [
        '-p', 'What is 2 + 2?',
        '--max-turns', '1',
      ], {
        cwd: env.projectRoot,
        timeout: 45_000,
        env: { ...process.env, CC_DIR: env.ccDir, CC_PORT: String(E2E_PORT) },
      });
    } catch (error: any) {
      if (!error.stdout) throw error;
    }

    // Start daemon and process
    daemon = await startDaemon({ CC_DIR: env.ccDir, CC_PORT: String(E2E_PORT) });
    await daemon.waitForReady();

    const res = await fetch(`http://localhost:${E2E_PORT}/process`, { method: 'POST' });
    const body = await res.json();
    expect(body.status).toBe('ok');
    // Should have 0 API calls since triage should filter this as noise
    expect(body.stats.apiCallsMade).toBe(0);
  });
});
