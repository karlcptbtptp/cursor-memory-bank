---
name: memory-bank
description: >-
  Project Memory Bank: SQLite + FTS5 cross-conversation knowledge management.
  Supports full-text search (including Chinese trigram), knowledge distillation, and health checks.
  Trigger: search history, memory retrieval, distill knowledge, harvest, knowledge base, memory.
  Use when user mentions "discussed before", "search history", "last time", "knowledge base", "memory".
  Use when conversation produces valuable conclusions/decisions/gotchas — distill into the bank.
  Also trigger on: "check history", "was this analyzed before", "note this down", "distill", "harvest".
globs:
  - "src/**"
alwaysApply: false
---

# Project Memory Bank

SQLite + FTS5 full-text index — makes your project smarter over time. Stores conversation history + distilled knowledge with Chinese trigram substring matching.

---

## Part 0: First-time Setup

> Already set up? Run `npm run memory:stats` — if you see data, skip this section.

### Prerequisites

- Node.js 18+
- `better-sqlite3` and `tsx` installed (`npm install better-sqlite3 tsx`)

### One-click Install

```shell
npm run memory:setup
```

The script will: check dependencies → locate agent-transcripts → create SQLite DB → first full ingest → verify search.

### Manual Install

1. Confirm `src/` has `db.ts`, `ingest.ts`, `search.ts`, `harvest.ts`, `setup.ts`
2. Confirm `package.json` has `memory:*` scripts
3. Run `npm run memory:ingest` for first full ingest
4. Run `npm run memory:stats` to verify

### File Inventory

| File | Purpose |
|---|---|
| `src/db.ts` | DB connection + schema migration (versioned, auto-upgrade) |
| `src/ingest.ts` | Parse agent-transcripts/*.jsonl → insert into SQLite |
| `src/search.ts` | Full-text search CLI (dual-index unicode61 + trigram) |
| `src/harvest.ts` | Knowledge distillation CLI (add/list/recent) |
| `src/setup.ts` | One-click setup script |
| `99_runtime/memory.sqlite` | SQLite database file (runtime, don't commit) |

---

## Part 1: Searching Past Knowledge

Proactively search when the user's question might have been discussed before.

### Basic Search

```shell
npx tsx src/search.ts "energy room RTP"
```

### Search Options

| Option | Effect | Example |
|---|---|---|
| `--knowledge` | Search only distilled knowledge (more precise) | `--knowledge "control system"` |
| `--conversations` | Search only message history | `--conversations "translation"` |
| `--since 7d` | Recent N days/hours | `--since 3d`, `--since 24h` |
| `--since 2026-04-01` | From specific date | |
| `--limit 20` | Result count (default 10) | |
| `--stats` | Stats overview | |
| `--health` | Health check | |

### Chinese Search

The system maintains two index sets simultaneously:
- **unicode61**: word-level tokenization, good for English and space-separated text
- **trigram**: 3-character substring matching, directly finds continuous Chinese phrases

Searches use dual strategy automatically with deduplication. No manual word segmentation needed.

### When to Search

- User's question might have been analyzed before
- User says "discussed before", "what we said last time"
- Need to find rationale behind a past decision
- Hit a technical issue that might have been encountered before

Don't search: brand new questions, casual chat, simple operations.

---

## Part 2: Knowledge Distillation (Core Loop)

Every conversation with substantial output should have reusable knowledge extracted and stored. This is the key feedback loop for continuous self-improvement.

### When to Trigger Distillation

| Signal | Action |
|---|---|
| User says "done", "that's it", "wrapping up", "end of day" | Execute distillation |
| A complete analysis task finished (report published) | Execute distillation |
| Solved a specific technical/business problem | Execute distillation |
| Hit a gotcha and found the solution | Execute distillation |
| Made a decision with trade-offs | Execute distillation |

Don't distill: Q&A, casual chat, trivial one-liner operations.

### Three-Step Distillation

**Step 1: Review** — Identify what reusable knowledge this conversation produced.

**Step 2: Write to SQLite** — For each piece of knowledge worth keeping:

```shell
npx tsx src/harvest.ts add --conv "conversation-UUID" --category "finding" --title "Concise title" --content "Full content with reasoning and conclusion" --tags "tag1,tag2"
```

**Step 3: Sync to markdown (important conclusions only)** — If the distilled knowledge should be visible in every new conversation:

- `finding` → append to your project's findings index
- `pitfall` → append to cursor rules or runbooks
- `pattern` → append to recipe/template collections

SQLite is the primary store (searchable). Markdown is the curated highlight reel (auto-read each session).

### Six Knowledge Categories

| category | Meaning | Typical Source | Example |
|---|---|---|---|
| `finding` | Analysis conclusion | Analysis task output | "High consumption low recovery in room 2150" |
| `decision` | Decision record | Architecture/tech choices | "Chose SQLite over pgvector" |
| `pitfall` | Gotcha record | Troubleshooting | "npm run intercepts -- arguments" |
| `pattern` | Reusable pattern | SQL/workflow/script | "Reconciliation SQL template" |
| `insight` | Domain knowledge | Business understanding | "Negative probability but stock can still rise" |
| `improvement` | Improvement idea | Any inspiration | "Analysis should auto-generate findings draft" |

### Distillation Principles

- Only extract knowledge with genuine reuse value — not every sentence
- Title should be concise and searchable — recognizable at a glance
- Content should include sufficient context (reasoning + conclusion) — not just the conclusion
- Tags: comma-separated, choose discriminating tags
- Six categories have distinct purposes — don't dump everything into `finding`

---

## Part 3: Daily Operations

### Incremental Sync

Run before distillation, during daily standup, or when user says "end of day":

```shell
npm run memory:ingest:incremental
```

Only processes files changed since last ingest, usually 1-2 seconds.

### Health Check

```shell
npm run memory:health
```

Output: coverage (how many conversations distilled), high-value undistilled list, knowledge age distribution.

### Browse Knowledge

```shell
npx tsx src/harvest.ts list                       # all knowledge
npx tsx src/harvest.ts list --category pitfall     # by category
npx tsx src/harvest.ts recent --limit 5            # recent 5 items
```

### Stats Overview

```shell
npm run memory:stats
```

---

## Part 4: Architecture

### Database Schema

```
conversations (id, title, first_user_msg, summary, message_count, created_at, updated_at)
  └── messages (conversation_id, seq, role, content, created_at)

knowledge (id, conversation_id, category, title, content, tags, created_at)
```

### FTS Indexes

Each content table has two FTS5 virtual tables:
- `*_fts`: `unicode61` tokenizer (English-friendly)
- `*_tri`: `trigram` tokenizer (CJK substring-friendly)

Kept in sync via INSERT/DELETE triggers.

### Tech Stack

- better-sqlite3 (SQLite 3.53.0, supports FTS5 trigram)
- tsx (TypeScript direct execution)
- Zero external service dependencies — database file lives in `99_runtime/`

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TRANSCRIPTS_DIR` | Auto-detected | Path to Cursor agent-transcripts |
| `MEMORY_DB_PATH` | `./99_runtime/memory.sqlite` | Path to SQLite database |

### npm scripts

| script | command |
|---|---|
| `memory:setup` | One-click setup |
| `memory:ingest` | Full ingest |
| `memory:ingest:incremental` | Incremental sync |
| `memory:search` | Search (no extra args) |
| `memory:harvest` | Harvest (no extra args) |
| `memory:stats` | Stats overview |
| `memory:health` | Health check |

> For commands with `--since`, `--limit` etc., use `npx tsx src/search.ts ...` directly — more reliable than `npm run` which may intercept `--` arguments.
