# Claude Memory Extension — Intelligent Context Sidecar for Claude Code

## Overview

An extension to the Claude CLI that acts as intelligent memory. It observes conversations via hooks, uses a background agent to extract high-signal decisions, and writes them into `CLAUDE.md` files that Claude Code natively reads. It operates as a sidecar process — never interrupting the primary workflow.

**Key behaviors:**
- Automatically captures project decisions (theme colors, layout, architecture choices, API patterns)
- Updates `CLAUDE.md` files in-place with structured, auto-managed sections
- Stores global preferences across all projects in `~/.claude/CLAUDE.md`
- Uses the hooks system so the main agent never knows memory extraction is happening
- Periodically consolidates and deduplicates memories

---

## Core Architecture

**Three-layer system:**

1. **Observer Layer** — Hooks into Claude Code's lifecycle events to capture context without interrupting flow
2. **Intelligence Layer** — A background agent that classifies, deduplicates, and decides what's worth remembering
3. **Storage Layer** — Writes to project-scoped and global memory files that Claude Code natively reads

---

## 1. Hook-Driven Capture (Observer)

Claude Code's hooks system is the entry point. Register a `Stop` hook (fires after each agent turn) and optionally `PostToolUse` for file writes.

### Hook Configuration

```jsonc
// ~/.claude/hooks.json (or .claude/hooks.json per-project)
{
  "hooks": {
    "Stop": [
      {
        "command": "node /path/to/claude-memory/capture.js",
        "timeout": 15000
      }
    ]
  }
}
```

The `Stop` hook receives the conversation transcript on stdin. The capture script extracts it and queues it for processing. **Critically, it must not block.** Fire-and-forget to a background daemon.

### capture.js — Lightweight Queue Writer

```javascript
// capture.js — lightweight, just queues work
import { readFileSync, appendFileSync } from 'fs';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
const transcript = input.messages; // conversation context
const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Append to a processing queue (simple file-based or use a Unix socket)
const event = {
  timestamp: Date.now(),
  projectRoot,
  transcript,
  sessionId: input.session_id
};

appendFileSync('/tmp/claude-memory-queue.jsonl', JSON.stringify(event) + '\n');

// Signal the daemon (non-blocking)
fetch('http://localhost:7377/process', { method: 'POST' }).catch(() => {});
```

---

## 2. Background Intelligence Daemon

The brain — a long-running process that consumes the queue and uses a Claude instance to analyze what's worth remembering.

### daemon.js — The Memory Agent

```javascript
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const client = new Anthropic();

const MEMORY_SYSTEM_PROMPT = `You are a memory extraction agent for a software developer's CLI workflow.

Given a conversation transcript, extract:
1. **Project decisions** — architecture choices, design tokens, API patterns,
   naming conventions, theme/style definitions, tech stack decisions
2. **Global preferences** — coding style, tool preferences, workflow patterns
   that apply across projects
3. **Corrections** — if the user corrected a previous approach, note the
   preferred way

Output JSON:
{
  "project_memories": [
    { "category": "design|architecture|api|conventions|config",
      "key": "short identifier",
      "value": "concise description",
      "confidence": 0.0-1.0 }
  ],
  "global_memories": [
    { "category": "style|tools|preferences|patterns",
      "key": "short identifier",
      "value": "concise description",
      "confidence": 0.0-1.0 }
  ],
  "supersedes": ["keys that this new info replaces"]
}

Only extract HIGH-SIGNAL information. Skip chitchat, debugging iterations,
and exploratory back-and-forth. Confidence threshold: only include items
where you're 0.7+ confident this is a deliberate decision worth persisting.`;

