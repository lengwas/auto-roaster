import { useEffect, useMemo, useState } from 'react';
import type { Store, Promoter, Country } from '../types/types';
import { useOrders } from '../hooks/useOrders';
import { useShifts } from '../hooks/useShifts';
import { supabase } from '../lib/supabase';
import { buildStoreByWarehouse, vendorOfStore, normalizeProductSku } from '../lib/orderCommission';

const VENDORS = ['virgin', 'jashanmal', 'sharaf', 'hamleys', 'borders'] as const;
const EXCLUDED = new Set(['cancelled', 'canceled', 'returned', 'void', 'refund', 'cn']);
const LEAVE = new Set(['off', 'lop', 'sl', 'al', '']);
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const norm = (s: string | null | undefined) => (s || '').toLowerCase().trim();

interface VLine { date: string; storeCode: string | null; sku: string | null; vendor: string; price: number | null; }
interface Ovr { note?: string; approved?: boolean | null; }
interface MapRow {
  key: string; date: string; storeCode: string | null; sku: string | null;
  salesperson: string | null; serial: string | null; amount: number | null;
  vendor: string | null; vendorPrice: number | null;
  kind: 'order' | 'vendoronly' | 'return';
  matched: boolean; shiftType: string | null; shiftMatch: boolean;
  jotform: boolean | null; autoApprove: boolean;
}

interface Props { month: string; country: Country; stores: Store[]; promoters: Promoter[]; }

/** #2 — Map sales orders against vendor reports (qty/price), the promoter's shift that day,
 *  and their Jotform claim. Auto-approve when everything agrees; flag mismatches for review. */
