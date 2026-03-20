-- ============================================================
-- Test Orders Data — UAE PC Shift Table
-- ============================================================
-- รัน SQL นี้ใน Supabase Dashboard → SQL Editor
-- เพื่อทดสอบ Sales Performance tab ก่อนมีข้อมูลจริง
-- ============================================================
-- ⚠️  ต้องรัน supabase-orders-anon.sql ก่อน เพื่อให้ anon อ่านได้
-- ============================================================

-- Helper: สร้าง order_id แบบ sequential อัตโนมัติ
-- Warehouse ใช้ค่าเดียวกับ stores.platform ในฐานข้อมูล

-- ─── ลบ test data เก่า (ถ้ามี) ─────────────────────────────────────────────
DELETE FROM orders WHERE order_id LIKE 'TEST-%';

-- ─── Insert test orders ─────────────────────────────────────────────────────
-- Promoters (จาก seed data): Tammy Bo, Mint Ch, Kevin Ka, Olaide Us,
--   Mostafa MO, Tiwter, Danny Th, Juan Fe, Sandun Ma, Jerby Pe, etc.
-- Warehouse values must match stores.platform:
--   VDM → 'Virgin - Dubai Mall'
--   VME → 'Virgin - MOE'
--   VDH → 'Virgin - Dubai Hills'
--   JDM → 'Jashanmal - Dubai Mall'
--   JME → 'Jashanmal - MOE'
--   JDH → 'Jashanmal - Dubai Hills'
--   VMN → 'Virgin - Dubai Marina'
--   VNK → NULL (no platform) → use 'VNK' directly
--   BDM → 'Borders - Dubai Mall'
--   HDM → 'Hamleys - Dubai Mall'

INSERT INTO orders
  (date, order_id, name, salesperson, warehouse, platform, amount_aed, status)
VALUES
-- ─── Jan 2026 — VDM (Virgin Dubai Mall) ────────────────────────────────
('2026-01-02','TEST-001','Customer A','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',4500,'completed'),
('2026-01-02','TEST-002','Customer B','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',6200,'completed'),
('2026-01-03','TEST-003','Customer C','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',3800,'completed'),
('2026-01-04','TEST-004','Customer D','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',5100,'completed'),
('2026-01-05','TEST-005','Customer E','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',2900,'completed'),
('2026-01-06','TEST-006','Customer F','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',7200,'completed'),
('2026-01-07','TEST-007','Customer G','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',4400,'completed'),
('2026-01-09','TEST-008','Customer H','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',5600,'completed'),
('2026-01-10','TEST-009','Customer I','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',3100,'completed'),
('2026-01-11','TEST-010','Customer J','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',8900,'completed'),

-- ─── Jan 2026 — VME (Virgin MOE) ────────────────────────────────────────
('2026-01-02','TEST-011','Customer K','Punpun','Virgin - MOE','Virgin - MOE',3200,'completed'),
('2026-01-03','TEST-012','Customer L','Nabeel Na','Virgin - MOE','Virgin - MOE',4100,'completed'),
('2026-01-04','TEST-013','Customer M','Punpun','Virgin - MOE','Virgin - MOE',2800,'completed'),
('2026-01-05','TEST-014','Customer N','Nabeel Na','Virgin - MOE','Virgin - MOE',5500,'completed'),
('2026-01-06','TEST-015','Customer O','Maureen Wa','Virgin - MOE','Virgin - MOE',3700,'completed'),
('2026-01-07','TEST-016','Customer P','Punpun','Virgin - MOE','Virgin - MOE',4900,'completed'),
('2026-01-09','TEST-017','Customer Q','Nabeel Na','Virgin - MOE','Virgin - MOE',2600,'completed'),
('2026-01-10','TEST-018','Customer R','Maureen Wa','Virgin - MOE','Virgin - MOE',6100,'completed'),

-- ─── Jan 2026 — JDM (Jashanmal Dubai Mall) ──────────────────────────────
('2026-01-02','TEST-021','Customer U','Kevin Ka','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',7800,'completed'),
('2026-01-03','TEST-022','Customer V','Olaide Us','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',5200,'completed'),
('2026-01-04','TEST-023','Customer W','Kevin Ka','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',9100,'completed'),
('2026-01-05','TEST-024','Customer X','Olaide Us','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',4300,'completed'),
('2026-01-06','TEST-025','Customer Y','Kevin Ka','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',11200,'completed'),
('2026-01-07','TEST-026','Customer Z','Olaide Us','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',6700,'completed'),

