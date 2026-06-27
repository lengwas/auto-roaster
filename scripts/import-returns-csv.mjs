#!/usr/bin/env node
// ============================================================
// Import returned serials from a CSV exported from the Lark "returns" Base
// → Supabase returned_serials. (Lark Base is External → API sync not possible,
//   so we import an export instead.)
// ============================================================
// Usage:
//   node scripts/import-returns-csv.mjs <file.csv> [--field "Serial Number"] [--date-field "Date"] [--store-field "Store"]
// Reads SUPABASE creds from the repo-root .env (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY,
// or SUPABASE_URL + SUPABASE_SERVICE_KEY). returned_serials RLS allows anon writes.
// If --field is omitted, the serial column is auto-detected (alphanumeric 12–20 chars).
// ============================================================

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function loadEnv() {
  for (const p of [resolve(repoRoot, '.env'), resolve(__dirname, '.env')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('='); if (eq === -1) continue;
      const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}
loadEnv();

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!URL || !KEY) { console.error('Missing Supabase URL/key in .env'); process.exit(1); }

const args = process.argv.slice(2);
let file = null, field = null, dateField = null, storeField = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--field') field = args[++i];
  else if (args[i] === '--date-field') dateField = args[++i];
  else if (args[i] === '--store-field') storeField = args[++i];
  else file = args[i];
}
if (!file) { console.error('Usage: node scripts/import-returns-csv.mjs <file.csv> [--field NAME] [--date-field NAME] [--store-field NAME]'); process.exit(1); }
const path = resolve(process.cwd(), file);
if (!existsSync(path)) { console.error(`File not found: ${path}`); process.exit(1); }

// CSV parser (handles quoted fields)
function parseCsv(text) {
  const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); f = ''; row = []; }
    else if (c === '\r') { /* skip */ }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const SERIAL_RE = /^[A-Z]{2,}[A-Z0-9]{8,}$/;
const normSerial = s => String(s || '').toUpperCase().replace(/[\s-]/g, '').trim();
const isSerial = s => { const v = normSerial(s); return v.length >= 12 && v.length <= 22 && SERIAL_RE.test(v); };

const rows = parseCsv(readFileSync(path, 'utf8'));
if (rows.length < 2) { console.error('No data rows.'); process.exit(1); }
const header = rows[0].map(h => h.trim());
const dataRows = rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));

// resolve serial column
let serialCol = field;
if (!serialCol) {
  let best = null, bestHits = 0;
  for (const h of header) {
    const hits = dataRows.reduce((n, r) => n + (isSerial(r[h]) ? 1 : 0), 0);
    if (hits > bestHits) { bestHits = hits; best = h; }
  }
  serialCol = best;
  console.log(`[returns] auto-detected serial column: "${serialCol}" (${bestHits} serial-like values)`);
}
if (!serialCol) { console.error(`Could not find a serial column. Headers: ${header.join(' | ')}`); process.exit(1); }

const seen = new Set();
const records = [];
for (const r of dataRows) {
  const serial = normSerial(r[serialCol]);
  if (!serial || !isSerial(serial) || seen.has(serial)) continue;
  seen.add(serial);
  let returned_date = null;
  if (dateField && r[dateField]) { const d = new Date(r[dateField]); if (!isNaN(d.getTime())) returned_date = d.toISOString().split('T')[0]; }
  records.push({
    serial_number: serial,
    returned_date,
    store_code: storeField && r[storeField] ? String(r[storeField]).toUpperCase().trim() : null,
    raw: r,
    synced_at: new Date().toISOString(),
  });
}
console.log(`[returns] ${records.length} unique returned serials → returned_serials`);

const BATCH = 500;
for (let i = 0; i < records.length; i += BATCH) {
  const resp = await fetch(`${URL}/rest/v1/returned_serials?on_conflict=serial_number`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(records.slice(i, i + BATCH)),
  });
  if (!resp.ok) { console.error(`Upsert failed (${resp.status}): ${await resp.text()}`); process.exit(1); }
  console.log(`  batch ${Math.floor(i / BATCH) + 1}: ${Math.min(BATCH, records.length - i)} rows`);
}
console.log('✅ Returns import complete.');
