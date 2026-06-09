-- ============================================================
-- Vendor report upload: Storage bucket + upload log
-- Run in Supabase SQL Editor.
-- ============================================================

-- 1. Storage bucket to keep the raw uploaded report files (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('vendor-reports', 'vendor-reports', false)
ON CONFLICT (id) DO NOTHING;

-- Allow the app (anon/authenticated) + service role to manage objects in this bucket.
DO $$
DECLARE r TEXT; pol TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    pol := 'vendor_reports_objects_' || r;
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol);
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR ALL TO %I USING (bucket_id = ''vendor-reports'') WITH CHECK (bucket_id = ''vendor-reports'')',
      pol, r);
  END LOOP;
END $$;

-- 2. Log of uploaded reports (one row per upload)
CREATE TABLE IF NOT EXISTS vendor_report_uploads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor         TEXT,
  report_month   TEXT,                 -- 'YYYY-MM'
  file_name      TEXT,
  storage_path   TEXT,
  row_count      INT,
  sales_count    INT,
  return_count   INT,
  unmapped_stores TEXT[],
  uploaded_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE vendor_report_uploads ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r TEXT; pol TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    pol := 'Allow all for ' || r;
    EXECUTE format('DROP POLICY IF EXISTS %I ON vendor_report_uploads', pol);
    EXECUTE format('CREATE POLICY %I ON vendor_report_uploads FOR ALL TO %I USING (true) WITH CHECK (true)', pol, r);
  END LOOP;
END $$;
