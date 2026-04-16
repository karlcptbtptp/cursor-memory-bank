# Cursor Memory Bank

> Make your Cursor IDE project smarter over time — persist conversation knowledge across sessions.

SQLite + FTS5 powered cross-conversation knowledge management system for [Cursor IDE](https://cursor.sh). It ingests your agent transcripts, enables full-text search (including Chinese trigram substring matching), and lets the AI distill reusable knowledge from past conversations.

## Why

Every time you close a Cursor conversation, valuable context — decisions, analysis results, gotchas, patterns — is lost. Memory Bank solves this by:

1. **Ingesting** all agent transcripts into a local SQLite database
2. **Indexing** with dual FTS5 strategies (unicode61 + trigram) for both English and Chinese
3. **Searching** past conversations when the AI encounters questions that were previously discussed
4. **Distilling** reusable knowledge (findings, decisions, pitfalls, patterns, insights) into structured entries
5. **Health checking** to identify high-value conversations that haven't been distilled yet

## Quick Start

### 1. Install into your project

Copy the files into your existing project:

```bash
# Clone the repo
git clone https://github.com/karlcptbtptp/cursor-memory-bank.git

# Copy src/ into your project as 90_tools/memory-db/ (or any path you prefer)
# Copy .cursor/ rules and skills into your project's .cursor/
# Add the npm scripts from package.json to your project's package.json

# Install dependencies
npm install better-sqlite3 tsx
```

Or use it standalone:

```bash
git clone https://github.com/karlcptbtptp/cursor-memory-bank.git
cd cursor-memory-bank
npm install
npm run memory:setup
```

### 2. One-click setup

```bash
npm run memory:setup
```

This will: check dependencies → locate your agent transcripts → create SQLite database → run first ingest → verify search.

### 3. Start using

```bash
# Search past conversations
npx tsx src/search.ts "keyword"

# Search with options
npx tsx src/search.ts "query" --since 7d --limit 20

# Search only distilled knowledge
npx tsx src/search.ts --knowledge "topic"

# View stats
npm run memory:stats

# Check health (find undistilled conversations)
npm run memory:health

# Distill knowledge
npx tsx src/harvest.ts add --category finding --title "Title" --content "Content" --tags "tag1,tag2"
```

## Cursor Integration

### Skill (recommended)

Copy `.cursor/skills/memory-bank/SKILL.md` into your project. The AI will automatically:
- Search the memory bank when users reference past discussions
- Distill knowledge at the end of productive conversations
- Run health checks periodically

### Rules

Copy `.cursor/rules/` files for always-on behavior:
- `conversation-memory.mdc` — auto-search memory bank for context
- `conversation-harvest.mdc` — auto-trigger knowledge distillation

## Knowledge Categories

| Category | Meaning | Example |
|---|---|---|
| `finding` | Analysis conclusion | "High energy room has low recovery rate" |
| `decision` | Decision record | "Chose SQLite over pgvector for simplicity" |
| `pitfall` | Gotcha encountered | "npm run can't pass -- args correctly" |
| `pattern` | Reusable pattern | "SQL template for reconciliation" |
| `insight` | Domain knowledge | "Negative probability doesn't mean decreasing stock" |
| `improvement` | Improvement idea | "Auto-generate findings draft from analysis" |

## Architecture

```
conversations (id, title, first_user_msg, summary, message_count, created_at, updated_at)
  └── messages (conversation_id, seq, role, content, created_at)

knowledge (id, conversation_id, category, title, content, tags, created_at)
```

Each content table has two FTS5 virtual tables:
- `*_fts` — `unicode61` tokenizer (word-level, English-friendly)
- `*_tri` — `trigram` tokenizer (substring matching, CJK-friendly)

Sync triggers keep FTS indexes up-to-date automatically.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TRANSCRIPTS_DIR` | Auto-detected from `~/.cursor/projects/` | Path to Cursor agent-transcripts directory |
| `MEMORY_DB_PATH` | `./99_runtime/memory.sqlite` | Path to SQLite database file |

## Tech Stack

- **better-sqlite3** — SQLite 3.53.0+ with FTS5 trigram support
- **tsx** — TypeScript direct execution
- Zero external services — everything runs locally

## License

MIT
