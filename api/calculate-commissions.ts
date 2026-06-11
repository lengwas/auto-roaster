import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './lib/supabase-admin.js';

/**
 * POST /api/calculate-commissions
 * Body: { "month": "2026-03" }  (optional — defaults to last month)
 *
 * For each verified sales_claim_item, find matching commission_rules
 * and calculate commission → insert into commission_ledger.
 *
 * Commission rules matching (highest priority wins):
 * 1. promoter_id + sku_pattern + vendor + date range → most specific
 * 2. promoter_id + date range → promoter-specific rate
 * 3. sku_pattern + date range → product-specific rate
 * 4. Default rule (no filters) → fallback
 *
 * Deductions from return_deductions are subtracted from the ledger.
 */

interface CommissionResult {
  calculated: number;
  skipped: number;
  totalCommission: number;
  deductions: number;
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

  console.log(`[commission] Calculating for ${month} (${fromDate} → ${toDate})`);

  const result: CommissionResult = { calculated: 0, skipped: 0, totalCommission: 0, deductions: 0, errors: [] };

  // ── 1. Load active commission rules. May be empty — when no rule matches
  //      we fall back to the promoter's own commission_rate (PC Setting page). ──
  const { data: rulesData } = await supabaseAdmin
    .from('commission_rules')
    .select('*')
    .eq('active', true)
    .order('priority', { ascending: false });
  const rules = rulesData ?? [];

  // ── 2. Load verified claim items for this month ──────────────────
  const { data: claims } = await supabaseAdmin
    .from('sales_claims')
    .select('id, date, branch, promoter_name')
    .gte('date', fromDate)
    .lte('date', toDate);

  if (!claims || claims.length === 0) {
    return res.json({ ...result, message: `No claims for ${month}` });
  }

  const claimMap = new Map(claims.map(c => [c.id, c]));
  const claimIds = claims.map(c => c.id);

  const { data: items } = await supabaseAdmin
    .from('sales_claim_items')
    .select('id, claim_id, model, sku, selling_price, verified')
    .in('claim_id', claimIds)
    .eq('verified', true);

  if (!items || items.length === 0) {
    return res.json({ ...result, message: `No verified items for ${month}` });
  }

  // ── 3. Load promoter lookup (name → id) ──────────────────────────
  const { data: promoters } = await supabaseAdmin
    .from('promoters')
    .select('id, name, commission_rate');

  const promoterByName = new Map<string, string>();
  const promoterRateById = new Map<string, number>();
  for (const p of promoters ?? []) {
    promoterByName.set(p.name.toLowerCase(), p.id);
    const first = p.name.split(' ')[0].toLowerCase();
    if (!promoterByName.has(first)) promoterByName.set(first, p.id);
    promoterRateById.set(p.id, p.commission_rate != null ? Number(p.commission_rate) : 0.5);
  }

  // ── 4. Check existing ledger entries to avoid duplicates ─────────
  const { data: existingLedger } = await supabaseAdmin
    .from('commission_ledger')
    .select('claim_item_id')
    .eq('month', month);

  const alreadyCalculated = new Set((existingLedger ?? []).map(e => e.claim_item_id));

