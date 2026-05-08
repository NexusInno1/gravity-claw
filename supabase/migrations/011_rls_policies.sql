-- =============================================
-- SUNDAY — Row Level Security (RLS) Policies
-- Migration 011 — Run in Supabase SQL Editor
--
-- Security model:
--   service_role key  → Full access (used by SUNDAY agent backend)
--   anon key          → Mission Control dashboard (limited access)
--
-- Sensitive tables (memory, messages, reminders):
--   READ:  service_role only
--   WRITE: service_role only
--
-- Dashboard tables (tasks, contacts, content_pipeline, etc.):
--   READ:  anon + service_role
--   WRITE: anon + service_role (dashboard needs full CRUD)
--
-- bot_config:
--   READ:  anon + service_role (settings page needs to read)
--   WRITE: service_role only  (changes should go through backend)
--
-- PostgreSQL RLS clause rules (enforced by the engine):
--   FOR SELECT → USING only
--   FOR INSERT → WITH CHECK only  (no USING — rows don't exist yet)
--   FOR UPDATE → USING + optional WITH CHECK
--   FOR DELETE → USING only
--   FOR ALL    → USING + optional WITH CHECK
-- =============================================

-- ─── Enable RLS on ALL tables ─────────────────────────────────────

ALTER TABLE core_memories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_config           ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_pipeline     ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_agents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills               ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_facts            ENABLE ROW LEVEL SECURITY;

-- ─── SENSITIVE MEMORY TABLES — service_role only ──────────────────
-- Private conversation history, semantic memories, reminders.
-- anon key (Mission Control dashboard) is fully blocked.
--
-- FOR ALL with both clauses covers SELECT/INSERT/UPDATE/DELETE cleanly.

-- core_memories
CREATE POLICY "service_role_only_core_memories"
  ON core_memories FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- messages (conversation buffer)
CREATE POLICY "service_role_only_messages"
  ON messages FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- memories (semantic / pgvector)
CREATE POLICY "service_role_only_memories"
  ON memories FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- reminders
CREATE POLICY "service_role_only_reminders"
  ON reminders FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- usage_logs (token tracking — internal only)
CREATE POLICY "service_role_only_usage_logs"
  ON usage_logs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─── BOT FACTS — anon read, service_role write ────────────────────

-- SELECT: USING only
CREATE POLICY "anon_read_bot_facts"
  ON bot_facts FOR SELECT
  USING (true);

-- INSERT: WITH CHECK only (no USING for INSERT)
CREATE POLICY "service_role_write_bot_facts"
  ON bot_facts FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ─── BOT CONFIG — anon read, service_role write ───────────────────
-- Settings page displays current config (read).
-- Only the backend mutates it.

-- SELECT: USING only
CREATE POLICY "anon_read_bot_config"
  ON bot_config FOR SELECT
  USING (true);

-- INSERT: WITH CHECK only
CREATE POLICY "service_role_write_bot_config"
  ON bot_config FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- UPDATE: USING (row filter) + WITH CHECK (new row validation)
CREATE POLICY "service_role_update_bot_config"
  ON bot_config FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- DELETE: USING only
CREATE POLICY "service_role_delete_bot_config"
  ON bot_config FOR DELETE
  USING (auth.role() = 'service_role');

-- ─── ACTIVITY LOG — anon read, service_role write ─────────────────
-- Dashboard reads activity log for the live feed.
-- Only the backend writes to it.

-- SELECT: USING only
CREATE POLICY "anon_read_activity_log"
  ON activity_log FOR SELECT
  USING (true);

-- INSERT: WITH CHECK only
CREATE POLICY "service_role_write_activity_log"
  ON activity_log FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ─── SKILLS — anon read, service_role write ───────────────────────
-- Mission Control Skills page displays skills.
-- Agent backend writes/updates/deletes them.

-- SELECT: USING only
CREATE POLICY "anon_read_skills"
  ON skills FOR SELECT
  USING (true);

-- INSERT: WITH CHECK only
CREATE POLICY "service_role_write_skills"
  ON skills FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- UPDATE: USING + WITH CHECK
CREATE POLICY "service_role_update_skills"
  ON skills FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- DELETE: USING only
CREATE POLICY "service_role_delete_skills"
  ON skills FOR DELETE
  USING (auth.role() = 'service_role');

-- ─── DASHBOARD TABLES — anon full CRUD ───────────────────────────
-- Mission Control workspace tables: tasks, content_pipeline,
-- scheduled_events, contacts. No sensitive data — anon key gets
-- full read/write so the dashboard can manage them directly.
-- FOR ALL covers all operations: USING filters existing rows,
-- WITH CHECK validates rows being inserted/updated.

-- tasks
CREATE POLICY "anon_all_tasks"
  ON tasks FOR ALL
  USING (true)
  WITH CHECK (true);

-- content_pipeline
CREATE POLICY "anon_all_content_pipeline"
  ON content_pipeline FOR ALL
  USING (true)
  WITH CHECK (true);

-- scheduled_events
CREATE POLICY "anon_all_scheduled_events"
  ON scheduled_events FOR ALL
  USING (true)
  WITH CHECK (true);

-- contacts
CREATE POLICY "anon_all_contacts"
  ON contacts FOR ALL
  USING (true)
  WITH CHECK (true);

-- ─── OFFICE AGENTS — anon read + update, service_role write ───────
-- Dashboard displays agent status (read).
-- Agent status updates (Online/Idle) come from the dashboard (update).
-- Agent rows are seeded by the backend/migration only (insert).

-- SELECT: USING only
CREATE POLICY "anon_read_office_agents"
  ON office_agents FOR SELECT
  USING (true);

-- INSERT: WITH CHECK only (seeded by migration/backend)
CREATE POLICY "service_role_write_office_agents"
  ON office_agents FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- UPDATE: USING + WITH CHECK (dashboard updates status/activity)
CREATE POLICY "anon_update_office_agents"
  ON office_agents FOR UPDATE
  USING (true)
  WITH CHECK (true);
