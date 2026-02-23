---
description: Search curated-context memories by keyword
allowed-tools: Read, Bash, Glob
argument-hint: <search query>
---

# /curated:search — Search Memories

Search across all memories for the current project by keyword.

## Steps

1. Find and read the project memory store from `~/.curated-context/store/` (use the project hash or match by `projectRoot`)
2. Also read the global store from `~/.curated-context/store/global.json`
3. Perform case-insensitive substring matching of the query against both the `key` and `value` fields of every memory
4. Group matches by category

## Output Format

```
Found 3 matches for "auth":

## Architecture
  - auth-strategy: JWT-based auth with refresh tokens
  - session-store: Redis for session management

## API
  - auth-endpoint: POST /api/v1/auth/login returns JWT pair

No matches in global memories.
```

If no matches are found:
```
No memories matching "auth". Available categories: design (5), architecture (3), api (2)
```

Be concise. Show the matching memories with their key and value. Do not show confidence or timestamps unless asked.
