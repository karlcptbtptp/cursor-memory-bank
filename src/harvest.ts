#!/usr/bin/env tsx
/**
 * Harvest knowledge items into the memory bank.
 *
 * Usage:
 *   npx tsx src/harvest.ts add \
 *     --conv "uuid" \
 *     --category "finding" \
 *     --title "Short title" \
 *     --content "Full content with reasoning and conclusion..." \
 *     --tags "tag1,tag2"
 *
 *   npx tsx src/harvest.ts list [--category finding]
 *   npx tsx src/harvest.ts recent [--limit 10]
 *
 * Categories:
 *   finding     — data analysis conclusion
 *   decision    — decision record (why A over B)
 *   pitfall     — gotcha / trap encountered
 *   pattern     — reusable pattern (SQL / workflow / script)
 *   insight     — domain knowledge
 *   improvement — improvement idea
 */

import { getDb, closeDb } from "./db.js";

type Category =
  | "finding"
  | "decision"
  | "pitfall"
  | "pattern"
  | "insight"
  | "improvement";

const VALID_CATEGORIES: Category[] = [
  "finding",
  "decision",
  "pitfall",
  "pattern",
  "insight",
  "improvement",
];

function parseKV(args: string[]): Record<string, string> {
  const kv: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && args[i + 1]) {
      kv[args[i].slice(2)] = args[++i];
    }
  }
  return kv;
}

function addKnowledge(args: string[]) {
  const kv = parseKV(args);
  const { conv, category, title, content, tags } = kv;

  if (!category || !title || !content) {
    console.error(
      "Required: --category <cat> --title <title> --content <content>",
    );
    console.error("Optional: --conv <uuid> --tags <comma,sep>");
    console.error(`Categories: ${VALID_CATEGORIES.join(", ")}`);
    process.exit(1);
  }

  if (!VALID_CATEGORIES.includes(category as Category)) {
    console.error(
      `Invalid category "${category}". Use: ${VALID_CATEGORIES.join(", ")}`,
    );
    process.exit(1);
  }

  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO knowledge (conversation_id, category, title, content, tags)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(conv || null, category, title, content, tags || "");
  console.log(`✓ Knowledge #${result.lastInsertRowid} added [${category}]: ${title}`);
  closeDb();
}

function listKnowledge(args: string[]) {
  const kv = parseKV(args);
  const db = getDb();

  let sql = "SELECT id, category, title, tags, created_at FROM knowledge";
  const params: string[] = [];

  if (kv.category) {
    sql += " WHERE category = ?";
    params.push(kv.category);
  }
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params) as Array<{
    id: number;
    category: string;
    title: string;
    tags: string;
    created_at: string;
  }>;

  console.log(`\n📚 Knowledge items (${rows.length}):\n`);
  for (const r of rows) {
    console.log(`  #${r.id} [${r.category}] ${r.title}`);
    if (r.tags) console.log(`    tags: ${r.tags}`);
    console.log(`    ${r.created_at}\n`);
  }
  closeDb();
}

function recentKnowledge(args: string[]) {
  const kv = parseKV(args);
  const limit = parseInt(kv.limit || "10", 10);
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT id, category, title, content, tags, created_at
     FROM knowledge ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{
    id: number;
    category: string;
    title: string;
    content: string;
    tags: string;
    created_at: string;
  }>;

  console.log(`\n📚 Recent ${rows.length} knowledge items:\n`);
  for (const r of rows) {
    console.log(`  #${r.id} [${r.category}] ${r.title}`);
    const preview =
      r.content.length > 120 ? r.content.slice(0, 117) + "..." : r.content;
    console.log(`    ${preview}`);
    if (r.tags) console.log(`    tags: ${r.tags}`);
    console.log();
  }
  closeDb();
}

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case "add":
    addKnowledge(rest);
    break;
  case "list":
    listKnowledge(rest);
    break;
  case "recent":
    recentKnowledge(rest);
    break;
  default:
    console.log("Usage: harvest.ts <add|list|recent> [options]");
    console.log("  add     --category <cat> --title <t> --content <c> [--conv <id>] [--tags <t>]");
    console.log("  list    [--category <cat>]");
    console.log("  recent  [--limit N]");
    process.exit(1);
}
