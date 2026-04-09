-- ============================================================
-- Attendance tables for LINE webhook + OCR check-in tracking
-- Run this in Supabase SQL Editor
-- ============================================================

-- UAE attendance table
CREATE TABLE IF NOT EXISTS attendance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID REFERENCES promoters(id) ON DELETE SET NULL,
  promoter_name   TEXT,                    -- raw name from OCR (before matching)
  store_code      VARCHAR(10),             -- matched store code
  store_name      TEXT,                    -- raw store name from OCR
  date            DATE NOT NULL,
  check_in        TIME,
  check_out       TIME,
  source          TEXT DEFAULT 'line',     -- 'line' or 'manual'
  line_message_id TEXT UNIQUE,             -- LINE message ID (dedup key)
  line_group_id   TEXT,                    -- LINE group source
  line_user_id    TEXT,                    -- LINE sender user ID
  ocr_confidence  TEXT,                    -- 'high', 'medium', 'low'
  ocr_raw_text    TEXT,                    -- full OCR text for debugging
  status          TEXT DEFAULT 'matched',  -- 'matched', 'unmatched', 'error'
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_promoter ON attendance(promoter_id);
CREATE INDEX IF NOT EXISTS idx_attendance_line_msg ON attendance(line_message_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_anon_all" ON attendance FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "attendance_authenticated_all" ON attendance FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "attendance_service_all" ON attendance FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Qatar attendance table (mirror)
CREATE TABLE IF NOT EXISTS attendance_qa (LIKE attendance INCLUDING ALL);

-- attendance_qa foreign key references promoters_qa instead
ALTER TABLE attendance_qa DROP CONSTRAINT IF EXISTS attendance_promoter_id_fkey;
ALTER TABLE attendance_qa ADD CONSTRAINT attendance_qa_promoter_id_fkey
  FOREIGN KEY (promoter_id) REFERENCES promoters_qa(id) ON DELETE SET NULL;

ALTER TABLE attendance_qa ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_qa_anon_all" ON attendance_qa FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "attendance_qa_authenticated_all" ON attendance_qa FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "attendance_qa_service_all" ON attendance_qa FOR ALL TO service_role USING (true) WITH CHECK (true);
