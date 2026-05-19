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

// ── Download JotForm image helper ─────────────────────────────────────
async function downloadJotformImage(imageUrl: string, submissionId?: string): Promise<Buffer | null> {
  const jotformKey = process.env.JOTFORM_API_KEY;
  let buf: Buffer | null = null;

  if (jotformKey && imageUrl.includes('jotform.com/uploads/')) {
    const urlParts = imageUrl.split('/');
    const filename = urlParts[urlParts.length - 1];
    const subId = submissionId || urlParts.find(p => /^\d{16,}$/.test(p));

    if (subId) {
      const apiUrl = `https://api.jotform.com/submission/${subId}?apiKey=${jotformKey}`;
      try {
        const subResp = await fetch(apiUrl);
        if (subResp.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const subJson: any = await subResp.json();
          const answers = subJson?.content?.answers ?? {};
          const allFileUrls: string[] = [];
          for (const [, ans] of Object.entries(answers) as [string, { answer?: unknown; type?: string }][]) {
            if (ans.type !== 'control_fileupload' || !ans.answer) continue;
            if (typeof ans.answer === 'string' && ans.answer.includes('http')) {
              allFileUrls.push(...ans.answer.split('\n').map(u => u.trim()).filter(u => u.startsWith('http')));
            } else if (Array.isArray(ans.answer)) {
              for (const item of ans.answer) {
                if (typeof item === 'string' && item.startsWith('http')) allFileUrls.push(item);
              }
            }
          }
          const matchUrl = allFileUrls.find(u => u.includes(filename)) || allFileUrls[0];
          if (matchUrl) {
            const fileResp = await fetch(matchUrl + (matchUrl.includes('?') ? '&' : '?') + `apiKey=${jotformKey}`);
            const ct = fileResp.headers.get('content-type') || '';
            if (fileResp.ok && (ct.startsWith('image') || ct === 'application/octet-stream')) {
              buf = Buffer.from(await fileResp.arrayBuffer());
            }
          }
        }
      } catch (e) {
        console.error('[downloadJotformImage] Error:', e);
      }
    }
  }

  // Fallback: direct fetch
  if (!buf && !imageUrl.includes('jotform.com')) {
    try {
      const resp = await fetch(imageUrl, { redirect: 'follow' });
      const ct = resp.headers.get('content-type') || '';
      if (resp.ok && ct.startsWith('image')) {
        buf = Buffer.from(await resp.arrayBuffer());
      }
    } catch { /* ignore */ }
  }

  return buf;
}

