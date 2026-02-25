#!/usr/bin/env node

// capture.js — Stop hook handler
// Accumulates transcript data to a session file. No API calls.
// Must be plain JS (no build step) since hooks run directly via node.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CC_DIR = process.env.CC_DIR || join(homedir(), '.curated-context');
const SESSIONS_DIR = join(CC_DIR, 'sessions');

// Debug: log that the hook was invoked
try {
  mkdirSync(CC_DIR, { recursive: true });
  appendFileSync(join(CC_DIR, 'hook-debug.log'),
    `[${new Date().toISOString()}] capture.js invoked\n`);
} catch { /* best effort */ }

// Read hook input from stdin
let stdinData = '';
try {
  stdinData = readFileSync('/dev/stdin', 'utf8');
} catch {
  process.exit(0);
}

let hookInput;
try {
  hookInput = JSON.parse(stdinData);
} catch {
  process.exit(0);
}

const { transcript_path, session_id } = hookInput;

// Debug: log parsed input
try {
  appendFileSync(join(CC_DIR, 'hook-debug.log'),
    `[${new Date().toISOString()}] input keys: ${Object.keys(hookInput).join(', ')}, transcript_path=${transcript_path}, session_id=${session_id}\n`);
} catch { /* best effort */ }

if (!transcript_path || !session_id) {
  // Output empty JSON and exit — don't block Claude
  process.stdout.write('{}');
  process.exit(0);
}

// Ensure directories exist
mkdirSync(SESSIONS_DIR, { recursive: true });

// Read and parse the JSONL transcript
let transcriptRaw;
try {
  transcriptRaw = readFileSync(transcript_path, 'utf8');
} catch (err) {
  try { appendFileSync(join(CC_DIR, 'hook-debug.log'), `[${new Date().toISOString()}] FAILED to read transcript: ${err}\n`); } catch {}
  process.stdout.write('{}');
  process.exit(0);
}

// Compute a simple hash to avoid re-processing identical transcripts
let hash = 0;
for (let i = 0; i < transcriptRaw.length; i++) {
  hash = ((hash << 5) - hash + transcriptRaw.charCodeAt(i)) | 0;
}
const transcriptHash = hash.toString(36);

// Check if we already processed this exact transcript state
const hashFile = join(SESSIONS_DIR, `${session_id}.hash`);
try { appendFileSync(join(CC_DIR, 'hook-debug.log'), `[${new Date().toISOString()}] transcript read OK (${transcriptRaw.length} bytes), hash=${transcriptHash}\n`); } catch {}
if (existsSync(hashFile)) {
  try {
    const lastHash = readFileSync(hashFile, 'utf8').trim();
    if (lastHash === transcriptHash) {
      try { appendFileSync(join(CC_DIR, 'hook-debug.log'), `[${new Date().toISOString()}] hash unchanged — skipping\n`); } catch {}
      process.stdout.write('{}');
      process.exit(0);
    }
  } catch {
    // Continue if hash file can't be read
  }
}

// Parse transcript lines — extract user/assistant text + tool events
const lines = transcriptRaw.split('\n').filter(Boolean);
const messages = [];
const toolEvents = [];
let projectRoot = '';

for (const line of lines) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }

  if (entry.type === 'queue-operation' || entry.type === 'file-history-snapshot') {
    continue;
  }

  if (entry.cwd && !projectRoot) {
    projectRoot = entry.cwd;
  }

  if (!entry.message?.content) continue;

  if (entry.type === 'user') {
    const text = entry.message.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text || '')
      .join('\n')
      .trim();
    if (text) {
      messages.push({ role: 'user', content: text });
    }
  }

  if (entry.type === 'assistant') {
    const text = entry.message.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text || '')
      .join('\n')
      .trim();
    if (text) {
      messages.push({ role: 'assistant', content: text });
    }

    for (const block of entry.message.content) {
      if (block.type === 'tool_use' && block.name) {
        toolEvents.push({ tool: block.name, input: block.input || {} });
      }
    }
  }
}

// Debug: log parsing results
try {
  appendFileSync(join(CC_DIR, 'hook-debug.log'),
    `[${new Date().toISOString()}] parsed: ${lines.length} lines, ${messages.length} messages, ${toolEvents.length} tool events, projectRoot=${projectRoot}\n`);
} catch {}

if (messages.length === 0) {
  try { appendFileSync(join(CC_DIR, 'hook-debug.log'), `[${new Date().toISOString()}] NO messages found — exiting\n`); } catch {}
  process.stdout.write('{}');
  process.exit(0);
}

// Write session event
const event = {
  timestamp: Date.now(),
  sessionId: session_id,
  projectRoot,
  transcriptHash,
  messageCount: messages.length,
  toolEventCount: toolEvents.length,
  transcriptPath: transcript_path,
};

// === Central dir write (backward compat for host daemon poll) ===
const sessionFile = join(SESSIONS_DIR, `${session_id}.jsonl`);
try {
  appendFileSync(sessionFile, JSON.stringify(event) + '\n');
  // Save hash to avoid reprocessing
  writeFileSync(hashFile, transcriptHash);
  try { appendFileSync(join(CC_DIR, 'hook-debug.log'), `[${new Date().toISOString()}] SUCCESS: wrote session file ${sessionFile}\n`); } catch {}
} catch (err) {
  try { appendFileSync(join(CC_DIR, 'hook-debug.log'), `[${new Date().toISOString()}] FAILED to write session: ${err}\n`); } catch {}
}

