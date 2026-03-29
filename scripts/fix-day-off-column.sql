-- Fix day_off column: change from varchar(3) to TEXT to support multiple days like "Mon,Tue,Wed,Thu"
ALTER TABLE promoters ALTER COLUMN day_off TYPE TEXT;
