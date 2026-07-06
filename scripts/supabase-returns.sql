-- ============================================================
-- returns — Return / Refund cases synced from the Lark Base
--   https://omnimove.sg.larksuite.com/base/JN0Nb6gEiajhjhsjgSElrx7ogNf?table=tbl6yKbrEwMsr5bS
-- Keyed by lark_record_id (not serial) because ~30% of returns have no serial.
-- Run this once in the Supabase SQL editor, then hit /api/sync-lark-returns.
-- ============================================================

CREATE TABLE IF NOT EXISTS returns (
  lark_record_id  text PRIMARY KEY,
  num             text,
  request_type    text,          -- "Return / Refund"
  type            text,          -- Demo | Customer | …
  status          text,          -- Done (FT) | Pending (FT) | …
  serial_number   text,
  model           text,
  store_code      text,
  country         text,          -- 'UAE' | 'QA' (derived from store_code)
  staff_name      text,
  request_date    date,
  reason          text,          -- why it was returned (the "detail inside")
  note            text,
  condition       text,
  solution        text,
  raw             jsonb,         -- full Lark record for anything else
  synced_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS returns_country_idx ON returns (country);
CREATE INDEX IF NOT EXISTS returns_serial_idx  ON returns (serial_number);
CREATE INDEX IF NOT EXISTS returns_date_idx    ON returns (request_date);

-- RLS: the web app reads with the anon key; the sync writes with the service role.
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS returns_anon_read ON returns;
CREATE POLICY returns_anon_read ON returns
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS returns_service_all ON returns;
CREATE POLICY returns_service_all ON returns
  FOR ALL TO service_role USING (true) WITH CHECK (true);
