---
description: Backfill curated-context memories from claude-mem session history for a project
allowed-tools: Bash, Read, Glob, Grep
argument-hint: <project-path> [--skip-api] [--clear] [--verbose] [--dry-run]
---

# /curated-context:backfill — Import claude-mem History

Process a project's claude-mem session history through curated-context's extraction pipeline to retroactively build the memory store — as if curated-context had been installed from day one.

## Prerequisites

This command requires that **claude-mem** is installed and has recorded session history for the target project. Session files are stored at `~/.claude/projects/<project-slug>/`.

## Arguments

The first argument is the **project path** (required). Additional flags:

- `--skip-api` — Only run free extraction tiers (structural + triage), skip Claude API calls
- `--clear` — Wipe existing memories before backfill (useful for re-testing)
- `--verbose` — Show per-session details during processing
- `--dry-run` — List discovered sessions without processing them

## Steps

1. Validate the project path argument. If not provided, ask the user for it.

2. Check that claude-mem data exists for the project:
   ```bash
   ls ~/.claude/projects/$(echo "<project-path>" | tr '/' '-')/*.jsonl 2>/dev/null | wc -l
   ```
   If no sessions found, inform the user and stop.

3. Run backfill via the CLI (find the plugin root first):
   ```bash
   PLUGIN_ROOT=$(dirname "$(dirname "$(readlink -f "$(which curated-context 2>/dev/null || echo "$CLAUDE_PLUGIN_ROOT")")")")
   node "$PLUGIN_ROOT/dist/cli.js" backfill --project "<project-path>" [flags from arguments]
   ```

   If `$CLAUDE_PLUGIN_ROOT` is available, use:
   ```bash
   node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" backfill --project "<project-path>" [flags]
   ```

4. Display the results. If memories were extracted, suggest running `/curated-context:show` to review them.

## Safety

- This command only reads claude-mem's session files — it never modifies or deletes them.
- Each session is processed independently; one failure does not affect others.
- Existing memories are merged by key (idempotent). Use `--clear` to start fresh.
- API calls respect curated-context's existing rate limits (30/hr global, 10/project/hr).
