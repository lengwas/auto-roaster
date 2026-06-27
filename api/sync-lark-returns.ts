import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './lib/supabase-admin.js';

// Lark Base (Bitable) holding returned units.
// https://omnimove.sg.larksuite.com/base/JN0Nb6gEiajhjhsjgSElrx7ogNf?table=tbl6yKbrEwMsr5bS
const LARK_HOST = 'https://open.larksuite.com';
const APP_TOKEN = process.env.LARK_RETURNS_APP_TOKEN || 'JN0Nb6gEiajhjhsjgSElrx7ogNf';
const TABLE_ID = process.env.LARK_RETURNS_TABLE_ID || 'tbl6yKbrEwMsr5bS';

// Looks like a product serial: starts with letters, 12–20 alphanumerics.
const SERIAL_RE = /^[A-Z]{2,}[A-Z0-9]{8,}$/;
const isSerial = (s: string) => { const v = s.toUpperCase().replace(/[\s-]/g, ''); return v.length >= 12 && v.length <= 22 && SERIAL_RE.test(v); };

/** Flatten a Lark field value (string | {text} | [{text}] | number) to a string. */
function flat(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(flat).join(' ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.name === 'string') return o.name;
    return Object.values(o).map(flat).join(' ');
  }
  return String(v);
}

async function tenantToken(): Promise<string> {
  const r = await fetch(`${LARK_HOST}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: process.env.LARK_APP_ID, app_secret: process.env.LARK_APP_SECRET }),
  });
  const j = await r.json() as { tenant_access_token?: string; code?: number; msg?: string };
  if (!j.tenant_access_token) throw new Error(`Lark token failed: ${j.code} ${j.msg}`);
  return j.tenant_access_token;
}

async function fetchAllRecords(token: string): Promise<{ record_id: string; fields: Record<string, unknown> }[]> {
  const out: { record_id: string; fields: Record<string, unknown> }[] = [];
  let pageToken = '';
  do {
    const url = `${LARK_HOST}/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?page_size=500${pageToken ? `&page_token=${pageToken}` : ''}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json() as { code?: number; msg?: string; data?: { items?: { record_id: string; fields: Record<string, unknown> }[]; page_token?: string; has_more?: boolean } };
    if (j.code !== 0) throw new Error(`Lark records failed: ${j.code} ${j.msg}`);
    out.push(...(j.data?.items ?? []));
    pageToken = j.data?.has_more ? (j.data?.page_token ?? '') : '';
  } while (pageToken);
  return out;
}

/**
 * GET/POST /api/sync-lark-returns?token=<LARK_RETURNS_SECRET>
 *   &inspect=1  → return field names + a sample record (no write)
 *   &field=<name> → use that field as the serial (else auto-detect)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const expected = process.env.LARK_RETURNS_SECRET;
  if (expected && req.query.token !== expected) return res.status(401).json({ error: 'Invalid token' });

  try {
    const token = await tenantToken();
    const records = await fetchAllRecords(token);

    if (req.query.inspect) {
      const fieldNames = [...new Set(records.flatMap(r => Object.keys(r.fields)))];
      return res.status(200).json({ count: records.length, fieldNames, sample: records.slice(0, 3).map(r => r.fields) });
    }

    const serialField = req.query.field ? String(req.query.field) : null;
    const dateField = req.query.dateField ? String(req.query.dateField) : null;
    const storeField = req.query.storeField ? String(req.query.storeField) : null;

    const rows: Record<string, unknown>[] = [];
    let noSerial = 0;
    for (const rec of records) {
      let serial = '';
      if (serialField) serial = flat(rec.fields[serialField]);
      else for (const v of Object.values(rec.fields)) { const s = flat(v).toUpperCase().replace(/[\s-]/g, ''); if (isSerial(s)) { serial = s; break; } }
      serial = serial.toUpperCase().replace(/[\s-]/g, '');
      if (!serial) { noSerial++; continue; }
      const dateStr = dateField ? flat(rec.fields[dateField]) : '';
      const d = dateStr ? new Date(dateStr) : null;
      rows.push({
        serial_number: serial,
        returned_date: d && !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : null,
        store_code: storeField ? flat(rec.fields[storeField]).toUpperCase().trim() || null : null,
        lark_record_id: rec.record_id,
        raw: rec.fields,
        synced_at: new Date().toISOString(),
      });
    }

    // de-dup by serial (keep last)
    const bySerial = new Map(rows.map(r => [r.serial_number as string, r]));
    const payload = [...bySerial.values()];
    const BATCH = 500;
    for (let i = 0; i < payload.length; i += BATCH) {
      const { error } = await supabaseAdmin.from('returned_serials').upsert(payload.slice(i, i + BATCH), { onConflict: 'serial_number' });
      if (error) throw new Error(`upsert: ${error.message}`);
    }
    return res.status(200).json({ records: records.length, returnedSerials: payload.length, skippedNoSerial: noSerial });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[sync-lark-returns]', msg);
    return res.status(500).json({ error: msg });
  }
}