-- ─── Jan 2026 — VMN (Virgin Dubai Marina) ───────────────────────────────
('2026-01-02','TEST-031','Customer AA','Tiwter','Virgin - Dubai Marina','Virgin - Dubai Marina',2100,'completed'),
('2026-01-03','TEST-032','Customer AB','Danny Th','Virgin - Dubai Marina','Virgin - Dubai Marina',1800,'completed'),
('2026-01-04','TEST-033','Customer AC','Juan Fe','Virgin - Dubai Marina','Virgin - Dubai Marina',2400,'completed'),
('2026-01-05','TEST-034','Customer AD','Tiwter','Virgin - Dubai Marina','Virgin - Dubai Marina',1600,'completed'),
('2026-01-07','TEST-035','Customer AE','Danny Th','Virgin - Dubai Marina','Virgin - Dubai Marina',2200,'completed'),

-- ─── Feb 2026 — VDM ─────────────────────────────────────────────────────
('2026-02-01','TEST-101','Customer BA','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',5200,'completed'),
('2026-02-02','TEST-102','Customer BB','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',3600,'completed'),
('2026-02-03','TEST-103','Customer BC','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',6800,'completed'),
('2026-02-04','TEST-104','Customer BD','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',4100,'completed'),
('2026-02-05','TEST-105','Customer BE','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',7500,'completed'),
('2026-02-06','TEST-106','Customer BF','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',3200,'completed'),
('2026-02-07','TEST-107','Customer BG','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',9200,'completed'),
('2026-02-08','TEST-108','Customer BH','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',2800,'completed'),
('2026-02-09','TEST-109','Customer BI','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',6100,'completed'),
('2026-02-10','TEST-110','Customer BJ','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',8300,'completed'),
('2026-02-11','TEST-111','Customer BK','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',4700,'completed'),
('2026-02-12','TEST-112','Customer BL','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',5900,'completed'),
('2026-02-13','TEST-113','Customer BM','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',3400,'completed'),
('2026-02-14','TEST-114','Customer BN','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',11500,'completed'),  -- Valentine's Day spike

-- ─── Feb 2026 — VME ─────────────────────────────────────────────────────
('2026-02-01','TEST-121','Customer CA','Punpun','Virgin - MOE','Virgin - MOE',3900,'completed'),
('2026-02-02','TEST-122','Customer CB','Nabeel Na','Virgin - MOE','Virgin - MOE',4600,'completed'),
('2026-02-03','TEST-123','Customer CC','Maureen Wa','Virgin - MOE','Virgin - MOE',3100,'completed'),
('2026-02-05','TEST-124','Customer CD','Punpun','Virgin - MOE','Virgin - MOE',5200,'completed'),
('2026-02-07','TEST-125','Customer CE','Nabeel Na','Virgin - MOE','Virgin - MOE',2700,'completed'),
('2026-02-08','TEST-126','Customer CF','Maureen Wa','Virgin - MOE','Virgin - MOE',4800,'completed'),
('2026-02-10','TEST-127','Customer CG','Punpun','Virgin - MOE','Virgin - MOE',3600,'completed'),
('2026-02-12','TEST-128','Customer CH','Nabeel Na','Virgin - MOE','Virgin - MOE',5100,'completed'),
('2026-02-14','TEST-129','Customer CI','Maureen Wa','Virgin - MOE','Virgin - MOE',7200,'completed'),  -- Valentine's

-- ─── Feb 2026 — JDM ─────────────────────────────────────────────────────
('2026-02-01','TEST-131','Customer DA','Kevin Ka','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',8400,'completed'),
('2026-02-03','TEST-132','Customer DB','Olaide Us','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',5800,'completed'),
('2026-02-05','TEST-133','Customer DC','Kevin Ka','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',10200,'completed'),
('2026-02-07','TEST-134','Customer DD','Olaide Us','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',6100,'completed'),
('2026-02-09','TEST-135','Customer DE','Kevin Ka','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',12500,'completed'),
('2026-02-11','TEST-136','Customer DF','Olaide Us','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',4900,'completed'),
('2026-02-14','TEST-137','Customer DG','Kevin Ka','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',15000,'completed'),  -- Valentine's

