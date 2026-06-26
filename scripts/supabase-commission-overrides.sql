-- ============================================================
-- Manual overwrites for the Sales Order Map (commission reconciliation).
-- Run in Supabase SQL Editor.
-- ============================================================
-- One row per reconciliation line (keyed by row_key = order id, or
-- "vendoronly:date|store|sku|vendor"). `note` is the free-text correction shown
-- in the Overwrite column.

CREATE TABLE IF NOT EXISTS commission_overrides (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  row_key    TEXT UNIQUE NOT NULL,
  note       TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE commission_overrides ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r TEXT; pol TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    pol := 'Allow all for ' || r;
    EXECUTE format('DROP POLICY IF EXISTS %I ON commission_overrides', pol);
    EXECUTE format('CREATE POLICY %I ON commission_overrides FOR ALL TO %I USING (true) WITH CHECK (true)', pol, r);
  END LOOP;
END $$;
