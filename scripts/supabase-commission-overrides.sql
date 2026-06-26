-- ============================================================
-- Manual overwrites + approvals for the Sales Order Map.
-- Run in Supabase SQL Editor (safe to re-run).
-- ============================================================
-- One row per reconciliation line (row_key = order id, or
-- "vendoronly:..." / "return:..." synthetic key).
--   note     = free-text correction (Overwrite column)
--   approved = manual approve/reject (NULL = use the auto-approve decision)

CREATE TABLE IF NOT EXISTS commission_overrides (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  row_key    TEXT UNIQUE NOT NULL,
  note       TEXT,
  approved   BOOLEAN,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE commission_overrides ADD COLUMN IF NOT EXISTS approved BOOLEAN;

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
