-- Add shift_slots column to stores table
-- shift_slots stores an array of shift time patterns, e.g.:
--   ["10:00-19:00", "13:30-22:30"]
--   ["Mon-Thu 10:00-19:00", "Fri,Sat,Sun 13:00-22:00"]
ALTER TABLE stores ADD COLUMN IF NOT EXISTS shift_slots TEXT[] DEFAULT NULL;

-- Also add platform and warehouse columns if missing
ALTER TABLE stores ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT NULL;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS warehouse TEXT DEFAULT NULL;

-- Allow anon access (match existing RLS policies)
-- If RLS is enabled, ensure the policy covers the new columns (it should automatically)
