# Integrating Memory Bank into an Existing Project

## Step 1: Copy Source Files

Copy the `src/` directory into your project. You can place it anywhere, for example:

```
your-project/
├── 90_tools/memory-db/    # or wherever you prefer
│   ├── db.ts
│   ├── ingest.ts
│   ├── search.ts
│   ├── harvest.ts
│   └── setup.ts
```

If you change the path, update the `import` paths in the scripts and the npm script commands accordingly.

## Step 2: Add npm Scripts

Add these to your project's `package.json`:

```json
{
  "scripts": {
    "memory:setup": "tsx 90_tools/memory-db/setup.ts",
    "memory:ingest": "tsx 90_tools/memory-db/ingest.ts",
    "memory:ingest:incremental": "tsx 90_tools/memory-db/ingest.ts --incremental",
    "memory:search": "tsx 90_tools/memory-db/search.ts",
    "memory:harvest": "tsx 90_tools/memory-db/harvest.ts",
    "memory:stats": "tsx 90_tools/memory-db/search.ts --stats",
    "memory:health": "tsx 90_tools/memory-db/search.ts --health"
  }
}
```

## Step 3: Install Dependencies

```bash
npm install better-sqlite3 tsx
```

## Step 4: Copy Cursor Rules (Optional but Recommended)

Copy from this repo:
- `.cursor/skills/memory-bank/SKILL.md` → your `.cursor/skills/memory-bank/SKILL.md`
- `.cursor/rules/conversation-memory.mdc` → your `.cursor/rules/conversation-memory.mdc`
- `.cursor/rules/conversation-harvest.mdc` → your `.cursor/rules/conversation-harvest.mdc`

Update the file paths in the rules/skill if you placed the source files in a different directory.

## Step 5: Add to .gitignore

```
99_runtime/
*.sqlite
*.sqlite-wal
*.sqlite-shm
```

## Step 6: Run Setup

```bash
npm run memory:setup
```

Done! Your project now has persistent cross-conversation memory.
