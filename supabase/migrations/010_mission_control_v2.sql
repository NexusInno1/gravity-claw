-- =============================================
-- SUNDAY Mission Control — FULL SCHEMA
-- Single consolidated migration (replaces 001–010)
-- Run this once in your Supabase SQL Editor
-- =============================================

-- ─── Extensions ────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════════
-- CORE SUNDAY MEMORY TABLES (from 001)
-- ═══════════════════════════════════════════════════════════════════

-- Tier 1: Core Memory (KV Store)
CREATE TABLE IF NOT EXISTS core_memories (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Tier 2: Conversation Buffer
CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  chat_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'model')),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at DESC);

-- Tier 3: Semantic Memory (pgvector)
CREATE TABLE IF NOT EXISTS memories (
  id bigserial PRIMARY KEY,
  content text NOT NULL,
  embedding vector(768),
  type text NOT NULL CHECK (type IN ('fact', 'event')),
  importance int NOT NULL CHECK (importance BETWEEN 1 AND 10),
  category text DEFAULT 'general',
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories
  USING hnsw (embedding vector_cosine_ops);

-- Vector similarity search RPC
CREATE OR REPLACE FUNCTION search_memories(
  query_embedding vector(768),
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id bigint, content text, type text, importance int, created_at timestamptz, similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.content, m.type, m.importance, m.created_at,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM memories m
  WHERE m.embedding IS NOT NULL
    AND (m.expires_at IS NULL OR m.expires_at > now())
  ORDER BY
    (1 - (m.embedding <=> query_embedding))
    + (m.importance::float / 10.0)
    + (1.0 / (1.0 + EXTRACT(epoch FROM (now() - m.created_at)) / 86400.0))
  DESC LIMIT match_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- ACTIVITY LOG + BOT CONFIG (from 002)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS activity_log (
  id bigserial PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('heartbeat', 'message', 'tool_use', 'content_sync', 'error')),
  description text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_type ON activity_log(type);

CREATE TABLE IF NOT EXISTS bot_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_items (
  id bigserial PRIMARY KEY,
  title text NOT NULL,
  url text,
  thumbnail_url text,
  platform text NOT NULL DEFAULT 'youtube',
  views bigint DEFAULT 0,
  likes bigint DEFAULT 0,
  comments bigint DEFAULT 0,
  outlier_score float DEFAULT 1.0,
  published_at timestamptz,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_facts (
  id bigserial PRIMARY KEY,
  content text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  source text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bot_facts_category ON bot_facts(category);

-- ═══════════════════════════════════════════════════════════════════
-- TASKS BOARD (from 003 + 010 extensions)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('recurring', 'backlog', 'in_progress', 'review', 'done')),
  assignee text DEFAULT 'me',
  priority text DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date timestamptz,
  project text DEFAULT 'General',
  column_order int DEFAULT 0,
  comments jsonb DEFAULT '[]',
  tag text,
  avatar text,
  avatar_color text,
  dot_color text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);

-- Seed initial tasks
INSERT INTO tasks (title, description, status, assignee, priority, project, tag)
VALUES
  ('Set up Mission Control', 'Configure .env and connect Supabase', 'in_progress', 'me', 'high', 'SUNDAY', 'SUNDAY'),
  ('Run database migration', 'Execute full schema SQL in Supabase editor', 'done', 'me', 'urgent', 'SUNDAY', 'SUNDAY'),
  ('Add first content item', 'Create first entry in content pipeline', 'backlog', 'me', 'medium', 'Content', 'Content'),
  ('Review agent prompts', 'Check all sub-agent system prompts', 'backlog', 'sunday', 'low', 'SUNDAY', 'SUNDAY')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- USAGE LOGS (from 005)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS usage_logs (
  id bigserial PRIMARY KEY,
  chat_id text NOT NULL,
  model text NOT NULL,
  input_tokens int DEFAULT 0,
  output_tokens int DEFAULT 0,
  tool_calls int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_logs_chat ON usage_logs(chat_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- CALENDAR / SCHEDULED EVENTS (from 006 + 010 extensions)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scheduled_events (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  title text NOT NULL,
  description text,
  scheduled_time timestamptz NOT NULL,
  end_time timestamptz,
  frequency text DEFAULT 'Once',
  status text DEFAULT 'Waiting',
  assignee text,
  avatar text DEFAULT 'GC',
  avatar_color text DEFAULT 'avatar-a',
  category text DEFAULT 'task'
    CHECK (category IN ('task', 'content', 'meeting', 'automation')),
  color_code text DEFAULT 'blue',
  all_day boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Seed calendar events
INSERT INTO scheduled_events (title, description, scheduled_time, frequency, status, assignee, category)
VALUES
  ('Morning Check-in', 'SUNDAY daily news + goal prompt', now() + interval '1 day', 'Daily', 'Waiting', 'SUNDAY', 'automation'),
  ('Evening Briefing', 'Day review + tomorrow prep', now() + interval '1 day' + interval '13 hours', 'Daily', 'Waiting', 'SUNDAY', 'automation')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- BOT CONFIG SEED (from 007)
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO bot_config (key, value, category) VALUES
  ('primary_model', 'gemini-2.5-flash', 'model'),
  ('fallback_model', 'mistralai/mistral-small-3.1-24b-instruct:free', 'model'),
  ('show_model_footer', 'true', 'ui'),
  ('morning_checkin_time', '08:00', 'heartbeat'),
  ('evening_briefing_time', '21:00', 'heartbeat'),
  ('max_memory_results', '5', 'memory'),
  ('extraction_interval', '3', 'memory')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- SKILLS TABLE (from 008)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text DEFAULT '',
  content text NOT NULL,
  enabled boolean DEFAULT true,
  category text DEFAULT 'general',
  effectiveness int DEFAULT 0,
  auto_generated boolean DEFAULT false,
  source_agent text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skills_slug ON skills(slug);
CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);

-- ═══════════════════════════════════════════════════════════════════
-- REMINDERS (from 009)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id text NOT NULL,
  message text NOT NULL,
  fire_at timestamptz NOT NULL,
  fired boolean DEFAULT false,
  recurring boolean DEFAULT false,
  cron_expr text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reminders_fire_at ON reminders(fire_at) WHERE fired = false;

-- ═══════════════════════════════════════════════════════════════════
-- OFFICE AGENTS / AI TEAM (from 006 + 010 extensions)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS office_agents (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL,
  avatar text DEFAULT 'A',
  avatar_color text DEFAULT 'avatar-a',
  workstation text DEFAULT 'Main Node',
  status text DEFAULT 'Offline',
  current_activity text DEFAULT 'Idle',
  group_name text DEFAULT 'operators',
  responsibilities text,
  performance jsonb DEFAULT '{}',
  last_active timestamptz DEFAULT now()
);

-- Seed all SUNDAY sub-agents
INSERT INTO office_agents (name, role, avatar, avatar_color, workstation, status, current_activity, group_name, responsibilities)
VALUES
  ('SUNDAY', 'Core AI Agent — Orchestrator', '☀️', 'avatar-a', 'Primary Server', 'Online', 'Processing user requests', 'operators', 'Main agent loop, tool orchestration, memory management, delegation'),
  ('Research Agent', 'Deep Web Research', '🔬', 'avatar-b', 'Node 01', 'Idle', 'Awaiting delegation', 'researchers', 'Multi-source research, fact-checking, report synthesis'),
  ('Code Agent', 'Programming & Review', '💻', 'avatar-c', 'Node 02', 'Idle', 'Awaiting delegation', 'developers', 'Code generation, review, debugging, best-practice enforcement'),
  ('Summary Agent', 'Content Condensation', '📋', 'avatar-d', 'Node 03', 'Idle', 'Awaiting delegation', 'writers', 'Long-form summarization, key-point extraction'),
  ('Creative Agent', 'Creative Writing', '🎨', 'avatar-e', 'Node 04', 'Idle', 'Awaiting delegation', 'writers', 'Original content, storytelling, copywriting, poetry'),
  ('Analysis Agent', 'Data & Reasoning', '📊', 'avatar-f', 'Node 05', 'Idle', 'Awaiting delegation', 'researchers', 'Pattern analysis, comparisons, decision frameworks'),
  ('Job Search Agent', 'Employment Research', '💼', 'avatar-g', 'Node 06', 'Idle', 'Awaiting delegation', 'researchers', 'Multi-platform job discovery, listing aggregation'),
  ('News Agent', 'News Intelligence', '📰', 'avatar-h', 'Node 07', 'Idle', 'Awaiting delegation', 'researchers', 'Breaking news monitoring, source verification, trend analysis'),
  ('SaaS Idea Agent', 'Product Ideation', '💡', 'avatar-a', 'Node 08', 'Idle', 'Awaiting delegation', 'researchers', 'SaaS opportunity research, pain validation, business modeling'),
  ('Startup Idea Agent', 'Venture Ideation', '🚀', 'avatar-b', 'Node 09', 'Idle', 'Awaiting delegation', 'researchers', 'Cross-model startup ideation, market analysis, MVP scoping')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- CONTENT PIPELINE (from 010)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS content_pipeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  platform text NOT NULL DEFAULT 'youtube'
    CHECK (platform IN ('youtube', 'x', 'linkedin', 'blog', 'other')),
  stage text NOT NULL DEFAULT 'idea'
    CHECK (stage IN ('idea', 'research', 'script', 'production', 'edit', 'schedule', 'published')),
  assigned_day text,
  status text DEFAULT 'pending',
  script text,
  draft_link text,
  attachments jsonb DEFAULT '[]',
  column_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_pipeline_stage ON content_pipeline(stage);

-- Seed a sample content item
INSERT INTO content_pipeline (title, platform, stage, assigned_day) VALUES
  ('SUNDAY Agent — Build Log', 'youtube', 'idea', 'Thursday')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- CONTACTS / CRM (from 010)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text,
  handle text,
  timezone text DEFAULT 'IST',
  compensation text,
  notes text,
  category text DEFAULT 'external'
    CHECK (category IN ('internal', 'content', 'external', 'clients')),
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_category ON contacts(category);

-- ═══════════════════════════════════════════════════════════════════
-- ENABLE SUPABASE REALTIME ON ALL TABLES
-- ═══════════════════════════════════════════════════════════════════

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE tasks;            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE content_pipeline; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE scheduled_events; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE office_agents;    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE contacts;         EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE memories;         EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE skills;           EXCEPTION WHEN duplicate_object THEN NULL; END $$;
