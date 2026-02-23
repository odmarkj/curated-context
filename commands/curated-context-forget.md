---
description: Remove a specific memory or category of memories from curated-context
allowed-tools: Bash, Read, Edit
argument-hint: <key or category>
---

# /curated-context:forget — Remove Memories

Remove the specified memory key or all memories in a category.

## With a specific key

Run:
```bash
node <find the cli.js in the plugin dist> forget "$ARGUMENTS"
```

This removes the memory from the JSON store and regenerates `.claude/rules/cc-*.md` and the CLAUDE.md marker section.

## With a category name

If the argument matches a category (architecture, design, api, conventions, config, tooling, gotchas), remove ALL memories in that category:

1. Read the project store from `~/.curated-context/store/`
2. Remove all entries where `category === argument`
3. Write the updated store back
4. Delete the corresponding `.claude/rules/cc-<category>.md` file

## Confirmation

Always show what will be removed and ask for confirmation before proceeding.
