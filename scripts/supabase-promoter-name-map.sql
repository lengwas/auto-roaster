-- Promoter name alias mapping table
-- When user corrects an attendance record, the OCR name → promoter mapping is saved here.
-- The LINE webhook checks this table FIRST before fuzzy token matching.

-- UAE
CREATE TABLE IF NOT EXISTS promoter_name_map (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ocr_name    TEXT NOT NULL,
  promoter_id UUID NOT NULL REFERENCES promoters(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (ocr_name)
);

-- Qatar
CREATE TABLE IF NOT EXISTS promoter_name_map_qa (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ocr_name    TEXT NOT NULL,
  promoter_id UUID NOT NULL REFERENCES promoters_qa(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (ocr_name)
);

-- RLS: allow anon read/write
ALTER TABLE promoter_name_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE promoter_name_map_qa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_promoter_name_map" ON promoter_name_map
  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_promoter_name_map_qa" ON promoter_name_map_qa
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Service role bypass
CREATE POLICY "service_all_promoter_name_map" ON promoter_name_map
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_promoter_name_map_qa" ON promoter_name_map_qa
  FOR ALL TO service_role USING (true) WITH CHECK (true);
