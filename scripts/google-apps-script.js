// ============================================================
// Google Apps Script — Sync Google Sheet → Supabase
// ============================================================
// วิธีใช้:
// 1. เปิด Google Sheet → Extensions → Apps Script
// 2. วาง code นี้ทั้งหมด
// 3. ใส่ SUPABASE_URL และ SUPABASE_SERVICE_KEY ใน Script Properties
// 4. ตั้ง Trigger ให้รัน syncToSupabase() ทุกวัน 1:00 AM
// ============================================================

// --- CONFIG ---
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    SUPABASE_URL: props.getProperty('SUPABASE_URL'),       // e.g. https://xxxxx.supabase.co
    SUPABASE_KEY: props.getProperty('SUPABASE_SERVICE_KEY'), // service_role key (not anon)
    SHEET_NAME: props.getProperty('SHEET_NAME') || 'Schedule', // ชื่อ sheet tab
  };
}

// --- MAIN: Sync shift schedule to Supabase ---
function syncToSupabase() {
  const config = getConfig();
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in Script Properties');
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet "${config.SHEET_NAME}" not found`);
  }

  // --- 1. Read sheet data ---
  // Expected format:
  //   Row 1: Header → ["Name", "2024-03-01", "2024-03-02", ...]
  //   Row 2+: Data  → ["Kevin Ka", "VDM", "Off", "VME", ...]
  //   (cell value = store code or Off/LOP/SL)

  const data = sheet.getDataRange().getValues();
  const headers = data[0]; // first row = dates
  const dateColumns = []; // { colIndex, date }

  // Parse date columns (skip column 0 = Name)
  for (let c = 1; c < headers.length; c++) {
    const val = headers[c];
    const date = parseDateHeader(val);
    if (date) {
      dateColumns.push({ col: c, date: date });
    }
  }

  Logger.log(`Found ${dateColumns.length} date columns, ${data.length - 1} promoter rows`);

  // --- 2. Fetch promoter mapping from Supabase ---
  const promoters = supabaseGet(config, '/rest/v1/promoters?select=id,name');
  const promoterMap = {};
  promoters.forEach(function(p) {
    promoterMap[p.name.toLowerCase().trim()] = p.id;
  });

  // --- 3. Fetch store mapping ---
  const stores = supabaseGet(config, '/rest/v1/stores?select=id,code,open_time,close_time');
  const storeMap = {};
  stores.forEach(function(s) {
    storeMap[s.code.toUpperCase()] = s;
  });

  // --- 4. Build shift rows ---
  const shifts = [];
  const specialShifts = { 'OFF': true, 'LOP': true, 'SL': true };

  for (let r = 1; r < data.length; r++) {
    const promoterName = String(data[r][0]).trim();
    if (!promoterName) continue;

    const promoterId = promoterMap[promoterName.toLowerCase()];
    if (!promoterId) {
      Logger.log('⚠ Promoter not found in DB: ' + promoterName);
      continue;
    }

    for (let d = 0; d < dateColumns.length; d++) {
      var cellValue = String(data[r][dateColumns[d].col]).trim().toUpperCase();
      if (!cellValue || cellValue === '-' || cellValue === '') continue;

      var shiftType = cellValue;
      var timeRange = null;

      // If it's a store code, attach open-close time
      if (!specialShifts[shiftType] && storeMap[shiftType]) {
        var store = storeMap[shiftType];
        timeRange = store.open_time + '-' + store.close_time;
      }

      // Check for custom time in cell (e.g. "VDM 16:00-23:00")
      var parts = String(data[r][dateColumns[d].col]).trim().split(/\s+/);
      if (parts.length >= 2 && /\d{1,2}:\d{2}/.test(parts[1])) {
        shiftType = parts[0].toUpperCase();
        timeRange = parts.slice(1).join(' ');
      }

      shifts.push({
        promoter_id: promoterId,
        date: dateColumns[d].date,
        shift_type: shiftType,
        time_range: timeRange,
      });
    }
  }

  Logger.log('Total shifts to upsert: ' + shifts.length);

  // --- 5. Upsert to Supabase in batches ---
  var batchSize = 500;
  for (var i = 0; i < shifts.length; i += batchSize) {
    var batch = shifts.slice(i, i + batchSize);
    supabaseUpsert(config, '/rest/v1/shifts', batch, 'promoter_id,date');
    Logger.log('Upserted batch ' + (Math.floor(i / batchSize) + 1) + ' (' + batch.length + ' rows)');
  }

  Logger.log('✅ Sync complete! ' + shifts.length + ' shifts synced.');
  return shifts.length;
}

// --- HELPERS ---

// Parse date from header (handles Date objects, strings like "2024-03-01", "1 Mar", etc.)
function parseDateHeader(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var str = String(val).trim();
  // Try ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // Try parsing as date string
  var d = new Date(str);
  if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return null;
}

// Supabase GET
function supabaseGet(config, path) {
  var url = config.SUPABASE_URL + path;
  var response = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: {
      'apikey': config.SUPABASE_KEY,
      'Authorization': 'Bearer ' + config.SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Supabase GET failed: ' + response.getContentText());
  }
  return JSON.parse(response.getContentText());
}

// Supabase UPSERT (POST with Prefer: resolution=merge-duplicates)
function supabaseUpsert(config, path, rows, onConflict) {
  var url = config.SUPABASE_URL + path + '?on_conflict=' + onConflict;
  var response = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: {
      'apikey': config.SUPABASE_KEY,
      'Authorization': 'Bearer ' + config.SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true,
  });

  var code = response.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('Supabase UPSERT failed (' + code + '): ' + response.getContentText());
  }
}

// --- MANUAL TEST ---
// รันจาก Apps Script editor เพื่อทดสอบ
function testSync() {
  var count = syncToSupabase();
  Logger.log('Synced ' + count + ' shifts');
}

// --- OPTIONAL: Sync stores from another sheet tab ---
function syncStores() {
  var config = getConfig();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Stores');
  if (!sheet) {
    Logger.log('No "Stores" sheet found, skipping');
    return;
  }

  // Expected: Code | Name | Open | Close | Extra Allowance | Max Capacity
  var data = sheet.getDataRange().getValues();
  var stores = [];

  for (var r = 1; r < data.length; r++) {
    var code = String(data[r][0]).trim().toUpperCase();
    var name = String(data[r][1]).trim();
    if (!code || !name) continue;

    stores.push({
      code: code,
      name: name,
      open_time: String(data[r][2] || '10:00').trim(),
      close_time: String(data[r][3] || '22:00').trim(),
      extra_allowance: String(data[r][4] || '').trim() || null,
      max_capacity: data[r][5] ? Number(data[r][5]) : null,
      active: true,
    });
  }

  supabaseUpsert(config, '/rest/v1/stores', stores, 'code');
  Logger.log('✅ Synced ' + stores.length + ' stores');
}

// --- OPTIONAL: Sync promoters from another sheet tab ---
function syncPromoters() {
  var config = getConfig();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Promoters');
  if (!sheet) {
    Logger.log('No "Promoters" sheet found, skipping');
    return;
  }

  // Expected: Name | Day Off | Active
  var data = sheet.getDataRange().getValues();
  var promoters = [];

  for (var r = 1; r < data.length; r++) {
    var name = String(data[r][0]).trim();
    if (!name) continue;

    promoters.push({
      name: name,
      day_off: String(data[r][1] || '').trim() || null,
      active: data[r][2] !== false && data[r][2] !== 'FALSE',
    });
  }

  supabaseUpsert(config, '/rest/v1/promoters', promoters, 'name');
  Logger.log('✅ Synced ' + promoters.length + ' promoters');
}

// --- FULL SYNC: stores + promoters + shifts ---
function syncAll() {
  syncStores();
  syncPromoters();
  syncToSupabase();
  Logger.log('✅ Full sync complete!');
}
