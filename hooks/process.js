#!/usr/bin/env node

// process.js — SessionStart hook handler
// Checks for pending session files and triggers deferred processing.
// Ensures daemon is running, then fires a non-blocking POST.
// Supports devcontainers via host.docker.internal fallback.

import { readdirSync, readFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CC_DIR = process.env.CC_DIR || join(homedir(), '.curated-context');
const SESSIONS_DIR = join(CC_DIR, 'sessions');
const PID_FILE = join(CC_DIR, 'daemon.pid');
const DAEMON_PORT = parseInt(process.env.CC_PORT || '7377', 10);

// Parse stdin for hook input (may contain cwd/session_id)
let hookInput = {};
try {
  const stdinData = readFileSync('/dev/stdin', 'utf8');
  if (stdinData.trim()) {
    hookInput = JSON.parse(stdinData);
  }
} catch {
  // stdin may be empty or invalid for SessionStart
}

// Extract projectRoot from hook input, session files, or cwd
let projectRoot = hookInput.cwd || '';

// Check central sessions dir for pending files
mkdirSync(SESSIONS_DIR, { recursive: true });

let centralPending = [];
try {
  centralPending = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.jsonl'));
} catch { /* best effort */ }

// If no projectRoot from hook input, extract from session files
if (!projectRoot && centralPending.length > 0) {
  try {
    const raw = readFileSync(join(SESSIONS_DIR, centralPending[0]), 'utf8');
    const lastLine = raw.trim().split('\n').pop();
    if (lastLine) {
      const evt = JSON.parse(lastLine);
      if (evt.projectRoot) projectRoot = evt.projectRoot;
    }
  } catch { /* best effort */ }
}

// Fallback: use process working directory
if (!projectRoot) {
  projectRoot = process.cwd();
}

// Check project-local sessions dir for pending files (devcontainer support)
let projectPending = [];
if (projectRoot) {
  const projectSessionsDir = join(projectRoot, '.curated-context', 'sessions');
  try {
    if (existsSync(projectSessionsDir)) {
      projectPending = readdirSync(projectSessionsDir).filter((f) => f.endsWith('.jsonl'));
    }
  } catch { /* best effort */ }
}

// Exit early if nothing to process
if (centralPending.length === 0 && projectPending.length === 0) {
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

// POST to daemon with projectRoot — try localhost first, then host.docker.internal
const postBody = JSON.stringify({ projectRoot });
const postOptions = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: postBody,
  signal: AbortSignal.timeout(2000),
};

let reached = false;
try {
  const res = await fetch(`http://localhost:${DAEMON_PORT}/process`, postOptions);
  if (res.ok) reached = true;
} catch {
  // localhost failed — try host.docker.internal (devcontainer → host)
  try {
    const res = await fetch(`http://host.docker.internal:${DAEMON_PORT}/process`, {
      ...postOptions,
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) reached = true;
  } catch {
    // Neither endpoint reachable — daemon will pick up sessions on next poll
  }
}

// Debug: log result
try {
  appendFileSync(join(CC_DIR, 'hook-debug.log'),
    `[${new Date().toISOString()}] process.js: projectRoot=${projectRoot}, central=${centralPending.length}, project=${projectPending.length}, daemonReached=${reached}\n`);
} catch { /* best effort */ }

process.stdout.write('{}');
