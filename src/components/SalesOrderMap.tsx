import { useEffect, useMemo, useState } from 'react';
import type { Store, Country } from '../types/types';
import { useOrders } from '../hooks/useOrders';
import { supabase } from '../lib/supabase';
import { buildStoreByWarehouse, vendorOfStore, normalizeProductSku } from '../lib/orderCommission';

const VENDORS = ['virgin', 'jashanmal', 'sharaf', 'hamleys', 'borders'] as const;
const EXCLUDED = new Set(['cancelled', 'canceled', 'returned', 'void', 'refund', 'cn']);
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

interface VLine { date: string; storeCode: string | null; sku: string | null; vendor: string; price: number | null; }
interface MapRow {
  key: string; date: string; storeCode: string | null; sku: string | null;
  salesperson: string | null; amount: number | null; vendor: string | null;
  vendorPrice: number | null; kind: 'order' | 'vendoronly'; matched: boolean;
}

interface Props { month: string; country: Country; stores: Store[]; }

/** #2 — Map sales orders against each vendor's reported sales (qty/price), sorted by date.
 *  Vendor units with no matching sales order are inserted as flagged rows. */
const SalesOrderMap = ({ month, country, stores }: Props) => {
  const { orders, loading: ordersLoading } = useOrders(12, country);
  const [vlines, setVlines] = useState<VLine[]>([]);
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const [y, m] = month.split('-').map(Number);
    const from = `${month}-01`, to = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    (async () => {
      const { data: v } = await supabase.from('vendor_report_lines')
        .select('date, store_code, sku, vendor, quantity, selling_price, trans_type')
        .gte('date', from).lte('date', to);
      const { data: ov } = await supabase.from('commission_overrides').select('row_key, note');
      if (cancelled) return;
      // explode vendor sale lines to 1 unit per row
      const exploded: VLine[] = [];
      for (const r of (v ?? [])) {
        if (String(r.trans_type || '').toLowerCase() === 'return') continue;
        const units = Math.max(1, Math.round(Math.abs(Number(r.quantity || 0))));
        for (let i = 0; i < units; i++) exploded.push({
          date: String(r.date).split('T')[0], storeCode: r.store_code ? String(r.store_code) : null,
          sku: r.sku ? String(r.sku) : null, vendor: String(r.vendor || ''),
          price: r.selling_price != null ? Number(r.selling_price) : null,
        });
      }
      setVlines(exploded);
      setOverrides(new Map((ov ?? []).map((o: { row_key: string; note: string }) => [o.row_key, o.note])));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [month]);

  const rows = useMemo<MapRow[]>(() => {
    const storeByWh = buildStoreByWarehouse(stores, country);
    // vendor unit pool keyed by vendor|store|sku
    const pool = new Map<string, VLine[]>();
    for (const v of vlines) {
      const k = `${v.vendor}|${v.storeCode}|${(v.sku || '').toUpperCase()}`;
      (pool.get(k) ?? pool.set(k, []).get(k)!).push(v);
    }
    const out: MapRow[] = [];
    const monthOrders = orders
      .filter(o => o.date.startsWith(month) && !EXCLUDED.has(o.status.toLowerCase()))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    for (const o of monthOrders) {
      const store = o.warehouse ? storeByWh.get(o.warehouse.toLowerCase().trim()) : undefined;
      const storeCode = store?.code ?? null;
      const sku = normalizeProductSku(o.sku);
      const vendor = vendorOfStore(storeCode);
      let vendorPrice: number | null = null, matched = false;
      if (vendor && storeCode) {
        const arr = pool.get(`${vendor}|${storeCode}|${sku}`);
        if (arr && arr.length) { const u = arr.shift()!; vendorPrice = u.price; matched = true; }
      }
      out.push({
        key: o.id, date: o.date, storeCode, sku, salesperson: o.salesperson ?? null,
        amount: o.amountAed ?? null, vendor, vendorPrice, kind: 'order', matched,
      });
    }
    // leftover vendor units → vendor-only rows (vendor reported, no sales order)
    for (const [, arr] of pool) {
      for (const u of arr) out.push({
        key: `vendoronly:${u.date}|${u.storeCode}|${u.sku}|${u.vendor}`,
        date: u.date, storeCode: u.storeCode, sku: u.sku, salesperson: null,
        amount: null, vendor: u.vendor, vendorPrice: u.price, kind: 'vendoronly', matched: false,
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.storeCode || '').localeCompare(b.storeCode || ''));
  }, [orders, vlines, stores, country, month]);

  const saveOverride = async (key: string, note: string) => {
    setOverrides(prev => new Map(prev).set(key, note));
    await supabase.from('commission_overrides').upsert({ row_key: key, note, updated_at: new Date().toISOString() }, { onConflict: 'row_key' });
  };

  const vendorOnly = rows.filter(r => r.kind === 'vendoronly').length;
  if (ordersLoading || loading) return <p style={{ padding: 16, color: '#6b7280' }}>Loading orders & vendor reports…</p>;

  return (
    <div>
      <div style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 10px' }}>
        {rows.length} rows · {vendorOnly > 0 && <span style={{ color: '#be123c', fontWeight: 600 }}>{vendorOnly} vendor-only (no sales order — inserted by date)</span>}
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
          <thead><tr style={{ background: '#f9fafb', textAlign: 'left' }}>
            <th style={{ padding: 6 }}>Date</th><th style={{ padding: 6 }}>Sales Order</th>
            {VENDORS.map(v => <th key={v} style={{ padding: 6, textTransform: 'capitalize' }}>{v}</th>)}
            <th style={{ padding: 6 }}>Overwrite</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} style={{ borderTop: '1px solid #f1f5f9', background: r.kind === 'vendoronly' ? '#fff7f7' : (r.matched ? undefined : '#fffdf5') }}>
                <td style={{ padding: 6 }}>{r.date}</td>
                <td style={{ padding: 6 }}>
                  {r.kind === 'vendoronly'
                    ? <span style={{ color: '#be123c' }}>⚠ no sales order — {r.storeCode} {r.sku}</span>
                    : <span>{r.storeCode} · {r.sku} · {r.salesperson ?? '—'} · {r.amount != null ? fmt(r.amount) : '—'}</span>}
                </td>
                {VENDORS.map(v => (
                  <td key={v} style={{ padding: 6, textAlign: 'right', color: r.vendor === v ? (r.vendorPrice != null ? '#16a34a' : '#dc2626') : '#e5e7eb' }}>
                    {r.vendor === v ? (r.vendorPrice != null ? `1 · ${fmt(r.vendorPrice)}` : '✗') : ''}
                  </td>
                ))}
                <td style={{ padding: 6 }}>
                  <input defaultValue={overrides.get(r.key) ?? ''} placeholder="fix…"
                    onBlur={e => { if (e.target.value !== (overrides.get(r.key) ?? '')) saveOverride(r.key, e.target.value); }}
                    style={{ width: 120, fontSize: 12, padding: '2px 6px', border: '1px solid #d1d5db', borderRadius: 4 }} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} style={{ padding: 16, textAlign: 'center', color: '#9ca3af' }}>No orders/vendor data for {month}.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SalesOrderMap;
