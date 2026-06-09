-- ============================================================
-- Add per-promoter commission rate + daily salary
-- Run in Supabase SQL Editor.
-- ============================================================
-- commission_rate: percent of selling price (0.5 = 0.5%, 1 = 1%) — matches
--   commission_rules.rate_value convention.
-- daily_salary: pay per working day (local currency).
-- Adds the columns to every promoters table that exists (UAE / QA / TH).

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['promoters', 'promoters_qa', 'promoters_th'] LOOP
    IF to_regclass(tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS commission_rate NUMERIC DEFAULT 0.5', tbl);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS daily_salary NUMERIC DEFAULT 0', tbl);
    END IF;
  END LOOP;
END $$;
