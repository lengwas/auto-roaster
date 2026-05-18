// ============================================================
// Google Apps Script — Sync JotForm Sales Claims → Supabase
// ============================================================
// วิธีใช้:
// 1. เปิด Google Sheet "🇦🇪 UAE Paid Customers Details" → Extensions → Apps Script
// 2. วาง code นี้ทั้งหมด
// 3. ใส่ Script Properties (Project Settings → Script Properties):
//    - SUPABASE_URL = https://xxxxx.supabase.co
//    - SUPABASE_ANON_KEY = xxxxx  (ใช้ anon key — ไม่ใช่ service_role)
//    - GEMINI_API_KEY = xxxxx (for serial number OCR)
//    - SHEET_NAME = Form responses (default)
// 4. ตั้ง Trigger: syncClaimsToSupabase() ทุกวัน
// ============================================================

function getConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    SUPABASE_URL: props.getProperty('SUPABASE_URL'),
    SUPABASE_KEY: props.getProperty('SUPABASE_ANON_KEY'),
    GEMINI_KEY: props.getProperty('GEMINI_API_KEY'),
    SHEET_NAME: props.getProperty('SHEET_NAME') || 'Form responses',
  };
}

// --- Column indices (0-based, matching the xlsx header) ---
var COL = {
  TIMESTAMP: 0,      // submission datetime
  DATE: 1,           // date
  TIME: 2,           // time
  UNIQUE_ID: 3,      // "AE-000006"
  PROMOTER: 4,       // "Maureen Wa"
  BRANCH: 5,         // "VDM"
  GENDER: 6,         // "Male"
  NATIONALITY: 7,    // "India"
  VISA_TYPE: 8,      // "Tourist"
  AGE_RANGE: 9,      // "23 - 30"
  GROUP_TYPE: 10,     // "Family with elderly"
  NUM_LUGGAGE: 11,    // 1
  PRODUCT_LIST: 12,   // "Model: SE3S, Colour: Black"
  IMAGE_URLS: 13,     // JotForm image URLs (newline-separated)
  // 14-17 = IP, URL, Edit URL, Last Update Date
  SUBMISSION_ID: 18,  // JotForm submission ID
  // 20 = Duplicated flag
  DUPLICATED: 20,
};