const SalesOrderMap = ({ month, country, stores, promoters }: Props) => {
  const { orders, loading: ordersLoading } = useOrders(12, country);
  const { shifts } = useShifts(country);
  const [vsales, setVsales] = useState<VLine[]>([]);
  const [vreturns, setVreturns] = useState<VLine[]>([]);
  const [claimSerials, setClaimSerials] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, Ovr>>(new Map());
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
      const { data: ov } = await supabase.from('commission_overrides').select('row_key, note, approved');
      // Jotform claim serials for the month
      const { data: cl } = await supabase.from('sales_claims').select('id').gte('date', from).lte('date', to);
      const claimIds = (cl ?? []).map((c: { id: string }) => c.id);
      const serials = new Set<string>();
      for (let i = 0; i < claimIds.length; i += 100) {
        const { data: items } = await supabase.from('sales_claim_items')
          .select('serial_number').in('claim_id', claimIds.slice(i, i + 100));
        (items ?? []).forEach((it: { serial_number: string | null }) => { if (it.serial_number) serials.add(String(it.serial_number).toUpperCase().trim()); });
      }
      if (cancelled) return;
      const sales: VLine[] = [], returns: VLine[] = [];
      for (const r of (v ?? [])) {
        const isReturn = String(r.trans_type || '').toLowerCase() === 'return' || Number(r.quantity || 0) < 0;
        const units = Math.max(1, Math.round(Math.abs(Number(r.quantity || 0))));
        const base: VLine = {
          date: String(r.date).split('T')[0], storeCode: r.store_code ? String(r.store_code) : null,
          sku: r.sku ? String(r.sku) : null, vendor: String(r.vendor || ''),
          price: r.selling_price != null ? Number(r.selling_price) : null,
        };
        for (let i = 0; i < units; i++) (isReturn ? returns : sales).push({ ...base });
      }
      setVsales(sales); setVreturns(returns); setClaimSerials(serials);
      setOverrides(new Map((ov ?? []).map((o: { row_key: string; note: string | null; approved: boolean | null }) => [o.row_key, { note: o.note ?? undefined, approved: o.approved }])));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [month]);

  const rows = useMemo<MapRow[]>(() => {
    const storeByWh = buildStoreByWarehouse(stores, country);
    const promoterByName = (sp: string | null): Promoter | undefined => {
      const n = norm(sp); if (!n) return undefined;
      return promoters.find(p => norm(p.name) === n || norm(p.name).startsWith(n) || n.startsWith(norm(p.name)));
    };
    const shiftStore = new Map<string, string>(); // promoterId|date -> store type
    for (const s of shifts) shiftStore.set(`${s.promoterId}|${s.date}`, s.type);

    const pool = new Map<string, VLine[]>();
    for (const v of vsales) {
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
      const promoter = promoterByName(o.salesperson ?? null);
      const shiftType = promoter ? (shiftStore.get(`${promoter.id}|${o.date}`) ?? null) : null;
      const shiftMatch = !!shiftType && !LEAVE.has(shiftType.toLowerCase()) && shiftType === storeCode;
      const serial = o.serialNumber ? o.serialNumber.toUpperCase().trim() : null;
      const jotform = serial ? claimSerials.has(serial) : null;
      const autoApprove = matched && shiftMatch && jotform === true;
      out.push({
        key: o.id, date: o.date, storeCode, sku, salesperson: o.salesperson ?? null, serial,
        amount: o.amountAed ?? null, vendor, vendorPrice, kind: 'order',
        matched, shiftType, shiftMatch, jotform, autoApprove,
      });
    }
    // vendor-only sale rows (vendor reported a sale, no matching order)
    for (const [, arr] of pool) for (const u of arr) out.push({
      key: `vendoronly:${u.date}|${u.storeCode}|${u.sku}|${u.vendor}`,
      date: u.date, storeCode: u.storeCode, sku: u.sku, salesperson: null, serial: null,
      amount: null, vendor: u.vendor, vendorPrice: u.price, kind: 'vendoronly',
      matched: false, shiftType: null, shiftMatch: false, jotform: null, autoApprove: false,
    });
    // vendor return rows
    vreturns.forEach((u, i) => out.push({
      key: `return:${u.date}|${u.storeCode}|${u.sku}|${u.vendor}|${i}`,
      date: u.date, storeCode: u.storeCode, sku: u.sku, salesperson: null, serial: null,
      amount: null, vendor: u.vendor, vendorPrice: u.price, kind: 'return',
      matched: false, shiftType: null, shiftMatch: false, jotform: null, autoApprove: false,
    }));
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.storeCode || '').localeCompare(b.storeCode || ''));
  }, [orders, shifts, vsales, vreturns, claimSerials, stores, promoters, country, month]);

  const save = async (key: string, patch: Ovr) => {
    const cur = overrides.get(key) ?? {};
    const merged = { ...cur, ...patch };
    setOverrides(prev => new Map(prev).set(key, merged));
    await supabase.from('commission_overrides').upsert(
      { row_key: key, note: merged.note ?? null, approved: merged.approved ?? null, updated_at: new Date().toISOString() },
      { onConflict: 'row_key' });
  };

  const counts = useMemo(() => ({
    vendorOnly: rows.filter(r => r.kind === 'vendoronly').length,
    returns: rows.filter(r => r.kind === 'return').length,
    flagged: rows.filter(r => r.kind === 'order' && !r.autoApprove && (overrides.get(r.key)?.approved == null)).length,
  }), [rows, overrides]);

  if (ordersLoading || loading) return <p style={{ padding: 16, color: '#6b7280' }}>Loading orders, vendor reports, shifts & claims…</p>;

  const th = (label: string, align: 'left' | 'center' = 'left') => <th style={{ padding: '7px 10px', border: '1px solid #cbd5e1', textAlign: align, textTransform: 'capitalize' }}>{label}</th>;

  return (
    <div>
      <div style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 10px', display: 'flex', gap: 14 }}>
        <span>{rows.length} rows</span>
        {counts.flagged > 0 && <span style={{ color: '#b45309', fontWeight: 600 }}>⚠ {counts.flagged} need review</span>}
        {counts.vendorOnly > 0 && <span style={{ color: '#be123c' }}>{counts.vendorOnly} vendor-only</span>}
        {counts.returns > 0 && <span style={{ color: '#be123c' }}>{counts.returns} returns</span>}
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
          <thead><tr style={{ background: '#eef2f6' }}>
            {th('Date')}{th('Sales Order')}{th('Shift', 'center')}{th('Jotform', 'center')}
            {VENDORS.map(v => <th key={v} style={{ padding: '7px 10px', border: '1px solid #cbd5e1', textAlign: 'center', textTransform: 'capitalize' }}>{v}</th>)}
            {th('Approved', 'center')}{th('Overwrite')}
          </tr></thead>
          <tbody>
            {rows.map(r => {
              const ov = overrides.get(r.key);
              const approved = ov?.approved != null ? ov.approved : r.autoApprove;
              const needsReview = r.kind === 'order' && !r.autoApprove && ov?.approved == null;
              const bg = r.kind === 'return' ? '#fee2e2' : r.kind === 'vendoronly' ? '#fff1f2' : needsReview ? '#fffbeb' : (approved ? '#f0fdf4' : '#fff');
              const cell = { padding: '6px 10px', border: '1px solid #e2e8f0' } as const;
              return (
                <tr key={r.key} style={{ background: bg }}>
                  <td style={cell}>{r.date}</td>
                  <td style={cell}>
                    {r.kind === 'return' ? <span style={{ color: '#be123c' }}>↩ RETURN — {r.storeCode} {r.sku} ({r.vendor})</span>
                      : r.kind === 'vendoronly' ? <span style={{ color: '#be123c' }}>⚠ no sales order — {r.storeCode} {r.sku}</span>
                      : <span>{r.storeCode} · {r.sku} · {r.salesperson ?? '—'} · {r.amount != null ? fmt(r.amount) : '—'}</span>}
                  </td>
                  {/* Shift */}
                  <td style={{ ...cell, textAlign: 'center', color: r.kind !== 'order' ? '#cbd5e1' : r.shiftMatch ? '#16a34a' : '#dc2626' }}>
                    {r.kind !== 'order' ? '·' : (r.shiftType ? (r.shiftMatch ? r.shiftType : `⚠ ${r.shiftType}`) : '⚠ no shift')}
                  </td>
                  {/* Jotform */}
                  <td style={{ ...cell, textAlign: 'center', color: r.kind !== 'order' ? '#cbd5e1' : r.jotform === true ? '#16a34a' : r.jotform === false ? '#dc2626' : '#9ca3af' }}>
                    {r.kind !== 'order' ? '·' : r.jotform === true ? '✓' : r.jotform === false ? '✗' : '—'}
                  </td>
                  {VENDORS.map(v => (
                    <td key={v} style={{ ...cell, textAlign: 'center', fontWeight: r.vendor === v ? 600 : 400, color: r.vendor === v ? (r.vendorPrice != null ? (r.kind === 'return' ? '#be123c' : '#16a34a') : '#dc2626') : '#cbd5e1' }}>
                      {r.vendor === v ? (r.kind === 'return' ? `↩ ${r.vendorPrice != null ? fmt(r.vendorPrice) : ''}` : r.vendorPrice != null ? `✓ ${fmt(r.vendorPrice)}` : '✗') : '·'}
                    </td>
                  ))}
                  {/* Approved */}
                  <td style={{ ...cell, textAlign: 'center' }}>
                    {r.kind === 'order' ? (
                      <input type="checkbox" checked={approved} title={needsReview ? 'Mismatch — review then approve' : 'auto-approved'}
                        onChange={e => save(r.key, { approved: e.target.checked })} />
                    ) : '·'}
                  </td>
                  <td style={cell}>
                    <input defaultValue={ov?.note ?? ''} placeholder="fix…"
                      onBlur={e => { if (e.target.value !== (ov?.note ?? '')) save(r.key, { note: e.target.value }); }}
                      style={{ width: 110, fontSize: 12, padding: '2px 6px', border: '1px solid #d1d5db', borderRadius: 4 }} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={11} style={{ padding: 16, textAlign: 'center', color: '#9ca3af' }}>No orders/vendor data for {month}.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SalesOrderMap;
