import { useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import { useSalesClaims } from '../hooks/useSalesClaims';
import type { SalesClaim } from '../hooks/useSalesClaims';
import './DashboardPage.css';

// ── Helpers ────────────────────────────────────────────────────────────

function toYearMonth(d: string) { return d.slice(0, 7); }

function parseModels(productList: string | null): string[] {
  if (!productList) return [];
  return productList.split('\n')
    .map(line => { const m = line.match(/Model:\s*([^,]+)/i); return m ? m[1].trim() : null; })
    .filter(Boolean) as string[];
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316', '#14b8a6', '#a855f7'];

function topN<T extends { value: number }>(arr: T[], n: number): T[] {
  return [...arr].sort((a, b) => b.value - a.value).slice(0, n);
}

function groupCount(items: string[]): { name: string; value: number }[] {
  const m = new Map<string, number>();
  for (const v of items) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([name, value]) => ({ name, value }));
}

type FilterMode = 'combine' | 'vs';
type VsDimension = 'branch' | 'promoter' | 'nationality';

const pieLabelFn = ({ name, percent }: { name?: string; percent?: number }) =>
  `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`;

// ── Compute KPIs for a slice of claims ────────────────────────────────
function computeKpis(data: SalesClaim[]) {
  const total = data.length;
  const luggage = data.reduce((s, c) => s + c.numberOfLuggage, 0);
  return {
    total,
    luggage,
    avgLuggage: total > 0 ? (luggage / total).toFixed(1) : '0',
    promoters: new Set(data.map(c => c.promoterName)).size,
    branches: new Set(data.map(c => c.branch)).size,
  };
}

// ── Component ──────────────────────────────────────────────────────────

const CustomerDashboardPage = () => {
  const { claims, loading, error } = useSalesClaims();

  // Filter state
  const [fromMonth, setFromMonth] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 5);
    return d.toISOString().slice(0, 7);
  });
  const [toMonth, setToMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selBranch, setSelBranch] = useState<Set<string>>(new Set());
  const [selPromoter, setSelPromoter] = useState<Set<string>>(new Set());
  const [selNationality, setSelNationality] = useState<Set<string>>(new Set());
  const [selGender, setSelGender] = useState<Set<string>>(new Set());
  const [selVisa, setSelVisa] = useState<Set<string>>(new Set());
  const [selAge, setSelAge] = useState<Set<string>>(new Set());
  const [selGroup, setSelGroup] = useState<Set<string>>(new Set());
  const [selModel, setSelModel] = useState<Set<string>>(new Set());

  // VS / Combine mode
  const [filterMode, setFilterMode] = useState<FilterMode>('combine');

  const toggle = (set: Set<string>, val: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val); else next.add(val);
    setter(next);
  };

  // Extract bar label from recharts click event
  const getBarLabel = (d: unknown): string | null => {
    const p = (d as { payload?: { name?: string } } | undefined)?.payload?.name;
    return typeof p === 'string' ? p : null;
  };

  const resetAll = () => {
    setSelBranch(new Set()); setSelPromoter(new Set()); setSelNationality(new Set());
    setSelGender(new Set()); setSelVisa(new Set()); setSelAge(new Set());
    setSelGroup(new Set()); setSelModel(new Set());
  };

  const activeFilterCount = selBranch.size + selPromoter.size + selNationality.size +
    selGender.size + selVisa.size + selAge.size + selGroup.size + selModel.size;

  // Determine which dimension is active for VS mode
  const vsDimension = useMemo<VsDimension | null>(() => {
    if (filterMode !== 'vs') return null;
    if (selBranch.size >= 2) return 'branch';
    if (selPromoter.size >= 2) return 'promoter';
    if (selNationality.size >= 2) return 'nationality';
    return null;
  }, [filterMode, selBranch, selPromoter, selNationality]);

  const vsLabels = useMemo<string[]>(() => {
    if (!vsDimension) return [];
    if (vsDimension === 'branch') return [...selBranch];
    if (vsDimension === 'promoter') return [...selPromoter];
    return [...selNationality];
  }, [vsDimension, selBranch, selPromoter, selNationality]);

  // Date-filtered non-duplicate claims (before dimension filters)
  const dateFiltered = useMemo(() => {
    const fromDate = `${fromMonth}-01`;
    const [fy, fm] = toMonth.split('-').map(Number);
    const lastDay = new Date(fy, fm, 0).getDate();
    const toDate = `${toMonth}-${String(lastDay).padStart(2, '0')}`;
    return claims.filter(c => !c.duplicated && c.date >= fromDate && c.date <= toDate);
  }, [claims, fromMonth, toMonth]);

  // Combined filter (used in combine mode + as base for charts)
  const filtered = useMemo(() => {
    return dateFiltered.filter(c => {
      if (selBranch.size > 0 && !selBranch.has(c.branch)) return false;
      if (selPromoter.size > 0 && !selPromoter.has(c.promoterName)) return false;
      if (selNationality.size > 0 && (!c.nationality || !selNationality.has(c.nationality))) return false;
      if (selGender.size > 0 && (!c.customerGender || !selGender.has(c.customerGender))) return false;
      if (selVisa.size > 0 && (!c.visaType || !selVisa.has(c.visaType))) return false;
      if (selAge.size > 0 && (!c.ageRange || !selAge.has(c.ageRange))) return false;
      if (selGroup.size > 0 && (!c.groupType || !selGroup.has(c.groupType))) return false;
      if (selModel.size > 0) {
        const models = parseModels(c.productList);
        if (!models.some(m => selModel.has(m))) return false;
      }
      return true;
    });
  }, [dateFiltered, selBranch, selPromoter, selNationality, selGender, selVisa, selAge, selGroup, selModel]);

  // VS slices: split data per selected label
  const vsSlices = useMemo(() => {
    if (!vsDimension) return new Map<string, SalesClaim[]>();
    const m = new Map<string, SalesClaim[]>();
    const getter = (c: SalesClaim) =>
      vsDimension === 'branch' ? c.branch
        : vsDimension === 'promoter' ? c.promoterName
          : (c.nationality ?? '');
    for (const label of vsLabels) {
      m.set(label, dateFiltered.filter(c => getter(c) === label));
    }
    return m;
  }, [vsDimension, vsLabels, dateFiltered]);

  // Available filter options
  const nonDup = useMemo(() => claims.filter(c => !c.duplicated), [claims]);
  const allBranches = useMemo(() => [...new Set(nonDup.map(c => c.branch))].filter(Boolean).sort(), [nonDup]);
  const allPromoters = useMemo(() => [...new Set(nonDup.map(c => c.promoterName))].filter(Boolean).sort(), [nonDup]);
  const allNationalities = useMemo(() => {
    const s = new Set<string>();
    for (const c of nonDup) if (c.nationality) s.add(c.nationality);
    return [...s].sort();
  }, [nonDup]);

  // ── Combined KPIs ────────────────────────────────────────────────────
  const kpi = computeKpis(filtered);

  // ── Combined trend ───────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const c of filtered) {
      const ym = toYearMonth(c.date);
      const cur = m.get(ym) ?? { month: 0 };
      cur.month = 0; // placeholder
      (cur as Record<string, number>)['sales'] = ((cur as Record<string, number>)['sales'] ?? 0) + 1;
      (cur as Record<string, number>)['luggage'] = ((cur as Record<string, number>)['luggage'] ?? 0) + c.numberOfLuggage;
      m.set(ym, cur);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ym, v]) => ({ month: ym, ...v }));
  }, [filtered]);

  // ── VS trend: one line per selected label ────────────────────────────
  const vsTrendData = useMemo(() => {
    if (!vsDimension) return [];
    // Collect all months
    const allMonths = new Set<string>();
    for (const [, data] of vsSlices) for (const c of data) allMonths.add(toYearMonth(c.date));
    const months = [...allMonths].sort();
    return months.map(ym => {
      const row: Record<string, string | number> = { month: ym };
      for (const label of vsLabels) {
        const slice = vsSlices.get(label) ?? [];
        row[label] = slice.filter(c => toYearMonth(c.date) === ym).length;
      }
      return row;
    });
  }, [vsDimension, vsSlices, vsLabels]);

  // ── Dimension breakdowns (always from filtered / combine data) ──────
  const byBranch = useMemo(() => topN(groupCount(filtered.map(c => c.branch)), 15), [filtered]);
  const byPromoter = useMemo(() => topN(groupCount(filtered.map(c => c.promoterName)), 15), [filtered]);
  const byNationality = useMemo(() => topN(groupCount(filtered.map(c => c.nationality).filter(Boolean) as string[]), 15), [filtered]);
  const byGender = useMemo(() => groupCount(filtered.map(c => c.customerGender).filter(Boolean) as string[]), [filtered]);
  const byVisaType = useMemo(() => groupCount(filtered.map(c => c.visaType).filter(Boolean) as string[]), [filtered]);
  const byAgeRange = useMemo(() => groupCount(filtered.map(c => c.ageRange).filter(Boolean) as string[]), [filtered]);
  const byGroupType = useMemo(() => topN(groupCount(filtered.map(c => c.groupType).filter(Boolean) as string[]), 10), [filtered]);
  const byModel = useMemo(() => {
    const models: string[] = [];
    for (const c of filtered) models.push(...parseModels(c.productList));
    return topN(groupCount(models), 10);
  }, [filtered]);

  const isVsActive = filterMode === 'vs' && vsDimension !== null;

  if (loading) return <div className="dash-page"><p>Loading customer data...</p></div>;
  if (error) return <div className="dash-page"><p style={{ color: '#ef4444' }}>Error: {error}</p></div>;

  return (
    <div className="dash-page">
      <div className="dash-header">
        <h2>Customer Dashboard</h2>
        <p>UAE Paid Customers — {kpi.total} transactions ({claims.filter(c => c.duplicated).length} duplicates excluded)</p>
      </div>

      {/* ── Filters ──────────────────────────────────────────────── */}
      <div className="dash-filters">
        <div className="dash-filter-row">
          <label>Period</label>
          <input type="month" value={fromMonth} onChange={e => setFromMonth(e.target.value)} />
          <span style={{ color: '#9ca3af' }}>→</span>
          <input type="month" value={toMonth} onChange={e => setToMonth(e.target.value)} />

          {/* VS / Combine toggle */}
          <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #d1d5db', marginLeft: 12 }}>
            <button
              onClick={() => setFilterMode('combine')}
              style={{
                padding: '4px 12px', fontSize: 12, border: 'none', cursor: 'pointer',
                background: filterMode === 'combine' ? '#6366f1' : '#fff',
                color: filterMode === 'combine' ? '#fff' : '#374151',
                fontWeight: filterMode === 'combine' ? 700 : 400,
              }}
            >Combine</button>
            <button
              onClick={() => setFilterMode('vs')}
              style={{
                padding: '4px 12px', fontSize: 12, border: 'none', cursor: 'pointer',
                borderLeft: '1px solid #d1d5db',
                background: filterMode === 'vs' ? '#6366f1' : '#fff',
                color: filterMode === 'vs' ? '#fff' : '#374151',
                fontWeight: filterMode === 'vs' ? 700 : 400,
              }}
            >VS</button>
          </div>

          <button className="dash-btn-reset" onClick={resetAll}>
            Reset{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        </div>

        {filterMode === 'vs' && !vsDimension && (selBranch.size + selPromoter.size + selNationality.size) < 2 && (
          <div style={{ fontSize: 12, color: '#f59e0b', margin: '4px 0 2px', fontStyle: 'italic' }}>
            Select 2+ items in Branch, Promoter, or Nationality to compare
          </div>
        )}

        <div className="dash-filter-row">
          <label>Branch</label>
          {allBranches.map(b => (
            <button key={b} className={`dash-chip${selBranch.has(b) ? ' active' : ''}`} onClick={() => toggle(selBranch, b, setSelBranch)}>{b}</button>
          ))}
        </div>
        <div className="dash-filter-row">
          <label>Promoter</label>
          {allPromoters.map(p => (
            <button key={p} className={`dash-chip${selPromoter.has(p) ? ' active' : ''}`} onClick={() => toggle(selPromoter, p, setSelPromoter)}>{p}</button>
          ))}
        </div>
        {allNationalities.length <= 30 && (
          <div className="dash-filter-row">
            <label>Nationality</label>
            {allNationalities.map(n => (
              <button key={n} className={`dash-chip${selNationality.has(n) ? ' active' : ''}`} onClick={() => toggle(selNationality, n, setSelNationality)}>{n}</button>
            ))}
          </div>
        )}
        {/* Active chart-click filters */}
        {(selGender.size + selVisa.size + selAge.size + selGroup.size + selModel.size) > 0 && (
          <div className="dash-filter-row" style={{ marginTop: 6 }}>
            <label style={{ color: '#6366f1' }}>Active</label>
            {[...selGender].map(v => <button key={`g-${v}`} className="dash-chip active" onClick={() => toggle(selGender, v, setSelGender)}>Gender: {v} &times;</button>)}
            {[...selVisa].map(v => <button key={`v-${v}`} className="dash-chip active" onClick={() => toggle(selVisa, v, setSelVisa)}>Visa: {v} &times;</button>)}
            {[...selAge].map(v => <button key={`a-${v}`} className="dash-chip active" onClick={() => toggle(selAge, v, setSelAge)}>Age: {v} &times;</button>)}
            {[...selGroup].map(v => <button key={`gr-${v}`} className="dash-chip active" onClick={() => toggle(selGroup, v, setSelGroup)}>Group: {v} &times;</button>)}
            {[...selModel].map(v => <button key={`m-${v}`} className="dash-chip active" onClick={() => toggle(selModel, v, setSelModel)}>Model: {v} &times;</button>)}
          </div>
        )}
      </div>

      {/* ── KPIs ─────────────────────────────────────────────────── */}
      {!isVsActive ? (
        <div className="dash-kpis">
          <div className="dash-kpi"><span className="dash-kpi-label">Total Sales</span><span className="dash-kpi-value">{kpi.total.toLocaleString()}</span></div>
          <div className="dash-kpi"><span className="dash-kpi-label">Total Luggage</span><span className="dash-kpi-value">{kpi.luggage.toLocaleString()}</span></div>
          <div className="dash-kpi"><span className="dash-kpi-label">Avg Luggage / Sale</span><span className="dash-kpi-value">{kpi.avgLuggage}</span></div>
          <div className="dash-kpi"><span className="dash-kpi-label">Promoters</span><span className="dash-kpi-value">{kpi.promoters}</span></div>
          <div className="dash-kpi"><span className="dash-kpi-label">Branches</span><span className="dash-kpi-value">{kpi.branches}</span></div>
        </div>
      ) : (
        /* VS KPI comparison table */
        <div style={{ overflowX: 'auto', marginBottom: 14 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', fontSize: 11 }}>{vsDimension}</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#64748b', fontSize: 11 }}>Sales</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#64748b', fontSize: 11 }}>Luggage</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#64748b', fontSize: 11 }}>Avg/Sale</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#64748b', fontSize: 11 }}>Promoters</th>
              </tr>
            </thead>
            <tbody>
              {vsLabels.map((label, i) => {
                const slice = vsSlices.get(label) ?? [];
                const k = computeKpis(slice);
                return (
                  <tr key={label} style={{ borderTop: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: COLORS[i % COLORS.length] }}>{label}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{k.total.toLocaleString()}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{k.luggage.toLocaleString()}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{k.avgLuggage}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{k.promoters}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Charts ────────────────────────────────────────────────── */}
      <div className="dash-charts">

        {/* Trend — VS mode shows one line per label */}
        <div className="dash-chart-card dash-chart-wide">
          <h3>Sales Trend {isVsActive && <span style={{ fontSize: 12, color: '#6366f1', fontWeight: 400 }}>— VS by {vsDimension}</span>}</h3>
          <ResponsiveContainer width="100%" height={280}>
            {isVsActive ? (
              <LineChart data={vsTrendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                {vsLabels.map((label, i) => (
                  <Line key={label} type="monotone" dataKey={label} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
                ))}
              </LineChart>
            ) : (
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sales" name="Transactions" stroke="#6366f1" strokeWidth={2} />
                <Line type="monotone" dataKey="luggage" name="Luggage" stroke="#10b981" strokeWidth={2} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* VS stacked bar: dimension breakdown side by side */}
        {isVsActive && (
          <div className="dash-chart-card dash-chart-wide">
            <h3>Nationality — VS</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={(() => {
                const allNats = new Set<string>();
                for (const [, data] of vsSlices) for (const c of data) if (c.nationality) allNats.add(c.nationality);
                const nats = [...allNats];
                return nats.map(nat => {
                  const row: Record<string, string | number> = { name: nat };
                  for (const label of vsLabels) {
                    row[label] = (vsSlices.get(label) ?? []).filter(c => c.nationality === nat).length;
                  }
                  return row;
                }).sort((a, b) => {
                  const sumA = vsLabels.reduce((s, l) => s + (Number(a[l]) || 0), 0);
                  const sumB = vsLabels.reduce((s, l) => s + (Number(b[l]) || 0), 0);
                  return sumB - sumA;
                }).slice(0, 12);
              })()}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={10} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                {vsLabels.map((label, i) => (
                  <Bar key={label} dataKey={label} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {isVsActive && (
          <div className="dash-chart-card dash-chart-wide">
            <h3>Product Model — VS</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={(() => {
                const allModels = new Set<string>();
                for (const [, data] of vsSlices) for (const c of data) for (const m of parseModels(c.productList)) allModels.add(m);
                return [...allModels].map(model => {
                  const row: Record<string, string | number> = { name: model };
                  for (const label of vsLabels) {
                    const models: string[] = [];
                    for (const c of vsSlices.get(label) ?? []) models.push(...parseModels(c.productList));
                    row[label] = models.filter(m => m === model).length;
                  }
                  return row;
                }).sort((a, b) => {
                  const sumA = vsLabels.reduce((s, l) => s + (Number(a[l]) || 0), 0);
                  const sumB = vsLabels.reduce((s, l) => s + (Number(b[l]) || 0), 0);
                  return sumB - sumA;
                }).slice(0, 10);
              })()}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={10} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                {vsLabels.map((label, i) => (
                  <Bar key={label} dataKey={label} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Standard breakdown charts (always shown) */}
        <div className="dash-chart-card">
          <h3>Sales by Branch</h3>
          <ResponsiveContainer width="100%" height={Math.max(180, byBranch.length * 22 + 40)}>
            <BarChart data={byBranch} layout="vertical" margin={{ left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={9} />
              <YAxis dataKey="name" type="category" fontSize={9} width={42} interval={0} />
              <Tooltip />
              <Bar dataKey="value" name="Sales" fill="#6366f1" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }}
                onClick={d => { const l = getBarLabel(d); if (l) toggle(selBranch, l, setSelBranch); }} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="dash-chart-card">
          <h3>Sales by Promoter</h3>
          <ResponsiveContainer width="100%" height={Math.max(180, byPromoter.length * 22 + 40)}>
            <BarChart data={byPromoter} layout="vertical" margin={{ left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={9} />
              <YAxis dataKey="name" type="category" fontSize={9} width={80} interval={0} />
              <Tooltip />
              <Bar dataKey="value" name="Sales" fill="#10b981" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }}
                onClick={d => { const l = getBarLabel(d); if (l) toggle(selPromoter, l, setSelPromoter); }} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="dash-chart-card">
          <h3>Top Nationalities</h3>
          <ResponsiveContainer width="100%" height={Math.max(180, byNationality.length * 22 + 40)}>
            <BarChart data={byNationality} layout="vertical" margin={{ left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={9} />
              <YAxis dataKey="name" type="category" fontSize={9} width={70} interval={0} />
              <Tooltip />
              <Bar dataKey="value" name="Customers" fill="#f59e0b" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }}
                onClick={d => { const l = getBarLabel(d); if (l) toggle(selNationality, l, setSelNationality); }} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="dash-chart-card">
          <h3>Product Models</h3>
          <ResponsiveContainer width="100%" height={Math.max(180, byModel.length * 22 + 40)}>
            <BarChart data={byModel} layout="vertical" margin={{ left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={9} />
              <YAxis dataKey="name" type="category" fontSize={9} width={70} interval={0} />
              <Tooltip />
              <Bar dataKey="value" name="Units" fill="#8b5cf6" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }}
                onClick={d => { const l = getBarLabel(d); if (l) toggle(selModel, l, setSelModel); }} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="dash-chart-card">
          <h3>Gender</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={byGender} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={pieLabelFn}
                onClick={(_: unknown, idx: number) => { const name = byGender[idx]?.name; if (name) toggle(selGender, name, setSelGender); }} style={{ cursor: 'pointer' }}>
                {byGender.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="dash-chart-card">
          <h3>Visa Type</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={byVisaType} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={pieLabelFn}
                onClick={(_: unknown, idx: number) => { const name = byVisaType[idx]?.name; if (name) toggle(selVisa, name, setSelVisa); }} style={{ cursor: 'pointer' }}>
                {byVisaType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="dash-chart-card">
          <h3>Age Range</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={byAgeRange}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={9} interval={0} />
              <YAxis fontSize={9} />
              <Tooltip />
              <Bar dataKey="value" name="Customers" fill="#06b6d4" radius={[4, 4, 0, 0]} style={{ cursor: 'pointer' }}
                onClick={d => { const l = getBarLabel(d); if (l) toggle(selAge, l, setSelAge); }} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="dash-chart-card">
          <h3>Group Type</h3>
          <ResponsiveContainer width="100%" height={Math.max(180, byGroupType.length * 22 + 40)}>
            <BarChart data={byGroupType} layout="vertical" margin={{ left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={9} />
              <YAxis dataKey="name" type="category" fontSize={9} width={110} interval={0} />
              <Tooltip />
              <Bar dataKey="value" name="Customers" fill="#ec4899" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }}
                onClick={d => { const l = getBarLabel(d); if (l) toggle(selGroup, l, setSelGroup); }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default CustomerDashboardPage;
