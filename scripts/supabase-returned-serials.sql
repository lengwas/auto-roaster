-- ============================================================
-- Returned serial numbers (synced from Lark Base) — run in Supabase SQL editor.
-- ============================================================
-- A returned unit is identified by its serial number. We match it back to the
-- original sales order (by serial) to claw back / flag that line.

CREATE TABLE IF NOT EXISTS returned_serials (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number  TEXT NOT NULL,
  returned_date  DATE,
  store_code     TEXT,
  vendor         TEXT,
  lark_record_id TEXT UNIQUE,
  raw            JSONB,
  synced_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (serial_number)
);
CREATE INDEX IF NOT EXISTS idx_returned_serials_serial ON returned_serials(serial_number);

ALTER TABLE returned_serials ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r TEXT; pol TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    pol := 'Allow all for ' || r;
    EXECUTE format('DROP POLICY IF EXISTS %I ON returned_serials', pol);
    EXECUTE format('CREATE POLICY %I ON returned_serials FOR ALL TO %I USING (true) WITH CHECK (true)', pol, r);
  END LOOP;
END $$;
