-- ============================================================
-- Create separate Qatar tables (mirrors of UAE tables)
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. stores_qa
CREATE TABLE IF NOT EXISTS stores_qa (LIKE stores INCLUDING ALL);
-- Remove the inherited country default; Qatar tables don't need a country column
-- (but keep it if it exists — no harm)

-- 2. promoters_qa
CREATE TABLE IF NOT EXISTS promoters_qa (LIKE promoters INCLUDING ALL);

-- 3. shifts_qa
CREATE TABLE IF NOT EXISTS shifts_qa (LIKE shifts INCLUDING ALL);

-- 4. orders_qa
CREATE TABLE IF NOT EXISTS orders_qa (LIKE orders INCLUDING ALL);
-- Add Qatar-specific columns
ALTER TABLE orders_qa ADD COLUMN IF NOT EXISTS sold_time TEXT;
ALTER TABLE orders_qa ADD COLUMN IF NOT EXISTS amount_qar NUMERIC;

-- 5. special_dates_qa
CREATE TABLE IF NOT EXISTS special_dates_qa (LIKE special_dates INCLUDING ALL);

-- 6. promoter_conflicts_qa
CREATE TABLE IF NOT EXISTS promoter_conflicts_qa (LIKE promoter_conflicts INCLUDING ALL);

-- 7. promoter_store_preferences_qa
CREATE TABLE IF NOT EXISTS promoter_store_preferences_qa (LIKE promoter_store_preferences INCLUDING ALL);

-- ============================================================
-- Fix unique constraints for Qatar tables
-- (LIKE copies constraints but they reference the original table's sequences)
-- ============================================================

-- shifts_qa: unique per promoter+date
ALTER TABLE shifts_qa DROP CONSTRAINT IF EXISTS shifts_qa_promoter_date_country_key;
ALTER TABLE shifts_qa DROP CONSTRAINT IF EXISTS shifts_promoter_date_country_key;
ALTER TABLE shifts_qa ADD CONSTRAINT shifts_qa_promoter_date_key UNIQUE(promoter_id, date);

-- special_dates_qa: unique per date
ALTER TABLE special_dates_qa DROP CONSTRAINT IF EXISTS special_dates_qa_date_country_key;
ALTER TABLE special_dates_qa DROP CONSTRAINT IF EXISTS special_dates_date_country_key;
ALTER TABLE special_dates_qa ADD CONSTRAINT special_dates_qa_date_key UNIQUE(date);

-- stores_qa: unique per code
ALTER TABLE stores_qa DROP CONSTRAINT IF EXISTS stores_qa_code_country_key;
ALTER TABLE stores_qa DROP CONSTRAINT IF EXISTS stores_code_country_key;
ALTER TABLE stores_qa ADD CONSTRAINT stores_qa_code_key UNIQUE(code);

-- orders_qa: unique per order_id
ALTER TABLE orders_qa DROP CONSTRAINT IF EXISTS orders_qa_order_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_qa_order_id_key'
  ) THEN
    ALTER TABLE orders_qa ADD CONSTRAINT orders_qa_order_id_key UNIQUE(order_id);
  END IF;
END $$;

-- promoter_store_preferences_qa: unique per promoter+store
ALTER TABLE promoter_store_preferences_qa DROP CONSTRAINT IF EXISTS promoter_store_preferences_qa_promoter_id_store_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'psp_qa_promoter_store_key'
  ) THEN
    ALTER TABLE promoter_store_preferences_qa ADD CONSTRAINT psp_qa_promoter_store_key UNIQUE(promoter_id, store_id);
  END IF;
END $$;

-- ============================================================
-- Enable RLS and copy policies (permissive for now)
-- ============================================================
ALTER TABLE stores_qa ENABLE ROW LEVEL SECURITY;
ALTER TABLE promoters_qa ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts_qa ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders_qa ENABLE ROW LEVEL SECURITY;
ALTER TABLE special_dates_qa ENABLE ROW LEVEL SECURITY;
ALTER TABLE promoter_conflicts_qa ENABLE ROW LEVEL SECURITY;
ALTER TABLE promoter_store_preferences_qa ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated + service_role
DO $$
DECLARE
  tbl TEXT;
  roles TEXT[] := ARRAY['anon', 'authenticated', 'service_role'];
  r TEXT;
  pol_name TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'stores_qa', 'promoters_qa', 'shifts_qa', 'orders_qa',
    'special_dates_qa', 'promoter_conflicts_qa', 'promoter_store_preferences_qa'
  ] LOOP
    FOREACH r IN ARRAY roles LOOP
      pol_name := 'Allow all for ' || r;
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol_name, tbl);
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', pol_name, tbl, r);
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_stores_qa_code ON stores_qa(code);
CREATE INDEX IF NOT EXISTS idx_orders_qa_date ON orders_qa(date);
CREATE INDEX IF NOT EXISTS idx_orders_qa_order_id ON orders_qa(order_id);
CREATE INDEX IF NOT EXISTS idx_shifts_qa_date ON shifts_qa(date);
CREATE INDEX IF NOT EXISTS idx_shifts_qa_promoter ON shifts_qa(promoter_id);
