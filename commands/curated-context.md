---
description: Query and manage curated-context memories for the current project
allowed-tools: Read, Bash, Glob, Grep
argument-hint: [query or action]
---

# /curated-context — Intelligent Memory Manager

You are interacting with curated-context, an intelligent memory sidecar. Read the memory store and respond to the user's request.

## Without Arguments

Show a summary of memories for the current project:

1. Read `~/.curated-context/store/` to find the store file for this project (files are named by project path hash)
2. Parse the JSON and display memories grouped by category
3. Show daemon status by running: `curl -s http://localhost:7377/health 2>/dev/null || echo "daemon not running"`
4. Show count of pending sessions in `~/.curated-context/sessions/`

## With Arguments

Interpret the argument as a memory management request:

- **"what do you remember about X?"** — Search memories for keywords matching X
- **"forget X"** — Remove the memory with key X from the store, then regenerate output files by running: `node <plugin-root>/dist/cli.js forget "X"`
- **"promote X to global"** — Move a project memory to the global store
- **"show all"** — List every memory with full details (category, confidence, age, source)

## Memory Store Location

- Project memories: `~/.curated-context/store/<hash>.json`
- Global memories: `~/.curated-context/store/global.json`
- Decision log: `.claude/decisions.log`
- Output rules: `.claude/rules/cc-*.md`

## Response Format

Be concise. Use bullet points. Group by category. Show confidence scores only if relevant.
