import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.js';
import { writePid, clearPid, isDaemonRunning, getLogPath } from '../../../src/daemon/lifecycle.js';

describe('lifecycle', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('writePid creates PID file with process.pid', () => {
    writePid();

    const pidFile = join(env.ccDir, 'daemon.pid');
    expect(existsSync(pidFile)).toBe(true);

    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    expect(pid).toBe(process.pid);
  });

  it('clearPid removes PID file', () => {
    writePid();
    clearPid();

    const pidFile = join(env.ccDir, 'daemon.pid');
    expect(existsSync(pidFile)).toBe(false);
  });

  it('isDaemonRunning returns running:true for current process PID', () => {
    writePid();

    const result = isDaemonRunning();
    expect(result.running).toBe(true);
    expect(result.pid).toBe(process.pid);
  });

  it('isDaemonRunning returns running:false and clears stale PID', () => {
    // Write a PID that definitely doesn't exist
    writeFileSync(join(env.ccDir, 'daemon.pid'), '999999999');

    const result = isDaemonRunning();
    expect(result.running).toBe(false);
    // Stale PID file should be cleaned up
    expect(existsSync(join(env.ccDir, 'daemon.pid'))).toBe(false);
  });

  it('getLogPath uses CC_DIR', () => {
    const logPath = getLogPath();
    expect(logPath).toContain(env.ccDir);
  });
});
