-- ============================================================
-- Serial Number Registry — track every serial ever sold
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS serial_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number TEXT NOT NULL,
  model TEXT,
  colour TEXT,
  sku TEXT,
  promoter_name TEXT,
  promoter_id UUID REFERENCES promoters(id),
  branch TEXT,                           -- store code
  date DATE,
  selling_price NUMERIC(12,2),
  claim_item_id UUID REFERENCES sales_claim_items(id),
  vendor_line_id UUID REFERENCES vendor_report_lines(id),
  source TEXT DEFAULT 'jotform' CHECK (source IN ('jotform', 'vendor', 'manual')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'returned', 'disputed')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(serial_number)                  -- one entry per serial
);

CREATE INDEX IF NOT EXISTS idx_serial_registry_serial ON serial_registry(serial_number);
CREATE INDEX IF NOT EXISTS idx_serial_registry_date ON serial_registry(date);
CREATE INDEX IF NOT EXISTS idx_serial_registry_promoter ON serial_registry(promoter_name);
CREATE INDEX IF NOT EXISTS idx_serial_registry_branch ON serial_registry(branch);
CREATE INDEX IF NOT EXISTS idx_serial_registry_sku ON serial_registry(sku);

-- RLS
ALTER TABLE serial_registry ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r TEXT;
  pol_name TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    pol_name := 'Allow all for ' || r;
    EXECUTE format('DROP POLICY IF EXISTS %I ON serial_registry', pol_name);
    EXECUTE format('CREATE POLICY %I ON serial_registry FOR ALL TO %I USING (true) WITH CHECK (true)', pol_name, r);
  END LOOP;
END $$;
