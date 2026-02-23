---
description: Show a summary of all curated-context memories for the current project
allowed-tools: Read, Bash, Glob
---

# /curated — Memory Summary

Show a concise overview of all memories stored for the current project.

## Steps

1. Find the project memory store by listing files in `~/.curated-context/store/` and reading the one matching this project (use `node -e "require('crypto').createHash('md5').update(process.cwd()).digest('hex').slice(0,12)"` to get the hash, or read all store files and match by `projectRoot`)
2. Parse the JSON and group memories by category
3. Check daemon status: `curl -s http://localhost:7377/health 2>/dev/null || echo "not running"`
4. Count pending sessions in `~/.curated-context/sessions/`

## Output Format

```
Curated Context — [total] memories across [N] categories

## Design (3)
  - primary-color: The primary color is #2563EB
  - font-heading: Inter is used for all headings
  - spacing-unit: 4px base spacing unit

## Architecture (2)
  - orm: Using Drizzle ORM with PostgreSQL
  - auth: JWT-based auth with refresh tokens

Daemon: running | Sessions pending: 0
```

Be concise. Use bullet points. Group by category with counts. Do not show confidence scores unless the user asks.
