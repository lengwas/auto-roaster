-- ============================================================
-- Allow anonymous (browser) read access to orders table
-- ============================================================
-- วิธีใช้:
--   เปิด Supabase Dashboard → SQL Editor → Run
-- ทำไมต้องรัน:
--   ตาราง orders ถูกสร้างโดยมี RLS policy สำหรับ authenticated
--   และ service_role เท่านั้น  เว็บแอปที่ใช้ anon key จึงอ่าน
--   ข้อมูลไม่ได้  SQL นี้เพิ่ม SELECT policy สำหรับ anon role
-- ============================================================

-- Read-only access for the anon role (browser / Supabase anon key)
CREATE POLICY "Allow anon read orders"
  ON orders
  FOR SELECT
  TO anon
  USING (true);

-- ============================================================
-- (Optional) If you also want to allow anon writes via
-- Google Apps Script using the anon key, uncomment below.
-- Recommended: use service_role key in Apps Script instead.
-- ============================================================
-- CREATE POLICY "Allow anon insert orders"
--   ON orders
--   FOR INSERT
--   TO anon
--   WITH CHECK (true);
--
-- CREATE POLICY "Allow anon update orders"
--   ON orders
--   FOR UPDATE
--   TO anon
--   USING (true)
--   WITH CHECK (true);
