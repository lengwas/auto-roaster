import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './lib/supabase-admin.js';

// Real-time returns sync. A Lark Base Automation ("When a record is created /
// updated in the returns table → Send HTTP request") POSTs here with at least
// the record id. We then fetch the full record from the Base, map it, OCR the
// attached photo when the serial is missing, and upsert into `returns` (+ the
// serial into `returned_serials`).
//
// Configure the automation's HTTP request as POST JSON to:
//   https://<vercel-domain>/api/lark-returns-webhook?token=<LARK_RETURNS_SECRET>
// Body: { "record_id": "{{Record ID}}" }

const LARK_HOST = 'https://open.larksuite.com';
const APP_TOKEN = process.env.LARK_RETURNS_APP_TOKEN || 'JN0Nb6gEiajhjhsjgSElrx7ogNf';
const TABLE_ID = process.env.LARK_RETURNS_TABLE_ID || 'tbl6yKbrEwMsr5bS';
const QA = new Set(['KMQ', 'KLM', 'RKT', 'KVD', 'LGF', 'VDF', 'VLM', 'VMQ', 'ORI', 'VVD', 'VVG']);

const SERIAL_RE = /^[A-Z]{2,}[A-Z0-9]{8,}$/;
const normSerial = (s: unknown) => String(s ?? '').toUpperCase().replace(/[\s-]/g, '').trim();
const isSerial = (s: string) => s.length >= 12 && s.length <= 22 && SERIAL_RE.test(s);

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

function pick(body: Record<string, unknown>, keys: string[]): string {
  for (const k of Object.keys(body)) {
    if (keys.includes(k.toLowerCase().replace(/[\s_]/g, ''))) {
      const v = body[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
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

async function fetchRecord(token: string, recordId: string): Promise<Record<string, unknown> | null> {
  const url = `${LARK_HOST}/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${recordId}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json() as { code?: number; data?: { record?: { fields?: Record<string, unknown> } } };
  return j.code === 0 ? (j.data?.record?.fields ?? null) : null;
}

/** OCR the serial from the record's attached photo (Lark attachment → Gemini). */
async function ocrSerial(token: string, fields: Record<string, unknown>): Promise<string | null> {
  const pic = fields['Picture of S|N and unit'];
  const first = Array.isArray(pic) ? pic[0] as Record<string, unknown> : null;
  const tmpUrl = first?.tmp_url as string | undefined;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!tmpUrl || !geminiKey) return null;
  try {
    // tmp_url (with auth) returns the real signed download url
    const meta = await fetch(tmpUrl, { headers: { Authorization: `Bearer ${token}` } });
    const mj = await meta.json() as { data?: { tmp_download_urls?: { tmp_download_url?: string }[] } };
    const dl = mj.data?.tmp_download_urls?.[0]?.tmp_download_url;
    if (!dl) return null;
    const img = await fetch(dl);
    const buf = Buffer.from(await img.arrayBuffer());
    const b64 = buf.toString('base64');
    const prompt = 'Extract the serial number from this luggage/suitcase product image (sticker/label), ~16 chars like SE3LSXH2402A0116. Return ONLY JSON: {"serial_number":"...or null"}';
    const gr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: b64 } }] }] }),
    });
    const gj = await gr.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const txt = (gj.candidates?.[0]?.content?.parts?.[0]?.text ?? '').replace(/```json|```/g, '').trim();
    const s = normSerial(JSON.parse(txt).serial_number);
    return isSerial(s) ? s : null;
  } catch { return null; }
}

function toDate(v: unknown): string | null {
  const n = typeof v === 'number' ? v : Number(flat(v));
  if (!n) return null;
  const d = new Date(n);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
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

    const recordId = pick(b, ['recordid', 'id', 'record_id']);
    if (!recordId) return res.status(200).json({ ok: false, message: 'No record_id in payload', received: Object.keys(b) });

    const token = await tenantToken();
    const f = await fetchRecord(token, recordId);
    if (!f) return res.status(200).json({ ok: false, message: 'Record not found', recordId });

    if (flat(f['Request type']).trim() !== 'Return / Refund') {
      return res.status(200).json({ ok: true, skipped: 'not a Return / Refund', recordId });
    }

    let serial = normSerial(f['SN']);
    let ocr = false;
    if (!isSerial(serial)) {
      const found = await ocrSerial(token, f);
      if (found) { serial = found; ocr = true; }
    }
    const store = flat(f['Store|Location']).toUpperCase().trim() || null;

    const { error } = await supabaseAdmin.from('returns').upsert({
      lark_record_id: recordId,
      num: flat(f['Num']) || null,
      request_type: flat(f['Request type']) || null,
      type: flat(f['Type']) || null,
      status: flat(f['Status']) || null,
      serial_number: serial || null,
      model: flat(f['Models']) || null,
      store_code: store,
      country: store && QA.has(store) ? 'QA' : 'UAE',
      staff_name: flat(f['Staff name']) || null,
      request_date: toDate(f['Request date']),
      reason: flat(f['Reason']) || null,
      note: flat(f['Note']) || null,
      condition: flat(f['Condition']) || null,
      solution: flat(f['Solution']) || null,
      raw: f,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'lark_record_id' });
    if (error) throw new Error(`returns upsert: ${error.message}`);

    // Mirror the serial into returned_serials (commission clawback lookup).
    if (isSerial(serial)) {
      await supabaseAdmin.from('returned_serials').upsert({
        serial_number: serial,
        returned_date: toDate(f['Request date']),
        store_code: store,
        lark_record_id: recordId,
        raw: f,
        synced_at: new Date().toISOString(),
      }, { onConflict: 'serial_number' });
    }

    return res.status(200).json({ ok: true, recordId, serial: serial || null, ocr });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[lark-returns-webhook]', msg);
    return res.status(500).json({ error: msg });
  }
}
