---
description: Manually teach curated-context a memory about this project
allowed-tools: Bash, Read
argument-hint: <what to remember>
---

# /curated:teach — Teach a Memory

Manually add a memory to the curated-context store for this project.

## Parse the User's Input

The user will provide something like:
- `design primary-color "The primary color is #2563EB"`
- `architecture orm "We use Drizzle ORM with PostgreSQL"`
- `conventions naming "Use camelCase for variables, PascalCase for components"`
- Or natural language: `remember that we always use Tailwind cn() for className merging`

Extract three parts:
1. **category** — One of: `architecture`, `design`, `api`, `conventions`, `config`, `tooling`, `gotchas`
2. **key** — A short kebab-case identifier (e.g., `primary-color`, `orm-choice`)
3. **value** — The memory content (concise, under 100 chars)

If the user provides natural language, infer the best category and generate an appropriate key.

## Save the Memory

Run the CLI to save:
```bash
node <find cli.js in the plugin dist directory> teach "<category>" "<key>" "<value>"
```

The plugin root can be found by searching for `dist/cli.js` under the plugin directory. Use `$CLAUDE_PLUGIN_ROOT` if available, otherwise find it via: `dirname $(dirname $(which curated-context 2>/dev/null))` or search `~/.claude/plugins/`.

## Confirm to User

After saving, confirm:
```
Remembered: [key] → [value] (category: [category])
```

If the key already exists, note that the previous value was overwritten.
