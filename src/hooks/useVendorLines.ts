import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { VendorNet } from '../lib/orderCommission';

/** Fetch vendor_report_lines for a month as signed net quantities (returns negative). */
export function useVendorLines(month: string) {
  const [lines, setLines] = useState<VendorNet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fromDate = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const toDate = `${month}-${String(lastDay).padStart(2, '0')}`;

    (async () => {
      const PAGE = 1000;
      const all: Record<string, unknown>[] = [];
      let from = 0, hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase
          .from('vendor_report_lines')
          .select('date, store_code, sku, quantity, trans_type')
          .gte('date', fromDate).lte('date', toDate)
          .range(from, from + PAGE - 1);
        if (error) { console.warn('[useVendorLines]', error.message); break; }
        if (data?.length) all.push(...(data as Record<string, unknown>[]));
        hasMore = (data?.length ?? 0) === PAGE;
        from += PAGE;
      }
      if (cancelled) return;
      setLines(all.map(r => {
        const q = Number(r.quantity || 0);
        const isReturn = String(r.trans_type || '').toLowerCase() === 'return';
        return {
          saleDate: String(r.date).split('T')[0],
          storeCode: r.store_code ? String(r.store_code) : null,
          sku: r.sku ? String(r.sku) : null,
          quantity: isReturn ? -Math.abs(q) : Math.abs(q),
        };
      }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [month]);

  return { lines, loading };
}
