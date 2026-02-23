# Security Model

This document describes the complete security model for the `curated-context` Claude Code plugin. It covers exactly what the plugin reads, writes, executes, and connects to — and what it explicitly does not do.

**Version:** 0.1.0
**License:** AGPL-3.0-only
**Architecture:** Two hook scripts (`capture.js`, `process.js`) + background daemon (Express on localhost) + CLI

---

## What the Plugin Reads

| What | Location | Purpose |
|------|----------|---------|
| Conversation transcripts | Path from Claude Code hook stdin (`transcript_path`) | Extract user/assistant messages and tool events |
| Decision log | `{project}/.claude/decisions.log` | User-tagged decisions (Tier 1 extraction) |
| CLAUDE.md | `{project}/CLAUDE.md` or `{project}/.claude/CLAUDE.md` | Merge managed section with existing content |
| Global CLAUDE.md | `~/.claude/CLAUDE.md` | Merge global memory section |
| Session queue | `~/.curated-context/sessions/*.jsonl` | Track pending sessions for processing |
| Memory store | `~/.curated-context/store/*.json` | Load existing memories to avoid duplicates |
| Config | `~/.curated-context/config.json` | API rate-limit tracking |
| PID file | `~/.curated-context/daemon.pid` | Daemon lifecycle management |
| Hook stdin | `/dev/stdin` | Receive hook input JSON from Claude Code |

### Transcript content details

From conversation transcripts, the plugin reads:

- **User messages** — text content only
- **Assistant messages** — text content only (thinking blocks are filtered out)
- **Tool use events** — tool name and input parameters (file paths, content written)

The following internal entries are **skipped**: `queue-operation`, `file-history-snapshot`.

Total content is budget-capped at **50,000 characters** (`src/extraction/transcript.ts:38`). If the transcript exceeds this, older messages are dropped.

---

## What the Plugin Writes

| What | Location | Write Method |
|------|----------|-------------|
| Session queue events | `~/.curated-context/sessions/{sessionId}.jsonl` | Append-only. Contains: timestamp, sessionId, projectRoot, transcriptHash, message/tool counts, transcript path. **No conversation content.** |
| Transcript hash | `~/.curated-context/sessions/{sessionId}.hash` | Overwrite. Simple dedup hash to avoid reprocessing. |
| Memory store | `~/.curated-context/store/{hash}.json` | **Atomic write** (write to `.tmp`, then `rename`). Max 200 project entries, 100 global entries. Evicts lowest-confidence, oldest entries when full. |
| CLAUDE.md section | `{project}/CLAUDE.md` or `{project}/.claude/CLAUDE.md` | **Atomic write** (write to `.tmp`, then `rename`). Only modifies content between `<!-- curated-context:start -->` and `<!-- curated-context:end -->` markers. |
| Global CLAUDE.md section | `~/.claude/CLAUDE.md` | **Atomic write**. Same marker-based section. |
| Rules files | `{project}/.claude/rules/cc-{category}.md` | Direct write. Max 1KB per file. Obsolete category files are deleted. |
| API config | `~/.curated-context/config.json` | Direct write. Stores API call counts and timestamps. |
| PID file | `~/.curated-context/daemon.pid` | Direct write. Contains daemon process ID. |
| Daemon log | `~/.curated-context/daemon.log` | Append (streaming). Only written when daemon runs in background mode. |

### Opt-out

If a user deletes the `<!-- curated-context:start -->...<!-- curated-context:end -->` block from their CLAUDE.md, the plugin detects this and will **not re-insert it** (`src/storage/claude-md.ts:39-50`).

---

## What the Plugin Does NOT Do

Every claim below is verified by exhaustive search of all `.ts` and `.js` source files:

- **No arbitrary file reads.** Only reads the files listed above. Does not scan the filesystem, read source code files, read `.env` files, or access files outside the project's `.claude/` directory and `~/.curated-context/`.

- **No environment variable snooping.** Only uses two env vars: `CC_DAEMON` (set internally to flag daemon mode) and `CLAUDE_PLUGIN_ROOT` (plugin install location).

- **No third-party network requests.** Only connects to `127.0.0.1:7377` (its own daemon). Tier 4 extraction uses the `claude` CLI subprocess, which handles its own authentication via the user's existing Claude Code subscription. No telemetry, analytics, error reporting, or phone-home behavior.

- **No dynamic code execution.** No `eval()`, no `Function()` constructor, no `vm` module, no dynamic `require()` or `import()` with user-controlled paths.

- **No shell command injection.** All subprocess spawning uses `spawn('node', [scriptPath])` or `execFile('claude', [...args])` with array arguments. The single `execSync` call is a hardcoded string (`npm install --omit=dev`) with a fixed `cwd`.

- **No credential storage.** No API keys are required or stored. Tier 4 extraction delegates to the `claude` CLI which uses the user's existing authentication.

- **No webviews or UI.** Pure CLI/daemon. No HTML, no browser contexts, no rendered content.

- **No git operations.** Does not read `.git/`, make commits, push, or modify version control in any way.