// ============================================================
// MAIN: Sync claims
// ============================================================
function syncClaimsToSupabase() {
  var config = getConfig_();
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in Script Properties');
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + config.SHEET_NAME + '" not found');

  var data = sheet.getDataRange().getValues();
  Logger.log('Total rows (incl header): ' + data.length);

  // Fetch existing submission IDs to avoid re-processing
  var existing = supabaseGet_(config, '/rest/v1/sales_claims?select=submission_id');
  var existingIds = {};
  existing.forEach(function(r) { existingIds[r.submission_id] = true; });
  Logger.log('Existing claims in DB: ' + existing.length);

  var claims = [];
  var claimItems = [];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var submissionId = trimVal_(row[COL.SUBMISSION_ID]);
    if (!submissionId) continue;
    if (existingIds[submissionId]) continue; // already synced

    var dateVal = row[COL.DATE];
    var dateStr = formatDate_(dateVal);
    if (!dateStr) continue;

    var timeVal = row[COL.TIME];
    var timeStr = formatTime_(timeVal);

    var productList = trimVal_(row[COL.PRODUCT_LIST]) || '';
    var imageUrls = trimVal_(row[COL.IMAGE_URLS]) || '';
    var numLuggage = parseInt(row[COL.NUM_LUGGAGE]) || 0;
    var duplicated = trimVal_(row[COL.DUPLICATED]);

    var claim = {
      submission_id: submissionId,
      unique_id: trimVal_(row[COL.UNIQUE_ID]),
      date: dateStr,
      time: timeStr,
      promoter_name: trimVal_(row[COL.PROMOTER]),
      branch: trimVal_(row[COL.BRANCH]),
      customer_gender: trimVal_(row[COL.GENDER]),
      nationality: trimVal_(row[COL.NATIONALITY]),
      visa_type: trimVal_(row[COL.VISA_TYPE]),
      age_range: trimVal_(row[COL.AGE_RANGE]),
      group_type: trimVal_(row[COL.GROUP_TYPE]),
      number_of_luggage: numLuggage,
      product_list: productList,
      image_urls: imageUrls,
      duplicated: duplicated ? true : false,
      status: 'pending',
    };

    claims.push(claim);

    // Parse product_list into individual items
    var products = parseProductList_(productList);
    var images = imageUrls ? imageUrls.split('\n').map(function(s) { return s.trim(); }).filter(Boolean) : [];

    for (var i = 0; i < products.length; i++) {
      claimItems.push({
        _submission_id: submissionId, // temp key for linking after insert
        item_index: i,
        model: products[i].model,
        colour: products[i].colour,
        sku: resolveProductSku_(products[i].model, products[i].colour),
        image_url: images[i] || null,
        ocr_status: images[i] ? 'pending' : 'manual',
      });
    }
  }

  // --- Deduplicate by submission_id (keep last occurrence) ---
  var claimMap = {};
  for (var ci = 0; ci < claims.length; ci++) {
    claimMap[claims[ci].submission_id] = claims[ci];
  }
  claims = Object.keys(claimMap).map(function(k) { return claimMap[k]; });

  // Rebuild claimItems to only include deduplicated claims
  var validIds = {};
  claims.forEach(function(c) { validIds[c.submission_id] = true; });
  claimItems = claimItems.filter(function(it) { return validIds[it._submission_id]; });

  Logger.log('New claims to sync: ' + claims.length + ' (' + claimItems.length + ' items)');

  if (claims.length === 0) {
    Logger.log('No new claims. Done.');
    return;
  }

  // --- Batch upsert claims ---
  var BATCH = 200;
  for (var i = 0; i < claims.length; i += BATCH) {
    var batch = claims.slice(i, i + BATCH);
    supabaseUpsert_(config, '/rest/v1/sales_claims?on_conflict=submission_id', batch);
    Logger.log('  Claims batch ' + (Math.floor(i / BATCH) + 1) + ': ' + batch.length + ' upserted');
  }

  // --- Fetch back inserted claim IDs (batched to avoid URL length limit) ---
  var submissionIds = claims.map(function(c) { return c.submission_id; });
  var claimIdMap = {};
  var FETCH_BATCH = 50;
  for (var fi = 0; fi < submissionIds.length; fi += FETCH_BATCH) {
    var idSlice = submissionIds.slice(fi, fi + FETCH_BATCH);
    var inserted = supabaseGet_(config,
      '/rest/v1/sales_claims?select=id,submission_id&submission_id=in.(' + idSlice.join(',') + ')'
    );
    inserted.forEach(function(c) { claimIdMap[c.submission_id] = c.id; });
  }

  // --- Link items to claim IDs and insert ---
  var itemRows = [];
  for (var j = 0; j < claimItems.length; j++) {
    var item = claimItems[j];
    var claimId = claimIdMap[item._submission_id];
    if (!claimId) continue;
    itemRows.push({
      claim_id: claimId,
      item_index: item.item_index,
      model: item.model,
      colour: item.colour,
      sku: item.sku,
      image_url: item.image_url,
      ocr_status: item.ocr_status,
    });
  }

  for (var k = 0; k < itemRows.length; k += BATCH) {
    var itemBatch = itemRows.slice(k, k + BATCH);
    supabasePost_(config, '/rest/v1/sales_claim_items', itemBatch);
    Logger.log('  Items batch ' + (Math.floor(k / BATCH) + 1) + ': ' + itemBatch.length + ' inserted');
  }

  Logger.log('✅ Claims sync complete! ' + claims.length + ' claims, ' + itemRows.length + ' items.');

  // Trigger Vercel OCR to process serial numbers from images
  var vercelUrl = PropertiesService.getScriptProperties().getProperty('VERCEL_APP_URL');
  if (vercelUrl && itemRows.length > 0) {
    Logger.log('Triggering Vercel OCR for ' + itemRows.length + ' items...');
    try {
      var ocrResp = UrlFetchApp.fetch(vercelUrl + '/api/ocr-serial', {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify({ limit: 50 }),
        muteHttpExceptions: true,
      });
      Logger.log('OCR response: ' + ocrResp.getContentText().slice(0, 300));
    } catch (e) {
      Logger.log('OCR trigger failed (non-blocking): ' + e.message);
    }
  }
}

// ============================================================
// OCR: Extract serial numbers from JotForm images via Gemini
// ============================================================
function runOcrForPendingItems_(config) {
  // Fetch items that need OCR
  var pending = supabaseGet_(config,
    '/rest/v1/sales_claim_items?select=id,image_url&ocr_status=eq.pending&image_url=not.is.null&limit=50'
  );
  Logger.log('OCR pending items: ' + pending.length);

  for (var i = 0; i < pending.length; i++) {
    var item = pending[i];
    try {
      var serial = extractSerialFromImage_(config.GEMINI_KEY, item.image_url);
      supabasePatch_(config, '/rest/v1/sales_claim_items?id=eq.' + item.id, {
        serial_number: serial || null,
        ocr_status: serial ? 'success' : 'failed',
        ocr_raw: serial || 'no serial found',
      });
      Logger.log('  OCR ' + item.id.slice(0, 8) + ': ' + (serial || 'FAILED'));
    } catch (e) {
      Logger.log('  OCR error for ' + item.id.slice(0, 8) + ': ' + e.message);
      supabasePatch_(config, '/rest/v1/sales_claim_items?id=eq.' + item.id, {
        ocr_status: 'failed',
        ocr_raw: 'Error: ' + e.message,
      });
    }
    // Rate limiting
    Utilities.sleep(1000);
  }
}