-- ─── Feb 2026 — VMN ─────────────────────────────────────────────────────
('2026-02-02','TEST-141','Customer EA','Tiwter','Virgin - Dubai Marina','Virgin - Dubai Marina',1900,'completed'),
('2026-02-04','TEST-142','Customer EB','Danny Th','Virgin - Dubai Marina','Virgin - Dubai Marina',2300,'completed'),
('2026-02-06','TEST-143','Customer EC','Juan Fe','Virgin - Dubai Marina','Virgin - Dubai Marina',1700,'completed'),
('2026-02-09','TEST-144','Customer ED','Tiwter','Virgin - Dubai Marina','Virgin - Dubai Marina',2800,'completed'),
('2026-02-11','TEST-145','Customer EE','Danny Th','Virgin - Dubai Marina','Virgin - Dubai Marina',2100,'completed'),

-- ─── Feb 2026 — JME ─────────────────────────────────────────────────────
('2026-02-03','TEST-151','Customer FA','Punpun','Jashanmal - MOE','Jashanmal - MOE',3300,'completed'),
('2026-02-05','TEST-152','Customer FB','Tammy Bo','Jashanmal - MOE','Jashanmal - MOE',4800,'completed'),  -- Tammy cross-posting
('2026-02-07','TEST-153','Customer FC','Punpun','Jashanmal - MOE','Jashanmal - MOE',2900,'completed'),
('2026-02-10','TEST-154','Customer FD','Tammy Bo','Jashanmal - MOE','Jashanmal - MOE',5600,'completed'),
('2026-02-12','TEST-155','Customer FE','Punpun','Jashanmal - MOE','Jashanmal - MOE',3700,'completed'),

-- ─── Mar 2026 — VDM ─────────────────────────────────────────────────────
('2026-03-01','TEST-201','Customer GA','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',5500,'completed'),
('2026-03-02','TEST-202','Customer GB','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',4200,'completed'),
('2026-03-03','TEST-203','Customer GC','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',6900,'completed'),
('2026-03-04','TEST-204','Customer GD','Shimul','Virgin - Dubai Mall','Virgin - Dubai Mall',3800,'completed'),  -- Shimul at VDM
('2026-03-05','TEST-205','Customer GE','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',8100,'completed'),
('2026-03-06','TEST-206','Customer GF','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',3500,'completed'),
('2026-03-07','TEST-207','Customer GG','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',7200,'completed'),
('2026-03-08','TEST-208','Customer GH','Shimul','Virgin - Dubai Mall','Virgin - Dubai Mall',4100,'completed'),
('2026-03-09','TEST-209','Customer GI','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',9600,'completed'),
('2026-03-10','TEST-210','Customer GJ','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',5300,'completed'),
('2026-03-11','TEST-211','Customer GK','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',6700,'completed'),
('2026-03-12','TEST-212','Customer GL','Shimul','Virgin - Dubai Mall','Virgin - Dubai Mall',3200,'completed'),
('2026-03-13','TEST-213','Customer GM','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',7800,'completed'),
('2026-03-14','TEST-214','Customer GN','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',4600,'completed'),
('2026-03-15','TEST-215','Customer GO','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',8400,'completed'),
('2026-03-16','TEST-216','Customer GP','Shimul','Virgin - Dubai Mall','Virgin - Dubai Mall',5100,'completed'),
('2026-03-17','TEST-217','Customer GQ','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',10200,'completed'),
('2026-03-18','TEST-218','Customer GR','Mint Ch','Virgin - Dubai Mall','Virgin - Dubai Mall',3900,'completed'),
('2026-03-19','TEST-219','Customer GS','Tammy Bo','Virgin - Dubai Mall','Virgin - Dubai Mall',7500,'completed'),
('2026-03-20','TEST-220','Customer GT','Shimul','Virgin - Dubai Mall','Virgin - Dubai Mall',4400,'completed'),

