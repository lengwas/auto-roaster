-- ============================================================
-- Add `note` column to attendance tables (UAE + QA)
-- Run this in Supabase SQL Editor
-- ============================================================

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE attendance_qa ADD COLUMN IF NOT EXISTS note TEXT;
