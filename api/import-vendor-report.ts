import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './lib/supabase-admin.js';
import { parseVendorReport, isVendor } from './lib/vendor-parse.js';

const BUCKET = 'vendor-reports';

/**
 * POST /api/import-vendor-report
 * Body: { "storagePath": "virgin/2026-05/file.xlsx", "vendor": "virgin", "month": "2026-05", "fileName": "..." }
 *
 * Downloads the previously-uploaded report from Supabase Storage, parses it with
 * the vendor-specific parser, replaces that (vendor, month)'s rows in
 * vendor_report_lines, and records the upload in vendor_report_uploads.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { storagePath, vendor, month, fileName } = (req.body || {}) as {
    storagePath?: string; vendor?: string; month?: string; fileName?: string; country?: string;
  };
  if (!storagePath || !vendor) return res.status(400).json({ error: 'storagePath and vendor are required' });
  if (!isVendor(vendor)) return res.status(400).json({ error: `Unknown vendor "${vendor}" (virgin|jashanmal|hamleys)` });

  // A vendor (e.g. Virgin) can report in more than one country via different
  // distributors. Store codes never overlap across countries, so we scope the
  // idempotent replace to the country of the file being uploaded.
  const QA_STORE_CODES = new Set(['KMQ', 'KLM', 'RKT', 'KVD', 'LGF', 'VDF', 'VLM', 'VMQ', 'ORI', 'VVD', 'VVG']);
  const countryOf = (code: string | null | undefined) =>
    code && QA_STORE_CODES.has(String(code).toUpperCase().trim()) ? 'QA' : 'UAE';

  try {
    // 1. Download the uploaded file from Storage
    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(storagePath);
    if (dlErr || !blob) throw new Error(`Storage download failed: ${dlErr?.message || 'no data'}`);
    const buffer = Buffer.from(await blob.arrayBuffer());

    // 2. Vendor store map (vendor_store_id -> our store_code)
    const { data: mapRows, error: mapErr } = await supabaseAdmin
      .from('vendor_store_map').select('vendor_store_id, store_code').eq('vendor', vendor);
    if (mapErr) throw new Error(`store map: ${mapErr.message}`);
    const storeMap: Record<string, string> = {};
    (mapRows || []).forEach((r: { vendor_store_id: string; store_code: string }) => { storeMap[r.vendor_store_id] = r.store_code; });

    // 3. Parse
    const lines = parseVendorReport(buffer, vendor, storeMap);
    if (lines.length === 0) return res.status(200).json({ rows: 0, message: 'No rows parsed from file' });

    const months = [...new Set(lines.map(l => l.report_month).filter(Boolean))] as string[];
    const sales = lines.filter(l => l.trans_type === 'sale').length;
    const returns = lines.filter(l => l.trans_type === 'return').length;
    const unmappedStores = [...new Set(lines.filter(l => !l.store_code && l.vendor_store_id).map(l => l.vendor_store_id))];

    // 4. Idempotent replace — scoped to this file's country so uploading e.g.
    //    Qatar Virgin doesn't wipe UAE Virgin for the same month. The country is
    //    derived from the parsed store codes (self-correcting regardless of which
    //    country view the upload was triggered from).
    const fileCountry = lines.some(l => countryOf(l.store_code) === 'QA' && l.store_code) ? 'QA' : 'UAE';
    if (months.length > 0) {
      const { data: existing, error: selErr } = await supabaseAdmin
        .from('vendor_report_lines').select('id, store_code').eq('vendor', vendor).in('report_month', months);
      if (selErr) throw new Error(`read existing: ${selErr.message}`);
      const delIds = (existing || []).filter(r => countryOf(r.store_code) === fileCountry).map(r => r.id);
      for (let i = 0; i < delIds.length; i += 500) {
        const { error: delErr } = await supabaseAdmin
          .from('vendor_report_lines').delete().in('id', delIds.slice(i, i + 500));
        if (delErr) throw new Error(`clear existing: ${delErr.message}`);
      }
    }

    // 5. Insert in batches
    const BATCH = 500;
    for (let i = 0; i < lines.length; i += BATCH) {
      const { error: insErr } = await supabaseAdmin.from('vendor_report_lines').insert(lines.slice(i, i + BATCH));
      if (insErr) throw new Error(`insert batch: ${insErr.message}`);
    }

    // 6. Record the upload (best-effort; ignore if table absent)
    await supabaseAdmin.from('vendor_report_uploads').insert({
      vendor, report_month: month || months[0] || null, file_name: fileName || storagePath.split('/').pop(),
      storage_path: storagePath, row_count: lines.length, sales_count: sales, return_count: returns,
      unmapped_stores: unmappedStores,
    });

    return res.status(200).json({ rows: lines.length, sales, returns, months, unmappedStores, country: fileCountry });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[import-vendor-report]', msg);
    return res.status(500).json({ error: msg });
  }
}