// === Project-local write (devcontainer support — shared volume) ===
if (projectRoot) {
  try {
    const projectCcDir = join(projectRoot, '.curated-context');
    const projectSessionsDir = join(projectCcDir, 'sessions');
    const projectTranscriptsDir = join(projectCcDir, 'transcripts');
    mkdirSync(projectSessionsDir, { recursive: true });
    mkdirSync(projectTranscriptsDir, { recursive: true });

    // Write session event to project dir
    const projectSessionFile = join(projectSessionsDir, `${session_id}.jsonl`);
    const projectHashFile = join(projectSessionsDir, `${session_id}.hash`);
    appendFileSync(projectSessionFile, JSON.stringify(event) + '\n');
    writeFileSync(projectHashFile, transcriptHash);

    // Copy raw transcript to project dir (host daemon can't read container transcript paths)
    const projectTranscriptFile = join(projectTranscriptsDir, `${session_id}.jsonl`);
    writeFileSync(projectTranscriptFile, transcriptRaw);

    try { appendFileSync(join(CC_DIR, 'hook-debug.log'), `[${new Date().toISOString()}] SUCCESS: wrote project-local session + transcript\n`); } catch {}

    // Auto-append .curated-context/ to .gitignore
    const gitignorePath = join(projectRoot, '.gitignore');
    try {
      let gitignore = '';
      if (existsSync(gitignorePath)) {
        gitignore = readFileSync(gitignorePath, 'utf8');
      }
      if (!gitignore.includes('.curated-context')) {
        appendFileSync(gitignorePath, '\n# Curated Context plugin (session data)\n.curated-context/\n');
      }
    } catch { /* best effort — .gitignore might not exist or be writable */ }
  } catch (err) {
    try { appendFileSync(join(CC_DIR, 'hook-debug.log'), `[${new Date().toISOString()}] project-local write failed (non-fatal): ${err}\n`); } catch {}
  }
}

// === Bootstrap project-level hooks (enables devcontainer support) ===
// When running as a plugin hook on the host, copies hook scripts into the
// project workspace and configures .claude/settings.local.json so that
// hooks also fire inside devcontainers (where the plugin cache isn't mounted).
bootstrapProjectHooks(projectRoot);

// Output empty JSON — don't block, don't inject messages
process.stdout.write('{}');

function bootstrapProjectHooks(root) {
  if (!root) return;

  // Don't re-bootstrap if we're already the project-local copy
  try {
    const selfPath = new URL(import.meta.url).pathname;
    if (selfPath.includes('.curated-context/hooks/')) return;
  } catch { return; }

  const hooksDir = join(root, '.curated-context', 'hooks');
  const captureTarget = join(hooksDir, 'capture.js');
  const processTarget = join(hooksDir, 'process.js');

  // Skip if already bootstrapped (both hook files exist)
  if (existsSync(captureTarget) && existsSync(processTarget)) {
    ensureHookSettings(root);
    return;
  }

  try {
    mkdirSync(hooksDir, { recursive: true });

    // Copy this script (capture.js) to project hooks dir
    const selfPath = new URL(import.meta.url).pathname;
    const selfSource = readFileSync(selfPath, 'utf8');
    writeFileSync(captureTarget, selfSource);

    // Copy simplified process hook (no daemon auto-start)
    const processLocalPath = join(selfPath, '..', 'process-local.js');
    if (existsSync(processLocalPath)) {
      const processSource = readFileSync(processLocalPath, 'utf8');
      writeFileSync(processTarget, processSource);
    }

    ensureHookSettings(root);

    try { appendFileSync(join(CC_DIR, 'hook-debug.log'), `[${new Date().toISOString()}] bootstrapped project hooks at ${hooksDir}\n`); } catch {}
  } catch (err) {
    try { appendFileSync(join(CC_DIR, 'hook-debug.log'), `[${new Date().toISOString()}] bootstrap failed (non-fatal): ${err}\n`); } catch {}
  }
}

function ensureHookSettings(root) {
  try {
    const claudeDir = join(root, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, 'settings.local.json');

    let settings = {};
    if (existsSync(settingsPath)) {
      try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch {}
    }

    // Check if our hooks are already configured
    const json = JSON.stringify(settings);
    if (json.includes('.curated-context/hooks/capture.js')) return;

    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks.Stop) settings.hooks.Stop = [];
    if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];

    settings.hooks.Stop.push({
      hooks: [{
        type: 'command',
        command: 'node "$CLAUDE_PROJECT_DIR/.curated-context/hooks/capture.js"',
        timeout: 5000,
      }],
    });

    settings.hooks.SessionStart.push({
      hooks: [{
        type: 'command',
        command: 'node "$CLAUDE_PROJECT_DIR/.curated-context/hooks/process.js"',
        timeout: 5000,
      }],
    });

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

    try { appendFileSync(join(CC_DIR, 'hook-debug.log'), `[${new Date().toISOString()}] wrote hook settings to ${settingsPath}\n`); } catch {}
  } catch (err) {
    try { appendFileSync(join(CC_DIR, 'hook-debug.log'), `[${new Date().toISOString()}] ensureHookSettings failed (non-fatal): ${err}\n`); } catch {}
  }
}
