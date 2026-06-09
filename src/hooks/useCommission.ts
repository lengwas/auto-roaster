import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface CommissionLedgerEntry {
  id: string;
  claimItemId: string;
  promoterId: string | null;
  date: string;
  storeCode: string | null;
  model: string | null;
  sku: string | null;
  sellingPrice: number;
  commissionRate: number;
  commissionAmount: number;
  month: string;
  status: string;
  notes: string | null;
}

export interface CommissionRule {
  id: string;
  name: string;
  promoterId: string | null;
  skuPattern: string | null;
  vendor: string | null;
  rateType: 'percentage' | 'fixed';
  rateValue: number;
  validFrom: string | null;
  validTo: string | null;
  priority: number;
  active: boolean;
}

export interface ClaimWithItems {
  id: string;
  submissionId: string;
  uniqueId: string | null;
  date: string;
  promoterName: string;
  branch: string;
  numberOfLuggage: number;
  productList: string | null;
  status: string;
  items: {
    id: string;
    model: string | null;
    colour: string | null;
    sku: string | null;
    serialNumber: string | null;
    ocrStatus: string;
    verified: boolean;
    sellingPrice: number | null;
  }[];
}

export interface VerificationSummary {
  totalClaims: number;
  verifiedClaims: number;
  disputedClaims: number;
  pendingClaims: number;
  totalItems: number;
  verifiedItems: number;
  ocrSuccess: number;
  ocrFailed: number;
  totalCommission: number;
}

export function useCommissionData(month: string) {
  const [claims, setClaims] = useState<ClaimWithItems[]>([]);
  const [ledger, setLedger] = useState<CommissionLedgerEntry[]>([]);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [summary, setSummary] = useState<VerificationSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const fromDate = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const toDate = `${month}-${String(lastDay).padStart(2, '0')}`;

    async function fetchAll() {
      // Fetch claims
      const { data: claimsData } = await supabase
        .from('sales_claims')
        .select('id, submission_id, unique_id, date, promoter_name, branch, number_of_luggage, product_list, status')
        .gte('date', fromDate)
        .lte('date', toDate)
        .order('date', { ascending: false });

      // Fetch all items for these claims
      const claimIds = (claimsData ?? []).map(c => c.id);
      let itemsData: Record<string, unknown>[] = [];
      if (claimIds.length > 0) {
        // Batch fetch in chunks of 100
        for (let i = 0; i < claimIds.length; i += 100) {
          const chunk = claimIds.slice(i, i + 100);
          const { data } = await supabase
            .from('sales_claim_items')
            .select('id, claim_id, model, colour, sku, serial_number, ocr_status, verified, selling_price')
            .in('claim_id', chunk);
          if (data) itemsData.push(...(data as Record<string, unknown>[]));
        }
      }

      // Build claims with items
      const itemsByClaim = new Map<string, typeof itemsData>();
      for (const item of itemsData) {
        const cid = String(item.claim_id);
        const list = itemsByClaim.get(cid) ?? [];
        list.push(item);
        itemsByClaim.set(cid, list);
      }

      const mapped: ClaimWithItems[] = (claimsData ?? []).map(c => ({
        id: c.id,
        submissionId: String(c.submission_id),
        uniqueId: c.unique_id ? String(c.unique_id) : null,
        date: String(c.date).split('T')[0],
        promoterName: String(c.promoter_name),
        branch: String(c.branch),
        numberOfLuggage: Number(c.number_of_luggage || 0),
        productList: c.product_list ? String(c.product_list) : null,
        status: String(c.status),
        items: (itemsByClaim.get(c.id) ?? []).map(i => ({
          id: String(i.id),
          model: i.model ? String(i.model) : null,
          colour: i.colour ? String(i.colour) : null,
          sku: i.sku ? String(i.sku) : null,
          serialNumber: i.serial_number ? String(i.serial_number) : null,
          ocrStatus: String(i.ocr_status || 'pending'),
          verified: Boolean(i.verified),
          sellingPrice: i.selling_price != null ? Number(i.selling_price) : null,
        })),
      }));
      setClaims(mapped);

      // Fetch ledger
      const { data: ledgerData } = await supabase
        .from('commission_ledger')
        .select('*')
        .eq('month', month)
        .order('date', { ascending: false });

      setLedger((ledgerData ?? []).map(l => ({
        id: String(l.id),
        claimItemId: String(l.claim_item_id),
        promoterId: l.promoter_id ? String(l.promoter_id) : null,
        date: String(l.date).split('T')[0],
        storeCode: l.store_code ? String(l.store_code) : null,
        model: l.model ? String(l.model) : null,
        sku: l.sku ? String(l.sku) : null,
        sellingPrice: Number(l.selling_price || 0),
        commissionRate: Number(l.commission_rate || 0),
        commissionAmount: Number(l.commission_amount || 0),
        month: String(l.month),
        status: String(l.status),
        notes: l.notes ? String(l.notes) : null,
      })));

      // Fetch rules
      const { data: rulesData } = await supabase
        .from('commission_rules')
        .select('*')
        .order('priority', { ascending: false });

      setRules((rulesData ?? []).map(r => ({
        id: String(r.id),
        name: String(r.name),
        promoterId: r.promoter_id ? String(r.promoter_id) : null,
        skuPattern: r.sku_pattern ? String(r.sku_pattern) : null,
        vendor: r.vendor ? String(r.vendor) : null,
        rateType: String(r.rate_type) as 'percentage' | 'fixed',
        rateValue: Number(r.rate_value),
        validFrom: r.valid_from ? String(r.valid_from) : null,
        validTo: r.valid_to ? String(r.valid_to) : null,
        priority: Number(r.priority || 0),
        active: Boolean(r.active),
      })));

      // Compute summary
      const allItems = mapped.flatMap(c => c.items);
      setSummary({
        totalClaims: mapped.length,
        verifiedClaims: mapped.filter(c => c.status === 'verified').length,
        disputedClaims: mapped.filter(c => c.status === 'disputed').length,
        pendingClaims: mapped.filter(c => c.status === 'pending').length,
        totalItems: allItems.length,
        verifiedItems: allItems.filter(i => i.verified).length,
        ocrSuccess: allItems.filter(i => i.ocrStatus === 'success').length,
        ocrFailed: allItems.filter(i => i.ocrStatus === 'failed').length,
        totalCommission: (ledgerData ?? []).reduce((s, l) => s + Number(l.commission_amount || 0), 0),
      });

      setLoading(false);
    }

    fetchAll();
  }, [month]);

  return { claims, ledger, rules, summary, loading };
}
