import { useState, useMemo } from 'react';
import { useCommissionData } from '../hooks/useCommission';
import type { ClaimWithItems } from '../hooks/useCommission';
import type { Store, Promoter, Country } from '../types/types';
import VendorReportUpload from './VendorReportUpload';
import OrderCommissionView from './OrderCommissionView';
import './DashboardPage.css';

function fmtMoney(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(2);
}

const STATUS_COLORS: Record<string, string> = {
  verified: '#16a34a',
  disputed: '#ef4444',
  pending: '#f59e0b',
  rejected: '#6b7280',
};

interface CommissionPageProps { stores: Store[]; promoters: Promoter[]; country: Country; }

const CommissionPage = ({ stores, promoters, country }: CommissionPageProps) => {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [view, setView] = useState<'orders' | 'claims'>('orders');
  const { claims, ledger, rules, summary, loading } = useCommissionData(month);

  const [expandedClaim, setExpandedClaim] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPromoter, setFilterPromoter] = useState<string>('all');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [calcLoading, setCalcLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Promoter name list (for the claims filter dropdown)
  const promoterNames = useMemo(() => {
    const s = new Set(claims.map(c => c.promoterName));
    return [...s].sort();
  }, [claims]);

  // Filtered claims
  const filtered = useMemo(() => {
    return claims.filter(c => {
      if (filterStatus !== 'all' && c.status !== filterStatus) return false;
      if (filterPromoter !== 'all' && c.promoterName !== filterPromoter) return false;
      return true;
    });
  }, [claims, filterStatus, filterPromoter]);

  // Commission by promoter
  const commByPromoter = useMemo(() => {
    const m = new Map<string, { sales: number; commission: number; items: number }>();
    for (const c of claims) {
      const entry = m.get(c.promoterName) ?? { sales: 0, commission: 0, items: 0 };
      entry.items += c.items.length;
      for (const item of c.items) {
        if (item.sellingPrice) entry.sales += item.sellingPrice;
      }
      m.set(c.promoterName, entry);
    }
    for (const l of ledger) {
      // Find promoter name from claims
      const claim = claims.find(c => c.items.some(i => i.id === l.claimItemId));
      if (claim) {
        const entry = m.get(claim.promoterName) ?? { sales: 0, commission: 0, items: 0 };
        entry.commission += l.commissionAmount;
        m.set(claim.promoterName, entry);
      }
    }
    return [...m.entries()].sort((a, b) => b[1].commission - a[1].commission);
  }, [claims, ledger]);

  const runVerify = async () => {
    setVerifyLoading(true);
    setActionMsg(null);
    try {
      const resp = await fetch('/api/verify-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      const data = await resp.json();
      setActionMsg(`Verified: ${data.verified}, Disputed: ${data.disputed}, Returns: ${data.returnsProcessed}`);
      window.location.reload();
    } catch (e) {
      setActionMsg('Verification failed');
    }
    setVerifyLoading(false);
  };

  const runCalc = async () => {
    setCalcLoading(true);
    setActionMsg(null);
    try {
      const resp = await fetch('/api/calculate-commissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      const data = await resp.json();
      setActionMsg(`Calculated: ${data.calculated}, Total: ${data.totalCommission} AED, Deductions: ${data.deductions}`);
      window.location.reload();
    } catch (e) {
      setActionMsg('Calculation failed');
    }
    setCalcLoading(false);
  };

  if (loading) return <div className="dash-page"><p>Loading commission data...</p></div>;

  return (
    <div className="dash-page">
      <div className="dash-header">
        <h2>Commission Verification</h2>
        <p>Verify sales claims against vendor reports and calculate commissions</p>
      </div>

      {/* ── Controls ─────────────────────────────────────────────── */}
      <div className="dash-filters">
        <div className="dash-filter-row">
          <label>Month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
          <label style={{ marginLeft: 16 }}>Status</label>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db' }}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="disputed">Disputed</option>
          </select>
          <label style={{ marginLeft: 16 }}>Promoter</label>
          <select value={filterPromoter} onChange={e => setFilterPromoter(e.target.value)} style={{ padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db' }}>
            <option value="all">All</option>
            {promoterNames.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              onClick={runVerify}
              disabled={verifyLoading}
              style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 12, opacity: verifyLoading ? 0.6 : 1 }}
            >
              {verifyLoading ? 'Verifying...' : 'Run Verification'}
            </button>
            <button
              onClick={runCalc}
              disabled={calcLoading}
              style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer', fontSize: 12, opacity: calcLoading ? 0.6 : 1 }}
            >
              {calcLoading ? 'Calculating...' : 'Calculate Commission'}
            </button>
          </div>
        </div>
        {actionMsg && (
          <div style={{ fontSize: 12, color: '#6366f1', marginTop: 4, fontWeight: 600 }}>{actionMsg}</div>
        )}
      </div>

      {/* ── Upload vendor monthly report ─────────────────────────── */}
      <VendorReportUpload month={month} />

      {/* ── View toggle: Orders (admin) vs Jotform claims ────────── */}
      <div style={{ display: 'flex', margin: '12px 0', border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden', width: 'fit-content' }}>
        {(['orders', 'claims'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            style={{ border: 'none', padding: '6px 16px', cursor: 'pointer', fontSize: 13, background: view === v ? '#eef2ff' : '#fff', color: view === v ? '#4338ca' : '#6b7280', fontWeight: view === v ? 700 : 400 }}>
            {v === 'orders' ? 'Orders (admin → vendor)' : 'Jotform Claims'}
          </button>
        ))}
      </div>

      {view === 'orders' && (
        <OrderCommissionView month={month} country={country} stores={stores} promoters={promoters} />
      )}

      {view === 'claims' && (<>
      {/* ── KPIs ─────────────────────────────────────────────────── */}
      {summary && (
        <div className="dash-kpis">
          <div className="dash-kpi">
            <span className="dash-kpi-label">Claims</span>
            <span className="dash-kpi-value">{summary.totalClaims}</span>
          </div>
          <div className="dash-kpi">
            <span className="dash-kpi-label">Verified</span>
            <span className="dash-kpi-value" style={{ color: '#16a34a' }}>{summary.verifiedClaims}</span>
          </div>
          <div className="dash-kpi">
            <span className="dash-kpi-label">Disputed</span>
            <span className="dash-kpi-value" style={{ color: '#ef4444' }}>{summary.disputedClaims}</span>
          </div>
          <div className="dash-kpi">
            <span className="dash-kpi-label">Pending</span>
            <span className="dash-kpi-value" style={{ color: '#f59e0b' }}>{summary.pendingClaims}</span>
          </div>
          <div className="dash-kpi">
            <span className="dash-kpi-label">OCR Success</span>
            <span className="dash-kpi-value">{summary.ocrSuccess}/{summary.totalItems}</span>
          </div>
          <div className="dash-kpi">
            <span className="dash-kpi-label">Total Commission</span>
            <span className="dash-kpi-value" style={{ color: '#16a34a' }}>{fmtMoney(summary.totalCommission)} AED</span>
          </div>
        </div>
      )}

      {/* ── Commission by Promoter ───────────────────────────────── */}
      {commByPromoter.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 14 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b' }}>Promoter</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#64748b' }}>Items</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#64748b' }}>Total Sales</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#64748b' }}>Commission</th>
              </tr>
            </thead>
            <tbody>
              {commByPromoter.map(([name, data]) => (
                <tr key={name} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{name}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>{data.items}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtMoney(data.sales)} AED</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>{fmtMoney(data.commission)} AED</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Rules ────────────────────────────────────────────────── */}
      {rules.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 14, margin: '0 0 8px', color: '#374151' }}>Commission Rules ({rules.length})</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {rules.map(r => (
              <div key={r.id} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: r.active ? '#f0fdf4' : '#f1f5f9', border: `1px solid ${r.active ? '#86efac' : '#d1d5db'}` }}>
                <strong>{r.name}</strong>: {r.rateType === 'percentage' ? `${r.rateValue}%` : `${r.rateValue} AED`}
                {r.skuPattern && <span style={{ color: '#6b7280' }}> | SKU: {r.skuPattern}</span>}
                {r.validFrom && <span style={{ color: '#6b7280' }}> | {r.validFrom}→{r.validTo || '∞'}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {rules.length === 0 && (
        <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 14, fontStyle: 'italic' }}>
          No commission rules configured. Add rules to `commission_rules` table in Supabase.
        </div>
      )}

      {/* ── Claims Table ─────────────────────────────────────────── */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#64748b' }}>Order</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#64748b' }}>Date</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#64748b' }}>Promoter</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#64748b' }}>Branch</th>
              <th style={{ padding: '6px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#64748b' }}>Qty</th>
              <th style={{ padding: '6px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#64748b' }}>Status</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#64748b' }}>Serial Numbers</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <ClaimRow key={c.id} claim={c} expanded={expandedClaim === c.id} onToggle={() => setExpandedClaim(expandedClaim === c.id ? null : c.id)} />
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && (
        <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, marginTop: 16 }}>No claims found for {month}</p>
      )}
      </>)}
    </div>
  );
};

const ClaimRow = ({ claim, expanded, onToggle }: { claim: ClaimWithItems; expanded: boolean; onToggle: () => void }) => {
  const serials = claim.items.filter(i => i.serialNumber).map(i => i.serialNumber!);
  const ocrOk = claim.items.filter(i => i.ocrStatus === 'success').length;
  const verifiedCount = claim.items.filter(i => i.verified).length;

  return (
    <>
      <tr style={{ borderTop: '1px solid #e5e7eb', cursor: 'pointer' }} onClick={onToggle}>
        <td style={{ padding: '6px 10px', fontWeight: 600, color: '#6366f1' }}>{claim.uniqueId || claim.submissionId.slice(0, 8)}</td>
        <td style={{ padding: '6px 10px' }}>{claim.date}</td>
        <td style={{ padding: '6px 10px' }}>{claim.promoterName}</td>
        <td style={{ padding: '6px 10px' }}>{claim.branch}</td>
        <td style={{ padding: '6px 10px', textAlign: 'center' }}>{claim.numberOfLuggage}</td>
        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
          <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
            color: '#fff', background: STATUS_COLORS[claim.status] || '#6b7280',
          }}>
            {claim.status} {verifiedCount > 0 && `(${verifiedCount}/${claim.items.length})`}
          </span>
        </td>
        <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'monospace' }}>
          {serials.length > 0 ? serials.join(', ') : <span style={{ color: '#d1d5db' }}>—</span>}
          {ocrOk < claim.items.length && <span style={{ color: '#f59e0b', marginLeft: 4 }}>({ocrOk}/{claim.items.length} OCR)</span>}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{ padding: '8px 16px', background: '#f8fafc' }}>
            <div style={{ fontSize: 11 }}>
              <strong>Products:</strong> {claim.productList || '—'}
            </div>
            <table style={{ width: '100%', fontSize: 11, marginTop: 6, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '3px 6px', color: '#64748b' }}>#</th>
                  <th style={{ textAlign: 'left', padding: '3px 6px', color: '#64748b' }}>Model</th>
                  <th style={{ textAlign: 'left', padding: '3px 6px', color: '#64748b' }}>Colour</th>
                  <th style={{ textAlign: 'left', padding: '3px 6px', color: '#64748b' }}>SKU</th>
                  <th style={{ textAlign: 'left', padding: '3px 6px', color: '#64748b' }}>Serial</th>
                  <th style={{ textAlign: 'center', padding: '3px 6px', color: '#64748b' }}>OCR</th>
                  <th style={{ textAlign: 'center', padding: '3px 6px', color: '#64748b' }}>Verified</th>
                  <th style={{ textAlign: 'right', padding: '3px 6px', color: '#64748b' }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {claim.items.map((item, idx) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '3px 6px' }}>{idx + 1}</td>
                    <td style={{ padding: '3px 6px' }}>{item.model || '—'}</td>
                    <td style={{ padding: '3px 6px' }}>{item.colour || '—'}</td>
                    <td style={{ padding: '3px 6px', fontFamily: 'monospace', fontSize: 10 }}>{item.sku || '—'}</td>
                    <td style={{ padding: '3px 6px', fontFamily: 'monospace', fontSize: 10, color: item.serialNumber ? '#16a34a' : '#d1d5db' }}>
                      {item.serialNumber || '—'}
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                      {item.ocrStatus === 'success' ? '✅' : item.ocrStatus === 'failed' ? '❌' : '⏳'}
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                      {item.verified ? '✅' : '—'}
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'right' }}>
                      {item.sellingPrice ? `${item.sellingPrice.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
};

export default CommissionPage;
