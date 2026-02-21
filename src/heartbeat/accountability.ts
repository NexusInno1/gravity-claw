import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// ── Accountability Tracker — Heartbeat Response Log ──────

const DATA_DIR = join(process.cwd(), "data");
const ACCOUNTABILITY_FILE = join(DATA_DIR, "accountability.json");

export interface CheckinEntry {
  date: string; // YYYY-MM-DD
  timestamp: number;
  responded: boolean;
  mood?: "on_track" | "struggling" | "neutral";
  weightTracked?: boolean;
  goal?: string;
  replyText?: string;
}

type AccountabilityDb = Record<string, CheckinEntry[]>; // userId → entries

function readDb(): AccountabilityDb {
  if (!existsSync(ACCOUNTABILITY_FILE)) return {};
  try {
    return JSON.parse(
      readFileSync(ACCOUNTABILITY_FILE, "utf-8"),
    ) as AccountabilityDb;
  } catch {
    return {};
  }
}

function writeDb(db: AccountabilityDb): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(ACCOUNTABILITY_FILE, JSON.stringify(db, null, 2), "utf-8");
}

/** Get today's date string in YYYY-MM-DD (IST) */
function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Log a check-in response (or mark a check-in as sent). */
export function logCheckin(userId: string, data: Partial<CheckinEntry>): void {
  const db = readDb();
  if (!db[userId]) db[userId] = [];

  const date = data.date ?? todayIST();
  const existing = db[userId]!.find((e) => e.date === date);

  if (existing) {
    // Update existing entry for today
    Object.assign(existing, data);
  } else {
    db[userId]!.push({
      date,
      timestamp: Date.now(),
      responded: false,
      ...data,
    });
  }

  writeDb(db);
}

/** Get check-in history for a user, most recent first. */
export function getCheckinHistory(
  userId: string,
  days: number = 7,
): CheckinEntry[] {
  const db = readDb();
  const entries = db[userId] ?? [];
  return entries.sort((a, b) => b.timestamp - a.timestamp).slice(0, days);
}

/** Get weekly summary stats for a user. */
export function getWeeklySummary(userId: string): {
  totalCheckins: number;
  responded: number;
  responseRate: number;
  streak: number;
  moodBreakdown: Record<string, number>;
  weightTrackedDays: number;
} {
  const history = getCheckinHistory(userId, 7);
  const totalCheckins = history.length;
  const responded = history.filter((e) => e.responded).length;
  const weightTrackedDays = history.filter((e) => e.weightTracked).length;

  // Mood breakdown
  const moodBreakdown: Record<string, number> = {};
  for (const entry of history) {
    if (entry.mood) {
      moodBreakdown[entry.mood] = (moodBreakdown[entry.mood] ?? 0) + 1;
    }
  }

  // Current streak (consecutive days responded)
  let streak = 0;
  for (const entry of history) {
    if (entry.responded) {
      streak++;
    } else {
      break;
    }
  }

  return {
    totalCheckins,
    responded,
    responseRate: totalCheckins > 0 ? responded / totalCheckins : 0,
    streak,
    moodBreakdown,
    weightTrackedDays,
  };
}

/** Check if today's check-in has already been sent. */
export function wasCheckinSentToday(userId: string): boolean {
  const db = readDb();
  const entries = db[userId] ?? [];
  return entries.some((e) => e.date === todayIST());
}
