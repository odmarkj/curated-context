#!/usr/bin/env node

// process.js — SessionStart hook handler
// Checks for pending session files and triggers deferred processing.
// Ensures daemon is running, then fires a non-blocking POST.

import { readdirSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CC_DIR = join(homedir(), '.curated-context');
const SESSIONS_DIR = join(CC_DIR, 'sessions');
const PID_FILE = join(CC_DIR, 'daemon.pid');
const DAEMON_PORT = 7377;

// Read stdin (required by hook protocol) but we don't need it
try {
  readFileSync('/dev/stdin', 'utf8');
} catch {
  // stdin may be empty for SessionStart
}

// Check if there are pending session files to process
mkdirSync(SESSIONS_DIR, { recursive: true });

let pendingFiles;
try {
  pendingFiles = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.jsonl'));
} catch {
  process.stdout.write('{}');
  process.exit(0);
}

if (pendingFiles.length === 0) {
  process.stdout.write('{}');
  process.exit(0);
}

// Check if daemon is running
let daemonRunning = false;
if (existsSync(PID_FILE)) {
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (pid > 0) {
      process.kill(pid, 0); // Throws if process doesn't exist
      daemonRunning = true;
    }
  } catch {
    // PID file stale or process doesn't exist
  }
}

if (!daemonRunning) {
  const { spawn, execSync } = await import('child_process');
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(import.meta.url, '..', '..').replace('file://', '');

  // Lazy npm install: if node_modules/ doesn't exist, install runtime deps first
  const nodeModulesDir = join(pluginRoot, 'node_modules');
  if (!existsSync(nodeModulesDir)) {
    try {
      execSync('npm install --omit=dev', {
        cwd: pluginRoot,
        stdio: 'ignore',
        timeout: 60000,
      });
    } catch {
      // Install failed — daemon can't start without deps, try again next session
      process.stdout.write('{}');
      process.exit(0);
    }
  }

  // Auto-start daemon in background
  const daemonScript = join(pluginRoot, 'dist', 'daemon', 'index.js');
  if (existsSync(daemonScript)) {
    const child = spawn('node', [daemonScript], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, CC_DAEMON: '1' },
    });
    child.unref();

    // Give daemon a moment to start
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// Fire-and-forget POST to trigger processing
try {
  fetch(`http://localhost:${DAEMON_PORT}/process`, {
    method: 'POST',
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
} catch {
  // Daemon might not be ready yet — events will be processed next time
}

process.stdout.write('{}');
