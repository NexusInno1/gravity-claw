import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// ── Facts Store — Layer 3 (local JSON) ───────────────────

const DATA_DIR = join(process.cwd(), "data");
const FACTS_FILE = join(DATA_DIR, "facts.json");

type FactsDb = Record<string, Record<string, string>>; // userId → { key: value }

function readDb(): FactsDb {
  if (!existsSync(FACTS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(FACTS_FILE, "utf-8")) as FactsDb;
  } catch {
    return {};
  }
}

function writeDb(db: FactsDb): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FACTS_FILE, JSON.stringify(db, null, 2), "utf-8");
}

/** Insert or update a fact for a user. */
export function upsertFact(userId: string, key: string, value: string): void {
  const db = readDb();
  if (!db[userId]) db[userId] = {};
  db[userId]![key] = value;
  writeDb(db);
}

/** Retrieve all known facts for a user. Returns empty object if none. */
export function getFacts(userId: string): Record<string, string> {
  const db = readDb();
  return db[userId] ?? {};
}

/** Delete all facts for a user (called on /new if desired). */
export function clearFacts(userId: string): void {
  const db = readDb();
  delete db[userId];
  writeDb(db);
}
