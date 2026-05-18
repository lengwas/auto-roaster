import { Fragment, useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend,
} from 'recharts';
import type { Order, Country, Store, Promoter } from '../types/types';
import {
  getWarehouseMap, getStoreCodeFromOrder, parseVendorModel, getMallName,
  groupBy, sumAmount, countOrders, toYearMonth,
  detectBranchAnomalies, nMonthsAgo, thisMonth, monthToStart, monthToEnd,
} from '../lib/ordersAnalytics';
import './DashboardPage.css';

interface Props {
  orders: Order[];
  stores: Store[];
  promoters: Promoter[];
  country: Country;
  loading?: boolean;
}

interface EnrichedOrder extends Order {
  _storeCode: string | null;
  _vendor: string;
  _model: string;
  _mall: string;
  _month: string;
}

type DimensionKey = 'store' | 'promoter' | 'vendor' | 'model' | 'mall' | 'platform' | 'sku';

const CURRENCY: Record<Country, string> = { UAE: 'AED', QA: 'QAR', TH: 'THB' };

function fmtMoney(n: number, country: Country): string {
  const cur = CURRENCY[country];
  if (n >= 1_000_000) return `${cur} ${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${cur} ${(n / 1_000).toFixed(0)}k`;
  return `${cur} ${Math.round(n).toLocaleString()}`;
}

