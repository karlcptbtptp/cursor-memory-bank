#!/usr/bin/env tsx
/**
 * Search memory DB — supports Chinese substring matching via trigram.
 *
 * Usage:
 *   npx tsx src/search.ts "弹头商人"
 *   npx tsx src/search.ts "能量房 存量" --since 7d
 *   npx tsx src/search.ts --knowledge "控制系统"
 *   npx tsx src/search.ts --conversations "翻译"
 *   npx tsx src/search.ts --stats
 *   npx tsx src/search.ts --health
 */

import { getDb, closeDb } from "./db.js";

type SearchMode = "all" | "knowledge" | "conversations" | "stats" | "health";

interface ParsedArgs {
  query: string;
  mode: SearchMode;
  limit: number;
  since: string | null;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let mode: SearchMode = "all";
  let limit = 10;
  let since: string | null = null;
  const queryParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--knowledge") mode = "knowledge";
    else if (args[i] === "--conversations") mode = "conversations";
    else if (args[i] === "--stats") mode = "stats";
    else if (args[i] === "--health") mode = "health";
    else if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i], 10);
    else if (args[i] === "--since" && args[i + 1]) since = parseSince(args[++i]);
    else queryParts.push(args[i]);
  }

  return { query: queryParts.join(" "), mode, limit, since };
}

function parseSince(val: string): string {
  const match = val.match(/^(\d+)([dhm])$/);
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2] === "d" ? "days" : match[2] === "h" ? "hours" : "minutes";
    const ms =
      n *
      (unit === "days" ? 86400000 : unit === "hours" ? 3600000 : 60000);
    return new Date(Date.now() - ms).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) {
    return new Date(val).toISOString();
  }
  return val;
}

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

interface SearchRow {
  conversation_id: string;
  title: string;
  summary?: string;
  role: string;
  snippet: string;
  rank: number;
  updated_at: string;
}

interface KnowledgeRow {
  id: number;
  category: string;
  title: string;
  snippet: string;
  tags: string;
  conversation_id: string;
  rank: number;
}

function searchMessages(
  db: ReturnType<typeof getDb>,
  query: string,
  limit: number,
  since: string | null,
) {
  const sinceClause = since ? "AND c.updated_at >= ?" : "";
  const sinceParams = since ? [since] : [];

  const ftsQuery = query
    .split(/\s+/)
    .map((w) => `"${w}"`)
    .join(" OR ");

  let rows = db
    .prepare(
      `
    SELECT
      m.conversation_id,
      c.title,
      c.summary,
      m.role,
      snippet(messages_fts, 0, '>>>', '<<<', '...', 40) AS snippet,
      rank,
      c.updated_at
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.rowid
    JOIN conversations c ON c.id = m.conversation_id
    WHERE messages_fts MATCH ?
    ${sinceClause}
    ORDER BY rank
    LIMIT ?
  `,
    )
    .all(ftsQuery, ...sinceParams, limit * 3) as SearchRow[];

  if (rows.length < limit && hasChinese(query)) {
    const triRows = db
      .prepare(
        `
      SELECT
        m.conversation_id,
        c.title,
        c.summary,
        m.role,
        snippet(messages_tri, 0, '>>>', '<<<', '...', 40) AS snippet,
        rank,
        c.updated_at
      FROM messages_tri
      JOIN messages m ON m.id = messages_tri.rowid
      JOIN conversations c ON c.id = m.conversation_id
      WHERE messages_tri MATCH ?
      ${sinceClause}
      ORDER BY rank
      LIMIT ?
    `,
      )
      .all(`"${query}"`, ...sinceParams, limit * 3) as SearchRow[];

    const seen = new Set(rows.map((r) => `${r.conversation_id}:${r.snippet}`));
    for (const r of triRows) {
      const key = `${r.conversation_id}:${r.snippet}`;
      if (!seen.has(key)) {
        rows.push(r);
        seen.add(key);
      }
    }
  }

  return dedup(rows, limit);
}

function dedup(rows: SearchRow[], limit: number): SearchRow[] {
  const best = new Map<string, SearchRow>();
  for (const r of rows) {
    const existing = best.get(r.conversation_id);
    if (!existing || r.rank < existing.rank) {
      best.set(r.conversation_id, r);
    }
  }
  return [...best.values()]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);
}

