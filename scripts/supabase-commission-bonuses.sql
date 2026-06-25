-- ============================================================
-- Commission bonuses — ADDITIVE incentives on top of the per-promoter % rate.
-- Run in Supabase SQL Editor.
-- ============================================================
-- Each active bonus that matches a verified sale (by SKU pattern, optional vendor,
-- and date window) is ADDED to that line's commission:
--   bonus_type = 'fixed'      → bonus_value AED per piece
--   bonus_type = 'percentage' → bonus_value % of the sale amount
-- Example: "SE3SLP sold in July → +20 AED/pc" =
--   sku_pattern 'SE3SLP', bonus_type 'fixed', bonus_value 20, valid_from 2026-07-01, valid_to 2026-07-31

CREATE TABLE IF NOT EXISTS commission_bonuses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT,
  sku_pattern TEXT,                 -- matched case-insensitively against the order's SKU/product (use % as wildcard, else substring)
  vendor      TEXT,                 -- 'virgin'|'jashanmal'|'hamleys'... NULL = all vendors
  valid_from  DATE,                 -- NULL = no start bound
  valid_to    DATE,                 -- NULL = no end bound
  bonus_type  TEXT NOT NULL DEFAULT 'fixed' CHECK (bonus_type IN ('fixed', 'percentage')),
  bonus_value NUMERIC NOT NULL,     -- AED/pc (fixed) or percent (percentage)
  active      BOOLEAN DEFAULT true,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE commission_bonuses ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r TEXT; pol TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    pol := 'Allow all for ' || r;
    EXECUTE format('DROP POLICY IF EXISTS %I ON commission_bonuses', pol);
    EXECUTE format('CREATE POLICY %I ON commission_bonuses FOR ALL TO %I USING (true) WITH CHECK (true)', pol, r);
  END LOOP;
END $$;

-- Example bonus (edit/enable as needed):
-- INSERT INTO commission_bonuses (name, sku_pattern, bonus_type, bonus_value, valid_from, valid_to)
-- VALUES ('SE3SLP July push', 'SE3SLP', 'fixed', 20, '2026-07-01', '2026-07-31');
