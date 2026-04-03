// ============================================================
// Google Apps Script — Sync Qatar Data → Supabase
// ============================================================
// วิธีใช้:
// 1. เปิด Google Sheet ของ Qatar → Extensions → Apps Script
// 2. วาง code นี้ทั้งหมด
// 3. ใส่ Script Properties:
//    - SUPABASE_URL        → https://xxxxx.supabase.co
//    - SUPABASE_SERVICE_KEY → service_role key (ไม่ใช่ anon key)
//    - ORDERS_SHEET_ID     → (optional) ถ้าอ่านจาก Sheet อื่น ใส่ Sheet ID
//    - ORDERS_SHEET_NAME   → ชื่อ tab ที่มี order data (default: "Import Order")
//    - SCHEDULE_SHEET_NAME → ชื่อ tab ตารางกะ (default: "Schedule")
//    - STORES_SHEET_NAME   → ชื่อ tab stores (default: "Stores")
//    - PROMOTERS_SHEET_NAME→ ชื่อ tab promoters (default: "Promoters")
// 4. ตั้ง Trigger:
//    - Function: syncQatarAll
//    - Time-driven → Day timer → 11pm to midnight (UTC)
//      (= ตี 2 เวลาไทย GMT+7, หรือ ตี 3 เวลา UAE GMT+4)
//    หรือใช้ installTrigger() ข้างล่างเพื่อตั้ง trigger อัตโนมัติ
// ============================================================

var COUNTRY = 'QA';

// --- CONFIG ---
function getConfig() {
  var props = PropertiesService.getScriptProperties();
  return {
    SUPABASE_URL: props.getProperty('SUPABASE_URL'),
    SUPABASE_KEY: props.getProperty('SUPABASE_SERVICE_KEY'),
  };
}

// ============================================================
// Main: Sync Qatar orders to Supabase
// ============================================================
function syncQatarOrders() {
  var config = getConfig();
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in Script Properties');
  }

  var props = PropertiesService.getScriptProperties();
  var ordersSheetId = props.getProperty('ORDERS_SHEET_ID');
  var ordersTabName = props.getProperty('ORDERS_SHEET_NAME') || 'Import Order';

  var ss;
  if (ordersSheetId) {
    ss = SpreadsheetApp.openById(ordersSheetId);
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }

  var sheet = ss.getSheetByName(ordersTabName);
  if (!sheet) {
    throw new Error('Sheet tab "' + ordersTabName + '" not found');
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log('No data rows found in "' + ordersTabName + '"');
    return 0;
  }

  // Column mapping (0-indexed) — match Qatar sheet header order (A-V)
  // Date | Sold Time | Order ID | Name | Serial Number | SKU | Platform |
  // Warehouse | Lead | Nationality | Note (Resident / Tourist) | Salesperson |
  // Payment method | Transportation | Amount QAR | Amount USD |
  // Paid Amount AED | PMGY Expense | Delivery Expense | Commission | Comments | Status
  var COL = {
    DATE: 0,
    SOLD_TIME: 1,
    ORDER_ID: 2,
    NAME: 3,
    SERIAL_NUMBER: 4,
    SKU: 5,
    PLATFORM: 6,
    WAREHOUSE: 7,
    LEAD: 8,
    NATIONALITY: 9,
    NOTE: 10,
    SALESPERSON: 11,
    PAYMENT_METHOD: 12,
    TRANSPORTATION: 13,
    AMOUNT_QAR: 14,
    AMOUNT_USD: 15,
    PAID_AMOUNT_AED: 16,
    PMGY_EXPENSE: 17,
    DELIVERY_EXPENSE: 18,
    COMMISSION: 19,
    COMMENTS: 20,
    STATUS: 21,
  };

  var orders = [];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];

    var orderId = trimOrNull(row[COL.ORDER_ID]);
    if (!orderId) continue;

    var rawDate = row[COL.DATE];
    var dateStr = null;
    if (rawDate instanceof Date) {
      dateStr = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else if (rawDate) {
      var parsed = new Date(rawDate);
      if (!isNaN(parsed.getTime())) {
        dateStr = Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
    }

    if (!dateStr) {
      Logger.log('⚠ Row ' + (r + 1) + ': invalid date, skipping');
      continue;
    }

    orders.push({
      date: dateStr,
      sold_time: trimOrNull(row[COL.SOLD_TIME]),
      order_id: trimOrNull(row[COL.ORDER_ID]),
      name: trimOrNull(row[COL.NAME]),
      serial_number: trimOrNull(row[COL.SERIAL_NUMBER]),
      sku: trimOrNull(row[COL.SKU]),
      platform: trimOrNull(row[COL.PLATFORM]),
      warehouse: trimOrNull(row[COL.WAREHOUSE]),
      lead: trimOrNull(row[COL.LEAD]),
      nationality: trimOrNull(row[COL.NATIONALITY]),
      note: trimOrNull(row[COL.NOTE]),
      salesperson: trimOrNull(row[COL.SALESPERSON]),
      payment_method: trimOrNull(row[COL.PAYMENT_METHOD]),
      transportation: trimOrNull(row[COL.TRANSPORTATION]),
      amount_qar: parseNum(row[COL.AMOUNT_QAR]),
      amount_usd: parseNum(row[COL.AMOUNT_USD]),
      paid_amount_aed: parseNum(row[COL.PAID_AMOUNT_AED]),
      pmgy_expense: parseNum(row[COL.PMGY_EXPENSE]),
      delivery_expense: parseNum(row[COL.DELIVERY_EXPENSE]),
      commission: parseNum(row[COL.COMMISSION]),
      comments: trimOrNull(row[COL.COMMENTS]),
      status: trimOrNull(row[COL.STATUS]) || 'pending',
      country: COUNTRY,  // ← Qatar
    });
  }

  // Deduplicate by order_id
  var uniqueMap = {};
  for (var o = 0; o < orders.length; o++) {
    uniqueMap[orders[o].order_id] = orders[o];
  }
  var uniqueOrders = [];
  for (var key in uniqueMap) {
    uniqueOrders.push(uniqueMap[key]);
  }

  Logger.log('[Qatar] Total orders to upsert: ' + uniqueOrders.length + ' (deduped from ' + orders.length + ')');

  // Upsert in batches (on_conflict = order_id)
  var batchSize = 500;
  for (var i = 0; i < uniqueOrders.length; i += batchSize) {
    var batch = uniqueOrders.slice(i, i + batchSize);
    supabaseUpsert(config, '/rest/v1/orders_qa', batch, 'order_id');
    Logger.log('[Qatar] Upserted orders batch ' + (Math.floor(i / batchSize) + 1) + ' (' + batch.length + ' rows)');
  }

  Logger.log('✅ Qatar orders sync complete! ' + uniqueOrders.length + ' orders synced.');
  return uniqueOrders.length;
}

