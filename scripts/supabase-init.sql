-- ============================================================
-- UAE PC Shift Table — Supabase Database Setup
-- ============================================================
-- วิธีใช้:
-- 1. เปิด Supabase Dashboard → SQL Editor
-- 2. วาง SQL นี้ทั้งหมด แล้วกด Run
-- ============================================================

-- Enable UUID extension (ปกติ Supabase เปิดอยู่แล้ว)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. Stores
-- ============================================================
CREATE TABLE IF NOT EXISTS stores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(10) UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  active          BOOLEAN DEFAULT true,
  open_time       TIME NOT NULL,
  close_time      TIME NOT NULL,
  extra_allowance TEXT,
  max_capacity    INT,                -- max promoters per day (NULL = unlimited, default 1)
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. Promoters
-- ============================================================
CREATE TABLE IF NOT EXISTS promoters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  active          BOOLEAN DEFAULT true,
  day_off         VARCHAR(3),         -- 'Sun','Mon','Tue','Wed','Thu','Fri','Sat'
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. Promoter-Store assignments (many-to-many)
-- ============================================================
CREATE TABLE IF NOT EXISTS promoter_stores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID REFERENCES promoters(id) ON DELETE CASCADE,
  store_id        UUID REFERENCES stores(id) ON DELETE CASCADE,
  UNIQUE(promoter_id, store_id)
);

-- ============================================================
-- 4. Shifts (CORE — flat, 1 row = 1 person + 1 day)
-- ============================================================
CREATE TABLE IF NOT EXISTS shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID REFERENCES promoters(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  shift_type      TEXT NOT NULL,      -- store code ('VDM') or 'Off','LOP','SL'
  time_range      TEXT,               -- '16:00-23:00' (nullable for Off/LOP/SL)
  note            TEXT,               -- optional note per shift
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(promoter_id, date)           -- 1 shift per person per day
);

CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_shifts_promoter ON shifts(promoter_id);
CREATE INDEX IF NOT EXISTS idx_shifts_type ON shifts(shift_type);
CREATE INDEX IF NOT EXISTS idx_shifts_date_type ON shifts(date, shift_type);

-- ============================================================
-- 5. Shift change log (audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS shift_change_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id        UUID REFERENCES shifts(id) ON DELETE SET NULL,
  promoter_id     UUID REFERENCES promoters(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  old_type        TEXT,               -- previous shift_type (NULL = new)
  new_type        TEXT,               -- new shift_type (NULL = deleted)
  old_note        TEXT,
  new_note        TEXT,
  changed_by      TEXT NOT NULL,      -- user email or name
  changed_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_changelog_promoter ON shift_change_log(promoter_id);
CREATE INDEX IF NOT EXISTS idx_changelog_date ON shift_change_log(date);
CREATE INDEX IF NOT EXISTS idx_changelog_changed_at ON shift_change_log(changed_at);

-- ============================================================
-- 6. Store preferences per promoter (must/preferred/banned)
-- ============================================================
CREATE TABLE IF NOT EXISTS promoter_store_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID REFERENCES promoters(id) ON DELETE CASCADE,
  store_id        UUID REFERENCES stores(id) ON DELETE CASCADE,
  preference      TEXT NOT NULL CHECK (preference IN ('must','preferred','banned')),
  UNIQUE(promoter_id, store_id)
);

-- ============================================================
-- 7. Promoter conflicts (pairs that should not work same store same day)
-- ============================================================
CREATE TABLE IF NOT EXISTS promoter_conflicts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_a_id   UUID REFERENCES promoters(id) ON DELETE CASCADE,
  promoter_b_id   UUID REFERENCES promoters(id) ON DELETE CASCADE,
  reason          TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  CHECK (promoter_a_id < promoter_b_id),
  UNIQUE(promoter_a_id, promoter_b_id)
);

-- ============================================================
-- 8. Auto-update updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shifts_updated_at
  BEFORE UPDATE ON shifts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 9. Auto-log shift changes trigger