  // ── 5. Match rules and calculate ─────────────────────────────────
  for (const item of items) {
    if (alreadyCalculated.has(item.id)) { result.skipped++; continue; }

    const claim = claimMap.get(item.claim_id);
    if (!claim) continue;

    const promoterName = claim.promoter_name?.toLowerCase() ?? '';
    const promoterId = promoterByName.get(promoterName) || promoterByName.get(promoterName.split(' ')[0]) || null;
    const itemSku = (item.sku || '').toUpperCase();
    const itemDate = claim.date;

    // Find best matching rule (rules are ordered by priority DESC)
    let bestRule = null;
    for (const rule of rules) {
      // Check date range
      if (rule.valid_from && itemDate < rule.valid_from) continue;
      if (rule.valid_to && itemDate > rule.valid_to) continue;

      // Check promoter match
      if (rule.promoter_id && rule.promoter_id !== promoterId) continue;

      // Check SKU pattern match (SQL LIKE style: % = wildcard)
      if (rule.sku_pattern) {
        const pattern = rule.sku_pattern.toUpperCase();
        if (pattern.includes('%')) {
          const regex = new RegExp('^' + pattern.replace(/%/g, '.*') + '$', 'i');
          if (!regex.test(itemSku)) continue;
        } else if (pattern !== itemSku) {
          continue;
        }
      }

      // Check vendor match
      if (rule.vendor) {
        // We'd need vendor info from matched_vendor_line — skip for now if no match
        // This is a soft filter
      }

      bestRule = rule;
      break; // highest priority that matches
    }

    // Effective rate: a matched rule wins; otherwise fall back to the promoter's
    // own commission_rate (% set on the PC Setting page).
    let ruleId: string | null = null;
    let rateValue: number;
    let rateType = 'percentage';
    if (bestRule) {
      ruleId = bestRule.id;
      rateValue = bestRule.rate_value;
      rateType = bestRule.rate_type;
    } else if (promoterId && promoterRateById.has(promoterId)) {
      rateValue = promoterRateById.get(promoterId)!;
    } else {
      result.skipped++;
      continue;
    }

    // Calculate commission
    const sellingPrice = item.selling_price || 0;
    const commissionAmount = rateType === 'fixed' ? rateValue : sellingPrice * (rateValue / 100);

    // Insert ledger entry
    const { error: ledgerErr } = await supabaseAdmin
      .from('commission_ledger')
      .insert({
        claim_item_id: item.id,
        promoter_id: promoterId,
        date: itemDate,
        store_code: claim.branch,
        model: item.model,
        sku: item.sku,
        selling_price: sellingPrice,
        commission_rule_id: ruleId,
        commission_rate: rateValue,
        commission_amount: Math.round(commissionAmount * 100) / 100,
        month,
        status: 'pending',
      });

    if (ledgerErr) {
      result.errors.push(`Item ${item.id}: ${ledgerErr.message}`);
    } else {
      result.calculated++;
      result.totalCommission += commissionAmount;
    }
  }

  // ── 6. Apply return deductions ───────────────────────────────────
  const { data: deductions } = await supabaseAdmin
    .from('return_deductions')
    .select('id, deducted_from_item_id, amount')
    .not('deducted_from_item_id', 'is', null);

  if (deductions) {
    for (const ded of deductions) {
      if (!ded.deducted_from_item_id || !ded.amount) continue;

      // Find matching ledger entry
      const { data: ledgerEntry } = await supabaseAdmin
        .from('commission_ledger')
        .select('id, commission_amount, status')
        .eq('claim_item_id', ded.deducted_from_item_id)
        .eq('month', month)
        .single();

      if (ledgerEntry && ledgerEntry.status !== 'deducted') {
        const deductionAmt = Math.abs(ded.amount);
        const newAmount = Math.max(0, (ledgerEntry.commission_amount || 0) - deductionAmt);

        await supabaseAdmin
          .from('commission_ledger')
          .update({
            commission_amount: Math.round(newAmount * 100) / 100,
            status: 'deducted',
            notes: `Return deduction: -${deductionAmt.toFixed(2)} AED`,
          })
          .eq('id', ledgerEntry.id);

        // Link deduction to ledger
        await supabaseAdmin
          .from('return_deductions')
          .update({ deducted_from_ledger_id: ledgerEntry.id })
          .eq('id', ded.id);

        result.deductions++;
        result.totalCommission -= deductionAmt;
      }
    }
  }

  result.totalCommission = Math.round(result.totalCommission * 100) / 100;

  console.log(`[commission] Done: ${result.calculated} calculated, ${result.skipped} skipped, total: ${result.totalCommission} AED, ${result.deductions} deductions`);

  return res.json({ month, ...result });
}
