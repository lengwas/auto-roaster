#!/usr/bin/env node
// ============================================================
// Node.js — Sync Thailand Orders from Zort API → Supabase
// ============================================================
// วิธีใช้:
// 1. สร้างไฟล์ scripts/.env (ถ้ายังไม่มี) แล้วเพิ่ม:
//    SUPABASE_URL=https://xxxxx.supabase.co
//    SUPABASE_SERVICE_KEY=xxxxx
//    ZORT_STORE_NAME=xxxxx
//    ZORT_API_KEY=xxxxx
//    ZORT_API_SECRET=xxxxx
// 2. รัน: node scripts/sync-thailand-orders.mjs
//    (optional) --days 90   ← ดึงย้อนหลังกี่วัน (default 90)
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
const ZORT_STORE_NAME = process.env.ZORT_STORE_NAME;
const ZORT_API_KEY = process.env.ZORT_API_KEY;
const ZORT_API_SECRET = process.env.ZORT_API_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY');
  process.exit(1);
}
if (!ZORT_STORE_NAME || !ZORT_API_KEY || !ZORT_API_SECRET) {
  console.error('Missing required env vars: ZORT_STORE_NAME, ZORT_API_KEY, ZORT_API_SECRET');
  process.exit(1);
}

// --- CLI args ---
const args = process.argv.slice(2);
let daysBack = 90;
const daysIdx = args.indexOf('--days');
if (daysIdx !== -1 && args[daysIdx + 1]) {
  daysBack = parseInt(args[daysIdx + 1], 10) || 90;
}

// --- Zort API helpers ---
const ZORT_BASE = 'https://api.zortout.com/api.aspx';
const ZORT_PAGE_LIMIT = 2000; // Zort max per page

function fmtDate(d) {
  return d.toISOString().split('T')[0]; // yyyy-MM-dd
}

async function fetchZortOrders(fromDate, toDate) {
  const allOrders = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      method: 'GETORDERS',
      version: '3',
      orderdateafter: fromDate,
      orderdatebefore: toDate,
      limit: String(ZORT_PAGE_LIMIT),
      page: String(page),
    });

    const url = `${ZORT_BASE}?${params}`;
    console.log(`  [Zort] Fetching page ${page} (${fromDate} → ${toDate})...`);

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'storename': ZORT_STORE_NAME,
        'apikey': ZORT_API_KEY,
        'apisecret': ZORT_API_SECRET,
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`Zort API error (${resp.status}): ${text}`);
      process.exit(1);
    }

    const data = await resp.json();

    if (data.resCode && data.resCode !== 200) {
      console.error(`Zort API error: ${data.resDesc || JSON.stringify(data)}`);
      process.exit(1);
    }

    const orders = data.list || [];
    allOrders.push(...orders);

    const totalCount = data.count || 0;
    console.log(`  [Zort] Page ${page}: ${orders.length} orders (total: ${totalCount})`);

    if (allOrders.length >= totalCount || orders.length < ZORT_PAGE_LIMIT) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return allOrders;
}

// --- Map Zort order to orders_th row ---
function mapZortOrder(zortOrder) {
  const orderDate = zortOrder.orderdate
    ? zortOrder.orderdate.split(' ')[0] // "yyyy-MM-dd HH:mm" → "yyyy-MM-dd"
    : null;

  if (!orderDate) return null;

  const orderId = zortOrder.ordernumber || zortOrder.id;
  if (!orderId) return null;

  // Extract salesperson from agent or properties
  const salesperson = zortOrder.agent?.name || null;

  // Extract warehouse code
  const warehouse = zortOrder.warehousecode || zortOrder.warehousename || null;

  // Amount
  const amount = zortOrder.netamount != null ? Number(zortOrder.netamount) : null;

  // Status mapping
  let status = 'pending';
  const zortStatus = String(zortOrder.status || '').toLowerCase();
  if (zortStatus === 'completed' || zortStatus === 'complete') status = 'completed';
  else if (zortStatus === 'cancelled' || zortStatus === 'canceled' || zortStatus === 'void') status = 'cancelled';
  else if (zortStatus === 'returned') status = 'returned';

  // Extract first product name + SKU from line items
  const firstItem = (zortOrder.list || [])[0];
  const name = firstItem?.name || null;
  const sku = firstItem?.sku || null;

  // Platform / sales channel
  const platform = zortOrder.integrationName || zortOrder.saleschannel || null;

  return {
    date: orderDate,
    order_id: String(orderId),
    name,
    sku,
    platform,
    warehouse,
    salesperson,
    amount_thb: amount,
    paid_amount_aed: zortOrder.paymentamount != null ? Number(zortOrder.paymentamount) : null,
    status,
    country: 'TH',
  };
}

// --- Main ---
const fromDt = new Date();
fromDt.setDate(fromDt.getDate() - daysBack);
const fromDate = fmtDate(fromDt);
const toDate = fmtDate(new Date());

console.log(`[Thailand] Fetching Zort orders from ${fromDate} to ${toDate} (${daysBack} days)...`);

const zortOrders = await fetchZortOrders(fromDate, toDate);

// Map and filter
const orders = [];
for (const zo of zortOrders) {
  const mapped = mapZortOrder(zo);
  if (mapped) orders.push(mapped);
}

// Deduplicate by order_id
const uniqueMap = new Map();
for (const o of orders) uniqueMap.set(o.order_id, o);
const uniqueOrders = [...uniqueMap.values()];

console.log(`[Thailand] ${uniqueOrders.length} orders to upsert (deduped from ${orders.length})`);

if (uniqueOrders.length === 0) {
  console.log('[Thailand] No orders to sync.');
  process.exit(0);
}

// --- Upsert to Supabase ---
const BATCH_SIZE = 500;
for (let i = 0; i < uniqueOrders.length; i += BATCH_SIZE) {
  const batch = uniqueOrders.slice(i, i + BATCH_SIZE);
  const url = `${SUPABASE_URL}/rest/v1/orders_th?on_conflict=order_id`;
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

console.log(`✅ Thailand orders sync complete! ${uniqueOrders.length} orders synced from Zort.`);