// ── OCR via Gemini ────────────────────────────────────────────────────
async function ocrSerialFromUrl(imageUrl: string, submissionId?: string): Promise<{ serial: string | null; raw: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { serial: null, raw: 'GEMINI_API_KEY not set' };

  try {
    const buf = await downloadJotformImage(imageUrl, submissionId);
    if (!buf) {
      return { serial: null, raw: `Image download failed for ${imageUrl.slice(0, 80)}` };
    }
    const mimeType = 'image/jpeg';

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

  // JotForm sends rawRequest as a JSON string with all question answers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: Record<string, any> = {};
  if (typeof body.rawRequest === 'string') {
    try { raw = JSON.parse(body.rawRequest); } catch { /* empty */ }
  }

  // Helper: find value by searching all keys for keywords
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const findByKeyword = (obj: Record<string, any>, ...keywords: string[]): string | null => {
    for (const [k, v] of Object.entries(obj)) {
      const val = typeof v === 'string' ? v : (v && typeof v === 'object' && v.value ? String(v.value) : null);
      if (!val) continue;
      for (const kw of keywords) {
        if (k.toLowerCase().includes(kw.toLowerCase()) || val.includes(kw)) return val.trim();
      }
    }
    return null;
  };

  // Log all raw keys for field discovery
  console.log('[jotform-webhook] rawRequest keys:', Object.keys(raw).filter(k => !k.startsWith('js') && !k.startsWith('submit') && !k.startsWith('build') && !k.startsWith('event')).join(', '));

  // Helper: get string value from raw, handling nested objects
  const str = (key: string): string | null => {
    const v = raw[key];
    if (typeof v === 'string') return v.trim() || null;
    if (Array.isArray(v)) return v.join(', ') || null;
    return null;
  };

  // Parse date: {year, month, day} → YYYY-MM-DD
  let dateStr: string | null = null;
  const dateObj = raw.q12_date;
  if (dateObj && typeof dateObj === 'object' && dateObj.year) {
    const y = String(dateObj.year);
    const m = String(dateObj.month).padStart(2, '0');
    const d = String(dateObj.day).padStart(2, '0');
    dateStr = `${y}-${m}-${d}`;
  }

  // Parse time: {timeInput, hourSelect, minuteSelect} → HH:MM
  let timeStr: string | null = null;
  const timeObj = raw.q6_time;
  if (timeObj && typeof timeObj === 'object') {
    timeStr = String(timeObj.timeInput || `${timeObj.hourSelect}:${timeObj.minuteSelect}`);
  }

  // Parse product list: JSON array or text
  let productList: string | null = null;
  const prodRaw = raw.q13_typeA;
  if (typeof prodRaw === 'string') {
    try {
      const arr = JSON.parse(prodRaw);
      if (Array.isArray(arr)) {
        productList = arr.map((p: { Model?: string; Colour?: string }) =>
          `Model: ${p.Model || '?'}, Colour: ${p.Colour || '?'}`
        ).join('\n');
      } else {
        productList = prodRaw;
      }
    } catch {
      productList = prodRaw;
    }
  }

  // Parse group type: can be array
  const groupRaw = raw.q10_typeA10;
  const groupType = Array.isArray(groupRaw) ? groupRaw.join(', ') : (typeof groupRaw === 'string' ? groupRaw : null);

  // Extract image URLs — search all fields for actual image file URLs
  const imageUrls: string[] = [];
  const isImageUrl = (u: string) =>
    u.startsWith('http') &&
    u.includes('jotform.com/uploads/') &&
    !u.endsWith('/upload');  // exclude upload endpoint
  const extractUrls = (val: unknown): void => {
    if (typeof val === 'string') {
      for (const u of val.split(/[\n,]/)) {
        const trimmed = u.trim();
        if (isImageUrl(trimmed)) imageUrls.push(trimmed);
      }
    } else if (Array.isArray(val)) {
      for (const item of val) extractUrls(item);
    } else if (val && typeof val === 'object') {
      for (const v of Object.values(val as Record<string, unknown>)) extractUrls(v);
    }
  };
  for (const [, val] of Object.entries(raw)) {
    extractUrls(val);
  }
  console.log('[jotform-webhook] Image URLs found:', imageUrls.length, imageUrls);

  const luggageStr = str('q11_numberOf');
  const numberOfLuggage = luggageStr ? parseInt(luggageStr) || 0 : 0;

  return {
    submissionId,
    uniqueId: (() => {
      // Try direct keys first
      for (const key of Object.keys(raw)) {
        const v = raw[key];
        const s = typeof v === 'string' ? v.trim() : '';
        // Match AE-XXXXXX pattern
        if (/^AE-\d+$/.test(s)) return s;
        // Check nested value
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const nested = String((v as Record<string, unknown>).value ?? (v as Record<string, unknown>).answer ?? '').trim();
          if (/^AE-\d+$/.test(nested)) return nested;
        }
      }
      return str('q15_unique') || str('q15_autoincrement') || str('q15') || findByKeyword(raw, 'unique', 'autoincrement', 'AE-');
    })(),
    date: dateStr,
    time: timeStr,
    promoterName: str('q3_promoterName'),
    branch: str('q4_typeA4'),
    customerGender: str('q5_typeA5'),
    nationality: str('q7_nationality'),
    visaType: str('q8_visaType'),
    ageRange: str('q9_typeA9'),
    groupType,
    numberOfLuggage,
    productList,
    imageUrls,
  };
}

// ── Disable Vercel body parser — JotForm sends multipart/form-data ────
export const config = { api: { bodyParser: false } };

function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseFormUrlEncoded(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of text.split('&')) {
    const [key, ...rest] = pair.split('=');
    if (key) result[decodeURIComponent(key)] = decodeURIComponent(rest.join('='));
  }
  return result;
}

function parseMultipartFormData(text: string, boundary: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = text.split('--' + boundary);
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    const body = part.slice(headerEnd + 4).replace(/\r\n$/, '');
    const nameMatch = headers.match(/name="([^"]+)"/);
    if (nameMatch) result[nameMatch[1]] = body.trim();
  }
  return result;
}