async function processEvent(event) {
  // Load existing memories for dedup context
  const existingProject = loadMemory(event.projectRoot, 'project');
  const existingGlobal = loadMemory(null, 'global');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: MEMORY_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Existing project memories:\n${JSON.stringify(existingProject)}\n\n` +
               `Existing global memories:\n${JSON.stringify(existingGlobal)}\n\n` +
               `New conversation transcript:\n${JSON.stringify(event.transcript)}`
    }]
  });

  const memories = JSON.parse(extractJSON(response.content[0].text));

  // Apply supersedes (remove outdated memories)
  if (memories.supersedes?.length) {
    removeMemories(event.projectRoot, memories.supersedes);
  }

  // Write to appropriate CLAUDE.md files
  if (memories.project_memories.length) {
    updateProjectMemory(event.projectRoot, memories.project_memories);
  }
  if (memories.global_memories.length) {
    updateGlobalMemory(memories.global_memories);
  }
}
```

---

## 3. Storage Layer — CLAUDE.md Integration

The key insight: Claude Code **already reads** `CLAUDE.md` files natively. Write structured sections into them that Claude Code picks up automatically on the next turn.

### storage.js — CLAUDE.md Read/Write/Merge

```javascript
import { readFileSync, writeFileSync, existsSync } from 'fs';

const MARKER_START = '<!-- claude-memory:start -->';
const MARKER_END = '<!-- claude-memory:end -->';

function updateProjectMemory(projectRoot, memories) {
  const claudeMdPath = `${projectRoot}/CLAUDE.md`;
  let content = existsSync(claudeMdPath)
    ? readFileSync(claudeMdPath, 'utf8')
    : '';

  // Parse existing auto-managed section
  const existing = extractSection(content, MARKER_START, MARKER_END);
  const existingMemories = parseMemorySection(existing);

  // Merge (new memories override by key)
  const merged = { ...existingMemories };
  for (const mem of memories) {
    merged[mem.key] = mem;
  }

  // Generate the managed section
  const memorySection = generateMemoryMarkdown(merged);

  // Replace or append
  if (content.includes(MARKER_START)) {
    content = content.replace(
      new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}`),
      `${MARKER_START}\n${memorySection}\n${MARKER_END}`
    );
  } else {
    content += `\n\n${MARKER_START}\n${memorySection}\n${MARKER_END}`;
  }

  writeFileSync(claudeMdPath, content);
}

function generateMemoryMarkdown(memories) {
  const grouped = groupBy(memories, 'category');
  let md = '## Project Context (auto-managed)\n\n';

  for (const [category, items] of Object.entries(grouped)) {
    md += `### ${capitalize(category)}\n`;
    for (const item of items) {
      md += `- **${item.key}**: ${item.value}\n`;
    }
    md += '\n';
  }
  return md;
}

function extractSection(content, start, end) {
  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);
  if (startIdx === -1 || endIdx === -1) return '';
  return content.slice(startIdx + start.length, endIdx).trim();
}

function parseMemorySection(section) {
  // Parse the markdown back into memory objects
  const memories = {};
  const lines = section.split('\n');
  for (const line of lines) {
    const match = line.match(/^- \*\*(.+?)\*\*: (.+)$/);
    if (match) {
      memories[match[1]] = { key: match[1], value: match[2] };
    }
  }
  return memories;
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    (acc[item[key]] = acc[item[key]] || []).push(item);
    return acc;
  }, {});
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
```

For global memory, use the same pattern targeting `~/.claude/CLAUDE.md`.

---

## 4. Consolidation Agent (Periodic)

Memories accumulate and may conflict over time. Run a consolidation pass periodically (cron, on daemon startup, or after N events).

### consolidator.js

```javascript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

async function consolidateMemories(path) {
  const memories = loadAllMemories(path);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: `You are a memory consolidation agent. Given a set of memories,
merge duplicates, resolve contradictions (prefer newer), and remove
obsolete entries. Return the cleaned set in the same JSON format.`,
    messages: [{
      role: 'user',
      content: JSON.stringify(memories)
    }]
  });

  const consolidated = JSON.parse(extractJSON(response.content[0].text));

  // Rewrite the memory file with consolidated set
  writeConsolidatedMemories(path, consolidated);
}
```

---

## Directory Structure

```
claude-memory/
├── daemon.js              # Background processing server (Express/Fastify)
├── capture.js             # Lightweight hook handler (stdin → queue)
├── install.js             # Sets up hooks in ~/.claude/hooks.json
├── lib/
│   ├── storage.js         # CLAUDE.md read/write/merge
│   ├── classifier.js      # Memory extraction via Claude API
│   └── consolidator.js    # Periodic dedup/merge
├── store/
│   └── global.json        # Structured global memory (source of truth)
└── package.json
```

---

## Key Design Decisions

### Why hooks over MCP?

MCP would require the *main* agent to decide to call memory tools — that's the opposite of what we want. Hooks fire automatically and the sidecar processes independently. The main Claude Code session never knows or cares that memory extraction is happening.

### Why Sonnet for the sidecar, not Opus?

The memory extraction task is well-scoped classification work. Sonnet is fast and cheap enough to run on every turn without the user noticing latency or cost. You could even drop to Haiku for the initial "is there anything worth remembering here?" triage, then escalate to Sonnet only when there is.

### Why markers in CLAUDE.md?

This lets users see and edit auto-managed memories alongside their hand-written context. The markers prevent the daemon from clobbering manual content. If a user doesn't like something the memory agent stored, they just delete the line — the daemon respects what's inside the markers as the source of truth on next merge.

### Confidence thresholding

Critical to avoid noise. Without it, the memory fills up with exploratory back-and-forth. The 0.7 threshold means only clear, deliberate decisions get persisted:
- ✅ "use Tailwind with a blue-600 primary color"
- ❌ "maybe we should try Redis"

---

## Extension Points

### Slash Command Agent

Once the core loop works, add a `/memory` slash command that lets users interact directly:

- "what do you remember about this project?"
- "forget the old color scheme"
- "promote this to global memory"

That agent would just read/write the same storage files.

### Event Granularity

Beyond the `Stop` hook, consider:

- **`PostToolUse` for file writes** — capture when the user accepts file changes (stronger signal than conversation alone)
- **`PreToolUse`** — intercept before tool calls to inject relevant memory context
- **Git commit hooks** — extract memory from commit messages and diffs

### Memory Scoping

Extend beyond project/global to support:

- **Workspace-level** memory (monorepo packages)
- **Team-shared** memory (checked into git)
- **Ephemeral session** memory (discarded after session ends)

### Semantic Search

Once the memory store grows large, add embedding-based retrieval so only relevant memories are injected into `CLAUDE.md` rather than the full set. This prevents the context file from growing unbounded.

---

## Rate-Limit-Friendly Implementation Strategies

A naive implementation doubles the user's API calls — every conversation turn triggers a sidecar LLM call for memory extraction. This burns through rate limits, especially for users without the Max plan. The following strategies eliminate or drastically reduce API overhead. They work best combined as a cascading pipeline.

### Strategy 1: Process Once at Session End, Not Per-Turn

The biggest win. Instead of firing an LLM call on every `PostToolUse` or `Stop` event, accumulate locally during the session and only process once when the session ends. The `Stop` hook fires on every agent turn, but you can simply queue events and defer processing.

```javascript
// capture.js - accumulate locally, don't call the API
import { appendFileSync } from 'fs';
import path from 'path';
import os from 'os';

