# Phase 2 — Advanced Features (TODO)

> Depends on Phase 1.5 completion (especially SQLite migration and contradiction tracking).
> Inspired by [jarvis-orb](https://github.com/whynowlab/jarvis-orb), [Zikkaron](https://github.com/amanhij/Zikkaron), [agent-recall](https://github.com/mnardit/agent-recall), [engram](https://github.com/Gentleman-Programming/engram), [breathe-memory](https://github.com/tkenaz/breathe-memory), [shodh-memory](https://github.com/varun29ankuS/shodh-memory), and [Cortex](https://github.com/cdeust/Cortex).
> These features add structural depth and visibility to the memory system.

---

## 1. Entity / Knowledge Graph

**Inspiration:** jarvis-orb's entity system with state transitions and relationships.

**Concept:** Layer a lightweight entity model on top of the memory store. Entities represent things (tools, services, people, decisions) with typed relationships between them.

**Key ideas:**
- Entity types: `tool`, `service`, `decision`, `pattern`, `person`, `dependency`
- Relationships: subject → predicate → object (e.g., `project → uses → Kamal`, `auth-decision → chose → Auth.js`)
- State transitions with timestamps (e.g., a dependency going from `v4` → `v5`)
- Entities extracted automatically during Tier 2 (structural) and Tier 4 (LLM) extraction
- Query interface: "what tools does this project use?" resolves to entity query, not full memory scan
- Storage: additional SQLite tables alongside memory FTS (leverages Phase 1.5 migration)

**Open questions:**
- How much entity extraction can be done deterministically vs requiring LLM?
- Should entities be project-scoped only, or also global?
- How to handle entity merging when the same thing is referenced differently?
- **4-tier entity dedup** (from shodh-memory): exact → case-insensitive → stemmed → embedding similarity. Prevents "React", "react", "ReactJS" from fragmenting into separate nodes.

---

## 2. Memory Verification Workflow

**Inspiration:** jarvis-orb's unverified → verified lifecycle.

**Concept:** Automatically-extracted memories start as `unverified`. Users can verify them explicitly, or they get auto-verified after repeated reinforcement.

**Key ideas:**
- Add `verified: boolean` field to `StoredMemory` (default: `false`)
- Auto-verify when: confidence ≥ 0.85 AND observed in ≥ 2 sessions
- Manual verify via: `curated-context verify <key>` or slash command
- Rules file output could optionally annotate unverified memories (e.g., `_(unverified)_`)
- Verification status factors into effective confidence score
- Batch verification: `curated-context verify --review` shows unverified memories for quick accept/reject

**Open questions:**
- Should unverified memories be included in rules files at all, or held back?
- How aggressive should auto-verification be?

---

## 3. Activity Visibility / Event Stream

**Inspiration:** jarvis-orb's real-time orb visualization and WebSocket event broadcasting.

**Concept:** Expose what the memory system is doing so users can see extraction activity, new memories, contradictions, and evictions in real time.

**Key ideas:**
- The daemon already runs on port 7377 — add a `/events` SSE (Server-Sent Events) endpoint
- Event types: `memory_created`, `memory_updated`, `memory_evicted`, `memory_contradicted`, `extraction_started`, `extraction_complete`, `tier_skipped`
- Simple terminal viewer: `curated-context watch` streams events with color-coded output
- Optional: web dashboard at `localhost:7377/dashboard` showing memory stats, recent activity, contradiction rate
- Event log persisted to `~/.curated-context/events.jsonl` for post-hoc analysis
- Could integrate with VS Code status bar or Claude Code status line

**Open questions:**
- SSE vs WebSocket? SSE is simpler and sufficient for one-way streaming
- How much event history to retain?
- Should the dashboard be a separate package or bundled?

---

## 4. Compaction Resilience (Checkpoint / Anchor / Restore)

> Inspired by Zikkaron's hippocampal replay, engram's compaction hooks, and Cortex's Notification-based checkpoint.

**Concept:** Claude Code's context compaction discards earlier conversation context. Critical project knowledge discovered mid-session can be lost. A checkpoint/restore system ensures important context survives compaction.

**Key ideas:**
- Hook into Claude Code's compaction lifecycle via **two complementary mechanisms**:
  - `Notification` hook (from Cortex): intercept compaction notification events and auto-save a checkpoint before context is lost
  - `SessionStart` with compaction matcher: detect post-compaction session resumption and inject checkpoint data via `additionalContext`
- Checkpoint content: current session's high-value discoveries (decisions, errors, architecture insights)
- "Anchored" memories (decisions, explicit user teaches, protected memories from 1.5.4) survive unconditionally
- Micro-checkpoints trigger automatically on significant events (error patterns, decision language, high-confidence extractions) — via the PostToolUse hook added in 1.5
- Checkpoint storage: `~/.curated-context/checkpoints/{sessionId}.json`

**Open questions:**
- Which hook event actually fires for compaction — `Notification`, `PreCompact`, or both? Needs testing.
- How to determine what's "high-value" without LLM? Use decision regex + Tier 3 scoring?
- How much checkpoint data to inject post-compaction without bloating context?
- Should checkpoints persist across sessions or be ephemeral?

---

## 5. Curation on Ingestion (Merge vs Link vs Create)

> Inspired by Zikkaron's ingestion curation and agent-recall's entity dedup.

**Concept:** Before creating a new memory, check if it should merge into an existing one. This prevents duplication at write time rather than requiring periodic consolidation (the still-unimplemented "Phase 8" consolidation).

**Key ideas:**
- On every memory write, compare against existing memories in the same category
- **High overlap** (same key or very similar value): merge — update value, boost confidence, preserve higher-confidence version
- **Moderate overlap** (related but distinct): link — add `relatedTo: [keys]` field
- **No overlap**: create new memory as normal
- Similarity check: FTS5 match + key prefix matching (leverages Phase 1.5 SQLite migration)
- Dedup CLI command: `curated-context dedup` — scan for duplicates and interactively merge
- Fuzzy key matching for common variations (e.g., `pref-auth-nextjs` vs `pref-auth-authjs`)
- This effectively replaces the need for a separate consolidation phase

**Open questions:**
- Similarity threshold for merge vs link vs create?
- Should merges preserve both values (append) or pick the newer one?
- How to handle cross-category near-duplicates (e.g., `config-auth-provider` and `architecture-auth-strategy`)?

**Replaces:** The unimplemented "Phase 8 consolidation" referenced in `src/cli.ts:376`.

---

## 6. Project Seeding

> Inspired by Zikkaron's `seed_project` and agent-recall's project file discovery.

**Concept:** On first encounter with a new project, scan the codebase and bootstrap memories from project structure, configs, and documentation — giving curated-context a head start instead of waiting for conversation-driven extraction.

**Key ideas:**
- Trigger: first `SessionStart` hook for a project with zero memories in the store
- Scan and extract from:
  - `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` — dependencies, scripts, project name
  - `tsconfig.json` / `vite.config.*` / `next.config.*` — framework and build config
  - `docker-compose.yml` / `Dockerfile` — infrastructure choices
  - `.github/workflows/` / `.gitlab-ci.yml` — CI/CD setup
  - `README.md` — project description and architecture overview
  - Directory structure — detect monorepo boundaries, identify key directories
- All seed memories tagged `source: seed` with moderate confidence (0.6)
- Idempotent: `curated-context seed` CLI command clears `source: seed` memories and re-scans
- Seed memories can be superseded by conversation-extracted memories (which have higher confidence)
- No LLM required — purely structural/deterministic extraction (extends Tier 2)

**Open questions:**
- How deep to scan? Top-level configs only, or recurse into packages?
- Should seeding run synchronously (blocking session start) or async?
- Monorepo handling: one store per package, or unified with tags?

---

## 7. Progressive Disclosure for Rules Files

> Inspired by engram's search → timeline → full content retrieval pattern.

**Concept:** As memories grow, rules files become bloated. Instead of dumping every memory's full value, generate compact summaries with topic-key references, and let the agent drill into full content via MCP search.

**Key ideas:**
- Rules files contain one-line summaries per memory (key + truncated value, ~100 chars)
- Full content available via `search` MCP tool or slash command
- Memories with `revisionCount > 3` or `duplicateCount > 2` get priority placement (frequently updated = important)
- This reduces rules file size while preserving discoverability
- Pairs with FTS — the agent can search for details when a summary isn't enough

**Open questions:**
- How short can summaries be while still triggering the right associations?
- Should high-confidence memories always get full content in rules files?

---

## 8. Private Content Stripping

> Inspired by engram's `<private>...</private>` tag removal.

**Concept:** Users may discuss sensitive information (credentials, internal URLs, personal details) that should never be persisted. Strip tagged content before any memory storage.

**Key ideas:**
- Recognize `<private>...</private>` tags in conversation content and strip before extraction
- Also strip common sensitive patterns: API keys (`sk-...`, `AKIA...`), tokens, passwords in env vars
- Apply at the earliest stage — in transcript parsing (Tier 0), before any other processing
- Log that stripping occurred (without the content) for transparency
- CLI: `curated-context audit` — scan existing memories for accidentally-stored sensitive patterns

**Open questions:**
- What patterns beyond explicit tags? `.env` values? URLs with tokens?
- Should stripping be configurable per project?

---

## 9. Conversation Mode Gating

> Inspired by breathe-memory's conversation mode detection (casual/work/deep/balanced).

**Concept:** Not every conversation warrants memory extraction. Greeting messages, quick debugging sessions, and casual chats produce noise. Detect the conversation mode and gate extraction intensity accordingly.

**Key ideas:**
- Classify sessions by technical term density and decision signal count (reuse Tier 3 scoring):
  - **Casual** (low technical, low decisions): skip Tier 3/4 entirely, structural extraction only
  - **Debugging** (high technical, high noise signals): skip Tier 4 LLM, rely on structural + decision log
  - **Decision-heavy** (high decision signals): full pipeline, all tiers
  - **Mixed**: standard pipeline with normal thresholds
- This reduces unnecessary LLM calls (Tier 4) for sessions that won't produce valuable memories
- Mode detection runs at the start of processing (before Tier 3 triage), using aggregate session statistics
- Configurable overrides per project (some projects may want aggressive extraction)

**Open questions:**
- Should mode detection be per-session or per-message-batch?
- How to handle sessions that start casual but shift to decision-heavy?

---

## 10. Feedback Momentum (Memory Quality Self-Improvement)

> Inspired by shodh-memory's learned relevance weights with EMA of helpfulness.

**Concept:** Track whether memories surfaced in rules files actually get referenced by the agent. Memories that are frequently useful should rank higher; memories that are never referenced should decay faster.

**Key ideas:**
- When a rules file is generated, record which memories were included
- After a session, check which included memories were actually referenced in agent responses (fuzzy match on key/value)
- Compute an **exponential moving average (EMA)** of "helpfulness" per memory: `ema = α * wasUsed + (1-α) * previousEma` where α = 0.3
- EMA factors into effective confidence score alongside decay and recency bonus
- Memories with consistently low EMA (never referenced despite being surfaced) get demoted
- Memories with high EMA get boosted — they're proven valuable
- This creates a self-improving cycle without manual curation

**Open questions:**
- How to detect "referenced" — exact string match, key match, or semantic similarity?
- Should EMA influence eviction or only ordering?
- Cold start: what EMA for new memories? (Default 0.5 = neutral)

---

## 11. MCP Recall Tool with Topic-Scoped Soft Boosting

> Inspired by Cortex's agent-scoped recall with soft boosting (not hard filtering).

**Concept:** Curated-context currently only *writes* to Claude Code (via rules files). Adding an MCP `recall` tool completes the loop — the agent can actively query memories beyond what's in the rules files, with topic-aware relevance boosting.

**Key ideas:**
- Expose `recall(query, topic?)` as an MCP tool alongside the existing `search`
- `recall` differs from `search`: it returns memories formatted for injection into the conversation (structured, concise, ranked), not raw search results
- **Soft boosting**: when `topic` is provided (e.g., `"architecture"`, `"database"`), boost memories matching that category/tag but don't exclude others. Cortex validated this empirically — hard filtering reduces retrieval quality by -0.101 MRR; soft boosting is near-neutral (-0.001)
- Token-budget-aware: `recall` accepts an optional `max_tokens` parameter and truncates/omits lower-ranked results to fit
- Enables agent-driven retrieval to complement passive rules-file injection — the agent pulls what it needs, when it needs it
- The existing MCP search tool becomes the "raw" interface; `recall` becomes the "smart" interface

**Open questions:**
- Should `recall` output use XML framing (`<associative_memory>`) or plain markdown?
- How to infer topic automatically from conversation context without explicit parameter?
- Should `recall` results be cached for the session to avoid redundant queries?

---

## Dependencies on Phase 1.5

| Phase 2 Feature | Requires |
|---|---|
| Entity Graph | SQLite migration (1.5.4), contradiction model (1.5.7) |
| Verification Workflow | Memory status field (1.5.7) |
| Activity Visibility | Can start independently, but richer with contradiction events (1.5.7) |
| Compaction Resilience | Independent — hook-based, no storage changes needed |
| Curation on Ingestion | SQLite migration (1.5.4), topic key upsert (1.5.5) for similarity search |
| Project Seeding | Independent — extends existing Tier 2 structural extraction |
| Progressive Disclosure | Topic key upsert (1.5.5), revision tracking (1.5.5) |
| Private Content Stripping | Independent — can be implemented at any time |
| Conversation Mode Gating | Independent — enhances Tier 3 triage |
| Feedback Momentum | Topic key upsert (1.5.5), session coherence bonus (1.5.3) |
| MCP Recall Tool | FTS search (1.5.4), topic key upsert (1.5.5) |
