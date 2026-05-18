-- ============================================================
-- Commission Verification System — Database Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. sales_claims — JotForm submissions (promoter's self-reported sales)
CREATE TABLE IF NOT EXISTS sales_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id TEXT UNIQUE NOT NULL,         -- JotForm submission ID
  unique_id TEXT,                             -- e.g. "AE-000006"
  date DATE NOT NULL,
  time TIME,
  promoter_name TEXT NOT NULL,                -- from JotForm (short name)
  promoter_id UUID REFERENCES promoters(id),  -- resolved link
  branch TEXT NOT NULL,                       -- store code (VDM, JDM, etc.)
  -- Survey fields
  customer_gender TEXT,
  nationality TEXT,
  visa_type TEXT,
  age_range TEXT,
  group_type TEXT,
  -- Sales data
  number_of_luggage INT DEFAULT 0,
  product_list TEXT,                          -- raw "Model: SE3S, Colour: Black\n..."
  image_urls TEXT,                            -- newline-separated JotForm image URLs
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'disputed', 'rejected')),
  duplicated BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_claims_date ON sales_claims(date);
CREATE INDEX IF NOT EXISTS idx_sales_claims_promoter ON sales_claims(promoter_name);
CREATE INDEX IF NOT EXISTS idx_sales_claims_branch ON sales_claims(branch);
CREATE INDEX IF NOT EXISTS idx_sales_claims_status ON sales_claims(status);

-- 2. sales_claim_items — individual items parsed from a claim
CREATE TABLE IF NOT EXISTS sales_claim_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES sales_claims(id) ON DELETE CASCADE,
  item_index INT DEFAULT 0,                  -- 0-based index within the claim
  model TEXT,                                -- e.g. "SE3S", "SQ3", "SE3SL"
  colour TEXT,                               -- e.g. "Black", "Silver"
  sku TEXT,                                  -- resolved SKU
  serial_number TEXT,                        -- OCR-extracted from image
  image_url TEXT,                            -- individual image URL for this item
  ocr_status TEXT DEFAULT 'pending' CHECK (ocr_status IN ('pending', 'success', 'failed', 'manual')),
  ocr_raw TEXT,                              -- raw OCR output
  -- Verification
  verified BOOLEAN DEFAULT false,
  matched_vendor_line_id UUID,               -- FK to vendor_report_lines if matched
  selling_price NUMERIC(12,2),               -- from vendor report or manual
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claim_items_claim ON sales_claim_items(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_items_serial ON sales_claim_items(serial_number);
CREATE INDEX IF NOT EXISTS idx_claim_items_model ON sales_claim_items(model);

-- 3. vendor_report_lines — rows from vendor monthly reports (ground truth)
CREATE TABLE IF NOT EXISTS vendor_report_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor TEXT NOT NULL,                       -- 'virgin', 'jashanmal', 'hamleys', 'sharaf', 'borders'
  report_month TEXT NOT NULL,                 -- 'YYYY-MM'
  date DATE NOT NULL,
  vendor_store_id TEXT,                       -- original store ID from report (e.g. "424", "101S01")
  store_code TEXT,                            -- our resolved store code (VDM, JDM, etc.)
  item_description TEXT,
  item_code TEXT,                             -- vendor item code / barcode
  sku TEXT,                                   -- normalized SKU (e.g. "SE3S_BK")
  upc TEXT,
  quantity INT NOT NULL DEFAULT 0,            -- positive = sale, negative = return
  selling_price NUMERIC(12,2),               -- per-unit price
  total_value NUMERIC(12,2),                 -- quantity * selling_price
  trans_type TEXT DEFAULT 'sale' CHECK (trans_type IN ('sale', 'return')),
  sales_rep TEXT,                             -- from Jashanmal (null for others)
  receipt_no TEXT,
  vendor_commission_pct NUMERIC(5,2),         -- from Hamleys report
  vendor_commission_amt NUMERIC(12,2),        -- from Hamleys report
  raw_data JSONB,                             -- full original row as JSON
  imported_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_lines_date ON vendor_report_lines(date);
CREATE INDEX IF NOT EXISTS idx_vendor_lines_store ON vendor_report_lines(store_code);
CREATE INDEX IF NOT EXISTS idx_vendor_lines_vendor ON vendor_report_lines(vendor);
CREATE INDEX IF NOT EXISTS idx_vendor_lines_month ON vendor_report_lines(report_month);
CREATE INDEX IF NOT EXISTS idx_vendor_lines_sku ON vendor_report_lines(sku);

-- Prevent duplicate imports
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_lines_dedup
  ON vendor_report_lines(vendor, date, vendor_store_id, item_code, receipt_no)
  WHERE receipt_no IS NOT NULL;

-- 4. vendor_store_map — map vendor store IDs to our store codes
CREATE TABLE IF NOT EXISTS vendor_store_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor TEXT NOT NULL,
  vendor_store_id TEXT NOT NULL,
  store_code TEXT NOT NULL,                   -- our store code
  store_name TEXT,                            -- human-readable name
  UNIQUE(vendor, vendor_store_id)
);