-- ============================================================
CREATE OR REPLACE FUNCTION log_shift_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO shift_change_log (shift_id, promoter_id, date, old_type, new_type, old_note, new_note, changed_by)
    VALUES (NEW.id, NEW.promoter_id, NEW.date, NULL, NEW.shift_type, NULL, NEW.note, 'system');
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only log if shift_type or note actually changed
    IF OLD.shift_type IS DISTINCT FROM NEW.shift_type OR OLD.note IS DISTINCT FROM NEW.note THEN
      INSERT INTO shift_change_log (shift_id, promoter_id, date, old_type, new_type, old_note, new_note, changed_by)
      VALUES (NEW.id, NEW.promoter_id, NEW.date, OLD.shift_type, NEW.shift_type, OLD.note, NEW.note, 'system');
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO shift_change_log (shift_id, promoter_id, date, old_type, new_type, old_note, new_note, changed_by)
    VALUES (NULL, OLD.promoter_id, OLD.date, OLD.shift_type, NULL, OLD.note, NULL, 'system');
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shifts_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON shifts
  FOR EACH ROW
  EXECUTE FUNCTION log_shift_change();

-- ============================================================
-- 10. Row Level Security (RLS)
-- ============================================================
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE promoters ENABLE ROW LEVEL SECURITY;
ALTER TABLE promoter_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE promoter_store_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE promoter_conflicts ENABLE ROW LEVEL SECURITY;

-- Allow full access for authenticated users (adjust as needed)
CREATE POLICY "Allow all for authenticated" ON stores
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON promoters
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON promoter_stores
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON shifts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON shift_change_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON promoter_store_preferences
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON promoter_conflicts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Allow service_role full access (for Google Apps Script sync)
CREATE POLICY "Allow service_role" ON stores
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Allow service_role" ON promoters
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Allow service_role" ON promoter_stores
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Allow service_role" ON shifts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Allow service_role" ON shift_change_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Allow service_role" ON promoter_store_preferences
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Allow service_role" ON promoter_conflicts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 11. Seed initial store data
-- ============================================================
INSERT INTO stores (code, name, open_time, close_time, extra_allowance, max_capacity) VALUES
  ('AIR', 'Airport City',           '10:00', '22:00', NULL, NULL),
  ('VDM', 'Vox Deira Mall',         '16:00', '23:00', NULL, 4),
  ('VME', 'Vox Mall of Emirates',   '14:00', '23:00', NULL, 2),
  ('VDH', 'Vox Dubai Hills',        '15:00', '23:00', '+10 AED', NULL),
  ('VNK', 'Vox Nakheel',            '14:00', '22:00', '+15 AED', NULL),
  ('VYM', 'Vox Yas Mall',           '13:00', '22:00', NULL, NULL),
  ('VAY', 'Vox Al Ain',             '13:00', '21:00', NULL, NULL),
  ('VRM', 'Vox Reel Mall',          '14:00', '22:00', NULL, NULL),
  ('VMF', 'Vox Mirdif',             '15:00', '23:00', NULL, NULL),
  ('VMN', 'Vox Marina',             '14:00', '23:00', NULL, NULL),
  ('JDM', 'Jumbo Deira',            '10:00', '22:00', NULL, NULL),
  ('JME', 'Jumbo MOE',              '10:00', '22:00', NULL, NULL),
  ('JDH', 'Jumbo Dubai Hills',      '10:00', '22:00', '+10 AED', NULL),
  ('SDM', 'Sharaf DG Mall',         '10:00', '22:00', NULL, NULL),
  ('BDM', 'Best Al Barsha',         '10:00', '23:00', NULL, NULL),
  ('HDM', 'Home Deira',             '10:00', '22:00', NULL, NULL)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 12. Seed initial promoter data
-- ============================================================
INSERT INTO promoters (name, day_off) VALUES
  ('Kevin Ka',       'Thu'),
  ('Maureen Wa',     'Mon'),
  ('Alexandre Ju',   'Sat'),
  ('Jerby Pe',       'Tue'),
  ('Ahmed No',       'Tue'),
  ('Angela Uj',      'Wed'),
  ('Mufti Ja',       'Tue'),
  ('Lynda Dj',       'Wed'),
  ('Arlene Le',      'Tue'),
  ('Ben Mu',         'Wed'),
  ('Sarah Al',       'Thu'),
  ('Omar Ha',        'Fri'),
  ('Diana Co',       'Mon'),
  ('Rashid Kh',      'Sun'),
  ('Maria Fe',       'Thu'),
  ('James Wy',       'Sat'),
  ('Fatima Za',      'Mon'),
  ('Carlos De',      'Wed'),
  ('Priya Sh',       'Fri'),
  ('Hassan Ab',      'Tue')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Done!
-- ============================================================
-- ตรวจสอบ: SELECT * FROM stores;
--          SELECT * FROM promoters;