- **No modification of user source code.** Only writes to `.claude/` directories and the top-level `CLAUDE.md` file.

---

## Network Communication

### Localhost daemon

An Express server bound to **`127.0.0.1:7377`** (not `0.0.0.0`):

| Endpoint | Method | Purpose | Returns |
|----------|--------|---------|---------|
| `/process` | POST | Trigger queue processing | Processing stats (sessions processed, memory counts) |
| `/health` | GET | Daemon status check | Uptime, queue depth, processing stats |
| `/stop` | POST | Graceful shutdown | `{ status: "stopping" }` |

- No authentication (localhost-only binding is the access control)
- No endpoint returns stored memories or conversation content
- All client requests use 2-3 second timeouts

### Claude CLI Subprocess (Tier 4 extraction)

| Property | Value |
|----------|-------|
| Binary | `claude` (Claude Code CLI) |
| Invocation | `execFile('claude', ['-p', prompt, '--output-format', 'json', '--max-turns', '1', '--model', 'sonnet'])` |
| Purpose | Last-resort memory extraction (Tier 4 of 4-tier cascade) |
| Rate limits | Max 10 calls/hour globally; max 3 calls/project/hour; 5-min cooldown between projects |
| Data sent | High-signal conversation messages + existing memory keys (for dedup) — via command-line argument |
| Data received | JSON with extracted memories (category, key, value, confidence) — via stdout |
| Auth | Uses the user's existing Claude Code subscription (no separate API key) |
| Timeout | 60 seconds |

The `claude -p` subprocess is **only invoked when** the first three extraction tiers (decision log, structural parsing, regex triage) fail to capture decisions from a conversation that scores highly on decision signals.

---

## Subprocess Spawning

| Location | Command | Purpose | Detached? |
|----------|---------|---------|-----------|
| `src/cli.ts` | `spawn('node', [daemonScript])` | Start daemon (background) | Yes |
| `src/cli.ts` | `spawn('node', [daemonScript])` | Start daemon (foreground) | No |
| `src/extraction/llm.ts` | `execFile('claude', ['-p', ...])` | Tier 4 memory extraction | No (60s timeout) |
| `src/storage/consolidator.ts` | `execFile('claude', ['-p', ...])` | Memory consolidation | No (60s timeout) |
| `hooks/process.js` | `spawn('node', [daemonScript])` | Auto-start daemon on SessionStart | Yes |
| `hooks/process.js` | `execSync('npm install --omit=dev')` | Lazy dep install (only if `node_modules/` missing) | No (60s timeout) |
| `src/cli.ts` | `process.kill(pid, 'SIGTERM')` | Stop daemon (fallback if HTTP fails) | N/A |

All script paths are derived from the plugin's own installation directory (`import.meta.dirname` or `CLAUDE_PLUGIN_ROOT`), never from user input.

---

## Dependencies

### Runtime (1 package)

- **`express@^5.1.0`** — HTTP framework for the localhost daemon server.

### Dev-only (not installed in production with `--omit=dev`)

- `@types/express@^5.0.0`
- `@types/node@^22.0.0`
- `typescript@^5.7.0`
- `vitest@^4.0.18`

---

## Threat Model

### Threat 1: Conversation data sent via Claude CLI subprocess

**Risk:** High-signal conversation messages are passed to `claude -p` for memory extraction.
**Likelihood:** By design — but only as a last resort (Tier 4).
**Mitigations:**
- Only triggered when decision log + structural parsing + regex triage all fail to capture decisions
- Only messages matching decision-signal patterns are sent (not the full transcript)
- Rate-limited: max 10 calls/hour, max 3/project/hour, 5-minute cooldown
- Uses the same Claude Code subscription and data policies the user already agreed to

**User action:** Review call counts in `~/.curated-context/config.json`.

### Threat 2: Unencrypted local storage

**Risk:** Memory store files and session queue files are stored as plaintext JSON.
**Likelihood:** Low — requires local filesystem access by another user or process.
**Mitigations:**
- Files are in the user's home directory with standard Unix permissions
- Session queue files are deleted immediately after processing
- Memory stores contain only extracted decision summaries, not raw conversation content

**User action:** Ensure `~/.curated-context/` has `700` permissions (`chmod 700 ~/.curated-context`).

### Threat 3: Unauthenticated localhost daemon

**Risk:** Any local process can call `http://localhost:7377/process` or `/stop`.
**Likelihood:** Low — requires local access; no data exfiltration endpoints exist.
**Mitigations:**
- Only 3 endpoints exist (process, health, stop)
- No endpoint returns stored memories or conversation content
- Bound to `127.0.0.1` only (unreachable from other machines)
- Worst case: an attacker can trigger processing (no harm) or stop the daemon (minor annoyance)

**User action:** None needed for single-user machines.

### Threat 4: Rules files committed to public repositories

**Risk:** `.claude/rules/cc-*.md` files contain extracted project decisions (architecture, design tokens, API patterns) that could leak proprietary information if committed to a public repo.
**Likelihood:** Medium — files are in a directory that may be git-tracked.

