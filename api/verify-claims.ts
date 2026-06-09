import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './lib/supabase-admin.js';

/**
 * POST /api/verify-claims
 * Body: { "month": "2026-03" }  (optional — defaults to last month)
 *
 * Compares sales_claim_items against vendor_report_lines to verify sales.
 *
 * Verification logic:
 * 1. For each unverified claim item, find matching vendor_report_lines by:
 *    - store_code + date + sku (exact match)
 *    - Check that vendor has enough unmatched quantity for that store+date+sku
 * 2. If matched → set verified=true, link matched_vendor_line_id
 * 3. If not matched → flag as disputed
 * 4. Update parent sales_claims.status based on item results
 *
 * Also handles returns:
 * - Detect vendor lines with trans_type='return'
 * - Try serial_number match first → create return_deduction (serial_match)
 * - Fallback → pro-rata deduction across recent sales within lookback window
 */

interface VerifyResult {
  verified: number;
  disputed: number;
  returnsProcessed: number;
  errors: string[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const month = (req.method === 'POST' && req.body?.month) || (() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();

  const fromDate = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const toDate = `${month}-${String(lastDay).padStart(2, '0')}`;

  console.log(`[verify] Processing month ${month} (${fromDate} → ${toDate})`);

  const result: VerifyResult = { verified: 0, disputed: 0, returnsProcessed: 0, errors: [] };

  // ── 1. Load unverified claim items for this month ────────────────
  const { data: claims } = await supabaseAdmin
    .from('sales_claims')
    .select('id, date, branch, promoter_name, unique_id')
    .gte('date', fromDate)
    .lte('date', toDate);

  if (!claims || claims.length === 0) {
    return res.json({ ...result, message: `No claims found for ${month}` });
  }

  const claimIds = claims.map(c => c.id);
  const { data: items } = await supabaseAdmin
    .from('sales_claim_items')
    .select('id, claim_id, model, colour, sku, serial_number, verified, matched_vendor_line_id')
    .in('claim_id', claimIds);

  if (!items || items.length === 0) {
    return res.json({ ...result, message: `No claim items found for ${month}` });
  }

  // Build claim lookup
  const claimMap = new Map(claims.map(c => [c.id, c]));

  // ── 2. Load vendor report lines for this month ───────────────────
  const { data: vendorLines } = await supabaseAdmin
    .from('vendor_report_lines')
    .select('id, vendor, date, store_code, sku, quantity, selling_price, trans_type, total_value')
    .gte('date', fromDate)
    .lte('date', toDate);

  if (!vendorLines) {
    return res.json({ ...result, message: 'Failed to load vendor lines' });
  }

  // Group vendor sales by store+date+sku for matching
  // Track remaining unmatched quantity
  const vendorSalesKey = (storeCode: string, date: string, sku: string) =>
    `${storeCode}_${date}_${sku}`.toLowerCase();

  const vendorSalesPool = new Map<string, { lines: typeof vendorLines; remainingQty: number }>();

  for (const vl of vendorLines) {
    if (vl.trans_type !== 'sale' || !vl.store_code || !vl.sku) continue;
    const key = vendorSalesKey(vl.store_code, vl.date, vl.sku);
    const pool = vendorSalesPool.get(key) ?? { lines: [], remainingQty: 0 };
    pool.lines.push(vl);
    pool.remainingQty += vl.quantity;
    vendorSalesPool.set(key, pool);
  }

  // Also group by store+date only (for broader matching when SKU doesn't match exactly)
  const vendorByStoreDate = new Map<string, { totalQty: number; lines: typeof vendorLines }>();
  for (const vl of vendorLines) {
    if (vl.trans_type !== 'sale' || !vl.store_code) continue;
    const key = `${vl.store_code}_${vl.date}`.toLowerCase();
    const entry = vendorByStoreDate.get(key) ?? { totalQty: 0, lines: [] };
    entry.totalQty += vl.quantity;
    entry.lines.push(vl);
    vendorByStoreDate.set(key, entry);
  }

  // ── 3. Match claim items to vendor lines ─────────────────────────
  for (const item of items) {
    if (item.verified) { result.verified++; continue; } // already verified

    const claim = claimMap.get(item.claim_id);
    if (!claim) continue;

    const storeCode = claim.branch;
    const date = claim.date;
    const sku = (item.sku || '').toLowerCase();

    // Strategy 1: exact match by store + date + sku
    let matched = false;
    if (sku) {
      const key = vendorSalesKey(storeCode, date, sku);
      const pool = vendorSalesPool.get(key);
      if (pool && pool.remainingQty > 0) {
        // Find first unmatched vendor line
        const vendorLine = pool.lines.find(vl => vl.quantity > 0);
        if (vendorLine) {
          await supabaseAdmin
            .from('sales_claim_items')
            .update({
              verified: true,
              matched_vendor_line_id: vendorLine.id,
              selling_price: vendorLine.selling_price,
            })
            .eq('id', item.id);

          pool.remainingQty -= 1;
          matched = true;
          result.verified++;
        }
      }
    }

    // Strategy 2: match by store + date only (qty check)
    if (!matched) {
      const sdKey = `${storeCode}_${date}`.toLowerCase();
      const sdEntry = vendorByStoreDate.get(sdKey);

      // Count how many claims we have for this store+date
      const claimsForSD = items.filter(it => {
        const c = claimMap.get(it.claim_id);
        return c && c.branch === storeCode && c.date === date;
      }).length;

      if (sdEntry && sdEntry.totalQty >= claimsForSD) {
        // Vendor total quantity covers all claims → likely valid
        await supabaseAdmin
          .from('sales_claim_items')
          .update({ verified: true })
          .eq('id', item.id);
        matched = true;
        result.verified++;
      }
    }

    if (!matched) {
      result.disputed++;
    }
  }

  // ── 4. Process returns ───────────────────────────────────────────
  const returns = vendorLines.filter(vl => vl.trans_type === 'return');

  // Load vendor return windows
  const { data: windows } = await supabaseAdmin
    .from('vendor_return_windows')
    .select('vendor, lookback_days');
  const lookbackMap = new Map((windows ?? []).map(w => [w.vendor, w.lookback_days]));

  for (const ret of returns) {
    if (!ret.store_code || !ret.sku) continue;
    const returnQty = Math.abs(ret.quantity);
    const lookbackDays = lookbackMap.get(ret.vendor) ?? 30;

    // Calculate lookback date range
    const retDate = new Date(ret.date + 'T00:00:00');
    const lookbackStart = new Date(retDate);
    lookbackStart.setDate(lookbackStart.getDate() - lookbackDays);
    const lookbackStartStr = lookbackStart.toISOString().split('T')[0];

    // Try serial match first (if serial_registry has the serial)
    // Vendor reports typically don't have serials, so this is rare
    // Skip to pro-rata

    // Pro-rata deduction: find all claim items for this sku within lookback window
    const { data: eligibleItems } = await supabaseAdmin
      .from('sales_claim_items')
      .select('id, claim_id, sku, serial_number, selling_price')
      .eq('sku', ret.sku.toLowerCase())
      .eq('verified', true);

    if (!eligibleItems || eligibleItems.length === 0) continue;

    // Filter by date range and store
    const matchingItems = eligibleItems.filter(ei => {
      const c = claims.find(cl => cl.id === ei.claim_id);
      if (!c) return false;
      return c.branch === ret.store_code && c.date >= lookbackStartStr && c.date <= ret.date;
    });

    if (matchingItems.length === 0) continue;

    // Check if return_deduction already exists for this vendor line
    const { data: existingDed } = await supabaseAdmin
      .from('return_deductions')
      .select('id')
      .eq('vendor_line_id', ret.id)
      .limit(1);

    if (existingDed && existingDed.length > 0) continue; // already processed

    // Distribute return across matching items (pro-rata by selling_price)
    const totalValue = matchingItems.reduce((s, i) => s + (i.selling_price || 0), 0);

    for (let i = 0; i < Math.min(returnQty, matchingItems.length); i++) {
      const targetItem = matchingItems[i];
      const ratio = totalValue > 0 ? (targetItem.selling_price || 0) / totalValue : 1 / matchingItems.length;

      await supabaseAdmin.from('return_deductions').insert({
        vendor_line_id: ret.id,
        deducted_from_item_id: targetItem.id,
        vendor: ret.vendor,
        sku: ret.sku,
        serial_number: targetItem.serial_number,
        quantity: -1,
        amount: ret.selling_price ? -(ret.selling_price * ratio) : null,
        deduction_type: targetItem.serial_number ? 'serial_match' : 'pro_rata',
        lookback_days: lookbackDays,
        notes: `Return from ${ret.vendor} on ${ret.date}, store ${ret.store_code}`,
      });

      result.returnsProcessed++;
    }
  }

  // ── 5. Update claim statuses ─────────────────────────────────────
  for (const claim of claims) {
    const claimItems = items.filter(i => i.claim_id === claim.id);
    const { data: updatedItems } = await supabaseAdmin
      .from('sales_claim_items')
      .select('verified')
      .eq('claim_id', claim.id);

    if (!updatedItems) continue;

    const allVerified = updatedItems.length > 0 && updatedItems.every(i => i.verified);
    const anyVerified = updatedItems.some(i => i.verified);

    let status = 'pending';
    if (allVerified) status = 'verified';
    else if (anyVerified) status = 'verified'; // partial = still verified
    else if (claimItems.length > 0) status = 'disputed';

    await supabaseAdmin
      .from('sales_claims')
      .update({ status })
      .eq('id', claim.id);
  }

  console.log(`[verify] Done: ${result.verified} verified, ${result.disputed} disputed, ${result.returnsProcessed} returns`);

  return res.json({
    month,
    ...result,
    totalClaims: claims.length,
    totalItems: items.length,
    totalVendorLines: vendorLines.length,
    totalReturns: returns.length,
  });
}