-- ─── Mar 2026 — VME ─────────────────────────────────────────────────────
('2026-03-01','TEST-231','Customer HA','Punpun','Virgin - MOE','Virgin - MOE',4200,'completed'),
('2026-03-02','TEST-232','Customer HB','Nabeel Na','Virgin - MOE','Virgin - MOE',5100,'completed'),
('2026-03-03','TEST-233','Customer HC','Maureen Wa','Virgin - MOE','Virgin - MOE',3400,'completed'),
('2026-03-04','TEST-234','Customer HD','Punpun','Virgin - MOE','Virgin - MOE',4800,'completed'),
('2026-03-05','TEST-235','Customer HE','Nabeel Na','Virgin - MOE','Virgin - MOE',3900,'completed'),
('2026-03-07','TEST-236','Customer HF','Maureen Wa','Virgin - MOE','Virgin - MOE',5600,'completed'),
('2026-03-08','TEST-237','Customer HG','Punpun','Virgin - MOE','Virgin - MOE',4100,'completed'),
('2026-03-10','TEST-238','Customer HH','Nabeel Na','Virgin - MOE','Virgin - MOE',5800,'completed'),
('2026-03-12','TEST-239','Customer HI','Maureen Wa','Virgin - MOE','Virgin - MOE',3200,'completed'),
('2026-03-14','TEST-240','Customer HJ','Punpun','Virgin - MOE','Virgin - MOE',6200,'completed'),
('2026-03-15','TEST-241','Customer HK','Nabeel Na','Virgin - MOE','Virgin - MOE',4500,'completed'),
('2026-03-17','TEST-242','Customer HL','Maureen Wa','Virgin - MOE','Virgin - MOE',5300,'completed'),
('2026-03-19','TEST-243','Customer HM','Punpun','Virgin - MOE','Virgin - MOE',4700,'completed'),
('2026-03-20','TEST-244','Customer HN','Nabeel Na','Virgin - MOE','Virgin - MOE',3800,'completed'),

-- ─── Mar 2026 — JDM ─────────────────────────────────────────────────────
('2026-03-01','TEST-251','Customer IA','Kevin Ka','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',9500,'completed'),
('2026-03-02','TEST-252','Customer IB','Olaide Us','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',6200,'completed'),
('2026-03-03','TEST-253','Customer IC','Kevin Ka','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',11800,'completed'),
('2026-03-04','TEST-254','Customer ID','Olaide Us','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',5500,'completed'),
('2026-03-05','TEST-255','Customer IE','Kevin Ka','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',13200,'completed'),
('2026-03-07','TEST-256','Customer IF','Olaide Us','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',7800,'completed'),
('2026-03-08','TEST-257','Customer IG','Kevin Ka','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',14500,'completed'),
('2026-03-10','TEST-258','Customer IH','Olaide Us','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',6900,'completed'),
('2026-03-12','TEST-259','Customer II','Kevin Ka','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',16000,'completed'),
('2026-03-14','TEST-260','Customer IJ','Olaide Us','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',5100,'completed'),
('2026-03-15','TEST-261','Customer IK','Kevin Ka','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',12300,'completed'),
('2026-03-17','TEST-262','Customer IL','Olaide Us','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',7200,'completed'),
('2026-03-19','TEST-263','Customer IM','Kevin Ka','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',10800,'completed'),
('2026-03-20','TEST-264','Customer IN','Olaide Us','Jashanmal - Dubai Mall','Jashanmal - Dubai Mall',5800,'completed'),

-- ─── Mar 2026 — VMN ─────────────────────────────────────────────────────
('2026-03-01','TEST-271','Customer JA','Tiwter','Virgin - Dubai Marina','Virgin - Dubai Marina',2300,'completed'),
('2026-03-03','TEST-272','Customer JB','Danny Th','Virgin - Dubai Marina','Virgin - Dubai Marina',1900,'completed'),
('2026-03-05','TEST-273','Customer JC','Juan Fe','Virgin - Dubai Marina','Virgin - Dubai Marina',2600,'completed'),
('2026-03-07','TEST-274','Customer JD','Tiwter','Virgin - Dubai Marina','Virgin - Dubai Marina',3100,'completed'),
('2026-03-10','TEST-275','Customer JE','Danny Th','Virgin - Dubai Marina','Virgin - Dubai Marina',2400,'completed'),
('2026-03-12','TEST-276','Customer JF','Juan Fe','Virgin - Dubai Marina','Virgin - Dubai Marina',1800,'completed'),
('2026-03-14','TEST-277','Customer JG','Tiwter','Virgin - Dubai Marina','Virgin - Dubai Marina',2700,'completed'),
('2026-03-17','TEST-278','Customer JH','Danny Th','Virgin - Dubai Marina','Virgin - Dubai Marina',2200,'completed'),
('2026-03-19','TEST-279','Customer JI','Juan Fe','Virgin - Dubai Marina','Virgin - Dubai Marina',3300,'completed'),

