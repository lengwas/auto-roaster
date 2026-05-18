#!/usr/bin/env node
// ============================================================
// Import vendor monthly reports → Supabase vendor_report_lines
// ============================================================
// วิธีใช้:
//   node scripts/import-vendor-report.mjs --vendor virgin --file "Virgin UAE (monthly).xlsx"
//   node scripts/import-vendor-report.mjs --vendor jashanmal --file "Jashanmal UAE (monthly).xlsx"
//   node scripts/import-vendor-report.mjs --vendor hamleys --file "Hamleys UAE (monthly).csv"
//
// ต้องติดตั้ง: npm install xlsx  (ครั้งเดียว ใน folder scripts/)
// .env ต้องมี: SUPABASE_URL, SUPABASE_SERVICE_KEY
// ============================================================

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = resolve(__dirname, '.env');
  if (!existsSync(envPath)) {
    console.error('Missing scripts/.env');
    process.exit(1);
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf('--' + name);
  return idx !== -1 ? args[idx + 1] : null;
}

const vendor = (getArg('vendor') || '').toLowerCase();
const filePath = getArg('file');

if (!vendor || !filePath) {
  console.error('Usage: node import-vendor-report.mjs --vendor <virgin|jashanmal|hamleys> --file <path>');
  process.exit(1);
}

if (!existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

// --- Load xlsx/csv ---
const XLSX = await import('xlsx');
const workbook = XLSX.readFile(filePath);

// --- Fetch vendor_store_map for resolving store codes ---
async function fetchStoreMap() {
  const url = `${SUPABASE_URL}/rest/v1/vendor_store_map?vendor=eq.${vendor}&select=vendor_store_id,store_code`;
  const resp = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!resp.ok) throw new Error(`Failed to fetch store map: ${await resp.text()}`);
  const rows = await resp.json();
  const map = {};
  for (const r of rows) map[r.vendor_store_id] = r.store_code;
  return map;
}

const storeMap = await fetchStoreMap();
console.log(`[${vendor}] Store map loaded: ${Object.keys(storeMap).length} entries`);

