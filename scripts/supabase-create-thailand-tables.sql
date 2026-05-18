-- ============================================================
-- Create separate Thailand tables (mirrors of UAE tables)
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. stores_th
CREATE TABLE IF NOT EXISTS stores_th (LIKE stores INCLUDING ALL);

-- 2. promoters_th
CREATE TABLE IF NOT EXISTS promoters_th (LIKE promoters INCLUDING ALL);

-- 3. shifts_th
CREATE TABLE IF NOT EXISTS shifts_th (LIKE shifts INCLUDING ALL);

-- 4. orders_th
CREATE TABLE IF NOT EXISTS orders_th (LIKE orders INCLUDING ALL);
-- Add Thailand-specific columns
ALTER TABLE orders_th ADD COLUMN IF NOT EXISTS amount_thb NUMERIC;

-- 5. special_dates_th
CREATE TABLE IF NOT EXISTS special_dates_th (LIKE special_dates INCLUDING ALL);

-- 6. promoter_conflicts_th
CREATE TABLE IF NOT EXISTS promoter_conflicts_th (LIKE promoter_conflicts INCLUDING ALL);

-- 7. promoter_store_preferences_th
CREATE TABLE IF NOT EXISTS promoter_store_preferences_th (LIKE promoter_store_preferences INCLUDING ALL);

-- 8. attendance_th
CREATE TABLE IF NOT EXISTS attendance_th (LIKE attendance INCLUDING ALL);

-- ============================================================
-- Fix unique constraints for Thailand tables
-- (LIKE copies constraints but they reference the original table's sequences)
-- ============================================================

-- shifts_th: unique per promoter+date
ALTER TABLE shifts_th DROP CONSTRAINT IF EXISTS shifts_th_promoter_date_country_key;
ALTER TABLE shifts_th DROP CONSTRAINT IF EXISTS shifts_promoter_date_country_key;
ALTER TABLE shifts_th ADD CONSTRAINT shifts_th_promoter_date_key UNIQUE(promoter_id, date);

-- special_dates_th: unique per date
ALTER TABLE special_dates_th DROP CONSTRAINT IF EXISTS special_dates_th_date_country_key;
ALTER TABLE special_dates_th DROP CONSTRAINT IF EXISTS special_dates_date_country_key;
ALTER TABLE special_dates_th ADD CONSTRAINT special_dates_th_date_key UNIQUE(date);

-- stores_th: unique per code
ALTER TABLE stores_th DROP CONSTRAINT IF EXISTS stores_th_code_country_key;
ALTER TABLE stores_th DROP CONSTRAINT IF EXISTS stores_code_country_key;
ALTER TABLE stores_th ADD CONSTRAINT stores_th_code_key UNIQUE(code);

-- orders_th: unique per order_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_th_order_id_key'
  ) THEN
    ALTER TABLE orders_th ADD CONSTRAINT orders_th_order_id_key UNIQUE(order_id);
  END IF;
END $$;

-- promoter_store_preferences_th: unique per promoter+store
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'psp_th_promoter_store_key'
  ) THEN
    ALTER TABLE promoter_store_preferences_th ADD CONSTRAINT psp_th_promoter_store_key UNIQUE(promoter_id, store_id);
  END IF;
END $$;

-- ============================================================
-- Enable RLS and copy policies (permissive for now)
-- ============================================================
ALTER TABLE stores_th ENABLE ROW LEVEL SECURITY;
ALTER TABLE promoters_th ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts_th ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders_th ENABLE ROW LEVEL SECURITY;
ALTER TABLE special_dates_th ENABLE ROW LEVEL SECURITY;
ALTER TABLE promoter_conflicts_th ENABLE ROW LEVEL SECURITY;
ALTER TABLE promoter_store_preferences_th ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_th ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated + service_role
DO $$
DECLARE
  tbl TEXT;
  roles TEXT[] := ARRAY['anon', 'authenticated', 'service_role'];
  r TEXT;
  pol_name TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'stores_th', 'promoters_th', 'shifts_th', 'orders_th',
    'special_dates_th', 'promoter_conflicts_th', 'promoter_store_preferences_th',
    'attendance_th'
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
CREATE INDEX IF NOT EXISTS idx_stores_th_code ON stores_th(code);
CREATE INDEX IF NOT EXISTS idx_orders_th_date ON orders_th(date);
CREATE INDEX IF NOT EXISTS idx_orders_th_order_id ON orders_th(order_id);
CREATE INDEX IF NOT EXISTS idx_shifts_th_date ON shifts_th(date);
CREATE INDEX IF NOT EXISTS idx_shifts_th_promoter ON shifts_th(promoter_id);
