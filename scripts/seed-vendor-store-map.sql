-- ============================================================
-- vendor_store_map — CORRECTED from "Dubai Inventory … Warehouse settings"
-- Maps each vendor's Store Id (used in their sales report) → our store_code.
-- Run in Supabase SQL editor. Replaces the previous (incorrectly-numbered) seed.
-- ============================================================
-- Source of truth: Warehouse settings sheet (Store Id ↔ WH Code ↔ our code).

DELETE FROM vendor_store_map WHERE vendor IN ('virgin', 'jashanmal', 'borders', 'hamleys', 'sharaf');

INSERT INTO vendor_store_map (vendor, vendor_store_id, store_code, store_name) VALUES
  -- Virgin
  ('virgin', '416', 'VDM', 'Virgin - Dubai Mall'),
  ('virgin', '405', 'VME', 'Virgin - Mall of the Emirates'),
  ('virgin', '437', 'VDH', 'Virgin - Dubai Hills'),
  ('virgin', '423', 'VMN', 'Virgin - Dubai Marina'),
  ('virgin', '424', 'VYM', 'Virgin - Yas Mall'),
  ('virgin', '412', 'VMF', 'Virgin - Mirdif'),
  ('virgin', '435', 'VNK', 'Virgin - Nakheel Mall'),
  ('virgin', '402', 'VAD', 'Virgin - Abu Dhabi Mall'),
  ('virgin', '425', 'VAY', 'Virgin - Arabian Ranches'),
  ('virgin', '433', 'VAY', 'Virgin - Al Maryah Island'),
  ('virgin', '436', 'VNK', 'Virgin - Al Zahia City Centre'),
  ('virgin', '438', 'VRM', 'Virgin - Reem Mall'),
  -- Jashanmal
  ('jashanmal', '142', 'JDM', 'Jashanmal - Dubai Mall'),
  ('jashanmal', '085', 'JME', 'Jashanmal - Mall of the Emirates'),
  ('jashanmal', '261', 'JDH', 'Jashanmal - Dubai Hills'),
  -- Borders
  ('borders', '2459', 'BDM', 'Borders - Dubai Mall'),
  ('borders', '2460', 'JDH', 'Borders - Dubai Hills'),
  -- Hamleys
  ('hamleys', '101S01', 'HDM', 'Hamleys - Dubai Mall')
ON CONFLICT (vendor, vendor_store_id)
  DO UPDATE SET store_code = EXCLUDED.store_code, store_name = EXCLUDED.store_name;

-- ──────────────────────────────────────────────────────────────────────────
-- UNMAPPED vendor stores (their report rows will land as "no_store" until we
-- add a matching store + WH-code mapping). Fill store_code then uncomment:
--   Virgin:     404 Mercato (VIR-MCT), 444/497 Online (VIR-ONL), 429 Sharjah,
--               439 Ibn Battuta, 390 Qatar WH, 690 Bahrain WH, 702 Oman
--   Jashanmal:  282 DIFC, 063 Abu Dhabi Mall, 213 Yas, 252 Nakheel, 115 Festival City,
--               122 Deira CC, 128 Al Ain, 123 Mirdif, 281 Reem, 277 Manar, 249 Dalma, 101 Marina AD
--   Borders:    2330 MOE, 2470 Nakheel, 2380 Mirdif CC
--   Hamleys:    101S20 Atlantis, 101S03 Yas, 113S01 Dubai Hills Play, 101S02 Mirdif
-- ──────────────────────────────────────────────────────────────────────────