// --- Normalize SKU from item description ---
function normalizeSku(desc) {
  if (!desc) return null;
  // Try to extract model_colour pattern
  // e.g. "AIRWHEEL SE3S BLACK" → "SE3S_BK"
  // e.g. "1013096 - SQ3-PINK - AIRWHEEL SQ3 KIDS..." → "SQ3_PK"
  const colourMap = {
    BLACK: 'BK', SILVER: 'SLV', PINK: 'PK', BLUE: 'BLU',
    WHITE: 'WH', RED: 'RD', GREEN: 'GN', GREY: 'GRY', GRAY: 'GRY',
  };
  const upper = desc.toUpperCase();
  // Known models
  const models = ['SE3SL', 'SE3MINIT', 'SE3S', 'SQ3S', 'SQ3', 'SR5', 'SR6', 'SE3T'];
  let model = null;
  for (const m of models) {
    if (upper.includes(m)) { model = m; break; }
  }
  if (!model) return null;
  let colour = null;
  for (const [c, abbr] of Object.entries(colourMap)) {
    if (upper.includes(c)) { colour = abbr; break; }
  }
  return model + (colour ? '_' + colour : '');
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  const s = String(val).trim();
  // Try dd/MM/yyyy
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Try yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Try as Date
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

function reportMonth(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : null;
}

// ============================================================
// VIRGIN parser
// ============================================================
function parseVirgin(wb) {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  const lines = [];
  for (const row of rows) {
    const date = parseDate(row['SalesDate']);
    if (!date) continue;
    const vendorStoreId = String(row['Store'] || '').trim();
    const storeCode = storeMap[vendorStoreId] || null;
    const qty = Number(row['Qty'] || 0);
    const price = Number(row['Virgin Selling Price Value'] || 0);
    lines.push({
      vendor: 'virgin',
      report_month: reportMonth(date),
      date,
      vendor_store_id: vendorStoreId,
      store_code: storeCode,
      item_description: String(row['Item Description'] || ''),
      item_code: String(row['UPC'] || ''),
      sku: normalizeSku(String(row['Item Description'] || '')),
      upc: String(row['UPC'] || ''),
      quantity: qty,
      selling_price: qty !== 0 ? Math.abs(price / qty) : price,
      total_value: price,
      trans_type: qty < 0 ? 'return' : 'sale',
      receipt_no: null,
      raw_data: JSON.stringify(row),
    });
  }
  return lines;
}

// ============================================================
// JASHANMAL parser — uses "Item Wise Sale" sheet
// ============================================================
function parseJashanmal(wb) {
  const sheet = wb.Sheets['Item Wise Sale'];
  if (!sheet) throw new Error('Sheet "Item Wise Sale" not found');
  const rows = XLSX.utils.sheet_to_json(sheet, { range: 1 }); // skip header row 0 (metadata)
  const lines = [];
  for (const row of rows) {
    const date = parseDate(row['Transaction Date']);
    if (!date) continue;
    const storeName = String(row['Store Name'] || '').trim();
    const storeCode = storeMap[storeName] || null;
    const qty = Number(row['Qty'] || 0);
    const saleValue = Number(row['Sale Value'] || 0);
    const transType = String(row['Trans Type'] || '').toUpperCase();
    lines.push({
      vendor: 'jashanmal',
      report_month: reportMonth(date),
      date,
      vendor_store_id: storeName,
      store_code: storeCode,
      item_description: String(row['Item Desc'] || ''),
      item_code: String(row['Item Code/Line'] || ''),
      sku: normalizeSku(String(row['Item Desc'] || '')),
      upc: String(row['Barcode'] || row['User Barcode'] || ''),
      quantity: qty,
      selling_price: qty !== 0 ? Math.abs(saleValue / qty) : Math.abs(saleValue),
      total_value: saleValue,
      trans_type: transType === 'RETURN' ? 'return' : 'sale',
      sales_rep: String(row['Sales Rep '] || row['Sales Rep'] || '').trim() || null,
      receipt_no: String(row['Transaction No'] || '').trim() || null,
      raw_data: JSON.stringify(row),
    });
  }
  return lines;
}

// ============================================================
// HAMLEYS parser
// ============================================================
function parseHamleys(wb) {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  const lines = [];
  for (const row of rows) {
    const date = parseDate(row['Date']);
    if (!date) continue;
    const vendorStoreId = String(row['Store No_'] || '').trim();
    const storeCode = storeMap[vendorStoreId] || null;
    const qty = Number(row['Quantity'] || 0);
    const price = Number(row['Vendor Retail Price Ex_ VAT'] || row['Vendor Retail Price Ex. VAT'] || 0);
    const commPct = Number(row['Commission %'] || 0);
    const commAmt = Number(row['Commission'] || 0);
    lines.push({
      vendor: 'hamleys',
      report_month: reportMonth(date),
      date,
      vendor_store_id: vendorStoreId,
      store_code: storeCode,
      item_description: String(row['Item Description'] || ''),
      item_code: String(row['Item No_'] || ''),
      sku: normalizeSku(String(row['Item Description'] || '')),
      upc: null,
      quantity: qty,
      selling_price: price,
      total_value: qty * price,
      trans_type: qty < 0 ? 'return' : 'sale',
      receipt_no: String(row['Receipt No_'] || '').trim() || null,
      vendor_commission_pct: commPct || null,
      vendor_commission_amt: commAmt || null,
      raw_data: JSON.stringify(row),
    });
  }
  return lines;
}

// --- Parse based on vendor ---
const PARSERS = { virgin: parseVirgin, jashanmal: parseJashanmal, hamleys: parseHamleys };
const parser = PARSERS[vendor];
if (!parser) {
  console.error(`Unknown vendor: ${vendor}. Supported: ${Object.keys(PARSERS).join(', ')}`);
  process.exit(1);
}

console.log(`[${vendor}] Parsing ${filePath}...`);
const lines = parser(workbook);
console.log(`[${vendor}] Parsed ${lines.length} lines`);

// Warn about unmapped stores
const unmapped = new Set();
for (const l of lines) {
  if (!l.store_code && l.vendor_store_id) unmapped.add(l.vendor_store_id);
}
if (unmapped.size > 0) {
  console.warn(`⚠ Unmapped vendor stores: ${[...unmapped].join(', ')}`);
  console.warn('  → Add mappings to vendor_store_map table');
}

// Summary
const sales = lines.filter(l => l.trans_type === 'sale');
const returns = lines.filter(l => l.trans_type === 'return');
console.log(`  Sales: ${sales.length}, Returns: ${returns.length}`);
console.log(`  Total sales qty: ${sales.reduce((s, l) => s + l.quantity, 0)}`);
console.log(`  Total return qty: ${returns.reduce((s, l) => s + l.quantity, 0)}`);

// --- Upsert to Supabase ---
const BATCH_SIZE = 500;
for (let i = 0; i < lines.length; i += BATCH_SIZE) {
  const batch = lines.slice(i, i + BATCH_SIZE);
  const url = `${SUPABASE_URL}/rest/v1/vendor_report_lines`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(batch),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error(`Supabase POST failed (${resp.status}): ${text}`);
    process.exit(1);
  }
  console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} rows inserted`);
}

console.log(`✅ ${vendor} report imported! ${lines.length} lines.`);
