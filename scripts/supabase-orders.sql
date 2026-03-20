-- ============================================================
-- Orders Table (Dubai Inventory Management)
-- ============================================================
-- รัน SQL นี้ใน Supabase → SQL Editor
-- ถ้ารัน supabase-init.sql ไปแล้ว ไม่ต้องรันไฟล์นี้ซ้ำ
-- ============================================================

CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date              DATE NOT NULL,
  order_id          TEXT UNIQUE,          -- Order ID from sheet
  name              TEXT NOT NULL,         -- Customer/product name
  serial_number     TEXT,
  sku               TEXT,
  platform          TEXT,                  -- e.g. 'Amazon', 'Noon', 'Walk-in'
  warehouse         TEXT,                  -- warehouse location
  lead              TEXT,                  -- lead source / promoter
  nationality       TEXT,
  note              TEXT,
  salesperson       TEXT,                  -- promoter/salesperson name
  payment_method    TEXT,                  -- e.g. 'Cash', 'Card', 'Bank Transfer'
  transportation    TEXT,                  -- delivery method
  amount_aed        NUMERIC(12,2),        -- total amount in AED
  amount_usd        NUMERIC(12,2),        -- total amount in USD
  paid_amount_aed   NUMERIC(12,2),        -- paid amount in AED
  pmgy_expense      NUMERIC(12,2),        -- PMGY expense
  delivery_expense  NUMERIC(12,2),        -- delivery cost
  commission        NUMERIC(12,2),        -- commission amount
  comments          TEXT,
  status            TEXT DEFAULT 'pending', -- e.g. 'pending','completed','cancelled','returned'
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date);
CREATE INDEX IF NOT EXISTS idx_orders_salesperson ON orders(salesperson);
CREATE INDEX IF NOT EXISTS idx_orders_platform ON orders(platform);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);

-- Auto-update updated_at
CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow service_role" ON orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);
