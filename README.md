<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img alt="Curated Context" src="assets/logo-light.svg" width="400">
  </picture>
</p>

<p align="center">
  <strong>Intelligent memory sidecar for Claude Code</strong><br>
  <em>Passively captures project decisions. Writes them where Claude reads them. Zero effort.</em>
</p>

<p align="center">
  <a href="https://github.com/odmarkj/curated-context/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/version-0.1.0-green.svg" alt="Version: 0.1.0">
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node: >=20.0.0">
  <img src="https://img.shields.io/badge/claude--code-plugin-blueviolet.svg" alt="Claude Code Plugin">
  <a href="TODO-buymeacoffee-url"><img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-donate-yellow.svg?logo=buy-me-a-coffee&logoColor=white" alt="Buy Me A Coffee"></a>
</p>

<!-- TODO: Add animated GIF or SVG showing the tool in action -->
<p align="center">
  <img src="TODO-demo.gif" alt="curated-context demo" width="680">
</p>
<p align="center">
  <em>curated-context silently observing a Claude Code session, then auto-generating project context files</em>
</p>

<p align="center">
  <a href="#the-problem">The Problem</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#how-it-works">How It Works</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#commands">Commands</a> &bull;
  <a href="#contributing">Contributing</a>
</p>

---

## The Problem

Every time you start a new Claude Code session, it starts from scratch. It doesn't remember that:

- Your brand uses **Inter for headings** and **#2563EB as the primary color**
- Your API follows **RESTful conventions with a /api/v1/ prefix**
- You chose **Drizzle over Prisma** after careful evaluation
- Your React components use **compound pattern with forwardRef**
- That edge case in the payment flow that took you two hours to debug

There are many times when curated context can save significant time, frustration, and make Claude Code feel like magic. Take a website application project — the branding guide that defines colors, fonts, and layout may not always be defined upfront. Even if it was, it may not always be included in the context. It may change over time. If these details aren't in the context and you ask Claude Code to build a new page, it will often pick an entirely different theme, colors, fonts, and layout than what your application already uses.

You end up re-explaining the same decisions in every session. Over and over.

**curated-context fixes this.** It runs silently in the background, captures the decisions you make during conversations, and writes them into files that Claude Code automatically reads. The next session starts with full context — your design tokens, your architecture choices, your conventions — without you lifting a finger.

---

## Quick Start

```bash
# Add the marketplace
claude plugin marketplace add odmarkj/curated-context

# Install the plugin
claude plugin install curated-context
```

That's it. Two commands. No configuration needed.

---

## How It Works

curated-context uses a **4-tier cascading pipeline** designed to minimize API costs. Most sessions require **zero API calls**.

| Tier | Method | Cost | What It Captures |
|------|--------|------|------------------|
| 1 | **Memory Protocol** | Free | Claude self-reports decisions to `.claude/decisions.log` |
| 2 | **Structural Extraction** | Free | CSS variables, dependencies, configs, API routes from file writes |
| 3 | **Deterministic Triage** | Free | Regex/keyword scoring filters ~75% of conversation noise |
| 4 | **Claude via `claude -p`** | Your Claude Code sub | Ambiguous conversational decisions (max 30 calls/hour) |

### What gets captured

- **Design tokens** — Colors, fonts, spacing, breakpoints from CSS/SCSS/Tailwind
- **Architecture decisions** — Framework choices, ORMs, state management, auth patterns
- **API patterns** — Route definitions, naming conventions, versioning schemes
- **Configuration** — TypeScript settings, linter rules, build tool configs
- **Conventions** — Naming patterns, file structure, component patterns
- **Gotchas** — Pitfalls, debugging solutions, edge cases

### Where memories are stored

| File | Purpose |
|------|---------|
| `.claude/rules/cc-*.md` | Categorized context files, auto-loaded by Claude Code |
| `CLAUDE.md` | Brief summary section with markers |
| `~/.curated-context/store/` | JSON backing store (source of truth) |

---

## Architecture

```
Claude Code Session
       |
       | Stop hook (every turn)
       v
[Session Accumulator] ── appends to ~/.curated-context/sessions/
       |                   cost: 0 API calls
       |
       | SessionStart hook (next session)
       v
[Background Daemon :7377]
       |
       |──> Tier 1: Decision Log Reader (.claude/decisions.log)
       |──> Tier 2: Structural Extractor (file writes)
       |──> Tier 3: Deterministic Triage (regex scoring)
       |──> Tier 4: Claude Sonnet API (rate-limited last resort)
       |
       v
[Memory Store] ── JSON at ~/.curated-context/store/
       |
       |──> .claude/rules/cc-{category}.md
       |──> CLAUDE.md (marker section)
```

### Key design decisions

