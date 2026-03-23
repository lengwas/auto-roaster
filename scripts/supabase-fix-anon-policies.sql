-- Run this in Supabase SQL Editor to allow the frontend (anon key) to read/write all tables.
-- The frontend uses the anon key, so it needs anon-role RLS policies.

CREATE POLICY "Allow all for anon" ON stores
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON promoters
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON promoter_stores
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON shifts
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON shift_change_log
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON promoter_store_preferences
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON promoter_conflicts
  FOR ALL TO anon USING (true) WITH CHECK (true);
