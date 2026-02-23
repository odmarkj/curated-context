#!/usr/bin/env node

// capture.js — Stop hook handler
// Accumulates transcript data to a session file. No API calls.
// Must be plain JS (no build step) since hooks run directly via node.

import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CC_DIR = process.env.CC_DIR || join(homedir(), '.curated-context');
const SESSIONS_DIR = join(CC_DIR, 'sessions');

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
} catch {
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
if (existsSync(hashFile)) {
  try {
    const lastHash = readFileSync(hashFile, 'utf8').trim();
    if (lastHash === transcriptHash) {
      // Transcript unchanged since last capture — skip
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

if (messages.length === 0) {
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

const sessionFile = join(SESSIONS_DIR, `${session_id}.jsonl`);
appendFileSync(sessionFile, JSON.stringify(event) + '\n');

// Save hash to avoid reprocessing
const { writeFileSync } = await import('fs');
writeFileSync(hashFile, transcriptHash);

// Output empty JSON — don't block, don't inject messages
process.stdout.write('{}');
