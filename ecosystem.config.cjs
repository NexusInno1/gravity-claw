/**
 * PM2 Ecosystem Configuration — Gravity Claw
 *
 * Manages both the main bot and Mission Control dashboard as a single
 * process group. Start everything with:
 *
 *   pm2 start ecosystem.config.cjs
 *
 * Useful commands:
 *   pm2 status                  — see running processes
 *   pm2 logs                    — tail all logs
 *   pm2 logs gravity-claw       — tail bot logs only
 *   pm2 logs mission-control    — tail dashboard logs only
 *   pm2 save                    — save current process list
 *   pm2 startup                 — generate OS auto-start script
 */

module.exports = {
    apps: [
        // ── Main Bot ────────────────────────────────────────────────────
        {
            name: "gravity-claw",
            script: "./node_modules/tsx/dist/cli.mjs",
            args: "src/index.ts",
            cwd: __dirname,

            // Restart policy
            autorestart: true,
            max_restarts: 10,
            restart_delay: 3000,
            watch: false, // bot handles its own hot-reload via Supabase Realtime

            // Environment
            env: {
                NODE_ENV: "production",
            },

            // Logging
            error_file: "./logs/bot-error.log",
            out_file: "./logs/bot-out.log",
            merge_logs: true,
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",

            // Memory guard — restart if bot exceeds 512MB
            max_memory_restart: "512M",
        },

        // ── Mission Control Dashboard ───────────────────────────────────
        {
            name: "mission-control",
            script: "./node_modules/vite/bin/vite.js",
            args: "--host 0.0.0.0 --port 5173",
            cwd: __dirname + "/mission-control-react",

            // Restart policy
            autorestart: true,
            max_restarts: 5,
            restart_delay: 2000,
            watch: false,

            // Environment
            env: {
                NODE_ENV: "production",
            },

            // Logging
            error_file: "./logs/mc-error.log",
            out_file: "./logs/mc-out.log",
            merge_logs: true,
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",

            // Memory guard — restart if dashboard dev server exceeds 256MB
            max_memory_restart: "256M",

            // Start after bot is ready (2s delay)
            wait_ready: false,
        },
    ],
};