const QUEUE_DIR = path.join(os.homedir(), '.claude-memory/queue');

// Just append to a local file. No API call. Near-zero cost.
const event = {
  timestamp: Date.now(),
  transcript: input.messages,
  projectRoot
};

const sessionFile = path.join(QUEUE_DIR, `${input.session_id}.jsonl`);
appendFileSync(sessionFile, JSON.stringify(event) + '\n');
```

Process the queue **on next session start** (via a `SessionStart` hook) or via a **cron/idle timer**. The user's active session never competes for rate limits because extraction happens when Claude Code isn't being used.

### Strategy 2: Deterministic Triage Before Any LLM Call

Most conversation turns are debugging loops, exploratory reads, or "try this / nope / try that" cycles. Use local heuristics to filter before making any API call:

```javascript
// triage.js - zero LLM calls, pure pattern matching

const DECISION_SIGNALS = [
  /(?:let's|we'll|I'll|going to|decided to|switching to|using)\s+/i,
  /(?:the (?:primary|accent|background) color|theme|font|layout)\s+(?:is|should be|will be)/i,
  /(?:we're using|stack is|chose|picked|going with)\s+/i,
  /(?:header|footer|sidebar|nav|api|endpoint|route|schema)\s+(?:should|will|must)/i,
  /(?:convention|pattern|standard|rule):\s+/i,
  /(?:always|never|prefer|avoid)\s+/i,
];

const NOISE_SIGNALS = [
  /(?:let me try|hmm|actually wait|no that's wrong|error:|failed)/i,
  /(?:can you|what if|maybe|not sure)/i,
  /(?:reading file|searching|listing)/i,
];

function shouldProcess(transcript) {
  const lastMessages = transcript.slice(-6); // only recent turns
  const text = lastMessages.map(m => m.content).join(' ');

  const decisionScore = DECISION_SIGNALS.reduce(
    (score, re) => score + (re.test(text) ? 1 : 0), 0
  );
  const noiseScore = NOISE_SIGNALS.reduce(
    (score, re) => score + (re.test(text) ? 1 : 0), 0
  );

  return decisionScore >= 2 && decisionScore > noiseScore;
}
```

In practice this filters out 70–80% of turns, meaning LLM calls only happen when there's real signal. Combined with session-end processing, you might make 1–3 extraction calls per session instead of 50+.

### Strategy 3: Extract Structured Data Without an LLM at All

For many high-value memories, you don't need an LLM. Parse them directly from what Claude *wrote* to files:

```javascript
// structural-extractor.js - parse tool outputs, no LLM needed
import path from 'path';

function extractFromToolUse(toolEvents) {
  const memories = [];

  for (const event of toolEvents) {
    // CSS/design tokens from file writes
    if (event.tool === 'write' && /\.(css|scss|tailwind|theme)/.test(event.path)) {
      const colors = extractCSSVariables(event.content);
      if (colors.length) {
        memories.push({
          category: 'design',
          key: 'color-tokens',
          value: colors.map(c => `${c.name}: ${c.value}`).join(', '),
          source: event.path
        });
      }
    }

    // Package decisions from package.json changes
    if (event.tool === 'write' && event.path.endsWith('package.json')) {
      const newDeps = extractNewDependencies(event.before, event.after);
      for (const dep of newDeps) {
        memories.push({
          category: 'architecture',
          key: `dependency-${dep.name}`,
          value: `Added ${dep.name}@${dep.version}`,
          source: 'package.json'
        });
      }
    }

    // Config file patterns (tsconfig, eslint, prettier, etc.)
    if (event.tool === 'write' && isConfigFile(event.path)) {
      memories.push({
        category: 'conventions',
        key: `config-${path.basename(event.path)}`,
        value: summarizeConfigChange(event.before, event.after),
        source: event.path
      });
    }

    // API route definitions
    if (event.tool === 'write' && /route|endpoint|api/i.test(event.path)) {
      const routes = extractRouteDefinitions(event.content);
      if (routes.length) {
        memories.push({
          category: 'api',
          key: `routes-${path.basename(event.path)}`,
          value: routes.join(', '),
          source: event.path
        });
      }
    }
  }

  return memories;
}

function extractCSSVariables(content) {
  const vars = [];
  const re = /--([\w-]+)\s*:\s*([^;]+)/g;
  let match;
  while ((match = re.exec(content))) {
    vars.push({ name: match[1], value: match[2].trim() });
  }
  return vars;
}
```

This handles a huge percentage of the "theme outline" use case — colors, layout config, dependencies, API patterns — with zero API calls. The LLM is only needed for *conversational* decisions that aren't reflected in file changes.

### Strategy 4: Use a Local Model for Remaining Cases

For turns that pass triage but need semantic understanding, run a small local model instead of hitting the Anthropic API:

```javascript
// local-extractor.js - use Ollama or llama.cpp
async function extractWithLocalModel(transcript) {
  // Ollama running locally - no rate limits, no API costs
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: 'qwen2.5:7b',  // fast, good at extraction
      prompt: buildExtractionPrompt(transcript),
      stream: false,
      options: { temperature: 0.1 }
    })
  });

  return parseExtractionResponse(await response.json());
}
```

A 7B parameter model is more than capable of extracting "user decided to use blue-600 as primary color" from a conversation. It won't be as nuanced as Sonnet, but for structured extraction tasks it's plenty.

### Strategy 5: The Hybrid Pipeline

Put it all together as a cascade — each layer only escalates what it can't handle:

```
Session Turn (every ~30 seconds)
    │
    ▼