function extractSerialFromImage_(apiKey, imageUrl) {
  // Download image
  var imageResp = UrlFetchApp.fetch(imageUrl, { muteHttpExceptions: true });
  if (imageResp.getResponseCode() !== 200) {
    throw new Error('Failed to download image: HTTP ' + imageResp.getResponseCode());
  }
  var imageBlob = imageResp.getBlob();
  var base64 = Utilities.base64Encode(imageBlob.getBytes());
  var mimeType = imageBlob.getContentType() || 'image/jpeg';

  // Call Gemini Vision
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;
  var payload = {
    contents: [{
      parts: [
        { text: 'Extract the serial number from this luggage/product image. Return ONLY the serial number text (alphanumeric string), nothing else. If no serial number is visible, return "NONE".' },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }]
  };

  var resp = UrlFetchApp.fetch(url, {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error('Gemini API error: ' + resp.getContentText().slice(0, 200));
  }

  var result = JSON.parse(resp.getContentText());
  var text = '';
  try {
    text = result.candidates[0].content.parts[0].text.trim();
  } catch (e) {
    return null;
  }

  if (!text || text === 'NONE' || text.toLowerCase().includes('no serial')) return null;
  // Clean up — remove quotes, whitespace
  return text.replace(/['"]/g, '').trim();
}

// ============================================================
// Parse "Model: SE3S, Colour: Black\nModel: SE3SL, Colour: Silver"
// ============================================================
function parseProductList_(text) {
  if (!text) return [];
  var lines = text.split('\n');
  var items = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var model = '';
    var colour = '';
    var modelMatch = line.match(/Model:\s*([^,]+)/i);
    if (modelMatch) model = modelMatch[1].trim();
    var colourMatch = line.match(/Colo(?:u)?r:\s*(.+)/i);
    if (colourMatch) colour = colourMatch[1].trim();
    if (model) items.push({ model: model, colour: colour });
  }
  return items;
}

// ============================================================
// Resolve model+colour to a normalized SKU
// ============================================================
function resolveProductSku_(model, colour) {
  if (!model) return null;
  var m = model.toUpperCase().replace(/\s+/g, '');
  var c = (colour || '').toUpperCase().replace(/\s+/g, '').slice(0, 4);
  var colourMap = {
    'BLACK': 'BK', 'SILVER': 'SLV', 'PINK': 'PK', 'BLUE': 'BLU',
    'WHITE': 'WH', 'RED': 'RD', 'GREEN': 'GN', 'GREY': 'GRY', 'GRAY': 'GRY',
  };
  var abbr = colourMap[c] || c;
  return m + (abbr ? '_' + abbr : '');
}

// ============================================================
// Date/time helpers
// ============================================================
function formatDate_(val) {
  if (!val) return null;
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Dubai', 'yyyy-MM-dd');
  var d = new Date(val);
  return isNaN(d.getTime()) ? null : Utilities.formatDate(d, 'Asia/Dubai', 'yyyy-MM-dd');
}

function formatTime_(val) {
  if (!val) return null;
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Dubai', 'HH:mm');
  var s = String(val).trim();
  if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
  return null;
}

function trimVal_(val) {
  if (val === null || val === undefined) return null;
  var s = String(val).trim();
  return (s === '' || s === '#N/A' || s === 'undefined') ? null : s;
}

// ============================================================
// Supabase REST helpers
// ============================================================
function supabaseGet_(config, path) {
  var resp = UrlFetchApp.fetch(config.SUPABASE_URL + path, {
    method: 'GET',
    headers: {
      'apikey': config.SUPABASE_KEY,
      'Authorization': 'Bearer ' + config.SUPABASE_KEY,
    },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Supabase GET ' + path + ' failed: ' + resp.getContentText().slice(0, 300));
  }
  return JSON.parse(resp.getContentText());
}

function supabaseUpsert_(config, path, rows) {
  var resp = UrlFetchApp.fetch(config.SUPABASE_URL + path, {
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
  if (resp.getResponseCode() >= 400) {
    throw new Error('Supabase UPSERT failed: ' + resp.getContentText().slice(0, 300));
  }
}

function supabasePost_(config, path, rows) {
  var resp = UrlFetchApp.fetch(config.SUPABASE_URL + path, {
    method: 'POST',
    headers: {
      'apikey': config.SUPABASE_KEY,
      'Authorization': 'Bearer ' + config.SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 400) {
    throw new Error('Supabase POST failed: ' + resp.getContentText().slice(0, 300));
  }
}

function supabasePatch_(config, path, data) {
  var resp = UrlFetchApp.fetch(config.SUPABASE_URL + path, {
    method: 'PATCH',
    headers: {
      'apikey': config.SUPABASE_KEY,
      'Authorization': 'Bearer ' + config.SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    payload: JSON.stringify(data),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 400) {
    throw new Error('Supabase PATCH failed: ' + resp.getContentText().slice(0, 300));
  }
}

// ============================================================
// Auto-trigger setup
// ============================================================
function createDailyTrigger() {
  // Remove existing triggers for this function
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncClaimsToSupabase') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // Run daily at 11pm-midnight UAE time
  ScriptApp.newTrigger('syncClaimsToSupabase')
    .timeBased()
    .atHour(23)
    .everyDays(1)
    .inTimezone('Asia/Dubai')
    .create();
  Logger.log('Daily trigger created for syncClaimsToSupabase');
}
