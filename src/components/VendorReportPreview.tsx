import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Country } from '../types/types';

const VENDORS = ['virgin', 'jashanmal', 'sharaf', 'hamleys', 'borders'] as const;
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

// Qatar store codes (mirrors stores_qa) — used to scope the preview to the
// current country since codes never overlap between countries.
const QA_STORE_CODES = new Set(['KMQ', 'KLM', 'RKT', 'KVD', 'LGF', 'VDF', 'VLM', 'VMQ', 'ORI', 'VVD', 'VVG']);
const countryOf = (code: string | null): Country =>
  code && QA_STORE_CODES.has(code.toUpperCase().trim()) ? 'QA' : 'UAE';

interface Line { date: string; storeCode: string | null; sku: string | null; quantity: number; sellingPrice: number | null; isReturn: boolean; }

/** After uploading a vendor report, preview what it says was sold per day × store × sku. */
const VendorReportPreview = ({ month, country }: { month: string; country: Country }) => {
  const [vendor, setVendor] = useState<string>('virgin');
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const [y, m] = month.split('-').map(Number);
    const from = `${month}-01`;
    const to = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    (async () => {
      const { data, error } = await supabase
        .from('vendor_report_lines')
        .select('date, store_code, sku, quantity, selling_price, trans_type')
        .eq('vendor', vendor).gte('date', from).lte('date', to)
        .order('date').order('store_code');
      if (cancelled) return;
      if (error) { console.warn('[VendorReportPreview]', error.message); setLines([]); }
      else setLines((data ?? [])
        .filter(r => countryOf(r.store_code ? String(r.store_code) : null) === country)
        .map(r => ({
          date: String(r.date).split('T')[0],
          storeCode: r.store_code ? String(r.store_code) : null,
          sku: r.sku ? String(r.sku) : null,
          quantity: Number(r.quantity || 0),
          sellingPrice: r.selling_price != null ? Number(r.selling_price) : null,
          isReturn: String(r.trans_type || '').toLowerCase() === 'return',
        })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [vendor, month, country]);

  // Explode a "qty N" line into N rows of 1 unit each (vendor sells 3 → 3 rows).
  const exploded = useMemo(() => lines.flatMap(l => {
    const units = Math.max(1, Math.round(Math.abs(l.quantity)));
    return Array.from({ length: units }, () => ({ ...l, quantity: l.isReturn ? -1 : 1 }));
  }), [lines]);

  const totals = useMemo(() => {
    const sales = exploded.filter(l => !l.isReturn);
    const returns = exploded.filter(l => l.isReturn);
    return {
      units: sales.length,
      returns: returns.length,
      stores: new Set(exploded.map(l => l.storeCode)).size,
    };
  }, [exploded]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 12px' }}>
        <strong style={{ fontSize: 13 }}>Vendor report preview</strong>
        <select value={vendor} onChange={e => setVendor(e.target.value)} style={{ padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db' }}>
          {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#6b7280' }}>month {month}</span>
        {!loading && <span style={{ fontSize: 12, color: '#9ca3af' }}>
          {totals.units} units · {totals.stores} stores · {totals.returns} returns (1 row = 1 unit)
        </span>}
      </div>

      {loading ? <p style={{ color: '#6b7280', fontSize: 13 }}>Loading…</p> : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: '#f9fafb', textAlign: 'left' }}>
              {['Date', 'Store', 'SKU', 'Qty', 'Unit price', 'Type'].map(h => <th key={h} style={{ padding: 6 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {exploded.map((l, i) => (
                <tr key={i} style={{ borderTop: '1px solid #f1f5f9', background: l.isReturn ? '#fff7f7' : undefined }}>
                  <td style={{ padding: 6 }}>{l.date}</td>
                  <td style={{ padding: 6 }}>{l.storeCode ?? '—'}</td>
                  <td style={{ padding: 6, fontFamily: 'monospace' }}>{l.sku ?? '—'}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{l.isReturn ? -1 : 1}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{l.sellingPrice != null ? fmt(l.sellingPrice) : '—'}</td>
                  <td style={{ padding: 6, color: l.isReturn ? '#be123c' : '#16a34a' }}>{l.isReturn ? 'return' : 'sale'}</td>
                </tr>
              ))}
              {exploded.length === 0 && <tr><td colSpan={6} style={{ padding: 16, textAlign: 'center', color: '#9ca3af' }}>No {vendor} report data for {month}. Upload it above.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default VendorReportPreview;