[Local Accumulator] ── just appends to a .jsonl file
    │                    cost: 0 API calls
    │
    ▼ (on session end or idle timeout)
    │
[Deterministic Triage] ── keyword/pattern scoring
    │                       cost: 0 API calls
    │                       filters out ~75% of turns
    │
    ├── score < threshold ──▶ discard
    │
    ▼ (high-signal turns only)
    │
[Structural Extractor] ── parse file writes, configs, diffs
    │                       cost: 0 API calls
    │                       captures ~60% of remaining decisions
    │
    ├── extracted memories ──▶ write to CLAUDE.md
    │
    ▼ (ambiguous conversational decisions only)
    │
[Local Model OR Queued API Call]
    │   Local: Ollama/llama.cpp, 0 API cost
    │   Remote: batched, off-peak, 1-3 calls per session
    │
    ▼
[Merge into CLAUDE.md]
```

The net result: a typical session might generate zero Anthropic API calls (structural extraction handles it), or at most 1–3 batched calls after the session ends. The user's active rate limits are never touched.

### Strategy 6: Let the User's Own Session Do It (Free)

Instead of a sidecar LLM call, inject a small instruction into the system context (via CLAUDE.md) that asks the *existing* Claude Code session to tag decisions as it goes:

```markdown
<!-- In CLAUDE.md -->
## Memory Protocol
When you make a project decision (architecture, design tokens, conventions,
API patterns), append a one-line summary to `.claude/decisions.log` in the
format: `[category] key: value`

Only log deliberate decisions, not exploratory steps.
```

This costs zero additional API calls — Claude is already running and the file write is a trivial addition to whatever it's doing. The sidecar daemon then just monitors `decisions.log`, validates/deduplicates, and merges into CLAUDE.md.

The downside is it slightly influences the primary workflow (which you wanted to avoid), but in practice a one-line file append is negligible overhead.

### Recommended Combination

The cleanest production setup is **Strategies 1 + 2 + 3** (accumulate locally, triage with heuristics, extract structurally from file changes) as the default path, with **Strategy 4** (local model) as the fallback for conversational decisions that can't be parsed structurally. This gives you intelligent curated context with literally zero Anthropic API calls in the common case.