# Phase 1.5 — Core Memory Improvements

> Inspired by analysis of [jarvis-orb](https://github.com/whynowlab/jarvis-orb), [Zikkaron](https://github.com/amanhij/Zikkaron), [engram](https://github.com/Gentleman-Programming/engram), [breathe-memory](https://github.com/tkenaz/breathe-memory), [shodh-memory](https://github.com/varun29ankuS/shodh-memory), and [Cortex](https://github.com/cdeust/Cortex).
> These seven features address the most impactful gaps in curated-context's current memory system.

---

## 1. Memory Decay / TTL

> Decay model informed by shodh-memory's hybrid exponential+power-law approach (Wixted 2004) and breathe-memory's floor+reactivation pattern.

**Problem:** Old memories persist indefinitely until evicted by the size cap (1000 project / 500 global). Stale facts (e.g., "primary color is blue" from 6 months ago) compete equally with fresh knowledge.

**Design:**
- Add `lastAccessed` timestamp to `StoredMemory` (updated on search hits and rule-file generation)
- **Hybrid decay model** (two phases):
  - **Consolidation phase** (< 3 days): exponential decay — `confidence * e^(-λ * hours)` where λ = 0.02
  - **Long-term phase** (≥ 3 days): power-law decay — `confidence * (daysSinceAccess)^(-0.3)`
  - Power-law gives heavy-tail retention (>1% at 365 days) that pure exponential kills too aggressively
- **Decay floor**: effective confidence never drops below 0.05 — memories at the floor can still be found via search, they just won't appear in rules files (which filter at 0.1)
- **Reactivation**: accessing a memory (search hit, rules-file inclusion) resets its `lastAccessed` timestamp, restarting the decay clock — reinforcement through use
- Effective confidence = `max(decayedConfidence, floor)` used for eviction ranking and rule-file ordering
- Configurable TTL per category (e.g., `gotchas` decay slower than `design` tokens)
- Eviction triggers when a memory's effective confidence drops below the floor AND it hasn't been accessed in 90+ days

**Files to modify:**
- `src/storage/memory-store.ts` — add `lastAccessed`, hybrid decay calculation, floor, TTL eviction
- `src/storage/rules-writer.ts` — sort by effective confidence, exclude below 0.1
- `src/daemon/processor.ts` — trigger TTL sweep during processing

**Migration:** Existing memories get `lastAccessed = updatedAt` on first load.

---

## 2. Full-Text Search (FTS) + SQLite Migration

> Storage design informed by engram's FTS5 trigger pattern.

**Problem:** Current search is substring matching on key and value fields. Queries like "how does auth work" won't match a memory keyed as `pref-auth-nextjs` with value "Prefers Auth.js v5 for Next.js App Router auth."

**Design:**
- Migrate backing store from JSON to **SQLite with FTS5**
- FTS index covers: `key`, `value`, `category`, `tags` (new field)
- **FTS5 maintained via SQLite triggers** (INSERT/UPDATE/DELETE on memories table auto-sync the FTS index — zero application-level bookkeeping, pattern proven by engram)
- Search returns results ranked by FTS5 `rank` combined with `effectiveConfidence`
- SQLite WAL mode for concurrent read/write safety
- Add `tags` field to `StoredMemory` for additional search surface
- Backward-compatible: on first run, migrate existing JSON stores into SQLite

**Files to modify:**
- `src/storage/memory-store.ts` — replace JSON read/write with SQLite (via `better-sqlite3`)
- `src/storage/rules-writer.ts` — read from SQLite
- `src/cli.ts` — update `search` command to use FTS
- `package.json` — add `better-sqlite3` dependency

**Migration:** JSON → SQLite migration runs automatically on first access. Old JSON files preserved as `.json.bak`.

---

## 3. Contradiction Tracking

> Enhanced by shodh-memory's interference detection (similarity-based contradiction) and breathe-memory's hallucination guard.

**Problem:** When a memory is superseded, the old value is silently replaced. There's no record of *what changed* or *why*, and no way to detect when two memories conflict without replacement.

**Design:**
- Add `status` field to `StoredMemory`: `active | superseded | contradicted`
- Add `supersededBy` and `contradicts` fields (memory key references)
- **Two-layer contradiction detection:**
  - **Layer 1 — Interference detection at write time** (no LLM): when saving a new memory, check existing memories in the same category for high content similarity (≥0.85 normalized string similarity) with conflicting content. If found, suppress the older memory's effective confidence rather than deleting — set `status: contradicted` with back-reference. This catches most contradictions cheaply.
  - **Layer 2 — LLM detection in Tier 4** (existing): prompt includes existing memories in same category. LLM returns `contradicts: [keys]` alongside `supersedes`. Catches semantic contradictions that string similarity misses.
- When a new memory has a `supersedes` key:
  - Mark the old memory as `status: superseded`, set `supersededBy: newKey`
  - Keep the old memory in storage (don't delete) for audit trail
  - Old memories with `status != active` are excluded from rules file output
- **Extraction validation** (from breathe-memory): post-validate LLM-extracted memories against the source transcript — drop any extraction whose key claims don't appear (via stem matching) in the original messages. Prevents hallucinated memories.
- New CLI command: `curated-context conflicts` — lists all contradicted/superseded memories with their replacements
- Dashboard data: track contradiction rate as a quality signal

**Files to modify:**
- `src/storage/memory-store.ts` — add status/relationship fields, interference detection, filter active-only for rules
- `src/extraction/prompts.ts` — add existing memories to Tier 4 prompt for contradiction detection
- `src/extraction/llm.ts` — parse `contradicts` field, add extraction validation
- `src/cli.ts` — add `conflicts` command
- `src/storage/rules-writer.ts` — filter `status === 'active'` only

**Migration:** Existing memories get `status: 'active'` on first load.

---

## 4. Decision Auto-Protection

> Inspired by Zikkaron's decision detection and shielding.

**Problem:** Decisions are among the most valuable memories (e.g., "chose Kamal over Coolify for deploys because..."), but they're treated identically to design tokens or config values. They can be evicted by the size cap or decayed by TTL like any other memory.

**Design:**
- Add `protected: boolean` field to `StoredMemory` (default: `false`)
- Regex detection of decision language in memory values at write time:
  - `chose .+ over`, `decided to`, `switched from .+ to`, `went with .+ because`, `rejected .+ in favor of`, `picked .+ instead of`
- Memories matching decision patterns get `protected: true` automatically
- Protected memories are exempt from TTL eviction and confidence decay
- Protected memories can still be superseded or contradicted (Phase 1.5.3)
- Manual protection via `curated-context protect <key>` CLI command
- Decisions extracted in Tier 1 (decision log) are auto-protected

**Files to modify:**
- `src/storage/memory-store.ts` — add `protected` field, decision regex, eviction exemption
- `src/cli.ts` — add `protect` / `unprotect` commands

**Migration:** Existing memories matching decision patterns get `protected: true` on first load.

---

## 5. Session Coherence Bonus

> Inspired by Zikkaron's heat bonus for recent memories.

**Problem:** Memories extracted in the current or most recent session may not have high confidence yet, but they're the most relevant context. A memory stored 10 minutes ago shouldn't rank below one from 3 months ago just because the old one has higher raw confidence.

**Design:**
- Add `sessionId` field to `StoredMemory` (already partially exists via extraction metadata)
- When generating rules files, apply a recency bonus to effective confidence:
  - Same session: `+0.15` bonus
  - Previous session (< 24h): `+0.10` bonus
  - Recent (< 7 days): `+0.05` bonus
- Bonus is additive to effective confidence (after decay), capped at 1.0
- This affects rules-file ordering only, not eviction or storage

**Files to modify:**
- `src/storage/memory-store.ts` — ensure `sessionId` is tracked
- `src/storage/rules-writer.ts` — apply recency bonus when sorting memories for output

**Migration:** None needed. Memories without `sessionId` get no bonus.

---

## 6. Topic Key Upsert

> Inspired by engram's topic key system — the single most effective anti-pollution mechanism observed across all analyzed repos.

**Problem:** Evolving decisions spawn duplicate entries. If a project's auth strategy is discussed across 3 sessions, the store ends up with 3 similar memories instead of one that evolves. The unimplemented "Phase 8 consolidation" was supposed to fix this, but prevention is better than cleanup.

**Design:**
- Add `topicKey` field to `StoredMemory` — a family-prefixed key like `architecture/auth-model`, `decision/deploy-target`, `config/database-provider`
- **Topic key inference**: when a memory is saved, auto-generate a topic key from category + normalized key:
  - `architecture` category → `architecture/{key}`
  - `design` category → `design/{key}`
  - Decision-detected memories → `decision/{key}`
  - etc.
- **Hub exclusion** (from breathe-memory): maintain a blacklist of over-generic topic keys (`error`, `system`, `claude`, `file`, `code`, `project`, `config`) that connect to everything and produce noise. Memories with hub-only keys are stored but don't get topic keys, preventing them from dominating upsert matching.
- **Upsert on save**: if a memory with the same `(topicKey, projectRoot)` already exists:
  - Update the value in place
  - Increment new `revisionCount` field
  - Update `updatedAt` timestamp
  - Preserve higher confidence between old and new
  - Keep `createdAt` from original
- This replaces create-then-consolidate with update-in-place
- `revisionCount` tracks how many times a topic has been updated — high revision count = important, evolving knowledge
- CLI: `curated-context history <topicKey>` shows revision history (requires SQLite, pairs with contradiction tracking)

**Files to modify:**
- `src/storage/memory-store.ts` — add `topicKey`, `revisionCount`, upsert logic
- `src/extraction/llm.ts` — generate topic keys from extraction output
- `src/extraction/structural.ts` — generate topic keys for structural memories
- `src/cli.ts` — add `history` command

**Migration:** Existing memories get `topicKey` auto-generated from `category/key` and `revisionCount: 1` on first load.

---

## 7. Content Hash Deduplication

> Inspired by engram's two-layer dedup (topic key upsert + content hash).

**Problem:** The same fact can be extracted from multiple sessions with slightly different wording. Topic key upsert catches exact key matches, but two memories with different keys and near-identical values still create duplicates.

**Design:**
- On every memory save, compute a **normalized content hash**: SHA-256 of `lowercase(value).replace(/\s+/g, ' ').trim()`
- Before inserting, check if a memory with the same `(contentHash, category, projectRoot)` already exists within a configurable time window (default: 1 hour)
- If match found: increment `duplicateCount` on existing memory, skip insert
- `duplicateCount` field tracks how many times the same content was independently extracted — high count = high confidence signal
- This is a cheap pre-filter that runs before any LLM or even triage logic
- Works at the storage layer, transparent to the extraction pipeline

**Files to modify:**
- `src/storage/memory-store.ts` — add `contentHash`, `duplicateCount`, dedup check on save

**Migration:** Existing memories get `contentHash` computed and `duplicateCount: 1` on first load.

---

## Implementation Order

1. **Memory Decay/TTL** — no new dependencies, smallest surface area
2. **Decision Auto-Protection** — small addition, pairs naturally with decay (protects decisions from it)
3. **Session Coherence Bonus** — small addition to rules-writer, depends on decay being in place
4. **FTS Search + SQLite Migration** — requires new dependency, foundation for items 5-7
5. **Topic Key Upsert** — requires SQLite for efficient lookups, prevents memory pollution
6. **Content Hash Deduplication** — requires SQLite, cheap dedup layer
7. **Contradiction Tracking** — touches extraction pipeline, benefits from FTS + topic keys

## Cross-Cutting: Rules File Ordering (from Cortex)

> Informed by Cortex's "Lost in the Middle" mitigation (Liu et al. 2023).

These are small improvements that apply across multiple Phase 1.5 items:

- **"Lost in the Middle" ordering**: When generating rules files, place highest-confidence memories at the **beginning and end**, not clustered at the top. LLMs attend less to middle-positioned content. Apply in `rules-writer.ts` alongside the session coherence bonus and decay scoring.
- **PostToolUse capture hook**: Add a lightweight `PostToolUse` hook that captures significant tool outputs (Bash errors, file writes with decision language) as immediate memories, without waiting for the Stop hook's conversation-level extraction. This is more granular than current capture and catches errors as they happen.

## Success Criteria

- Memories older than 90 days with no access are auto-evicted
- Decision memories are never evicted by TTL or size cap
- Recently-stored memories rank higher in rules files than stale equivalents
- High-confidence memories placed at beginning/end of rules files, not clustered at top
- `search` returns relevant results for natural-language queries
- Evolving decisions update in place instead of creating duplicates
- Near-identical extractions are deduplicated at the storage layer
- Superseded memories are preserved with full audit trail
- `conflicts` command shows memory evolution over time
