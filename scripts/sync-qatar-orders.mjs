#!/usr/bin/env node
// ============================================================
// Node.js — Sync Qatar Orders from Google Sheet → Supabase
// ============================================================
// วิธีใช้:
// 1. npm install googleapis   (ครั้งเดียว ใน folder scripts/)
// 2. สร้าง Google Service Account:
//    - Google Cloud Console → APIs & Services → Credentials
//    - Create Service Account → Download JSON key
//    - วางไฟล์เป็น scripts/service-account.json
//    - Share Qatar Google Sheet ให้ email ของ service account (Viewer)
// 3. สร้างไฟล์ scripts/.env:
//    SUPABASE_URL=https://xxxxx.supabase.co
//    SUPABASE_SERVICE_KEY=xxxxx
//    SHEET_ID=xxxxx  (ID จาก URL ของ Google Sheet)
//    SHEET_TAB=Import Order
// 4. รัน: node scripts/sync-qatar-orders.mjs
// ============================================================

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Load .env manually (no dotenv dependency) ---
function loadEnv() {
  const envPath = resolve(__dirname, '.env');
  if (!existsSync(envPath)) {
    console.error('Missing scripts/.env file. See instructions at top of this file.');
    process.exit(1);
  }
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
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
const SHEET_ID = process.env.SHEET_ID;
const SHEET_TAB = process.env.SHEET_TAB || 'Import Order';

if (!SUPABASE_URL || !SUPABASE_KEY || !SHEET_ID) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, SHEET_ID');
  process.exit(1);
}

// --- Google Sheets via Service Account ---
const { google } = await import('googleapis');

const saPath = resolve(__dirname, 'service-account.json');
if (!existsSync(saPath)) {
  console.error('Missing scripts/service-account.json (Google Service Account key).');
  console.error('See instructions at top of this file.');
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  keyFile: saPath,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

console.log(`[Qatar] Reading sheet ${SHEET_ID} tab "${SHEET_TAB}"...`);
const res = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: `'${SHEET_TAB}'`,
});

const rows = res.data.values;
if (!rows || rows.length < 2) {
  console.log('[Qatar] No data rows found.');
  process.exit(0);
}

// --- Column mapping (0-indexed, A-V) ---
const COL = {
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

function trimOrNull(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s === '' || s === '-' || s === '#N/A' || s === '#REF!' || s === '#VALUE!' || s === 'N/A') return null;
  return s;
}

function parseNum(val) {
  if (val === null || val === undefined || val === '') return null;
  let s = String(val).trim();
  if (s === '#N/A' || s === '#REF!' || s === '#VALUE!' || s === 'N/A' || s === '-') return null;
  s = s.replace(/^(dh|aed|usd|qar|\$)\s*/i, '');
  s = s.replace(/,/g, '');
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function parseDate(val) {
  if (!val) return null;
  // Try ISO-like: 2025-01-15 or 01/15/2025
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0]; // yyyy-MM-dd
}

// --- Parse rows ---
const orders = [];
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  const orderId = trimOrNull(row[COL.ORDER_ID]);
  if (!orderId) continue;

  const dateStr = parseDate(row[COL.DATE]);
  if (!dateStr) {
    console.warn(`  ⚠ Row ${r + 1}: invalid date, skipping`);
    continue;
  }

  orders.push({
    date: dateStr,
    sold_time: trimOrNull(row[COL.SOLD_TIME]),
    order_id: orderId,
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
    country: 'QA',
  });
}

// --- Deduplicate ---
const uniqueMap = new Map();
for (const o of orders) uniqueMap.set(o.order_id, o);
const uniqueOrders = [...uniqueMap.values()];

console.log(`[Qatar] ${uniqueOrders.length} orders to upsert (deduped from ${orders.length})`);

// --- Upsert to Supabase ---
const BATCH_SIZE = 500;
for (let i = 0; i < uniqueOrders.length; i += BATCH_SIZE) {
  const batch = uniqueOrders.slice(i, i + BATCH_SIZE);
  const url = `${SUPABASE_URL}/rest/v1/orders_qa?on_conflict=order_id`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(batch),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error(`Supabase UPSERT failed (${resp.status}): ${text}`);
    process.exit(1);
  }
  console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} rows upserted`);
}

console.log(`✅ Qatar orders sync complete! ${uniqueOrders.length} orders synced.`);
