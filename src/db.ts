/**
 * Memory Bank — SQLite-backed project memory with FTS5 full-text search.
 *
 * Tables:
 *   conversations  — one row per agent-transcript session (with summary)
 *   messages        — user/assistant text (tool calls stripped)
 *   knowledge       — distilled insights extracted from conversations
 *
 * FTS indexes:
 *   messages_fts    — unicode61 word-level search on messages
 *   messages_tri    — trigram substring search (Chinese-friendly)
 *   knowledge_fts   — unicode61 word-level search on knowledge
 *   knowledge_tri   — trigram substring search on knowledge
 */

import Database from "better-sqlite3";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

function getDbPath(): string {
  if (process.env.MEMORY_DB_PATH) {
    return resolve(process.env.MEMORY_DB_PATH);
  }
  const runtimeDir = resolve(process.cwd(), "99_runtime");
  if (!existsSync(runtimeDir)) {
    mkdirSync(runtimeDir, { recursive: true });
  }
  return join(runtimeDir, "memory.sqlite");
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(getDbPath());
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

const SCHEMA_VERSION = 2;

function migrate(db: Database.Database) {
  const currentVersion = (
    db.pragma("user_version") as Array<{ user_version: number }>
  )[0].user_version;

  if (currentVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id            TEXT PRIMARY KEY,
        title         TEXT,
        first_user_msg TEXT,
        summary       TEXT DEFAULT '',
        message_count INTEGER DEFAULT 0,
        created_at    TEXT,
        updated_at    TEXT,
        ingested_at   TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        seq             INTEGER NOT NULL,
        role            TEXT NOT NULL,
        content         TEXT NOT NULL,
        created_at      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);

      CREATE TABLE IF NOT EXISTS knowledge (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT REFERENCES conversations(id),
        category        TEXT NOT NULL,
        title           TEXT NOT NULL,
        content         TEXT NOT NULL,
        tags            TEXT DEFAULT '',
        created_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_know_cat ON knowledge(category);

      -- Word-level FTS (good for mixed CJK/English)
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content=messages,
        content_rowid=id,
        tokenize='unicode61'
      );

      -- Trigram FTS for Chinese substring matching
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_tri USING fts5(
        content,
        content=messages,
        content_rowid=id,
        tokenize='trigram'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        title, content, tags,
        content=knowledge,
        content_rowid=id,
        tokenize='unicode61'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_tri USING fts5(
        title, content, tags,
        content=knowledge,
        content_rowid=id,
        tokenize='trigram'
      );

      -- Sync triggers for messages
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        INSERT INTO messages_tri(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO messages_tri(messages_tri, rowid, content) VALUES ('delete', old.id, old.content);
      END;

      -- Sync triggers for knowledge
      CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
        INSERT INTO knowledge_fts(rowid, title, content, tags) VALUES (new.id, new.title, new.content, new.tags);
        INSERT INTO knowledge_tri(rowid, title, content, tags) VALUES (new.id, new.title, new.content, new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags) VALUES ('delete', old.id, old.title, old.content, old.tags);
        INSERT INTO knowledge_tri(knowledge_tri, rowid, title, content, tags) VALUES ('delete', old.id, old.title, old.content, old.tags);
      END;
    `);
  }

  if (currentVersion < 2) {
    try {
      db.exec("ALTER TABLE conversations ADD COLUMN summary TEXT DEFAULT ''");
    } catch {
      // Column already exists
    }
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_tri USING fts5(
          content, content=messages, content_rowid=id, tokenize='trigram'
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_tri USING fts5(
          title, content, tags, content=knowledge, content_rowid=id, tokenize='trigram'
        );
      `);
    } catch {
      // Tables already exist
    }
  }

  if (currentVersion < SCHEMA_VERSION) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
