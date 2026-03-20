-- ============================================================
-- UAE PC Shift Table — Replace mock data with real data
-- จาก: 🇦🇪UAE PC Shift Table 🇦🇪.xlsx
-- ============================================================
-- วิธีใช้:
-- 1. เปิด Supabase Dashboard → SQL Editor
-- 2. วาง SQL นี้ทั้งหมด แล้วกด Run
-- ============================================================

-- ============================================================
-- 1. Add missing columns to stores (if not already added)
-- ============================================================
ALTER TABLE stores ADD COLUMN IF NOT EXISTS platform  TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS warehouse TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS stores_label TEXT; -- for future use

-- Add stores_label to promoters
ALTER TABLE promoters ADD COLUMN IF NOT EXISTS stores_label TEXT;

-- ============================================================
-- 2. Clear old mock data (keep orders intact)
-- ============================================================
TRUNCATE promoter_conflicts CASCADE;
TRUNCATE promoter_store_preferences CASCADE;
TRUNCATE promoter_stores CASCADE;
TRUNCATE shift_change_log CASCADE;
TRUNCATE shifts CASCADE;
TRUNCATE promoters CASCADE;
TRUNCATE stores CASCADE;

-- ============================================================
-- 3. Insert real stores from UAE PC Shift Table
-- ============================================================
INSERT INTO stores (code, name, active, open_time, close_time, platform) VALUES
  ('AIR', 'Airwheel Office',            false, '09:00', '18:00', NULL),
  ('VDM', 'Virgin Dubai Mall',          true,  '13:00', '22:00', 'Virgin - Dubai Mall'),
  ('VME', 'Virgin Mall of Emirates',    true,  '13:00', '22:00', 'Virgin - MOE'),
  ('VDH', 'Virgin Dubai Hills',         true,  '13:00', '22:00', 'Virgin - Dubai Hills'),
  ('VNK', 'Virgin Nakheel',             true,  '13:00', '22:00', NULL),
  ('VYM', 'Virgin Yas Mall',            true,  '13:00', '22:00', 'Virgin - Yas Mall'),
  ('VAY', 'Virgin Al Maryah Island',    true,  '13:00', '22:00', 'Virgin - Al Maryah Island Abudhabi'),
  ('VRM', 'Virgin Reem Mall',           true,  '13:00', '22:00', 'Virgin - Reem Mall Abudhabi'),
  ('VMF', 'Virgin Mirdif',              true,  '13:00', '22:00', 'Virgin - Mirdif'),
  ('VMN', 'Virgin Dubai Marina',        true,  '13:00', '22:00', 'Virgin - Dubai Marina'),
  ('JDM', 'Jashanmal Dubai Mall',       true,  '13:00', '22:00', 'Jashanmal - Dubai Mall'),
  ('JME', 'Jashanmal MOE',              true,  '13:00', '22:00', 'Jashanmal - MOE'),
  ('JDH', 'Jashanmal Dubai Hills',      true,  '13:00', '22:00', 'Jashanmal - Dubai Hills'),
  ('ADC', 'Airwheel DCC',               false, '10:00', '19:00', NULL),
  ('IMG', 'IMG World',                  false, '10:00', '19:00', NULL),
  ('VAD', 'Virgin Abu Dhabi Mall',      false, '13:00', '22:00', 'Virgin - Abu Dhabi Mall'),
  ('SDM', 'Sharaf DG - Dubai Mall',     false, '10:00', '22:00', 'Sharaf DG - Dubai Mall'),
  ('BDM', 'Borders - Dubai Mall',       true,  '13:00', '22:00', 'Borders - Dubai Mall'),
  ('HDM', 'Hamleys - Dubai Mall',       true,  '13:00', '22:00', 'Hamleys - Dubai Mall')
ON CONFLICT (code) DO UPDATE SET
  name       = EXCLUDED.name,
  active     = EXCLUDED.active,
  open_time  = EXCLUDED.open_time,
  close_time = EXCLUDED.close_time,
  platform   = EXCLUDED.platform;

-- ============================================================
-- 4. Insert real promoters from UAE PC Shift Table (PC setting)
-- ============================================================
INSERT INTO promoters (name, active, stores_label) VALUES
  ('Tammy Bo',      true, 'VME, JME'),
  ('Mint Ch',       true, ''),
  ('Shimul',        true, ''),
  ('Artharva',      true, ''),
  ('Tiwter',        true, 'VMN'),
  ('Punpun',        true, 'VME, JME'),
  ('Mostafa MO',    true, 'VAY, VRM'),
  ('Akimu Ss',      true, 'VAY, VRM'),
  ('Eric Ba',       true, ''),
  ('Olaide Us',     true, 'JDM'),
  ('Danny Th',      true, 'VMN'),
  ('Kevin Ka',      true, 'JDM'),
  ('Natasha Ng',    true, ''),
  ('Maureen Wa',    true, 'VME'),
  ('Juan Fe',       true, 'VMN'),
  ('Nabeel Na',     true, 'VME'),
  ('Sandun Ma',     true, 'VAY, VRM'),
  ('Alexandre Ju',  true, ''),
  ('Mohid Kh',      true, ''),
  ('Khaled Al',     true, ''),
  ('Apple Ma',      true, ''),
  ('Sakib Ha',      true, ''),
  ('Mint Su',       true, ''),
  ('Hajar Sa',      true, 'VYM'),
  ('Jerby Pe',      true, 'VAY, VRM'),
  ('Amine Ch',      true, ''),
  ('Ahmed No',      true, ''),
  ('Angela Uj',     true, 'VDM'),
  ('Mohamed Ta',    true, ''),
  ('Mufti Ja',      true, ''),
  ('Milk Kh',       true, ''),
  ('Muhammad Ja',   true, ''),
  ('Soufiane Le',   true, ''),
  ('Emmanuel Fr',   true, ''),
  ('Timothy Ak',    true, ''),
  ('Lynda Dj',      true, ''),
  ('Pokuah Do',     true, 'VMN'),
  ('Arlene Le',     true, ''),
  ('Aamir An',      true, ''),
  ('Ben Mu',        true, 'JDM'),
  ('Sahil Ka',      true, ''),
  ('Lucky Ap',      true, ''),
  ('Ramya Sh',      true, ''),
  ('Mina Ta',       true, ''),
  ('Nadeem Si',     true, ''),
  ('Shuhaib Pu',    true, ''),
  ('Romnick Co',    true, '')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. Add anon RLS policies for web app access
-- ============================================================
DO $$
BEGIN
  -- stores
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='stores' AND policyname='Allow anon read stores'
  ) THEN
    CREATE POLICY "Allow anon read stores" ON stores FOR SELECT TO anon USING (true);
  END IF;

  -- promoters
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='promoters' AND policyname='Allow anon read promoters'
  ) THEN
    CREATE POLICY "Allow anon read promoters" ON promoters FOR SELECT TO anon USING (true);
  END IF;
END
$$;

-- ============================================================
-- Done! ตรวจสอบ:
--   SELECT * FROM stores ORDER BY code;
--   SELECT * FROM promoters ORDER BY name;
-- ============================================================
