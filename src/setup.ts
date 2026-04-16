#!/usr/bin/env tsx
/**
 * Memory Bank one-click setup.
 *
 * Checks prerequisites, locates transcripts, runs first ingest, verifies search.
 *
 *   npx tsx src/setup.ts
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(process.cwd());
const RUNTIME_DIR = join(ROOT, "99_runtime");

function step(label: string) {
  console.log(`\n── ${label} ──`);
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string) {
  console.error(`  ✗ ${msg}`);
}

async function main() {
  console.log("🧠 Memory Bank Setup\n");

  // 1. Check better-sqlite3
  step("1/5 Checking dependencies");
  try {
    await import("better-sqlite3");
    ok("better-sqlite3 found");
  } catch {
    fail("better-sqlite3 not installed. Run: npm install better-sqlite3");
    process.exit(1);
  }
  ok("tsx found (running via tsx right now)");

  // 2. Ensure runtime directory
  step("2/5 Ensuring runtime directory");
  if (!existsSync(RUNTIME_DIR)) {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    ok(`Created ${RUNTIME_DIR}`);
  } else {
    ok(`${RUNTIME_DIR} exists`);
  }

  // 3. Locate transcripts
  step("3/5 Locating agent transcripts");
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  let transcriptsDir = "";

  if (process.env.TRANSCRIPTS_DIR && existsSync(process.env.TRANSCRIPTS_DIR)) {
    transcriptsDir = process.env.TRANSCRIPTS_DIR;
  } else {
    const cursorProjects = join(home, ".cursor/projects");
    if (existsSync(cursorProjects)) {
      const projectDirs = readdirSync(cursorProjects, {
        withFileTypes: true,
      }).filter((d) => d.isDirectory() && !d.name.startsWith("."));

      const workspaceName = ROOT.split(/[/\\]/).pop()?.toLowerCase() ?? "";
      const sorted = projectDirs.sort((a, b) => {
        const aMatch = a.name.toLowerCase().includes(workspaceName) ? 0 : 1;
        const bMatch = b.name.toLowerCase().includes(workspaceName) ? 0 : 1;
        return aMatch - bMatch;
      });

      for (const d of sorted) {
        const candidate = join(cursorProjects, d.name, "agent-transcripts");
        if (existsSync(candidate)) {
          transcriptsDir = candidate;
          break;
        }
      }
    }
  }

  if (transcriptsDir) {
    ok(`Found transcripts at: ${transcriptsDir}`);
  } else {
    fail(
      "No agent-transcripts directory found. The system will work but start empty.",
    );
    fail(
      "Set TRANSCRIPTS_DIR env var to point to your Cursor agent-transcripts folder.",
    );
  }

  // 4. Run first ingest
  step("4/5 Running first ingest");
  try {
    const ingestScript = join(ROOT, "src/ingest.ts");
    const cmd = `npx tsx "${ingestScript}"`;
    const output = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 120_000,
      env: {
        ...process.env,
        ...(transcriptsDir ? { TRANSCRIPTS_DIR: transcriptsDir } : {}),
      },
    });
    const lastLine = output.trim().split("\n").pop() ?? "";
    ok(lastLine);
  } catch (err: any) {
    if (transcriptsDir) {
      fail(`Ingest failed: ${err.message}`);
    } else {
      ok("No transcripts to ingest (empty start is fine)");
    }
  }

  // 5. Verify search works
  step("5/5 Verifying search");
  try {
    const searchScript = join(ROOT, "src/search.ts");
    const cmd = `npx tsx "${searchScript}" --stats`;
    const output = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 30_000,
    });
    const lines = output.trim().split("\n");
    for (const line of lines) {
      if (line.includes("Conversations:") || line.includes("Messages:") || line.includes("Knowledge:")) {
        ok(line.trim());
      }
    }
  } catch (err: any) {
    fail(`Search verification failed: ${err.message}`);
  }

  console.log("\n🎉 Setup complete! Memory Bank is ready.\n");
  console.log("Quick start:");
  console.log('  Search:  npx tsx src/search.ts "keyword"');
  console.log("  Stats:   npm run memory:stats");
  console.log("  Health:  npm run memory:health");
  console.log(
    '  Harvest: npx tsx src/harvest.ts add --category finding --title "..." --content "..."',
  );
}

main();
