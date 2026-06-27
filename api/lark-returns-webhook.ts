import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './lib/supabase-admin.js';

// Receives returned-unit records PUSHED from a Lark Base Automation
// ("When a record is created/updated → Send HTTP request"). Works for an
// External base because the Base pushes to us (no cross-tenant API needed).
//
// Configure the automation's HTTP request as POST JSON to:
//   https://<vercel-domain>/api/lark-returns-webhook?token=<LARK_RETURNS_SECRET>
// Body (map Base fields with {{...}}), e.g.:
//   { "serial": "{{Serial Number}}", "date": "{{Return Date}}", "store": "{{Branch}}", "record_id": "{{Record ID}}" }

const SERIAL_RE = /^[A-Z]{2,}[A-Z0-9]{8,}$/;
const normSerial = (s: unknown) => String(s ?? '').toUpperCase().replace(/[\s-]/g, '').trim();
const isSerial = (s: string) => s.length >= 12 && s.length <= 22 && SERIAL_RE.test(s);

function pick(body: Record<string, unknown>, keys: string[]): string {
  for (const k of Object.keys(body)) {
    if (keys.includes(k.toLowerCase().replace(/[\s_]/g, ''))) {
      const v = body[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const expected = process.env.LARK_RETURNS_SECRET;
  if (expected && req.query.token !== expected) return res.status(401).json({ error: 'Invalid token' });

  try {
    let body = req.body as unknown;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* keep */ } }
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Expected JSON body' });
    const b = body as Record<string, unknown>;

    // serial: explicit field, else auto-detect a serial-looking value in the payload
    let serial = normSerial(pick(b, ['serial', 'serialnumber', 'sn']));
    if (!isSerial(serial)) {
      serial = '';
      for (const v of Object.values(b)) { const s = normSerial(v); if (isSerial(s)) { serial = s; break; } }
    }
    if (!serial) return res.status(200).json({ ok: false, message: 'No serial found in payload', received: Object.keys(b) });

    const dateRaw = pick(b, ['date', 'returndate', 'returneddate']);
    const d = dateRaw ? new Date(dateRaw) : null;
    const store = pick(b, ['store', 'storecode', 'branch']);
    const recordId = pick(b, ['recordid', 'id']);

    const { error } = await supabaseAdmin.from('returned_serials').upsert({
      serial_number: serial,
      returned_date: d && !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : null,
      store_code: store ? store.toUpperCase() : null,
      lark_record_id: recordId || null,
      raw: b,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'serial_number' });
    if (error) throw new Error(error.message);

    return res.status(200).json({ ok: true, serial });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[lark-returns-webhook]', msg);
    return res.status(500).json({ error: msg });
  }
}
