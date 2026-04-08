-- Add line_user_id to promoters table (for matching GPS selfies to promoters)
ALTER TABLE promoters ADD COLUMN IF NOT EXISTS line_user_id TEXT;
ALTER TABLE promoters_qa ADD COLUMN IF NOT EXISTS line_user_id TEXT;

-- Add line_user_id to attendance table (for reference/debugging)
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS line_user_id TEXT;
ALTER TABLE attendance_qa ADD COLUMN IF NOT EXISTS line_user_id TEXT;

-- Index for fast lookup by LINE user ID
CREATE INDEX IF NOT EXISTS idx_promoters_line_user_id ON promoters(line_user_id) WHERE line_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promoters_qa_line_user_id ON promoters_qa(line_user_id) WHERE line_user_id IS NOT NULL;
