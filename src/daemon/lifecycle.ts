import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function ccDir(): string {
  return process.env.CC_DIR || join(homedir(), '.curated-context');
}

export function writePid(): void {
  const dir = ccDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'daemon.pid'), String(process.pid));
}

export function clearPid(): void {
  try {
    const pidFile = join(ccDir(), 'daemon.pid');
    if (existsSync(pidFile)) {
      unlinkSync(pidFile);
    }
  } catch {
    // Best effort
  }
}

export function isDaemonRunning(): { running: boolean; pid?: number } {
  const pidFile = join(ccDir(), 'daemon.pid');
  if (!existsSync(pidFile)) {
    return { running: false };
  }

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    if (isNaN(pid) || pid <= 0) {
      return { running: false };
    }

    // Check if process exists
    process.kill(pid, 0);
    return { running: true, pid };
  } catch {
    // Process doesn't exist — stale PID file
    clearPid();
    return { running: false };
  }
}

export function getLogPath(): string {
  return join(ccDir(), 'daemon.log');
}

export function getDataDir(): string {
  return ccDir();
}