-- Seed known mappings
INSERT INTO vendor_store_map (vendor, vendor_store_id, store_code, store_name) VALUES
  -- Virgin (store numbers → our codes)
  ('virgin', '404', 'VAD', 'Virgin Abu Dhabi Mall'),
  ('virgin', '405', 'VYM', 'Virgin Yas Mall'),
  ('virgin', '412', 'VMN', 'Virgin Mirdif City Centre'),
  ('virgin', '416', 'VMF', 'Virgin Dubai Marina Mall'),
  ('virgin', '423', 'VDH', 'Virgin Dubai Hills'),
  ('virgin', '424', 'VDM', 'Virgin Dubai Mall'),
  ('virgin', '433', 'VME', 'Virgin Mall of the Emirates'),
  ('virgin', '437', 'VNK', 'Virgin Nakheel Mall'),
  ('virgin', '438', 'VRM', 'Virgin Reem Mall'),
  -- Jashanmal (store names → our codes)
  ('jashanmal', '142-JNC DUBAI MALL', 'JDM', 'Jashanmal Dubai Mall'),
  ('jashanmal', '085-JNC MOE', 'JME', 'Jashanmal Mall of the Emirates'),
  ('jashanmal', '252-JNC NAKHEEL MALL', 'VNK', 'Jashanmal Nakheel Mall'),
  ('jashanmal', '261-JNC DUBAI HILLS MALL', 'JDH', 'Jashanmal Dubai Hills'),
  ('jashanmal', '063-JNC DEPARMENT STORE ADH MALL', 'VAD', 'Jashanmal Abu Dhabi Mall'),
  ('jashanmal', '115-JNC DUBAI FESTIVAL CITY', 'VMF', 'Jashanmal Dubai Festival City'),
  ('jashanmal', '122-ATW DEIRA CC', 'VMN', 'Airwheel Deira CC'),
  -- Hamleys (store numbers → our codes)
  ('hamleys', '101S01', 'HDM', 'Hamleys Dubai Mall'),
  ('hamleys', '101S02', 'HDM', 'Hamleys Dubai Mall 2'),
  ('hamleys', '101S20', 'HDM', 'Hamleys other')
ON CONFLICT (vendor, vendor_store_id) DO NOTHING;

-- 5. commission_rules — configurable commission rates
CREATE TABLE IF NOT EXISTS commission_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                         -- human label e.g. "Default 1%", "EID bonus"
  promoter_id UUID REFERENCES promoters(id),  -- NULL = applies to all
  sku_pattern TEXT,                            -- NULL = all SKUs, or regex/glob e.g. "SE3S%"
  vendor TEXT,                                -- NULL = all vendors
  rate_type TEXT NOT NULL CHECK (rate_type IN ('percentage', 'fixed')),
  rate_value NUMERIC(10,4) NOT NULL,          -- 1.0 = 1%, or 50 = 50 AED
  valid_from DATE,                            -- NULL = always valid
  valid_to DATE,                              -- NULL = no end date
  priority INT DEFAULT 0,                     -- higher = takes precedence
  active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_rules_promoter ON commission_rules(promoter_id);

-- 6. commission_ledger — calculated commission per verified sale item
CREATE TABLE IF NOT EXISTS commission_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_item_id UUID REFERENCES sales_claim_items(id),
  promoter_id UUID REFERENCES promoters(id),
  date DATE NOT NULL,
  store_code TEXT,
  model TEXT,
  sku TEXT,
  selling_price NUMERIC(12,2),
  commission_rule_id UUID REFERENCES commission_rules(id),
  commission_rate NUMERIC(10,4),              -- effective rate applied
  commission_amount NUMERIC(12,2),            -- final commission
  month TEXT,                                 -- 'YYYY-MM' for grouping
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'deducted')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_ledger_promoter ON commission_ledger(promoter_id);
CREATE INDEX IF NOT EXISTS idx_commission_ledger_month ON commission_ledger(month);
CREATE INDEX IF NOT EXISTS idx_commission_ledger_status ON commission_ledger(status);

-- 7. return_deductions — track return deductions against promoter sales
CREATE TABLE IF NOT EXISTS return_deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_line_id UUID REFERENCES vendor_report_lines(id),
  deducted_from_item_id UUID REFERENCES sales_claim_items(id),  -- NULL if pro-rata
  deducted_from_ledger_id UUID REFERENCES commission_ledger(id), -- the commission entry to adjust
  vendor TEXT NOT NULL,
  sku TEXT,
  serial_number TEXT,                         -- if matched by serial
  quantity INT NOT NULL DEFAULT -1,
  amount NUMERIC(12,2),
  deduction_type TEXT NOT NULL CHECK (deduction_type IN ('serial_match', 'pro_rata')),
  lookback_days INT,                          -- vendor-specific: virgin=30, jashanmal=14
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. vendor_return_windows — configurable lookback window per vendor for pro-rata returns
CREATE TABLE IF NOT EXISTS vendor_return_windows (
  vendor TEXT PRIMARY KEY,
  lookback_days INT NOT NULL DEFAULT 30
);

INSERT INTO vendor_return_windows (vendor, lookback_days) VALUES
  ('virgin', 30),
  ('jashanmal', 14),
  ('hamleys', 30),
  ('sharaf', 30),
  ('borders', 30)
ON CONFLICT (vendor) DO NOTHING;

-- ============================================================
-- RLS + Policies
-- ============================================================
ALTER TABLE sales_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_claim_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_report_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_store_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_deductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_return_windows ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
  roles TEXT[] := ARRAY['anon', 'authenticated', 'service_role'];
  r TEXT;
  pol_name TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sales_claims', 'sales_claim_items', 'vendor_report_lines',
    'vendor_store_map', 'commission_rules', 'commission_ledger',
    'return_deductions', 'vendor_return_windows'
  ] LOOP
    FOREACH r IN ARRAY roles LOOP
      pol_name := 'Allow all for ' || r;
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol_name, tbl);
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', pol_name, tbl, r);
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- Auto-update trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sales_claims_updated_at ON sales_claims;
CREATE TRIGGER sales_claims_updated_at BEFORE UPDATE ON sales_claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
