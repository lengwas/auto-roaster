import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './lib/supabase-admin.js';

// ── Serial number OCR prompt ──────────────────────────────────────────
const SERIAL_OCR_PROMPT = `Extract the serial number from this luggage/suitcase product image.

Serial numbers follow this pattern: starts with letters (model code) followed by alphanumeric characters, typically 16 characters total.
Examples:
- SE3PSXH25JDA0072
- SE3LSXH24Q9A0006
- SQ3SPXZ253HA0502

The serial number is usually on a sticker, label, or engraved plate on the product.

Return ONLY valid JSON (no markdown, no backticks):
{"serial_number": "the serial string or null if not found", "confidence": "high/medium/low"}`;

// ── Product list parser ───────────────────────────────────────────────
function parseProductList(text: string): { model: string; colour: string }[] {
  if (!text) return [];
  return text.split('\n').map(line => {
    const model = line.match(/Model:\s*([^,]+)/i)?.[1]?.trim() ?? '';
    const colour = line.match(/Colo(?:u)?r:\s*(.+)/i)?.[1]?.trim() ?? '';
    return model ? { model, colour } : null;
  }).filter(Boolean) as { model: string; colour: string }[];
}

function resolveProductSku(model: string, colour: string): string | null {
  if (!model) return null;
  const m = model.toUpperCase().replace(/\s+/g, '');
  const colourMap: Record<string, string> = {
    BLACK: 'BK', SILVER: 'SLV', PINK: 'PK', BLUE: 'BLU',
    WHITE: 'WH', RED: 'RD', GREEN: 'GN', GREY: 'GRY', GRAY: 'GRY',
  };
  const c = colour.toUpperCase().replace(/\s+/g, '');
  const abbr = colourMap[c] || c.slice(0, 4);
  return m + (abbr ? '_' + abbr : '');
}

