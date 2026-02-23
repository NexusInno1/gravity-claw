import pino from "pino";

// ── Structured Logger — pino ─────────────────────────────
// JSON output by default (production). Set LOG_PRETTY=true for dev.

const isProduction = process.env.NODE_ENV === "production";
const isPretty = process.env.LOG_PRETTY === "true" || !isProduction;

export const log = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(isPretty
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});
