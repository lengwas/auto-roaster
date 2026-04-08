import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifySignature, downloadImage } from './lib/line.js';
import { extractAttendance } from './lib/gemini.js';
import { supabaseAdmin, t } from './lib/supabase-admin.js';

// Disable Vercel's automatic body parsing so we can read the raw body for signature verification
export const config = { api: { bodyParser: false } };

/** Map LINE group IDs to countries. Add your group IDs here. */
const GROUP_COUNTRY_MAP: Record<string, 'UAE' | 'QA'> = {
  // 'C...' : 'UAE',
  // 'C...' : 'QA',
};

/** Read the raw request body as a Buffer, then return as string. */
function readBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
    // If stream is already consumed (no data events fire), resolve after short timeout
    setTimeout(() => {
      if (chunks.length === 0 && req.body) {
        // Fallback: Vercel already consumed the stream
        resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
      }
    }, 100);
  });
}

/** Fuzzy-match a name from OCR against the promoters table. */
async function matchPromoter(
  ocrName: string | null,
  employeeCode: string | null,
  country: 'UAE' | 'QA',
): Promise<{ id: string; name: string } | null> {
  if (!ocrName && !employeeCode) return null;

  const { data } = await supabaseAdmin
    .from(t('promoters', country))
    .select('id, name, stores_label')
    .eq('active', true);

  if (!data) return null;

  const needle = (ocrName || '').toLowerCase().trim();
  const code = (employeeCode || '').toLowerCase().trim();

  // Try employee code match first (most reliable)
  if (code) {
    for (const row of data) {
      const name = String(row.name).toLowerCase();
      const label = String(row.stores_label || '').toLowerCase();
      if (name.includes(code) || label.includes(code)) {
        return { id: row.id, name: row.name };
      }
    }
  }

  if (!needle) return null;

  // Try exact name match, then substring
  for (const row of data) {
    const name = String(row.name).toLowerCase();
    const label = String(row.stores_label || '').toLowerCase();
    if (name === needle || label === needle) {
      return { id: row.id, name: row.name };
    }
  }
  for (const row of data) {
    const name = String(row.name).toLowerCase();
    const label = String(row.stores_label || '').toLowerCase();
    if (needle.includes(name) || name.includes(needle) || needle.includes(label) || label.includes(needle)) {
      return { id: row.id, name: row.name };
    }
  }
  return null;
}

/** Match OCR store name/code against stores table. */
async function matchStore(
  ocrStore: string | null,
  ocrStoreCode: string | null,
  country: 'UAE' | 'QA',
): Promise<string | null> {
  if (!ocrStore && !ocrStoreCode) return null;

  const { data } = await supabaseAdmin
    .from(t('stores', country))
    .select('code, name');

  if (!data) return null;

  // Try direct store code match first (most reliable, e.g. "VDM")
  if (ocrStoreCode) {
    const codeNeedle = ocrStoreCode.toLowerCase().trim();
    for (const row of data) {
      if (String(row.code).toLowerCase() === codeNeedle) return row.code;
    }
  }

  if (!ocrStore) return null;
  const needle = ocrStore.toLowerCase().trim();

  for (const row of data) {
    const code = String(row.code).toLowerCase();
    const name = String(row.name).toLowerCase();
    if (code === needle || name === needle) return row.code;
  }
  for (const row of data) {
    const code = String(row.code).toLowerCase();
    const name = String(row.name).toLowerCase();
    if (needle.includes(code) || needle.includes(name) || name.includes(needle)) return row.code;
  }
  return null;
}

/** Process a single image message event. */
async function processImageEvent(event: Record<string, unknown>) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
  const message = event.message as Record<string, unknown>;
  const messageId = String(message.id);
  const source = event.source as Record<string, unknown>;
  const groupId = source.groupId ? String(source.groupId) : null;

  // Determine country from group ID mapping, default to UAE
  const country: 'UAE' | 'QA' = (groupId && GROUP_COUNTRY_MAP[groupId]) || 'UAE';

  // Dedup check
  const { data: existing } = await supabaseAdmin
    .from(t('attendance', country))
    .select('id')
    .eq('line_message_id', messageId)
    .maybeSingle();

  if (existing) {
    console.log(`[webhook] Duplicate message ${messageId}, skipping.`);
    return;
  }

  // Download image from LINE
  console.log(`[webhook] Downloading image ${messageId}...`);
  const imageBuffer = await downloadImage(messageId, accessToken);
  const mimeType = 'image/jpeg'; // LINE images are typically JPEG

  // OCR via Gemini
  console.log(`[webhook] Running OCR on image ${messageId}...`);
  const ocr = await extractAttendance(imageBuffer, mimeType);
  console.log(`[webhook] OCR result:`, JSON.stringify(ocr));

  // Match promoter and store (use employee_code and store_code from OCR for better matching)
  const promoter = await matchPromoter(ocr.promoter_name, ocr.employee_code ?? null, country);
  const storeCode = await matchStore(ocr.store_name, ocr.store_code ?? null, country);

  // Determine date: from OCR or today
  const today = new Date().toISOString().split('T')[0];
  const date = ocr.date || today;

  // Insert into attendance table
  const record = {
    promoter_id: promoter?.id ?? null,
    promoter_name: ocr.promoter_name,
    store_code: storeCode,
    store_name: ocr.store_name,
    date,
    check_in: ocr.check_in,
    check_out: ocr.check_out,
    source: 'line',
    line_message_id: messageId,
    line_group_id: groupId,
    ocr_confidence: ocr.confidence,
    ocr_raw_text: ocr.raw_text,
    status: promoter ? 'matched' : 'unmatched',
  };

  const { error: insertErr } = await supabaseAdmin
    .from(t('attendance', country))
    .insert(record);

  if (insertErr) {
    console.error(`[webhook] Insert failed:`, insertErr);
    return;
  }

  const name = promoter?.name ?? ocr.promoter_name ?? 'Unknown';
  const store = storeCode ?? ocr.store_name ?? '-';
  console.log(`[webhook] Attendance saved for ${name} at ${store} on ${date}.`);
}

// ─── Main handler ───────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Read raw body for signature verification
  const rawBody = await readBody(req);
  console.log(`[webhook] Received POST, body length=${rawBody.length}, hasBody=${!!req.body}`);

  // Verify LINE signature
  const signature = req.headers['x-line-signature'] as string | undefined;
  const channelSecret = process.env.LINE_CHANNEL_SECRET;

  if (!channelSecret) {
    console.error('[webhook] LINE_CHANNEL_SECRET not configured');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  console.log(`[webhook] signature=${signature ? 'present' : 'missing'}, secret=${channelSecret ? channelSecret.substring(0, 4) + '...' : 'MISSING'}`);

  if (!signature || !verifySignature(rawBody, signature, channelSecret)) {
    console.error(`[webhook] Signature verification failed`);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Parse events
  const body = JSON.parse(rawBody) as { events?: Record<string, unknown>[] };
  const events = body.events ?? [];

  // Return 200 immediately — LINE requires fast response
  res.status(200).json({ status: 'ok' });

  // Process image events (runs after response is sent)
  for (const event of events) {
    try {
      if (event.type === 'message') {
        const message = event.message as Record<string, unknown>;
        if (message.type === 'image') {
          await processImageEvent(event);
        }
      }
    } catch (err) {
      console.error('[webhook] Error processing event:', err);
    }
  }
}