// ── OCR via Gemini ────────────────────────────────────────────────────
async function ocrSerialFromUrl(imageUrl: string): Promise<{ serial: string | null; raw: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { serial: null, raw: 'GEMINI_API_KEY not set' };

  try {
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) return { serial: null, raw: `Image download failed: ${imgResp.status}` };
    const buf = Buffer.from(await imgResp.arrayBuffer());
    const mimeType = imgResp.headers.get('content-type') || 'image/jpeg';

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: SERIAL_OCR_PROMPT },
            { inlineData: { mimeType, data: buf.toString('base64') } },
          ] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { serial: null, raw: `Gemini ${res.status}: ${errText.slice(0, 200)}` };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    try {
      const parsed = JSON.parse(cleaned);
      return { serial: parsed.serial_number || null, raw: cleaned };
    } catch {
      // Try to extract serial pattern directly from text
      const match = text.match(/[A-Z0-9]{14,20}/);
      return { serial: match?.[0] || null, raw: text };
    }
  } catch (e: unknown) {
    return { serial: null, raw: `Error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ── JotForm field extraction ──────────────────────────────────────────
// JotForm webhook sends rawRequest as JSON string with question answers.
// Field names vary by form — we match by label keywords.

interface ParsedSubmission {
  submissionId: string;
  uniqueId: string | null;
  date: string | null;
  time: string | null;
  promoterName: string | null;
  branch: string | null;
  customerGender: string | null;
  nationality: string | null;
  visaType: string | null;
  ageRange: string | null;
  groupType: string | null;
  numberOfLuggage: number;
  productList: string | null;
  imageUrls: string[];
}

function parseJotformPayload(body: Record<string, unknown>): ParsedSubmission | null {
  const submissionId = String(body.submissionID || body.submission_id || '');
  if (!submissionId) return null;

  // JotForm sends a rawRequest field containing the full submission as JSON
  let raw: Record<string, unknown> = body;
  if (typeof body.rawRequest === 'string') {
    try { raw = JSON.parse(body.rawRequest); } catch { /* use body as-is */ }
  }

  // Flatten all values — JotForm nests answers under question IDs
  const flat = new Map<string, string>();
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === 'string') {
      flat.set(key.toLowerCase(), val);
    } else if (val && typeof val === 'object') {
      // JotForm sometimes wraps values: { answer: "text" } or { prettyFormat: "text" }
      const obj = val as Record<string, unknown>;
      const text = String(obj.answer ?? obj.prettyFormat ?? obj.value ?? '');
      if (text) flat.set(key.toLowerCase(), text);
    }
  }

  // Helper: find value by keyword in key or known question labels
  const find = (...keywords: string[]): string | null => {
    for (const [k, v] of flat) {
      for (const kw of keywords) {
        if (k.includes(kw)) return v.trim() || null;
      }
    }
    return null;
  };

  // Extract image URLs — JotForm file uploads come as newline-separated URLs
  const imageUrls: string[] = [];
  for (const [k, v] of flat) {
    if ((k.includes('image') || k.includes('serial') || k.includes('photo') || k.includes('upload')) && v.includes('http')) {
      imageUrls.push(...v.split('\n').map(u => u.trim()).filter(u => u.startsWith('http')));
    }
  }

  // Parse date
  let dateStr = find('date');
  if (dateStr) {
    // Try to normalize to YYYY-MM-DD
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) dateStr = d.toISOString().split('T')[0];
  }

  // Parse time
  let timeStr = find('time');
  if (timeStr) {
    const tm = timeStr.match(/(\d{1,2}):(\d{2})/);
    timeStr = tm ? `${tm[1].padStart(2, '0')}:${tm[2]}` : null;
  }

  const luggageStr = find('luggage', 'number of');
  const numberOfLuggage = luggageStr ? parseInt(luggageStr) || 0 : 0;

  return {
    submissionId,
    uniqueId: find('unique', 'id') ?? null,
    date: dateStr,
    time: timeStr,
    promoterName: find('promoter', 'name') ?? null,
    branch: find('branch', 'store') ?? null,
    customerGender: find('gender') ?? null,
    nationality: find('nationality', 'nation') ?? null,
    visaType: find('visa') ?? null,
    ageRange: find('age', 'decision') ?? null,
    groupType: find('group') ?? null,
    numberOfLuggage,
    productList: find('product', 'model') ?? null,
    imageUrls,
  };
}

// ── Webhook handler ───────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // JotForm sends as form-encoded or JSON — normalize
  const body = req.body ?? {};
  console.log('[jotform-webhook] Content-Type:', req.headers['content-type']);
  console.log('[jotform-webhook] Payload keys:', Object.keys(body));
  console.log('[jotform-webhook] Raw body sample:', JSON.stringify(body).slice(0, 1000));

  const parsed = parseJotformPayload(body);
  if (!parsed || !parsed.submissionId) {
    console.log('[jotform-webhook] Could not parse submission');
    return res.status(200).json({ error: 'Invalid submission data', keys: Object.keys(body) });
  }

  if (!parsed.date || !parsed.promoterName) {
    console.log('[jotform-webhook] Missing required fields:', { date: parsed.date, promoter: parsed.promoterName });
    // Still log raw payload for debugging
    await supabaseAdmin.from('sales_claims').upsert({
      submission_id: parsed.submissionId,
      date: parsed.date || new Date().toISOString().split('T')[0],
      promoter_name: parsed.promoterName || 'UNKNOWN',
      branch: parsed.branch || 'UNKNOWN',
      status: 'pending',
      notes: `Raw webhook — missing fields. Keys: ${Object.keys(req.body ?? {}).join(', ')}`,
    }, { onConflict: 'submission_id' });
    return res.status(200).json({ ok: true, warning: 'Partial data saved' });
  }

  // ── 1. Insert sales_claim ─────────────────────────────────────────
  const claimPayload = {
    submission_id: parsed.submissionId,
    unique_id: parsed.uniqueId,
    date: parsed.date,
    time: parsed.time,
    promoter_name: parsed.promoterName,
    branch: parsed.branch || '',
    customer_gender: parsed.customerGender,
    nationality: parsed.nationality,
    visa_type: parsed.visaType,
    age_range: parsed.ageRange,
    group_type: parsed.groupType,
    number_of_luggage: parsed.numberOfLuggage,
    product_list: parsed.productList,
    image_urls: parsed.imageUrls.join('\n'),
    status: 'pending',
  };

  const { data: claim, error: claimErr } = await supabaseAdmin
    .from('sales_claims')
    .upsert(claimPayload, { onConflict: 'submission_id' })
    .select('id')
    .single();

  if (claimErr || !claim) {
    console.error('[jotform-webhook] Failed to upsert claim:', claimErr);
    return res.status(500).json({ error: 'Failed to save claim', detail: claimErr?.message });
  }

  const claimId = claim.id;
  console.log(`[jotform-webhook] Claim ${claimId} saved for ${parsed.promoterName} @ ${parsed.branch} on ${parsed.date}`);

  // ── 2. Parse & insert items ───────────────────────────────────────
  const products = parseProductList(parsed.productList || '');
  const itemResults: { model: string; serial: string | null; status: string }[] = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const imageUrl = parsed.imageUrls[i] || null;

    const { data: item, error: itemErr } = await supabaseAdmin
      .from('sales_claim_items')
      .insert({
        claim_id: claimId,
        item_index: i,
        model: p.model,
        colour: p.colour,
        sku: resolveProductSku(p.model, p.colour),
        image_url: imageUrl,
        ocr_status: imageUrl ? 'pending' : 'manual',
      })
      .select('id')
      .single();

    if (itemErr || !item) {
      console.error(`[jotform-webhook] Failed to insert item ${i}:`, itemErr);
      itemResults.push({ model: p.model, serial: null, status: 'insert_error' });
      continue;
    }

    // ── 3. OCR serial number if image available ───────────────────
    if (imageUrl) {
      const ocr = await ocrSerialFromUrl(imageUrl);
      await supabaseAdmin
        .from('sales_claim_items')
        .update({
          serial_number: ocr.serial,
          ocr_status: ocr.serial ? 'success' : 'failed',
          ocr_raw: ocr.raw,
        })
        .eq('id', item.id);

      itemResults.push({ model: p.model, serial: ocr.serial, status: ocr.serial ? 'success' : 'failed' });
      console.log(`[jotform-webhook] OCR item ${i} (${p.model}): ${ocr.serial || 'FAILED'}`);
    } else {
      itemResults.push({ model: p.model, serial: null, status: 'no_image' });
    }
  }

  // If no products parsed but images exist, create items from images
  if (products.length === 0 && parsed.imageUrls.length > 0) {
    for (let i = 0; i < parsed.imageUrls.length; i++) {
      const imageUrl = parsed.imageUrls[i];
      const { data: item } = await supabaseAdmin
        .from('sales_claim_items')
        .insert({
          claim_id: claimId,
          item_index: i,
          image_url: imageUrl,
          ocr_status: 'pending',
        })
        .select('id')
        .single();

      if (item) {
        const ocr = await ocrSerialFromUrl(imageUrl);
        await supabaseAdmin
          .from('sales_claim_items')
          .update({
            serial_number: ocr.serial,
            ocr_status: ocr.serial ? 'success' : 'failed',
            ocr_raw: ocr.raw,
          })
          .eq('id', item.id);
        itemResults.push({ model: 'unknown', serial: ocr.serial, status: ocr.serial ? 'success' : 'failed' });
      }
    }
  }

  // ── 4. Send Lark notification ─────────────────────────────────────
  const larkUrl = process.env.LARK_WEBHOOK_URL;
  if (larkUrl) {
    const serialList = itemResults
      .map((r, i) => `  ${i + 1}. ${r.model} → ${r.serial || '❌ OCR failed'}`)
      .join('\n');
    const larkMsg = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: `🛒 New Sale — ${parsed.promoterName}` },
          template: 'green',
        },
        elements: [
          { tag: 'div', text: { tag: 'lark_md', content:
            `**Promoter:** ${parsed.promoterName}\n` +
            `**Branch:** ${parsed.branch}\n` +
            `**Date:** ${parsed.date}${parsed.time ? ' ' + parsed.time : ''}\n` +
            `**Luggage:** ${parsed.numberOfLuggage}\n` +
            `**Customer:** ${parsed.customerGender || '-'} | ${parsed.nationality || '-'} | ${parsed.visaType || '-'}\n` +
            `**Products:**\n${parsed.productList || '-'}\n` +
            `**Serial Numbers:**\n${serialList || '  (none)'}`,
          }},
        ],
      },
    };

    try {
      await fetch(larkUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(larkMsg),
      });
    } catch (e) {
      console.error('[jotform-webhook] Lark notification failed:', e);
    }
  }

  return res.status(200).json({
    ok: true,
    claimId,
    promoter: parsed.promoterName,
    branch: parsed.branch,
    date: parsed.date,
    items: itemResults,
  });
}
