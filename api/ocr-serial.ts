import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './lib/supabase-admin.js';

const SERIAL_PROMPT = `Extract the serial number from this luggage/suitcase product image.

Serial numbers follow this pattern: starts with model letters (e.g. SE3P, SE3L, SQ3S) followed by alphanumeric characters, typically 16 characters total.
Examples:
- SE3PSXH25JDA0072
- SE3LSXH24Q9A0006
- SQ3SPXZ253HA0502

The serial number is usually on a sticker, label, or engraved plate on the product.

Return ONLY valid JSON (no markdown, no backticks):
{
  "serial_number": "the serial number string, or null if not found",
  "confidence": "high/medium/low",
  "raw_text": "all visible text in the image"
}`;

interface OcrResult {
  serial_number: string | null;
  confidence: string;
  raw_text: string;
}

async function ocrImage(imageUrl: string): Promise<OcrResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  // Download image
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) throw new Error(`Failed to download image: ${imgResp.status}`);
  const buf = Buffer.from(await imgResp.arrayBuffer());
  const mimeType = imgResp.headers.get('content-type') || 'image/jpeg';
  const base64 = buf.toString('base64');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: SERIAL_PROMPT },
            { inlineData: { mimeType, data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();
  const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  try {
    return JSON.parse(cleaned) as OcrResult;
  } catch {
    return { serial_number: null, confidence: 'low', raw_text: text };
  }
}

/**
 * POST /api/ocr-serial
 * Body: { "limit": 50 }  (optional, default 50)
 *
 * Processes pending sales_claim_items with image_url, extracts serial numbers via Gemini.
 * Also callable as GET (no body) to process default batch.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const limit = (req.method === 'POST' && req.body?.limit) || 50;

  // Fetch pending items
  const { data: pending, error: fetchErr } = await supabaseAdmin
    .from('sales_claim_items')
    .select('id, image_url')
    .eq('ocr_status', 'pending')
    .not('image_url', 'is', null)
    .limit(limit);

  if (fetchErr) {
    return res.status(500).json({ error: fetchErr.message });
  }

  if (!pending || pending.length === 0) {
    return res.json({ processed: 0, message: 'No pending items' });
  }

  const results: { id: string; serial: string | null; status: string }[] = [];

  for (const item of pending) {
    try {
      const ocr = await ocrImage(item.image_url);
      const serial = ocr.serial_number;

      await supabaseAdmin
        .from('sales_claim_items')
        .update({
          serial_number: serial,
          ocr_status: serial ? 'success' : 'failed',
          ocr_raw: ocr.raw_text || 'no serial found',
        })
        .eq('id', item.id);

      results.push({ id: item.id, serial, status: serial ? 'success' : 'failed' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin
        .from('sales_claim_items')
        .update({ ocr_status: 'failed', ocr_raw: `Error: ${msg}` })
        .eq('id', item.id);

      results.push({ id: item.id, serial: null, status: 'error' });
    }
  }

  const success = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status !== 'success').length;

  return res.json({
    processed: results.length,
    success,
    failed,
    results,
  });
}