// ── Webhook handler ───────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await readRawBody(req);
  const contentType = req.headers['content-type'] || '';
  console.log('[jotform-webhook] Content-Type:', contentType);
  console.log('[jotform-webhook] Raw body length:', rawBody.length);

  // Parse based on content type
  let body: Record<string, unknown> = {};
  if (contentType.includes('application/json')) {
    try { body = JSON.parse(rawBody); } catch { /* empty */ }
  } else if (contentType.includes('multipart/form-data')) {
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (boundaryMatch) {
      body = parseMultipartFormData(rawBody, boundaryMatch[1]);
    }
  } else {
    // application/x-www-form-urlencoded
    body = parseFormUrlEncoded(rawBody);
  }

  console.log('[jotform-webhook] Parsed keys:', Object.keys(body));
  console.log('[jotform-webhook] Body sample:', JSON.stringify(body).slice(0, 1500));

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
  console.log(`[jotform-webhook] Claim ${claimId} [${parsed.uniqueId || 'no-uid'}] saved for ${parsed.promoterName} @ ${parsed.branch} on ${parsed.date}`);

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
      const ocr = await ocrSerialFromUrl(imageUrl, parsed.submissionId);
      await supabaseAdmin
        .from('sales_claim_items')
        .update({
          serial_number: ocr.serial,
          ocr_status: ocr.serial ? 'success' : 'failed',
          ocr_raw: ocr.raw,
        })
        .eq('id', item.id);

      // Register serial number if OCR succeeded
      if (ocr.serial) {
        await supabaseAdmin.from('serial_registry').upsert({
          serial_number: ocr.serial,
          model: p.model,
          colour: p.colour,
          sku: resolveProductSku(p.model, p.colour),
          promoter_name: parsed.promoterName,
          branch: parsed.branch,
          date: parsed.date,
          claim_item_id: item.id,
          source: 'jotform',
        }, { onConflict: 'serial_number' });
      }

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
        const ocr = await ocrSerialFromUrl(imageUrl, parsed.submissionId);
        await supabaseAdmin
          .from('sales_claim_items')
          .update({
            serial_number: ocr.serial,
            ocr_status: ocr.serial ? 'success' : 'failed',
            ocr_raw: ocr.raw,
          })
          .eq('id', item.id);
        if (ocr.serial) {
          await supabaseAdmin.from('serial_registry').upsert({
            serial_number: ocr.serial,
            promoter_name: parsed.promoterName,
            branch: parsed.branch,
            date: parsed.date,
            claim_item_id: item.id,
            source: 'jotform',
          }, { onConflict: 'serial_number' });
        }
        itemResults.push({ model: 'unknown', serial: ocr.serial, status: ocr.serial ? 'success' : 'failed' });
      }
    }
  }

  // ── 4. Send Lark notification with images ──────────────────────────
  const larkUrl = process.env.LARK_WEBHOOK_URL;
  if (larkUrl) {
    // Upload images to Lark if App credentials are available
    const larkAppId = process.env.LARK_APP_ID;
    const larkAppSecret = process.env.LARK_APP_SECRET;
    const imageKeys: string[] = [];

    if (larkAppId && larkAppSecret && parsed.imageUrls.length > 0) {
      try {
        // Get tenant_access_token
        const tokenResp = await fetch('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_id: larkAppId, app_secret: larkAppSecret }),
        });
        const tokenJson = await tokenResp.json() as { tenant_access_token?: string; code?: number; msg?: string };
        const token = tokenJson.tenant_access_token;
        console.log('[lark] Token response:', tokenJson.code, tokenJson.msg ? tokenJson.msg : 'ok', token ? 'got token' : 'NO TOKEN');

        if (token) {
          // Download + upload each image to Lark
          for (const imgUrl of parsed.imageUrls.slice(0, 4)) { // max 4 images
            try {
              const imgBuf = await downloadJotformImage(imgUrl, parsed.submissionId);
              if (!imgBuf) { console.log('[lark] Image download failed for', imgUrl.slice(0, 60)); continue; }
              console.log('[lark] Downloaded image, size:', imgBuf.length);

              const formData = new FormData();
              formData.append('image_type', 'message');
              formData.append('image', new Blob([imgBuf], { type: 'image/jpeg' }), 'serial.jpg');

              const uploadResp = await fetch('https://open.larksuite.com/open-apis/im/v1/images', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
              });
              const uploadJson = await uploadResp.json() as { code?: number; msg?: string; data?: { image_key?: string } };
              console.log('[lark] Upload response:', JSON.stringify(uploadJson).slice(0, 200));
              if (uploadJson.code === 0 && uploadJson.data?.image_key) {
                imageKeys.push(uploadJson.data.image_key);
              } else {
                console.error('[lark] Upload failed:', uploadJson.code, uploadJson.msg);
              }
            } catch (e) {
              console.error('[lark] Image upload error:', e);
            }
          }
        }
      } catch (e) {
        console.error('[lark] Token fetch error:', e);
      }
    }

    const serialList = itemResults
      .map((r, i) => `  ${i + 1}. ${r.model} → ${r.serial || '❌ OCR failed'}`)
      .join('\n');

    // Build card elements
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const elements: any[] = [
      { tag: 'div', text: { tag: 'lark_md', content:
        `${parsed.uniqueId ? `**Order:** [${parsed.uniqueId}]\n` : ''}` +
        `**Promoter:** ${parsed.promoterName}\n` +
        `**Branch:** ${parsed.branch}\n` +
        `**Date:** ${parsed.date}${parsed.time ? ' ' + parsed.time : ''}\n` +
        `**Luggage:** ${parsed.numberOfLuggage}\n` +
        `**Customer:** ${parsed.customerGender || '-'} | ${parsed.nationality || '-'} | ${parsed.visaType || '-'}\n` +
        `**Products:**\n${parsed.productList || '-'}\n` +
        `**Serial Numbers:**\n${serialList || '  (none)'}`,
      }},
    ];

    // Add images to card (only if uploaded successfully)
    if (imageKeys.length > 0) {
      elements.push({ tag: 'hr' });
      for (const key of imageKeys) {
        elements.push({ tag: 'img', img_key: key, alt: { tag: 'plain_text', content: 'Serial Number Photo' } });
      }
    }

    const larkMsg = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: `🛒 ${parsed.uniqueId ? `[${parsed.uniqueId}] ` : ''}New Sale — ${parsed.promoterName}` },
          template: 'green',
        },
        elements,
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