function searchKnowledge(
  db: ReturnType<typeof getDb>,
  query: string,
  limit: number,
) {
  const ftsQuery = query
    .split(/\s+/)
    .map((w) => `"${w}"`)
    .join(" OR ");

  let rows = db
    .prepare(
      `
    SELECT k.id, k.category, k.title,
      snippet(knowledge_fts, 1, '>>>', '<<<', '...', 60) AS snippet,
      k.tags, k.conversation_id, rank
    FROM knowledge_fts
    JOIN knowledge k ON k.id = knowledge_fts.rowid
    WHERE knowledge_fts MATCH ?
    ORDER BY rank LIMIT ?
  `,
    )
    .all(ftsQuery, limit) as KnowledgeRow[];

  if (rows.length < limit && hasChinese(query)) {
    const triRows = db
      .prepare(
        `
      SELECT k.id, k.category, k.title,
        snippet(knowledge_tri, 1, '>>>', '<<<', '...', 60) AS snippet,
        k.tags, k.conversation_id, rank
      FROM knowledge_tri
      JOIN knowledge k ON k.id = knowledge_tri.rowid
      WHERE knowledge_tri MATCH ?
      ORDER BY rank LIMIT ?
    `,
      )
      .all(`"${query}"`, limit) as KnowledgeRow[];

    const seenIds = new Set(rows.map((r) => r.id));
    for (const r of triRows) {
      if (!seenIds.has(r.id)) rows.push(r);
    }
  }

  return rows.slice(0, limit);
}

function showStats(db: ReturnType<typeof getDb>) {
  const convCount = (
    db.prepare("SELECT count(*) as c FROM conversations").get() as { c: number }
  ).c;
  const msgCount = (
    db.prepare("SELECT count(*) as c FROM messages").get() as { c: number }
  ).c;
  const knowCount = (
    db.prepare("SELECT count(*) as c FROM knowledge").get() as { c: number }
  ).c;

  const recentConvs = db
    .prepare(
      `SELECT id, title, message_count, updated_at, summary
       FROM conversations ORDER BY updated_at DESC LIMIT 5`,
    )
    .all() as Array<{
    id: string;
    title: string;
    message_count: number;
    updated_at: string;
    summary: string;
  }>;

  const categories = db
    .prepare(
      "SELECT category, count(*) as c FROM knowledge GROUP BY category ORDER BY c DESC",
    )
    .all() as Array<{ category: string; c: number }>;

  console.log(`\n📊 Memory Bank Stats`);
  console.log(`  Conversations: ${convCount}`);
  console.log(`  Messages:      ${msgCount}`);
  console.log(`  Knowledge:     ${knowCount}`);

  if (categories.length > 0) {
    console.log(`\n  Knowledge by category:`);
    for (const cat of categories) {
      console.log(`    ${cat.category}: ${cat.c}`);
    }
  }

  console.log(`\n  Recent conversations:`);
  for (const c of recentConvs) {
    console.log(
      `    [${c.updated_at?.slice(0, 10)}] ${c.title} (${c.message_count} msgs)`,
    );
    if (c.summary) {
      const preview = c.summary.split("\n")[0].slice(0, 80);
      console.log(`      ${preview}`);
    }
  }
}

