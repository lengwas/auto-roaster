-- ============================================================
-- Promoter HR fields — enrich promoters with the staff-master columns.
-- Added to all country tables so the app works across UAE / QA / TH.
-- Run once in the Supabase SQL editor.
-- ============================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['promoters', 'promoters_qa', 'promoters_th'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('
        ALTER TABLE %I
          ADD COLUMN IF NOT EXISTS nickname               text,
          ADD COLUMN IF NOT EXISTS contact                text,
          ADD COLUMN IF NOT EXISTS email                  text,
          ADD COLUMN IF NOT EXISTS nationality            text,
          ADD COLUMN IF NOT EXISTS trainer                text,
          ADD COLUMN IF NOT EXISTS status                 text,
          ADD COLUMN IF NOT EXISTS start_date             date,
          ADD COLUMN IF NOT EXISTS last_date              date,
          ADD COLUMN IF NOT EXISTS uniform_size           text,
          ADD COLUMN IF NOT EXISTS last_shirt_date        date,
          ADD COLUMN IF NOT EXISTS reason_for_leaving     text,
          ADD COLUMN IF NOT EXISTS removed_from_chatgroups boolean,
          ADD COLUMN IF NOT EXISTS additional_comments    text
      ', t);
    END IF;
  END LOOP;
END $$;
