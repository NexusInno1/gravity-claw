import { getPineconeIndex } from "../memory/pinecone.js";
import { log } from "../logger.js";

// ── Accountability Tracker — Heartbeat Response Log ──────

/** Embedding dimension must match the index (multilingual-e5-large = 1024) */
const ZERO_VECTOR = new Array(1024).fill(0);

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

/** In-memory cache — loaded from Pinecone at startup */
let cache: AccountabilityDb = {};

/** Build a deterministic Pinecone record ID. */
function accountabilityId(userId: string): string {
  return `accountability-${userId}`;
}

/** Get today's date string in YYYY-MM-DD (IST) */
function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// ── Pinecone I/O ─────────────────────────────────────────

async function writeAccountability(
  userId: string,
  entries: CheckinEntry[],
): Promise<void> {
  try {
    const index = getPineconeIndex();
    // Only keep last 30 entries to stay within Pinecone metadata limits
    const trimmed = entries.slice(-30);
    await index.upsert({
      records: [
        {
          id: accountabilityId(userId),
          values: ZERO_VECTOR,
          metadata: {
            _type: "accountability",
            userId,
            entries: JSON.stringify(trimmed),
          },
        },
      ],
    });
  } catch (err) {
    log.warn(err, "⚠️ Failed to save accountability to Pinecone");
  }
}

/** Load accountability data from Pinecone into cache. Call at startup. */
export async function loadAccountability(userId: string): Promise<void> {
  try {
    const index = getPineconeIndex();
    const result = await index.fetch({ ids: [accountabilityId(userId)] });
    const record = result.records?.[accountabilityId(userId)];

    if (record?.metadata?.["entries"]) {
      const entries = JSON.parse(
        String(record.metadata["entries"]),
      ) as CheckinEntry[];
      if (entries.length > 0) {
        cache[userId] = entries;
        log.info(
          { userId, entryCount: entries.length },
          "📦 Accountability loaded from Pinecone",
        );
      }
    }
  } catch (err) {
    log.warn(err, "⚠️ Failed to load accountability from Pinecone");
  }
}

// ── Public API ───────────────────────────────────────────

/** Log a check-in response (or mark a check-in as sent). */
export function logCheckin(userId: string, data: Partial<CheckinEntry>): void {
  if (!cache[userId]) cache[userId] = [];

  const date = data.date ?? todayIST();
  const existing = cache[userId]!.find((e) => e.date === date);

  if (existing) {
    Object.assign(existing, data);
  } else {
    cache[userId]!.push({
      date,
      timestamp: Date.now(),
      responded: false,
      ...data,
    });
  }

  // Async Pinecone write
  void writeAccountability(userId, cache[userId]!);
}

/** Get check-in history for a user, most recent first. */
export function getCheckinHistory(
  userId: string,
  days: number = 7,
): CheckinEntry[] {
  const entries = cache[userId] ?? [];
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

  const moodBreakdown: Record<string, number> = {};
  for (const entry of history) {
    if (entry.mood) {
      moodBreakdown[entry.mood] = (moodBreakdown[entry.mood] ?? 0) + 1;
    }
  }

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
  const entries = cache[userId] ?? [];
  return entries.some((e) => e.date === todayIST());
}