function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(1)}%`;
}

const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

// Recharts tooltip formatter signature is loose; accept unknown and format money when numeric.
const moneyFormatter = (country: Country) => (v: unknown): string =>
  typeof v === 'number' ? fmtMoney(v, country) : String(v ?? '');

// Recharts Bar onClick payload shape — we only care about the original data row under `payload`.
interface BarClickPayload { payload?: { label?: string } }
const getBarLabel = (d: unknown): string | null => {
  const p = (d as BarClickPayload | undefined)?.payload?.label;
  return typeof p === 'string' ? p : null;
};

const DashboardPage = ({ orders, stores, promoters, country, loading }: Props) => {
  // ── Filter state ──────────────────────────────────────────────────────
  const [fromMonth, setFromMonth] = useState(nMonthsAgo(5));
  const [toMonth, setToMonth] = useState(thisMonth());
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set());
  const [selectedPromoters, setSelectedPromoters] = useState<Set<string>>(new Set());
  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set());
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [selectedMalls, setSelectedMalls] = useState<Set<string>>(new Set());
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed'>('completed');

  const warehouseMap = useMemo(() => getWarehouseMap(country), [country]);
  const storeByCode = useMemo(() => {
    const m = new Map<string, Store>();
    for (const s of stores) m.set(s.code, s);
    return m;
  }, [stores]);
  const promoterByName = useMemo(() => {
    const m = new Map<string, Promoter>();
    for (const p of promoters) {
      m.set(p.name.toLowerCase(), p);
      const first = p.name.split(' ')[0].toLowerCase();
      if (!m.has(first)) m.set(first, p);
    }
    return m;
  }, [promoters]);

  // ── Enrich orders with derived fields (once per orders change) ────────
  const enriched = useMemo<EnrichedOrder[]>(() => {
    return orders.map(o => {
      const storeCode = getStoreCodeFromOrder(o, warehouseMap);
      const { vendor, model } = parseVendorModel(o.name);
      return {
        ...o,
        _storeCode: storeCode,
        _vendor: vendor,
        _model: model,
        _mall: storeCode ? getMallName(storeCode, country) : 'Unknown',
        _month: toYearMonth(o.date),
      };
    });
  }, [orders, warehouseMap, country]);

  // ── Apply filters ─────────────────────────────────────────────────────
  const fromDate = monthToStart(fromMonth);
  const toDate = monthToEnd(toMonth);

  const filtered = useMemo<EnrichedOrder[]>(() => {
    return enriched.filter(o => {
      if (o.date < fromDate || o.date > toDate) return false;
      if (statusFilter === 'completed' && o.status.toLowerCase() !== 'completed') return false;
      if (statusFilter === 'all') {
        const bad = ['cancelled', 'returned'];
        if (bad.includes(o.status.toLowerCase())) return false;
      }
      if (selectedStores.size > 0 && (!o._storeCode || !selectedStores.has(o._storeCode))) return false;
      if (selectedPromoters.size > 0) {
        const pname = (o.salesperson ?? '').toLowerCase();
        const first = pname.split(' ')[0];
        if (!selectedPromoters.has(pname) && !selectedPromoters.has(first)) return false;
      }
      if (selectedVendors.size > 0 && !selectedVendors.has(o._vendor)) return false;
      if (selectedModels.size > 0 && !selectedModels.has(o._model)) return false;
      if (selectedMalls.size > 0 && !selectedMalls.has(o._mall)) return false;
      if (selectedPlatforms.size > 0 && (!o.platform || !selectedPlatforms.has(o.platform))) return false;
      return true;
    });
  }, [enriched, fromDate, toDate, statusFilter, selectedStores, selectedPromoters, selectedVendors, selectedModels, selectedMalls, selectedPlatforms]);

  // ── Available options (from enriched, before filters so dropdowns stay stable) ──
  const allStoreCodes = useMemo(() => {
    const set = new Set<string>();
    for (const o of enriched) if (o._storeCode) set.add(o._storeCode);
    return [...set].sort();
  }, [enriched]);
  const allPromoters = useMemo(() => {
    const set = new Set<string>();
    for (const o of enriched) if (o.salesperson) set.add(o.salesperson.split(' ')[0].toLowerCase());
    return [...set].sort();
  }, [enriched]);
  const allVendors = useMemo(() => {
    const set = new Set<string>();
    for (const o of enriched) set.add(o._vendor);
    return [...set].sort();
  }, [enriched]);
  const allModels = useMemo(() => {
    const set = new Set<string>();
    for (const o of enriched) set.add(o._model);
    return [...set].sort();
  }, [enriched]);
  const allMalls = useMemo(() => {
    const set = new Set<string>();
    for (const o of enriched) set.add(o._mall);
    return [...set].sort();
  }, [enriched]);
  const allPlatforms = useMemo(() => {
    const set = new Set<string>();
    for (const o of enriched) if (o.platform) set.add(o.platform);
    return [...set].sort();
  }, [enriched]);

  // ── KPIs + previous period for delta ──────────────────────────────────
  const kpis = useMemo(() => {
    const totalSales = sumAmount(filtered);
    const orderCount = countOrders(filtered);
    const avgOrder = orderCount > 0 ? totalSales / orderCount : 0;

    // Previous period delta (same length ending just before fromDate)
    const fromD = new Date(fromDate + 'T00:00:00');
    const toD = new Date(toDate + 'T00:00:00');
    const spanMs = toD.getTime() - fromD.getTime();
    const prevEnd = new Date(fromD);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setTime(prevEnd.getTime() - spanMs);
    const prevStartStr = prevStart.toISOString().slice(0, 10);
    const prevEndStr = prevEnd.toISOString().slice(0, 10);
    const prevOrders = enriched.filter(o => o.date >= prevStartStr && o.date <= prevEndStr && o.status.toLowerCase() === 'completed');
    const prevSales = sumAmount(prevOrders);
    const salesDelta = prevSales > 0 ? (totalSales - prevSales) / prevSales : 0;

    // Top store / promoter / model
    const byStore = groupBy(filtered, o => o._storeCode ?? 'Unknown');
    const topStore = [...byStore.entries()].map(([k, rows]) => [k, sumAmount(rows)] as const).sort((a, b) => b[1] - a[1])[0];

    const byPromoter = groupBy(filtered, o => (o.salesperson ?? 'Unknown').split(' ')[0].toLowerCase());
    const topPromoter = [...byPromoter.entries()].map(([k, rows]) => [k, sumAmount(rows)] as const).sort((a, b) => b[1] - a[1])[0];

    const byModel = groupBy(filtered, o => o._model);
    const topModel = [...byModel.entries()].map(([k, rows]) => [k, sumAmount(rows)] as const).sort((a, b) => b[1] - a[1])[0];

    return { totalSales, orderCount, avgOrder, salesDelta, topStore, topPromoter, topModel };
  }, [filtered, enriched, fromDate, toDate]);

  // ── Sales trend (by month) ────────────────────────────────────────────
  const trendData = useMemo(() => {
    const byMonth = groupBy(filtered, o => o._month);
    return [...byMonth.entries()]
      .map(([month, rows]) => ({ month, sales: Math.round(sumAmount(rows)), orders: countOrders(rows) }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [filtered]);

  // ── Bar data per dimension ────────────────────────────────────────────
  const buildBarData = (dim: DimensionKey, topN = 12) => {
    const grouped = groupBy(filtered, o => {
      switch (dim) {
        case 'store': return o._storeCode ?? 'Unknown';
        case 'promoter': return (o.salesperson ?? 'Unknown').split(' ')[0].toLowerCase();
        case 'vendor': return o._vendor;
        case 'model': return o._model;
        case 'mall': return o._mall;
        case 'platform': return o.platform ?? 'Unknown';
        case 'sku': return o.sku ?? 'Unknown';
      }
    });
    return [...grouped.entries()]
      .map(([label, rows]) => ({ label, sales: Math.round(sumAmount(rows)), count: countOrders(rows) }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, topN);
  };

  const byStoreData = useMemo(() => buildBarData('store'), [filtered]); // eslint-disable-line react-hooks/exhaustive-deps
  const byPromoterData = useMemo(() => buildBarData('promoter'), [filtered]); // eslint-disable-line react-hooks/exhaustive-deps
  const byVendorData = useMemo(() => buildBarData('vendor'), [filtered]); // eslint-disable-line react-hooks/exhaustive-deps
  const byModelData = useMemo(() => buildBarData('model', 10), [filtered]); // eslint-disable-line react-hooks/exhaustive-deps
  const byMallData = useMemo(() => buildBarData('mall'), [filtered]); // eslint-disable-line react-hooks/exhaustive-deps
  const byPlatformData = useMemo(() => buildBarData('platform'), [filtered]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Anomaly detection ─────────────────────────────────────────────────
  const anomalies = useMemo(() => {
    // Use the latest month in the selected range as "current", previous equal span as baseline.
    return detectBranchAnomalies(
      enriched.filter(o => o.status.toLowerCase() === 'completed'),
      fromDate,
      toDate,
      country,
    );
  }, [enriched, fromDate, toDate, country]);

  // ── Toggle helper ─────────────────────────────────────────────────────
  const toggle = (set: Set<string>, val: string, setState: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    setState(next);
  };

  const resetFilters = () => {
    setFromMonth(nMonthsAgo(5));
    setToMonth(thisMonth());
    setSelectedStores(new Set());
    setSelectedPromoters(new Set());
    setSelectedVendors(new Set());
    setSelectedModels(new Set());
    setSelectedMalls(new Set());
    setSelectedPlatforms(new Set());
    setStatusFilter('completed');
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="dash-page"><div className="dash-header"><h2>Dashboard</h2><p>Loading orders…</p></div></div>;
  }

  return (
    <div className="dash-page">
      <div className="dash-header">
        <h2>Dashboard</h2>
        <p>Slice your order data by any dimension. Click bars to drill down.</p>
      </div>

      {/* ── Filters ─────────────────────────────────────────── */}
      <div className="dash-filters">
        <div className="dash-filter-row">
          <label>From</label>
          <input type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
          <label>To</label>
          <input type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value)} />
          <label>Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | 'completed')}>
            <option value="completed">Completed only</option>
            <option value="all">All (exc. cancelled/returned)</option>
          </select>
          <button className="dash-btn-reset" onClick={resetFilters}>Reset</button>
        </div>

        <div className="dash-filter-row">
          <span className="dash-filter-label">Store:</span>
          {allStoreCodes.map(code => (
            <button
              key={code}
              className={`dash-chip${selectedStores.has(code) ? ' active' : ''}`}
              onClick={() => toggle(selectedStores, code, setSelectedStores)}
            >{code}</button>
          ))}
        </div>

        <div className="dash-filter-row">
          <span className="dash-filter-label">Promoter:</span>
          {allPromoters.slice(0, 20).map(p => (
            <button
              key={p}
              className={`dash-chip${selectedPromoters.has(p) ? ' active' : ''}`}
              onClick={() => toggle(selectedPromoters, p, setSelectedPromoters)}
            >{promoterByName.get(p)?.name.split(' ')[0] ?? p}</button>
          ))}
        </div>

        <div className="dash-filter-row">
          <span className="dash-filter-label">Mall:</span>
          {allMalls.map(m => (
            <button
              key={m}
              className={`dash-chip${selectedMalls.has(m) ? ' active' : ''}`}
              onClick={() => toggle(selectedMalls, m, setSelectedMalls)}
            >{m}</button>
          ))}
        </div>

        <div className="dash-filter-row">
          <span className="dash-filter-label">Vendor:</span>
          {allVendors.slice(0, 15).map(v => (
            <button
              key={v}
              className={`dash-chip${selectedVendors.has(v) ? ' active' : ''}`}
              onClick={() => toggle(selectedVendors, v, setSelectedVendors)}
            >{v}</button>
          ))}
        </div>

        {(selectedModels.size > 0 || allModels.length < 25) && (
          <div className="dash-filter-row">
            <span className="dash-filter-label">Model:</span>
            {allModels.slice(0, 25).map(m => (
              <button
                key={m}
                className={`dash-chip${selectedModels.has(m) ? ' active' : ''}`}
                onClick={() => toggle(selectedModels, m, setSelectedModels)}
              >{m}</button>
            ))}
          </div>
        )}

        {allPlatforms.length > 0 && (
          <div className="dash-filter-row">
            <span className="dash-filter-label">Platform:</span>
            {allPlatforms.slice(0, 10).map(p => (
              <button
                key={p}
                className={`dash-chip${selectedPlatforms.has(p) ? ' active' : ''}`}
                onClick={() => toggle(selectedPlatforms, p, setSelectedPlatforms)}
              >{p}</button>
            ))}
          </div>
        )}
      </div>

      {/* ── Anomaly banner ───────────────────────────────────── */}
      {anomalies.length > 0 && (
        <div className="dash-anomaly">
          <div className="dash-anomaly-title">
            ⚠ {anomalies.length} store{anomalies.length > 1 ? 's' : ''} dropped ≥ 20% while overall is flat/up — AM focus needed
          </div>
          <div className="dash-anomaly-grid">
            {anomalies.map(a => {
              const name = storeByCode.get(a.storeCode)?.name ?? a.storeCode;
              return (
                <div key={a.storeCode} className="dash-anomaly-card">
                  <div className="dash-anomaly-store">{a.storeCode} · {name}</div>
                  <div className="dash-anomaly-numbers">
                    <span className="dash-anomaly-prev">prev {fmtMoney(a.prev, country)}</span>
                    <span className="dash-anomaly-arrow">→</span>
                    <span className="dash-anomaly-curr">now {fmtMoney(a.curr, country)}</span>
                  </div>
                  <div className="dash-anomaly-delta">{fmtPct(a.delta)}</div>
                  <button
                    className="dash-anomaly-focus"
                    onClick={() => setSelectedStores(new Set([a.storeCode]))}
                  >Focus this store →</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── KPI strip ──────────────────────────────────────── */}
      <div className="dash-kpis">
        <div className="dash-kpi">
          <div className="dash-kpi-label">Total Sales</div>
          <div className="dash-kpi-value">{fmtMoney(kpis.totalSales, country)}</div>
          <div className={`dash-kpi-delta${kpis.salesDelta >= 0 ? ' up' : ' down'}`}>
            {fmtPct(kpis.salesDelta)} vs prev
          </div>
        </div>
        <div className="dash-kpi">
          <div className="dash-kpi-label">Orders</div>
          <div className="dash-kpi-value">{kpis.orderCount.toLocaleString()}</div>
        </div>
        <div className="dash-kpi">
          <div className="dash-kpi-label">Avg Order</div>
          <div className="dash-kpi-value">{fmtMoney(kpis.avgOrder, country)}</div>
        </div>
        <div className="dash-kpi">
          <div className="dash-kpi-label">Top Store</div>
          <div className="dash-kpi-value-sm">{kpis.topStore?.[0] ?? '-'}</div>
          <div className="dash-kpi-delta">{kpis.topStore ? fmtMoney(kpis.topStore[1], country) : ''}</div>
        </div>
        <div className="dash-kpi">
          <div className="dash-kpi-label">Top Promoter</div>
          <div className="dash-kpi-value-sm">{kpis.topPromoter?.[0] ?? '-'}</div>
          <div className="dash-kpi-delta">{kpis.topPromoter ? fmtMoney(kpis.topPromoter[1], country) : ''}</div>
        </div>
        <div className="dash-kpi">
          <div className="dash-kpi-label">Top Model</div>
          <div className="dash-kpi-value-sm">{kpis.topModel?.[0] ?? '-'}</div>
          <div className="dash-kpi-delta">{kpis.topModel ? fmtMoney(kpis.topModel[1], country) : ''}</div>
        </div>
      </div>

      {/* ── Charts grid ────────────────────────────────────── */}
      <div className="dash-charts">
        {/* Trend */}
        <div className="dash-chart dash-chart-wide">
          <div className="dash-chart-title">Sales Trend (month)</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" style={{ fontSize: 11 }} />
              <YAxis style={{ fontSize: 11 }} />
              <Tooltip formatter={moneyFormatter(country)} />
              <Legend />
              <Line type="monotone" dataKey="sales" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* By Store */}
        <div className="dash-chart">
          <div className="dash-chart-title">By Store</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byStoreData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" style={{ fontSize: 11 }} />
              <YAxis style={{ fontSize: 11 }} />
              <Tooltip formatter={moneyFormatter(country)} />
              <Bar
                dataKey="sales"
                fill={CHART_COLORS[0]}
                onClick={(d) => {
                  const label = getBarLabel(d);
                  if (label) toggle(selectedStores, label, setSelectedStores);
                }}
                style={{ cursor: 'pointer' }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By Promoter */}
        <div className="dash-chart">
          <div className="dash-chart-title">By Promoter</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byPromoterData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" style={{ fontSize: 11 }} />
              <YAxis style={{ fontSize: 11 }} />
              <Tooltip formatter={moneyFormatter(country)} />
              <Bar
                dataKey="sales"
                fill={CHART_COLORS[1]}
                onClick={(d) => {
                  const label = getBarLabel(d);
                  if (label) toggle(selectedPromoters, label, setSelectedPromoters);
                }}
                style={{ cursor: 'pointer' }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By Mall */}
        <div className="dash-chart">
          <div className="dash-chart-title">By Mall</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byMallData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" style={{ fontSize: 11 }} />
              <YAxis style={{ fontSize: 11 }} />
              <Tooltip formatter={moneyFormatter(country)} />
              <Bar
                dataKey="sales"
                fill={CHART_COLORS[2]}
                onClick={(d) => {
                  const label = getBarLabel(d);
                  if (label) toggle(selectedMalls, label, setSelectedMalls);
                }}
                style={{ cursor: 'pointer' }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By Vendor */}
        <div className="dash-chart">
          <div className="dash-chart-title">By Vendor</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byVendorData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" style={{ fontSize: 11 }} />
              <YAxis style={{ fontSize: 11 }} />
              <Tooltip formatter={moneyFormatter(country)} />
              <Bar
                dataKey="sales"
                fill={CHART_COLORS[3]}
                onClick={(d) => {
                  const label = getBarLabel(d);
                  if (label) toggle(selectedVendors, label, setSelectedVendors);
                }}
                style={{ cursor: 'pointer' }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By Model (horizontal) */}
        <div className="dash-chart">
          <div className="dash-chart-title">Top Models</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byModelData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" style={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="label" width={80} style={{ fontSize: 11 }} />
              <Tooltip formatter={moneyFormatter(country)} />
              <Bar
                dataKey="sales"
                fill={CHART_COLORS[4]}
                onClick={(d) => {
                  const label = getBarLabel(d);
                  if (label) toggle(selectedModels, label, setSelectedModels);
                }}
                style={{ cursor: 'pointer' }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By Platform */}
        {byPlatformData.length > 0 && (
          <div className="dash-chart">
            <div className="dash-chart-title">By Platform</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byPlatformData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" style={{ fontSize: 11 }} />
                <YAxis style={{ fontSize: 11 }} />
                <Tooltip formatter={moneyFormatter(country)} />
                <Bar dataKey="sales" fill={CHART_COLORS[5]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Matrix heatmap: store × month ──────────────────── */}
      {trendData.length > 1 && byStoreData.length > 0 && (
        <div className="dash-matrix-wrap">
          <div className="dash-chart-title">Store × Month Heatmap</div>
          <MatrixHeatmap
            orders={filtered}
            months={trendData.map(d => d.month)}
            stores={byStoreData.map(d => d.label)}
            country={country}
          />
        </div>
      )}

      <div className="dash-footer">
        Showing {filtered.length} orders · {fromMonth} → {toMonth}
      </div>
    </div>
  );
};

// ── Helper component: store × month heatmap ──────────────────────────────
interface MatrixProps {
  orders: EnrichedOrder[];
  months: string[];
  stores: string[];
  country: Country;
}

const MatrixHeatmap = ({ orders, months, stores, country }: MatrixProps) => {
  const cells = useMemo(() => {
    const m = new Map<string, number>();   // `${store}_${month}` → sales
    let max = 0;
    for (const o of orders) {
      if (!o._storeCode) continue;
      const key = `${o._storeCode}_${o._month}`;
      const amt = (o.amountAed ?? 0);
      const next = (m.get(key) ?? 0) + amt;
      m.set(key, next);
      if (next > max) max = next;
    }
    return { map: m, max };
  }, [orders]);

  const color = (val: number): string => {
    if (cells.max === 0) return '#f9fafb';
    const pct = val / cells.max;
    const r = Math.round(238 - pct * (238 - 67));
    const g = Math.round(242 - pct * (242 - 56));
    const b = Math.round(255 - pct * (255 - 202));
    return `rgb(${r}, ${g}, ${b})`;
  };

  return (
    <div className="dash-matrix" style={{ gridTemplateColumns: `80px repeat(${months.length}, 1fr)` }}>
      <div className="dash-matrix-corner"></div>
      {months.map(m => <div key={m} className="dash-matrix-col-hdr">{m}</div>)}
      {stores.map(s => (
        <Fragment key={s}>
          <div className="dash-matrix-row-hdr">{s}</div>
          {months.map(m => {
            const val = cells.map.get(`${s}_${m}`) ?? 0;
            return (
              <div
                key={`${s}_${m}`}
                className="dash-matrix-cell"
                style={{ background: color(val) }}
                title={`${s} · ${m}: ${fmtMoney(val, country)}`}
              >
                {val > 0 ? fmtMoney(val, country) : ''}
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
};

export default DashboardPage;
