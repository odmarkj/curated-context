#!/usr/bin/env node

// process-local.js — SessionStart hook (project-level, devcontainer support)
// Checks for pending sessions and POSTs to the host daemon.
// No daemon auto-start — relies on host daemon already running or starting
// via the plugin-level process.js hook on the next host session.

import { readdirSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CC_DIR = process.env.CC_DIR || join(homedir(), '.curated-context');
const SESSIONS_DIR = join(CC_DIR, 'sessions');
const DAEMON_PORT = parseInt(process.env.CC_PORT || '7377', 10);

// Parse stdin for hook input
let hookInput = {};
try {
  const stdinData = readFileSync('/dev/stdin', 'utf8');
  if (stdinData.trim()) hookInput = JSON.parse(stdinData);
} catch {}

const projectRoot = hookInput.cwd || process.cwd();

// Check for pending sessions in central dir
mkdirSync(SESSIONS_DIR, { recursive: true });
let hasPending = false;
try {
  hasPending = readdirSync(SESSIONS_DIR).some((f) => f.endsWith('.jsonl'));
} catch {}

// Check project-local sessions
if (!hasPending && projectRoot) {
  try {
    const dir = join(projectRoot, '.curated-context', 'sessions');
    if (existsSync(dir)) {
      hasPending = readdirSync(dir).some((f) => f.endsWith('.jsonl'));
    }
  } catch {}
}

if (!hasPending) {
  process.stdout.write('{}');
  process.exit(0);
}

// POST to daemon — try localhost first, then host.docker.internal
const postBody = JSON.stringify({ projectRoot });
const postOptions = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: postBody,
  signal: AbortSignal.timeout(2000),
};

try {
  await fetch(`http://localhost:${DAEMON_PORT}/process`, postOptions);
} catch {
  try {
    await fetch(`http://host.docker.internal:${DAEMON_PORT}/process`, {
      ...postOptions,
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
}

process.stdout.write('{}');