- **Hooks over MCP** — The main Claude session never knows memory extraction is happening. Hooks fire automatically; the sidecar processes independently.
- **Deferred processing** — Transcripts accumulate during sessions. Processing happens on next session start, so your active rate limits are never touched.
- **Sonnet via `claude -p`** — Uses your existing Claude Code subscription. No separate API key needed. Well-scoped classification work, fast and accurate.
- **Marker-based CLAUDE.md** — Users can see and edit auto-managed sections. Deleting the markers opts out. The daemon never clobbers manual content.

---

## Commands

### Slash Commands (inside Claude Code)

| Command | Description |
|---------|-------------|
| `/curated` | Show a summary of all memories for the current project |
| `/curated:teach <memory>` | Manually teach a memory (e.g., `/curated:teach design primary-color "#2563EB"`) |
| `/curated:search <query>` | Search memories by keyword |
| `/curated-context` | Query and manage memories (verbose mode) |
| `/curated-context:status` | Daemon health, queue depth, and API usage |
| `/curated-context:forget <key>` | Remove a specific memory |

### CLI

```bash
curated-context start [-d]                       # Start daemon (foreground, or -d for background)
curated-context stop                             # Stop daemon
curated-context status                           # Daemon health + memory counts
curated-context memories [--global]              # List all memories
curated-context teach <category> <key> <value>   # Manually add a memory
curated-context search <query>                   # Search memories by keyword
curated-context forget <key> [--global]          # Remove a specific memory
curated-context promote <key>                    # Move project memory to global store
```

---

## Getting Started

### Installation

```bash
# Add the marketplace (one time)
claude plugin marketplace add odmarkj/curated-context

# Install the plugin
claude plugin install curated-context
```

For local development, you can also load directly:
```bash
claude --plugin-dir /path/to/curated-context
```

### Verify installation

Start a Claude Code session. You should see the hooks register. Then run:

```bash
# Inside Claude Code, use the slash command
/curated-context:status
```

Or from a terminal:

```bash
npx curated-context status
```

### How memories appear

After a few sessions, you'll find:

```
your-project/
  .claude/
    decisions.log          # Claude's self-reported decisions
    rules/
      cc-design.md         # Design tokens, colors, fonts
      cc-architecture.md   # Tech stack, patterns
      cc-api.md            # Route definitions
      cc-conventions.md    # Naming, style rules
  CLAUDE.md                # Summary section with markers
```

These files are automatically read by Claude Code on every session start.

---

## System Requirements

- **Node.js** >= 20.0.0
- **Claude Code** with plugin support

---

## Documentation

<!-- TODO: Create and link detailed docs -->

| Topic | Description |
|-------|-------------|
| [Getting Started](TODO) | Installation, first run, verifying it works |
| [Configuration](TODO) | Rate limits, categories, store locations |
| [Memory Protocol](TODO) | How the decision log works and how to tune it |
| [Structural Extraction](TODO) | Which file types are parsed and what's extracted |
| [Troubleshooting](TODO) | Common issues, daemon logs, debugging |
| [API Reference](TODO) | Daemon HTTP endpoints, store format, types |

For the full technical design document, see [DESIGN.md](DESIGN.md).

---

## Contributing

<!-- TODO: Create CONTRIBUTING.md -->

Contributions are welcome! Please see [CONTRIBUTING.md](TODO) for guidelines.

### Development

```bash
git clone https://github.com/odmarkj/curated-context.git
cd curated-context
npm install
npm run build        # Compile src/ -> dist/
npm run dev          # Watch mode (tsc --watch)
```

When contributing, commit `dist/` changes alongside `src/` changes so end users don't need a build step.

### Project structure

```
curated-context/
├── hooks/              # Plain JS hook handlers (no build step)
│   ├── hooks.json      # Plugin hook configuration
│   ├── capture.js      # Stop hook: accumulate transcripts
│   └── process.js      # SessionStart hook: trigger processing
├── commands/           # Slash command definitions
├── agents/             # Sub-agent definitions
├── src/                # TypeScript source
│   ├── cli.ts          # CLI entry point
│   ├── daemon/         # Express daemon (index, processor, queue, lifecycle)
│   ├── extraction/     # 4-tier pipeline (decision-log, structural, triage, llm)
│   └── storage/        # Memory store, rules writer, CLAUDE.md writer
├── dist/               # Compiled output (committed)
├── bin/                # CLI bin entry
└── .claude-plugin/     # Plugin manifest
```

---

## License

[AGPL-3.0-only](LICENSE) — see [LICENSE](LICENSE) for full text.

---

## Support

<!-- TODO: Add GitHub Discussions or Discord -->

- **Bug reports** — [GitHub Issues](https://github.com/odmarkj/curated-context/issues)
- **Feature requests** — [GitHub Issues](https://github.com/odmarkj/curated-context/issues)
- **Questions** — [GitHub Discussions](https://github.com/odmarkj/curated-context/discussions)

<p align="center">
  <a href="TODO-buymeacoffee-url">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="200">
  </a>
</p>

---

<p align="center">
  <sub>Built for the Claude Code ecosystem</sub>
</p>