-- ─── Mar 2026 — JME ─────────────────────────────────────────────────────
('2026-03-01','TEST-281','Customer KA','Punpun','Jashanmal - MOE','Jashanmal - MOE',3600,'completed'),
('2026-03-04','TEST-282','Customer KB','Artharva','Jashanmal - MOE','Jashanmal - MOE',2900,'completed'),
('2026-03-07','TEST-283','Customer KC','Punpun','Jashanmal - MOE','Jashanmal - MOE',4100,'completed'),
('2026-03-10','TEST-284','Customer KD','Artharva','Jashanmal - MOE','Jashanmal - MOE',3200,'completed'),
('2026-03-12','TEST-285','Customer KE','Punpun','Jashanmal - MOE','Jashanmal - MOE',3800,'completed'),
('2026-03-15','TEST-286','Customer KF','Artharva','Jashanmal - MOE','Jashanmal - MOE',2700,'completed'),
('2026-03-17','TEST-287','Customer KG','Punpun','Jashanmal - MOE','Jashanmal - MOE',4600,'completed'),
('2026-03-20','TEST-288','Customer KH','Artharva','Jashanmal - MOE','Jashanmal - MOE',3100,'completed'),

-- ─── Mar 2026 — BDM (Borders Dubai Mall) ────────────────────────────────
('2026-03-02','TEST-291','Customer LA','Sandun Ma','Borders - Dubai Mall','Borders - Dubai Mall',3100,'completed'),
('2026-03-05','TEST-292','Customer LB','Jerby Pe','Borders - Dubai Mall','Borders - Dubai Mall',2800,'completed'),
('2026-03-08','TEST-293','Customer LC','Sandun Ma','Borders - Dubai Mall','Borders - Dubai Mall',3400,'completed'),
('2026-03-11','TEST-294','Customer LD','Jerby Pe','Borders - Dubai Mall','Borders - Dubai Mall',3900,'completed'),
('2026-03-14','TEST-295','Customer LE','Sandun Ma','Borders - Dubai Mall','Borders - Dubai Mall',2600,'completed'),
('2026-03-17','TEST-296','Customer LF','Jerby Pe','Borders - Dubai Mall','Borders - Dubai Mall',4200,'completed'),
('2026-03-20','TEST-297','Customer LG','Sandun Ma','Borders - Dubai Mall','Borders - Dubai Mall',3700,'completed'),

-- ─── Mar 2026 — HDM (Hamleys Dubai Mall) ────────────────────────────────
('2026-03-01','TEST-301','Customer MA','Mostafa MO','Hamleys - Dubai Mall','Hamleys - Dubai Mall',4600,'completed'),
('2026-03-04','TEST-302','Customer MB','Akimu Ss','Hamleys - Dubai Mall','Hamleys - Dubai Mall',3800,'completed'),
('2026-03-07','TEST-303','Customer MC','Mostafa MO','Hamleys - Dubai Mall','Hamleys - Dubai Mall',5200,'completed'),
('2026-03-10','TEST-304','Customer MD','Akimu Ss','Hamleys - Dubai Mall','Hamleys - Dubai Mall',4100,'completed'),
('2026-03-13','TEST-305','Customer ME','Mostafa MO','Hamleys - Dubai Mall','Hamleys - Dubai Mall',6300,'completed'),
('2026-03-16','TEST-306','Customer MF','Akimu Ss','Hamleys - Dubai Mall','Hamleys - Dubai Mall',3500,'completed'),
('2026-03-19','TEST-307','Customer MG','Mostafa MO','Hamleys - Dubai Mall','Hamleys - Dubai Mall',5800,'completed')

ON CONFLICT (order_id) DO UPDATE SET
  date         = EXCLUDED.date,
  salesperson  = EXCLUDED.salesperson,
  warehouse    = EXCLUDED.warehouse,
  platform     = EXCLUDED.platform,
  amount_aed   = EXCLUDED.amount_aed,
  status       = EXCLUDED.status;

-- ─── ผลลัพธ์ที่ควรเห็น ──────────────────────────────────────────────────────
-- VDM: Kevin Ka จะมี PI สูง (~1.4) เพราะขายได้มากกว่า store avg
--       Shimul จะมี PI ต่ำ (~0.6) เพราะขายได้น้อยกว่า
-- JDM: Kevin Ka → top performer (Grade A candidate)
-- VMN: ทุกคน PI ต่ำ เพราะ daily avg ต่ำ แต่ PI จะใกล้ 1.0 (คือ at-store avg)
-- Punpun: ทำงานทั้ง VME และ JME → เห็น cross-store performance
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  COUNT(*) AS total_orders,
  SUM(amount_aed) AS total_aed,
  COUNT(DISTINCT salesperson) AS unique_promoters,
  COUNT(DISTINCT warehouse) AS unique_warehouses
FROM orders
WHERE order_id LIKE 'TEST-%';
