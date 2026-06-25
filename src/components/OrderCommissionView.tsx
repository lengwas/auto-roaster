import { useMemo, useState } from 'react';
import type { Store, Promoter, Country } from '../types/types';
import { useOrders } from '../hooks/useOrders';
import { useVendorLines } from '../hooks/useVendorLines';
import { useSerialRegistry } from '../hooks/useSerialRegistry';
import { useCommissionBonuses } from '../hooks/useCommissionBonuses';
import { reconcileOrders, type OrderVerifyStatus, type OrderCommissionRow } from '../lib/orderCommission';

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
  const bonuses = useCommissionBonuses();
  const [statusFilter, setStatusFilter] = useState<'all' | OrderVerifyStatus>('all');

  const { rows, byPromoter } = useMemo(
    () => reconcileOrders(orders, vendorLines, stores, promoters, country, month, registrySerials, bonuses),
    [orders, vendorLines, stores, promoters, country, month, registrySerials, bonuses],
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

  // Validity note per line (mirrors the commission sheet's "Note" column)
  const noteFor = (r: OrderCommissionRow): string => {
    const parts: string[] = [];
    if (r.status === 'returned') parts.push('[INVALID] Returned (clawback)');
    else if (r.status === 'no_vendor') parts.push('[INVALID] Not in vendor report');
    else if (r.status === 'no_store') parts.push('[INVALID] Store/warehouse unmapped');
    else if (r.status === 'no_promoter') parts.push('[INVALID] Promoter not matched');
    if (r.flags.serialUnverified) parts.push('[CHECK] SN not in registry');
    if (r.flags.serialRepeat) parts.push('[CHECK] SN resold');
    if (r.flags.returnNote) parts.push(r.flags.returnNote);
    if (r.bonus > 0 && r.bonusNote) parts.push(`BONUS ${r.bonusNote}`);
    return parts.join('; ');
  };

  // Commission statement, grouped by salesperson then date
  const statement = useMemo(
    () => [...filtered].sort((a, b) =>
      (a.salesperson || '~').localeCompare(b.salesperson || '~') || a.date.localeCompare(b.date)),
    [filtered],
  );

  const exportCsv = () => {
    const header = ['Salesperson', 'Warehouse', 'Date', 'S/N Picture', 'Serial Number', 'SKU', 'Note', 'QTY', 'Price', 'Sales Valid for Commission', 'Commission'];
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = statement.map(r => [
      r.salesperson ?? '', r.storeName ?? r.storeCode ?? '', r.date,
      r.serialNumber ? 'TRUE' : 'FALSE', r.serialNumber ?? '', r.sku ?? '', noteFor(r),
      r.status === 'verified' ? 1 : '', r.amount,
      r.status === 'verified' ? r.amount : '',
      r.status === 'verified' && r.commissionRate != null ? `${r.commissionRate}%` : '',
    ].map(esc).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `commission-${country}-${month}.csv`;
    a.click();
  };

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
        <button onClick={exportCsv} disabled={!statement.length}
          style={{ marginLeft: 'auto', border: '1px solid #16a34a', background: '#16a34a', color: '#fff', borderRadius: 6, padding: '3px 12px', fontSize: 12, cursor: statement.length ? 'pointer' : 'default', opacity: statement.length ? 1 : 0.5 }}>
          Export CSV
        </button>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>{statement.length} lines</span>
      </div>

      {/* Commission statement (matches the commission sheet layout) */}
      <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
          <thead><tr style={{ background: '#f9fafb', textAlign: 'left' }}>
            {['Salesperson', 'Warehouse', 'Date', 'S/N Pic', 'Serial Number', 'SKU', 'Note', 'QTY', 'Price', 'Valid Sales', 'Comm'].map(h => (
              <th key={h} style={{ padding: 6 }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {statement.map((r, i) => {
              const valid = r.status === 'verified';
              const sameAsPrev = i > 0 && statement[i - 1].salesperson === r.salesperson;
              return (
                <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9', background: valid ? undefined : '#fff7f7' }}>
                  <td style={{ padding: 6, fontWeight: 600 }}>{sameAsPrev ? '' : (r.salesperson ?? '—')}</td>
                  <td style={{ padding: 6 }}>{r.storeName ?? r.storeCode ?? '—'}</td>
                  <td style={{ padding: 6 }}>{r.date}</td>
                  <td style={{ padding: 6, color: r.serialNumber ? '#16a34a' : '#9ca3af' }}>{r.serialNumber ? 'TRUE' : 'FALSE'}</td>
                  <td style={{ padding: 6, fontFamily: 'monospace' }}>{r.serialNumber ?? '—'}</td>
                  <td style={{ padding: 6 }}>{r.sku ?? '—'}</td>
                  <td style={{ padding: 6, color: STATUS_COLOR[r.status], fontSize: 11 }}>{noteFor(r) || (valid ? '' : STATUS_LABEL[r.status])}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{valid ? 1 : ''}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{fmt(r.amount)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{valid ? fmt(r.amount) : ''}</td>
                  <td style={{ padding: 6, textAlign: 'right', fontWeight: 600 }}>{valid && r.commissionRate != null ? `${r.commissionRate}%${r.bonus > 0 ? ` +${fmt(r.bonus)}` : ''}` : ''}</td>
                </tr>
              );
            })}
            {statement.length === 0 && <tr><td colSpan={11} style={{ padding: 16, textAlign: 'center', color: '#9ca3af' }}>No orders for {month}.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OrderCommissionView;
