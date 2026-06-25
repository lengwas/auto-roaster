import { useMemo, useState } from 'react';
import type { Store, Promoter, Country } from '../types/types';
import { useOrders } from '../hooks/useOrders';
import { useVendorLines } from '../hooks/useVendorLines';
import { useSerialRegistry } from '../hooks/useSerialRegistry';
import { reconcileOrders, type OrderVerifyStatus } from '../lib/orderCommission';

interface Props { month: string; country: Country; stores: Store[]; promoters: Promoter[]; }

const STATUS_LABEL: Record<OrderVerifyStatus, string> = {
  verified: 'Verified', no_vendor: 'No vendor match', no_store: 'Store unmapped',
  no_promoter: 'No promoter', returned: 'Returned (clawback)', excluded: 'Excluded',
};
const STATUS_COLOR: Record<OrderVerifyStatus, string> = {
  verified: '#16a34a', no_vendor: '#ef4444', no_store: '#b45309', no_promoter: '#a855f7', returned: '#be123c', excluded: '#6b7280',
};

const CURRENCY: Record<Country, string> = { UAE: 'AED', QA: 'QAR', TH: 'THB' };
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const OrderCommissionView = ({ month, country, stores, promoters }: Props) => {
  const { orders, loading: ordersLoading } = useOrders(12, country);
  const { lines: vendorLines, loading: vLoading } = useVendorLines(month);
  const registrySerials = useSerialRegistry();
  const [statusFilter, setStatusFilter] = useState<'all' | OrderVerifyStatus>('all');

  const { rows, byPromoter } = useMemo(
    () => reconcileOrders(orders, vendorLines, stores, promoters, country, month, registrySerials),
    [orders, vendorLines, stores, promoters, country, month, registrySerials],
  );

  const totals = useMemo(() => ({
    orders: rows.filter(r => r.status !== 'returned').length,
    verified: rows.filter(r => r.status === 'verified').length,
    commission: rows.reduce((s, r) => s + r.commission, 0),
    noVendor: rows.filter(r => r.status === 'no_vendor').length,
    returned: rows.filter(r => r.status === 'returned').length,
  }), [rows]);

  const filtered = useMemo(
    () => rows.filter(r => statusFilter === 'all' || r.status === statusFilter),
    [rows, statusFilter],
  );

  const cur = CURRENCY[country];
  if (ordersLoading || vLoading) return <p style={{ padding: 16, color: '#6b7280' }}>Loading orders & vendor data…</p>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '10px 0' }}>
        {[
          ['Orders', totals.orders], ['Verified', totals.verified],
          ['Net commission', `${fmt(totals.commission)} ${cur}`],
          ['No vendor', totals.noVendor], ['Returns', totals.returned],
        ].map(([label, val]) => (
          <div key={String(label)} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 14px', minWidth: 110 }}>
            <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Per-promoter summary */}
      <h4 style={{ margin: '14px 0 6px' }}>Commission by promoter</h4>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 18 }}>
        <thead><tr style={{ background: '#f9fafb', textAlign: 'left' }}>
          <th style={{ padding: 6 }}>Promoter</th><th style={{ padding: 6, textAlign: 'right' }}>Verified orders</th>
          <th style={{ padding: 6, textAlign: 'right' }}>Sales ({cur})</th><th style={{ padding: 6, textAlign: 'right' }}>Commission ({cur})</th>
        </tr></thead>
        <tbody>
          {byPromoter.map(p => {
            const name = promoters.find(pp => pp.id === p.promoterId)?.name ?? p.promoterName;
            return (
              <tr key={p.promoterId ?? name} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: 6 }}>{name}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{p.verifiedOrders}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{fmt(p.sales)}</td>
                <td style={{ padding: 6, textAlign: 'right', fontWeight: 600 }}>{fmt(p.commission)}</td>
              </tr>
            );
          })}
          {byPromoter.length === 0 && <tr><td colSpan={4} style={{ padding: 12, textAlign: 'center', color: '#9ca3af' }}>No verified commission. Upload the vendor report for {month} and set promoter rates.</td></tr>}
        </tbody>
      </table>

      {/* Status filter */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {(['all', 'verified', 'no_vendor', 'returned', 'no_store', 'no_promoter'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            style={{ border: '1px solid #d1d5db', background: statusFilter === s ? '#111827' : '#fff', color: statusFilter === s ? '#fff' : '#6b7280', borderRadius: 14, padding: '3px 12px', fontSize: 12, cursor: 'pointer' }}>
            {s === 'all' ? 'All' : STATUS_LABEL[s]}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af' }}>{filtered.length} orders</span>
      </div>

      {/* Per-order table */}
      <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: '#f9fafb', textAlign: 'left' }}>
            {['Order', 'Date', 'Store', 'SKU', 'Serial', 'Salesperson', `Amount`, 'Comm', 'Status'].map(h => (
              <th key={h} style={{ padding: 6, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: 6 }}>{r.orderId ?? '—'}</td>
                <td style={{ padding: 6 }}>{r.date}</td>
                <td style={{ padding: 6 }}>{r.storeName ?? r.storeCode ?? '—'}</td>
                <td style={{ padding: 6, fontFamily: 'monospace' }}>{r.sku ?? '—'}</td>
                <td style={{ padding: 6, fontFamily: 'monospace' }}>
                  {r.serialNumber ?? '—'}
                  {r.flags.serialRepeat && <span title="serial appears on >1 order (resold)" style={{ color: '#b45309', marginLeft: 4 }}>↺</span>}
                  {r.flags.serialUnverified && <span title="serial not in registry" style={{ color: '#dc2626', marginLeft: 4 }}>⚠</span>}
                </td>
                <td style={{ padding: 6 }} title={r.flags.returnNote || ''}>{r.salesperson ?? '—'}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{fmt(r.amount)}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{r.commission > 0 ? fmt(r.commission) : '—'}</td>
                <td style={{ padding: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status]}</span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={9} style={{ padding: 16, textAlign: 'center', color: '#9ca3af' }}>No orders for {month}.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OrderCommissionView;
