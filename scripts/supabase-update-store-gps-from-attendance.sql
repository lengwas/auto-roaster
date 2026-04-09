-- ============================================================
-- Extract GPS coordinates from attendance records and update stores
-- Parses "Coordinates : (lat, lng)" from ocr_raw_text
-- Uses the AVERAGE of all check-ins per store for accuracy
-- Run this in Supabase SQL Editor
-- ============================================================

-- Step 1: Preview — see what coordinates we can extract per store
WITH parsed AS (
  SELECT
    store_code,
    -- Extract lat from "Coordinates :  (25.1965489, 55.2787634)" pattern
    CAST(
      regexp_replace(
        substring(ocr_raw_text FROM 'Coordinates\s*:\s*\(([0-9]+\.[0-9]+),\s*[0-9]+\.[0-9]+\)'),
        '^\s+|\s+$', '', 'g'
      ) AS DOUBLE PRECISION
    ) AS lat,
    CAST(
      regexp_replace(
        substring(ocr_raw_text FROM 'Coordinates\s*:\s*\([0-9]+\.[0-9]+,\s*([0-9]+\.[0-9]+)\)'),
        '^\s+|\s+$', '', 'g'
      ) AS DOUBLE PRECISION
    ) AS lng
  FROM attendance
  WHERE store_code IS NOT NULL
    AND ocr_raw_text LIKE '%Coordinates%'
)
SELECT
  store_code,
  ROUND(AVG(lat)::numeric, 7) AS avg_lat,
  ROUND(AVG(lng)::numeric, 7) AS avg_lng,
  COUNT(*) AS sample_count
FROM parsed
WHERE lat IS NOT NULL AND lng IS NOT NULL
GROUP BY store_code
ORDER BY store_code;

-- Step 2: Actually update stores (uncomment and run after reviewing Step 1)
/*
WITH parsed AS (
  SELECT
    store_code,
    CAST(
      regexp_replace(
        substring(ocr_raw_text FROM 'Coordinates\s*:\s*\(([0-9]+\.[0-9]+),\s*[0-9]+\.[0-9]+\)'),
        '^\s+|\s+$', '', 'g'
      ) AS DOUBLE PRECISION
    ) AS lat,
    CAST(
      regexp_replace(
        substring(ocr_raw_text FROM 'Coordinates\s*:\s*\([0-9]+\.[0-9]+,\s*([0-9]+\.[0-9]+)\)'),
        '^\s+|\s+$', '', 'g'
      ) AS DOUBLE PRECISION
    ) AS lng
  FROM attendance
  WHERE store_code IS NOT NULL
    AND ocr_raw_text LIKE '%Coordinates%'
),
avg_coords AS (
  SELECT
    store_code,
    AVG(lat) AS avg_lat,
    AVG(lng) AS avg_lng,
    COUNT(*) AS sample_count
  FROM parsed
  WHERE lat IS NOT NULL AND lng IS NOT NULL
  GROUP BY store_code
)
UPDATE stores s
SET
  latitude = ac.avg_lat,
  longitude = ac.avg_lng
FROM avg_coords ac
WHERE s.code = ac.store_code;
*/

-- Step 3: For Qatar (uncomment if needed)
/*
WITH parsed AS (
  SELECT
    store_code,
    CAST(
      regexp_replace(
        substring(ocr_raw_text FROM 'Coordinates\s*:\s*\(([0-9]+\.[0-9]+),\s*[0-9]+\.[0-9]+\)'),
        '^\s+|\s+$', '', 'g'
      ) AS DOUBLE PRECISION
    ) AS lat,
    CAST(
      regexp_replace(
        substring(ocr_raw_text FROM 'Coordinates\s*:\s*\([0-9]+\.[0-9]+,\s*([0-9]+\.[0-9]+)\)'),
        '^\s+|\s+$', '', 'g'
      ) AS DOUBLE PRECISION
    ) AS lng
  FROM attendance_qa
  WHERE store_code IS NOT NULL
    AND ocr_raw_text LIKE '%Coordinates%'
),
avg_coords AS (
  SELECT
    store_code,
    AVG(lat) AS avg_lat,
    AVG(lng) AS avg_lng,
    COUNT(*) AS sample_count
  FROM parsed
  WHERE lat IS NOT NULL AND lng IS NOT NULL
  GROUP BY store_code
)
UPDATE stores_qa s
SET
  latitude = ac.avg_lat,
  longitude = ac.avg_lng
FROM avg_coords ac
WHERE s.code = ac.store_code;
*/

-- Step 4: Verify results
-- SELECT code, name, latitude, longitude FROM stores WHERE latitude IS NOT NULL ORDER BY code;
-- SELECT code, name, latitude, longitude FROM stores_qa WHERE latitude IS NOT NULL ORDER BY code;