function showHealth(db: ReturnType<typeof getDb>) {
  console.log("\n🏥 Memory Health Check\n");

  const totalConv = (
    db.prepare("SELECT count(*) as c FROM conversations").get() as { c: number }
  ).c;
  const totalKnow = (
    db.prepare("SELECT count(*) as c FROM knowledge").get() as { c: number }
  ).c;
  const totalMsg = (
    db.prepare("SELECT count(*) as c FROM messages").get() as { c: number }
  ).c;

  const coveredConvs = (
    db
      .prepare(
        "SELECT count(DISTINCT conversation_id) as c FROM knowledge WHERE conversation_id IS NOT NULL",
      )
      .get() as { c: number }
  ).c;
  const coveragePercent =
    totalConv > 0 ? ((coveredConvs / totalConv) * 100).toFixed(1) : "0";

  const undistilled = db
    .prepare(
      `SELECT c.id, c.title, c.message_count, c.updated_at
     FROM conversations c
     LEFT JOIN knowledge k ON k.conversation_id = c.id
     WHERE k.id IS NULL AND c.message_count >= 10
     ORDER BY c.message_count DESC
     LIMIT 10`,
    )
    .all() as Array<{
    id: string;
    title: string;
    message_count: number;
    updated_at: string;
  }>;

  const ageDistribution = db
    .prepare(
      `SELECT
       CASE
         WHEN julianday('now') - julianday(created_at) <= 7 THEN '< 7 days'
         WHEN julianday('now') - julianday(created_at) <= 30 THEN '7-30 days'
         ELSE '> 30 days'
       END as age_bucket,
       count(*) as c
     FROM knowledge GROUP BY age_bucket`,
    )
    .all() as Array<{ age_bucket: string; c: number }>;

  const noSummary = (
    db
      .prepare(
        "SELECT count(*) as c FROM conversations WHERE summary IS NULL OR summary = ''",
      )
      .get() as { c: number }
  ).c;

  console.log(`  📈 Coverage`);
  console.log(`    Total conversations: ${totalConv}`);
  console.log(`    With knowledge:      ${coveredConvs} (${coveragePercent}%)`);
  console.log(`    Total knowledge:     ${totalKnow}`);
  console.log(`    Total messages:      ${totalMsg}`);
  console.log(`    Missing summaries:   ${noSummary}`);

  if (ageDistribution.length > 0) {
    console.log(`\n  📅 Knowledge age distribution:`);
    for (const a of ageDistribution) {
      console.log(`    ${a.age_bucket}: ${a.c}`);
    }
  }

  if (undistilled.length > 0) {
    console.log(
      `\n  ⚠️  High-value undistilled conversations (${undistilled.length}):`,
    );
    for (const u of undistilled) {
      console.log(
        `    [${u.updated_at?.slice(0, 10)}] ${u.title} (${u.message_count} msgs)`,
      );
      console.log(`      id: ${u.id}`);
    }
    console.log(
      `\n  💡 Run harvest on these to extract knowledge and boost coverage.`,
    );
  } else {
    console.log(`\n  ✅ All substantial conversations have been distilled.`);
  }
}

function main() {
  const { query, mode, limit, since } = parseArgs();
  const db = getDb();

  if (mode === "stats") {
    showStats(db);
    closeDb();
    return;
  }

  if (mode === "health") {
    showHealth(db);
    closeDb();
    return;
  }

  if (!query) {
    console.error(
      "Usage: search.ts <query> [--knowledge|--conversations] [--limit N] [--since 7d|2026-04-01]",
    );
    process.exit(1);
  }

  const sinceInfo = since ? ` (since ${since.slice(0, 10)})` : "";
  console.log(
    `\n🔍 Searching "${query}" (mode: ${mode}, limit: ${limit}${sinceInfo})\n`,
  );

  if (mode === "all" || mode === "conversations") {
    const msgs = searchMessages(db, query, limit, since);
    if (msgs.length > 0) {
      console.log(`── Conversations (${msgs.length} matched) ──`);
      for (const m of msgs) {
        console.log(`  [${m.updated_at?.slice(0, 10)}] ${m.title}`);
        console.log(`    ${m.snippet.replace(/\n/g, " ").slice(0, 120)}`);
        console.log(`    conv: ${m.conversation_id}\n`);
      }
    } else {
      console.log("  No message matches.\n");
    }
  }

  if (mode === "all" || mode === "knowledge") {
    const items = searchKnowledge(db, query, limit);
    if (items.length > 0) {
      console.log(`── Knowledge (${items.length} hits) ──`);
      for (const k of items) {
        console.log(`  [${k.category}] ${k.title}`);
        console.log(`    ${k.snippet.replace(/\n/g, " ").slice(0, 120)}`);
        if (k.tags) console.log(`    tags: ${k.tags}`);
        console.log();
      }
    } else {
      console.log("  No knowledge matches.\n");
    }
  }

  closeDb();
}

main();