// ============================================================
// Supabase helpers
// ============================================================

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

// ============================================================
// String / Number helpers
// ============================================================

function trimOrNull(val) {
  if (val === null || val === undefined) return null;
  var s = String(val).trim();
  if (s === '' || s === '-' || s === '#N/A' || s === '#REF!' || s === '#VALUE!' || s === 'N/A') return null;
  return s;
}

function parseNum(val) {
  if (val === null || val === undefined || val === '') return null;
  var s = String(val).trim();
  if (s === '#N/A' || s === '#REF!' || s === '#VALUE!' || s === 'N/A' || s === '-') return null;
  s = s.replace(/^(dh|aed|usd|qar|\$)\s*/i, '');
  s = s.replace(/,/g, '');
  var n = Number(s);
  return isNaN(n) ? null : n;
}

// ============================================================
// Install daily trigger — ตี 2 เวลาไทย (GMT+7) = 19:00 UTC (วันก่อนหน้า)
// Google Apps Script ใช้ timezone ของ project
// ตั้ง project timezone เป็น Asia/Bangkok แล้วใช้ atHour(2)
// หรือตั้งเป็น UTC แล้วใช้ atHour(19)
// ============================================================
function installTrigger() {
  // ลบ trigger เก่าทั้งหมดของ syncQatarOrders ก่อน
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncQatarOrders') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // สร้าง trigger ใหม่: ทุกวัน ตี 2 (timezone ตาม project setting)
  // ⚠ ต้องตั้ง Project Settings → Time zone → Asia/Bangkok (UTC+7)
  ScriptApp.newTrigger('syncQatarOrders')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();

  Logger.log('✅ Trigger installed: syncQatarOrders runs daily at 2:00 AM (project timezone)');
}

// ============================================================
// Manual test
// ============================================================
function testSyncQatarOrders() {
  var count = syncQatarOrders();
  Logger.log('[Qatar] Synced ' + count + ' orders');
}
