import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdirSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createTestEnv, type TestEnv } from '../helpers/test-env.js';

const execFileAsync = promisify(execFile);

const RUN_E2E = !!process.env.RUN_E2E;

describe.skipIf(!RUN_E2E)('E2E: capture hook fires', { timeout: 60_000 }, () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('creates session file after claude -p prompt', async () => {
    try {
      await execFileAsync('claude', [
        '-p', 'Briefly state: We are using React with TypeScript and Tailwind CSS for this project.',
        '--max-turns', '1',
      ], {
        cwd: env.projectRoot,
        timeout: 45_000,
        env: { ...process.env, CC_DIR: env.ccDir },
      });
    } catch (error: any) {
      // claude -p may return non-zero in some cases, that's ok
      if (!error.stdout) throw error;
    }

    // After the prompt completes, the Stop hook should have fired
    const sessionFiles = readdirSync(env.sessionsDir).filter((f) => f.endsWith('.jsonl'));
    expect(sessionFiles.length).toBeGreaterThanOrEqual(1);
  });
});
