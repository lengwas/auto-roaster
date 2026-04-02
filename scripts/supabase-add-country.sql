-- Add country column to all data tables (default 'UAE' for existing data)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'UAE';
ALTER TABLE promoters ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'UAE';
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'UAE';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'UAE';
ALTER TABLE special_dates ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'UAE';
ALTER TABLE promoter_conflicts ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'UAE';

-- Indexes for fast country filtering
CREATE INDEX IF NOT EXISTS idx_stores_country ON stores(country);
CREATE INDEX IF NOT EXISTS idx_promoters_country ON promoters(country);
CREATE INDEX IF NOT EXISTS idx_shifts_country ON shifts(country);
CREATE INDEX IF NOT EXISTS idx_orders_country ON orders(country);

-- Update unique constraints to be country-aware
-- special_dates: UNIQUE(date) → UNIQUE(date, country)
ALTER TABLE special_dates DROP CONSTRAINT IF EXISTS special_dates_date_key;
ALTER TABLE special_dates ADD CONSTRAINT special_dates_date_country_key UNIQUE(date, country);

-- stores: allow same code in different countries
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_code_key;
ALTER TABLE stores ADD CONSTRAINT stores_code_country_key UNIQUE(code, country);

-- shifts: unique per promoter+date+country
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_promoter_id_date_key;
ALTER TABLE shifts ADD CONSTRAINT shifts_promoter_date_country_key UNIQUE(promoter_id, date, country);
