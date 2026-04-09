-- ============================================================
-- Add GPS coordinates to stores table for GPS-based matching
-- Run this in Supabase SQL Editor
-- ============================================================

-- Add lat/lng columns to stores
ALTER TABLE stores ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE stores_qa ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE stores_qa ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- ── UAE store coordinates ──
UPDATE stores SET latitude = 25.1968, longitude = 55.2783 WHERE code = 'VDM';  -- Virgin Dubai Mall
UPDATE stores SET latitude = 25.1022, longitude = 55.2420 WHERE code = 'VDH';  -- Virgin Dubai Hills
UPDATE stores SET latitude = 25.1180, longitude = 55.2005 WHERE code = 'VME';  -- Virgin Mall of the Emirates
UPDATE stores SET latitude = 25.0760, longitude = 55.1410 WHERE code = 'VMN';  -- Virgin Marina Mall
UPDATE stores SET latitude = 25.2580, longitude = 55.2952 WHERE code = 'VNK';  -- Virgin Nakheel Mall
UPDATE stores SET latitude = 25.0945, longitude = 55.1497 WHERE code = 'VMF';  -- Virgin Mirdif City Centre
UPDATE stores SET latitude = 25.0730, longitude = 55.1300 WHERE code = 'VYM';  -- Virgin Yas Mall
UPDATE stores SET latitude = 25.2098, longitude = 55.2745 WHERE code = 'VAY';  -- Virgin Al Ain Mall
UPDATE stores SET latitude = 25.1860, longitude = 55.2630 WHERE code = 'VRM';  -- Virgin Reef Mall
UPDATE stores SET latitude = 25.1968, longitude = 55.2783 WHERE code = 'JDM';  -- Jashanmal Dubai Mall
UPDATE stores SET latitude = 25.1022, longitude = 55.2420 WHERE code = 'JDH';  -- Jashanmal Dubai Hills
UPDATE stores SET latitude = 25.1180, longitude = 55.2005 WHERE code = 'JME';  -- Jashanmal Mall of the Emirates
UPDATE stores SET latitude = 25.2275, longitude = 55.2836 WHERE code = 'BDM';  -- Borders Dubai Mall
UPDATE stores SET latitude = 25.3172, longitude = 55.3760 WHERE code = 'SDM';  -- Sharjah
UPDATE stores SET latitude = 25.0640, longitude = 55.1420 WHERE code = 'HDM';  -- Hessa Mall
UPDATE stores SET latitude = 24.4450, longitude = 54.6558 WHERE code = 'ADC';  -- Abu Dhabi
UPDATE stores SET latitude = 25.2532, longitude = 55.3657 WHERE code = 'AIR';  -- Airport
UPDATE stores SET latitude = 25.0770, longitude = 55.1430 WHERE code = 'IMG';  -- IMG Worlds

-- ── Qatar store coordinates ──
UPDATE stores_qa SET latitude = 25.3200, longitude = 51.4800 WHERE code = 'VDF';  -- Virgin Doha Festival City
UPDATE stores_qa SET latitude = 25.3190, longitude = 51.5140 WHERE code = 'VLM';  -- Virgin Landmark Mall
UPDATE stores_qa SET latitude = 25.3760, longitude = 51.4160 WHERE code = 'VMQ';  -- Virgin Mall of Qatar
UPDATE stores_qa SET latitude = 25.3540, longitude = 51.4480 WHERE code = 'VVD';  -- Virgin Villaggio
UPDATE stores_qa SET latitude = 25.2850, longitude = 51.5310 WHERE code = 'VVG';  -- Virgin Vendome Mall

-- NOTE: Update these coordinates with exact values from Google Maps!
-- Right-click on the store location > Copy coordinates
