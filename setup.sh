#!/bin/bash
set -e

echo "Setting up curated-context..."

# Register as a Claude Code plugin
claude plugin add "$(pwd)"

echo ""
echo "curated-context installed! The hooks are now active."
echo ""
echo "How it works:"
echo "  - Stop hook accumulates transcript data each turn (no API calls)"
echo "  - SessionStart hook triggers deferred processing of previous sessions"
echo "  - Dependencies are installed automatically on first session start"
echo "  - Memories are written to .claude/rules/cc-*.md and CLAUDE.md"
echo ""
echo "Commands:"
echo "  /curated-context          — Query and manage memories"
echo "  /curated-context:status   — Daemon health and API usage"
echo "  /curated-context:forget   — Remove a specific memory"
echo ""
echo "CLI:"
echo "  npx curated-context status    — Check daemon and memory counts"
echo "  npx curated-context memories  — List all memories for current project"
