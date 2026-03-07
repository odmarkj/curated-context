#!/usr/bin/env node

// process-local.js — SessionStart hook (project-level, devcontainer support)
// 1. Auto-installs the plugin into the container's ~/.claude/ if not present
// 2. Checks for pending sessions and POSTs to the host daemon
// No daemon auto-start — relies on host daemon already running.

import { readdirSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, cpSync } from 'fs';
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

const projectRoot = hookInput.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

// === Auto-install plugin (devcontainer support) ===
// If the plugin isn't in this environment's ~/.claude/plugins/cache/, copy it
// from the project workspace (.curated-context/plugin/) which was placed there
// by the host-side bootstrap.
autoInstallPlugin(projectRoot);

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

function autoInstallPlugin(root) {
  if (!root) return;

  const pluginCacheDir = join(homedir(), '.claude', 'plugins', 'cache',
    'curated-context', 'curated-context', '0.1.0');

  // Already installed in this environment
  if (existsSync(pluginCacheDir)) return;

  // Check if the project has a bootstrapped plugin package
  const pluginSource = join(root, '.curated-context', 'plugin');
  if (!existsSync(join(pluginSource, '.claude-plugin', 'plugin.json'))) return;

  try {
    // Copy minimal plugin package to this environment's plugin cache
    mkdirSync(pluginCacheDir, { recursive: true });
    cpSync(pluginSource, pluginCacheDir, { recursive: true });

    // Enable the plugin in ~/.claude/settings.json
    const claudeDir = join(homedir(), '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, 'settings.json');

    let settings = {};
    if (existsSync(settingsPath)) {
      try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch {}
    }

    if (!settings.enabledPlugins) settings.enabledPlugins = {};
    if (!settings.enabledPlugins['curated-context@curated-context']) {
      settings.enabledPlugins['curated-context@curated-context'] = true;
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    }

    try {
      mkdirSync(CC_DIR, { recursive: true });
      appendFileSync(join(CC_DIR, 'hook-debug.log'),
        `[${new Date().toISOString()}] auto-installed plugin to ${pluginCacheDir}\n`);
    } catch {}
  } catch {}
}
