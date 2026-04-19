-- Migration: Add auto-skill metadata columns to the skills table
-- Run this in Supabase SQL Editor → New Query → Run
--
-- These columns allow the skills table to store auto-generated skills
-- from the autonomous skill generator (auto-generator.ts).
-- The columns are nullable so existing manual skills are unaffected.

ALTER TABLE public.skills
  ADD COLUMN IF NOT EXISTS auto_generated  BOOLEAN   DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS source_agent    TEXT,
  ADD COLUMN IF NOT EXISTS effectiveness   INTEGER   DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT now();

-- Index to speed up queries for auto-generated skills (used by /skills command)
CREATE INDEX IF NOT EXISTS idx_skills_auto_generated
  ON public.skills (auto_generated)
  WHERE auto_generated = TRUE;

-- Optional: update trigger to auto-set updated_at on any row change
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_skills_updated_at ON public.skills;
CREATE TRIGGER trg_skills_updated_at
  BEFORE UPDATE ON public.skills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
