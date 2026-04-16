#!/usr/bin/env tsx
/**
 * Ingest agent-transcripts into memory.sqlite.
 *
 * Usage:
 *   npx tsx src/ingest.ts                 # ingest all
 *   npx tsx src/ingest.ts --incremental   # only new/changed
 *
 * Environment:
 *   TRANSCRIPTS_DIR  — path to agent-transcripts (auto-detected if not set)
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { getDb, closeDb } from "./db.js";

function findTranscriptsDir(): string {
  if (process.env.TRANSCRIPTS_DIR) {
    return resolve(process.env.TRANSCRIPTS_DIR);
  }

  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const cursorProjects = join(home, ".cursor/projects");

  if (!existsSync(cursorProjects)) {
    console.error(
      "Cannot locate agent-transcripts. Set TRANSCRIPTS_DIR env var.",
    );
    process.exit(1);
  }

  const workspaceName = resolve(process.cwd()).split(/[/\\]/).pop()?.toLowerCase() ?? "";
  const projectDirs = readdirSync(cursorProjects, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .sort((a, b) => {
      const aMatch = a.name.toLowerCase().includes(workspaceName) ? 0 : 1;
      const bMatch = b.name.toLowerCase().includes(workspaceName) ? 0 : 1;
      return aMatch - bMatch;
    });

  for (const d of projectDirs) {
    const candidate = join(cursorProjects, d.name, "agent-transcripts");
    if (existsSync(candidate)) return candidate;
  }

  console.error(
    "Cannot locate agent-transcripts. Set TRANSCRIPTS_DIR env var.",
  );
  process.exit(1);
}

const TRANSCRIPTS_DIR = findTranscriptsDir();

interface JsonlMessage {
  role: "user" | "assistant" | "system";
  message?: {
    content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  };
}

function extractText(msg: JsonlMessage): string {
  const parts = msg.message?.content;
  if (!parts) return "";
  return parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => {
      let text = p.text!;
      text = text.replace(/<\/?user_query>/g, "").trim();
      text = text.replace(
        /^(?:The user|Let me|I need|I should|Now I|Looking at|This is|Based on)[\s\S]*?(?=\n\n[^\n]*[\u4e00-\u9fff])/m,
        "",
      ).trim();
      return text;
    })
    .filter(Boolean)
    .join("\n");
}

function extractTitle(firstUserText: string): string {
  const cleaned = firstUserText
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 60) return cleaned;
  return cleaned.slice(0, 57) + "...";
}

function buildSummary(
  messages: Array<{ role: string; text: string }>,
): string {
  const userTopics: string[] = [];
  const assistantConclusions: string[] = [];

  for (const m of messages) {
    const cleaned = m.text
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) continue;

    if (m.role === "user") {
      const snippet = cleaned.slice(0, 100);
      if (snippet.length > 5) userTopics.push(snippet);
    } else if (m.role === "assistant") {
      const conclusionPatterns =
        /(?:^|\n)\s*(?:##?\s+.*?(?:结论|总结|结果|关键发现|一句话)|(?:\*\*结论|✓|→)\s*).{10,120}/g;
      let match;
      while ((match = conclusionPatterns.exec(cleaned)) !== null) {
        assistantConclusions.push(match[0].trim().slice(0, 120));
      }
    }
  }

  const parts: string[] = [];
  if (userTopics.length > 0) {
    parts.push("用户问题: " + userTopics.slice(0, 5).join(" | "));
  }
  if (assistantConclusions.length > 0) {
    parts.push("关键结论: " + assistantConclusions.slice(0, 3).join(" | "));
  }

  return parts.join("\n").slice(0, 2000);
}

function ingestConversation(
  db: ReturnType<typeof getDb>,
  convId: string,
  jsonlPath: string,
) {
  const raw = readFileSync(jsonlPath, "utf-8");
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return;

  const messages: { role: string; text: string }[] = [];
  let firstUserMsg = "";

  for (const line of lines) {
    let parsed: JsonlMessage;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const text = extractText(parsed);
    if (!text) continue;

    if (!firstUserMsg && parsed.role === "user") {
      firstUserMsg = text;
    }
    messages.push({ role: parsed.role, text });
  }

  if (messages.length === 0) return;

  const stat = statSync(jsonlPath);
  const title = extractTitle(firstUserMsg);
  const summary = buildSummary(messages);

  const insertConv = db.prepare(`
    INSERT OR REPLACE INTO conversations (id, title, first_user_msg, summary, message_count, created_at, updated_at, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const deleteOldMsgs = db.prepare(
    "DELETE FROM messages WHERE conversation_id = ?",
  );

  const insertMsg = db.prepare(`
    INSERT INTO messages (conversation_id, seq, role, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const txn = db.transaction(() => {
    insertConv.run(
      convId,
      title,
      firstUserMsg.slice(0, 2000),
      summary,
      messages.length,
      stat.birthtime.toISOString(),
      stat.mtime.toISOString(),
    );
    deleteOldMsgs.run(convId);
    messages.forEach((m, i) => {
      insertMsg.run(
        convId,
        i,
        m.role,
        m.text.slice(0, 50000),
        stat.mtime.toISOString(),
      );
    });
  });

  txn();
  return messages.length;
}

function main() {
  const incremental = process.argv.includes("--incremental");
  const db = getDb();

  if (!existsSync(TRANSCRIPTS_DIR)) {
    console.error(`Transcripts dir not found: ${TRANSCRIPTS_DIR}`);
    process.exit(1);
  }

  const existingMap = new Map<string, string>();
  if (incremental) {
    const rows = db
      .prepare("SELECT id, updated_at FROM conversations")
      .all() as { id: string; updated_at: string }[];
    for (const r of rows) existingMap.set(r.id, r.updated_at);
  }

  const dirs = readdirSync(TRANSCRIPTS_DIR, { withFileTypes: true }).filter(
    (d) => d.isDirectory() && !d.name.startsWith("."),
  );

  let ingested = 0;
  let skipped = 0;

  for (const dir of dirs) {
    const convId = dir.name;
    const jsonlPath = join(TRANSCRIPTS_DIR, convId, `${convId}.jsonl`);
    if (!existsSync(jsonlPath)) continue;

    if (incremental) {
      const stat = statSync(jsonlPath);
      const existing = existingMap.get(convId);
      if (existing && existing >= stat.mtime.toISOString()) {
        skipped++;
        continue;
      }
    }

    try {
      const count = ingestConversation(db, convId, jsonlPath);
      if (count) {
        ingested++;
        process.stdout.write(`  ✓ ${convId} (${count} msgs)\n`);
      }
    } catch (err) {
      console.error(`  ✗ ${convId}: ${err}`);
    }
  }

  const total = db
    .prepare("SELECT count(*) as c FROM conversations")
    .get() as { c: number };
  const msgTotal = db
    .prepare("SELECT count(*) as c FROM messages")
    .get() as { c: number };

  console.log(
    `\nDone. Ingested ${ingested}, skipped ${skipped}. DB: ${total.c} conversations, ${msgTotal.c} messages.`,
  );
  closeDb();
}

main();