**User action:** Add to `.gitignore`:
```
.claude/rules/cc-*.md
```

### Threat 5: Memory poisoning via transcript manipulation

**Risk:** If an attacker could modify Claude Code's transcript files before the Stop hook fires, they could inject false memories.
**Likelihood:** Very low — requires write access to Claude Code's internal transcript directory.
**Mitigations:**
- Memories require confidence >= 0.7 to be stored
- Memory store capped at 200 entries (evicts lowest confidence first)
- Users can review all memories: `curated-context memories`
- Users can delete any memory: `curated-context forget <key>`

### Threat 6: Automatic npm install execution

**Risk:** `process.js` runs `npm install --omit=dev` automatically if `node_modules/` is missing.
**Likelihood:** Low — only runs once after fresh clone/install.
**Mitigations:**
- Hardcoded command string (no user input in command)
- `cwd` is the plugin's own directory (not the user's project)
- 60-second timeout
- Fails gracefully (daemon won't start, retries next session)

**User action:** Run `npm install` manually before activating the plugin to avoid automatic execution.

### Threat 7: Unbounded daemon log growth

**Risk:** `~/.curated-context/daemon.log` grows indefinitely in append mode.
**Likelihood:** Low — daemon only logs processing summaries and errors.
**Mitigation:** None currently implemented.

**User action:** Periodically truncate: `> ~/.curated-context/daemon.log`

### Threat 8: Full environment variable inheritance

**Risk:** The daemon subprocess inherits all parent environment variables via `{ ...process.env, CC_DAEMON: '1' }`.
**Likelihood:** Low — the daemon makes no direct network calls to external services.
**Mitigations:**
- Daemon only connects to its own localhost server
- `claude -p` subprocesses inherit the same environment the user's Claude Code already runs in
- No environment variable logging or persistence

---

## Data Flow

```
Claude Code Session
       |
       |--[Stop hook]--> capture.js
       |                    |  Reads: transcript file (via path from stdin)
       |                    |  Writes: session metadata to ~/.curated-context/sessions/{id}.jsonl
       |                    |          transcript hash to ~/.curated-context/sessions/{id}.hash
       |                    |  NOTE: No conversation content is written to queue files,
       |                    |        only metadata (counts, hash, paths)
       |                    v
       |              ~/.curated-context/sessions/{id}.jsonl
       |
       |--[SessionStart hook]--> process.js
       |                            |  Checks for pending .jsonl files
       |                            |  Starts daemon if not running
       |                            |  Sends POST http://127.0.0.1:7377/process
       |                            v
       |                    Daemon (src/daemon/index.ts)
       v
  Processing Pipeline (src/daemon/processor.ts)
       |
       |-- Tier 1: Decision Log (FREE)
       |     Reads: {project}/.claude/decisions.log
       |     Highest signal — user explicitly tagged these decisions
       |
       |-- Tier 2: Structural Extraction (FREE)
       |     Parses: tool_use events for package.json, CSS vars,
       |             config files, route definitions
       |
       |-- Tier 3: Deterministic Triage (FREE)
       |     Regex scoring on messages — filters ~75% of conversations
       |     Only passes conversations with decision-signal score >= 2
       |
       |-- Tier 4: Claude CLI subprocess (RATE-LIMITED, last resort)
       |     Runs: claude -p --output-format json --max-turns 1 --model sonnet
       |     Input: high-signal messages + existing memory keys
       |     Output: extracted memories as JSON
       |     Limits: 10/hour global, 3/project/hour, 5-min cooldown
       |
       v
  Memory Store (~/.curated-context/store/{hash}.json)
       |
       |---> {project}/.claude/rules/cc-{category}.md  (max 1KB each)
       |---> {project}/CLAUDE.md  (managed section between markers)
       |---> ~/.claude/CLAUDE.md  (global memories between markers)
```

---

## Permissions Summary

| Capability | Status | Details |
|-----------|--------|---------|
| Read user source files | **NO** | Only reads transcripts, CLAUDE.md, decisions.log, and its own data files |
| Write user source files | **NO** | Only writes to `.claude/` directories and `CLAUDE.md` |
| Network (internet) | **NO** | No direct internet calls. `claude -p` subprocess handles its own network via user's subscription |
| Network (localhost) | **YES** | Own daemon on `127.0.0.1:7377` |
| Environment variables | **MINIMAL** | `CC_DAEMON`, `CLAUDE_PLUGIN_ROOT` |
| Subprocess execution | **YES** | Own daemon script + one-time `npm install` |
| File deletion | **LIMITED** | Own session queue files and obsolete `.claude/rules/cc-*.md` files only |
| Process management | **LIMITED** | Own daemon process only (PID-file based) |
| Dynamic code execution | **NO** | No eval, Function, vm, or dynamic imports |
| Credential storage | **NO** | No API keys required; `claude` CLI manages its own auth |
| Telemetry / analytics | **NO** | No tracking of any kind |
