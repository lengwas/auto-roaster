import { useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import { useSalesClaims } from '../hooks/useSalesClaims';
import type { SalesClaim } from '../hooks/useSalesClaims';
import './DashboardPage.css'; // reuse existing dashboard styles

// ── Helpers ────────────────────────────────────────────────────────────

function toYearMonth(d: string) { return d.slice(0, 7); }

function parseModels(productList: string | null): string[] {
  if (!productList) return [];
  return productList.split('\n')
    .map(line => {
      const m = line.match(/Model:\s*([^,]+)/i);
      return m ? m[1].trim() : null;
    })
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

  const toggle = (set: Set<string>, val: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val); else next.add(val);
    setter(next);
  };

  // Filter out duplicates + apply filters
  const filtered = useMemo(() => {
    const fromDate = `${fromMonth}-01`;
    const [fy, fm] = toMonth.split('-').map(Number);
    const lastDay = new Date(fy, fm, 0).getDate();
    const toDate = `${toMonth}-${String(lastDay).padStart(2, '0')}`;

    return claims.filter(c => {
      if (c.duplicated) return false;
      if (c.date < fromDate || c.date > toDate) return false;
      if (selBranch.size > 0 && !selBranch.has(c.branch)) return false;
      if (selPromoter.size > 0 && !selPromoter.has(c.promoterName)) return false;
      if (selNationality.size > 0 && c.nationality && !selNationality.has(c.nationality)) return false;
      return true;
    });
  }, [claims, fromMonth, toMonth, selBranch, selPromoter, selNationality]);

  // Available filter options (from non-duplicated claims, before other filters)
  const nonDup = useMemo(() => claims.filter(c => !c.duplicated), [claims]);
  const allBranches = useMemo(() => [...new Set(nonDup.map(c => c.branch))].filter(Boolean).sort(), [nonDup]);
  const allPromoters = useMemo(() => [...new Set(nonDup.map(c => c.promoterName))].filter(Boolean).sort(), [nonDup]);
  const allNationalities = useMemo(() => {
    const s = new Set<string>();
    for (const c of nonDup) if (c.nationality) s.add(c.nationality);
    return [...s].sort();
  }, [nonDup]);

  // KPIs
  const totalClaims = filtered.length;
  const totalLuggage = filtered.reduce((s, c) => s + c.numberOfLuggage, 0);
  const uniquePromoters = new Set(filtered.map(c => c.promoterName)).size;
  const uniqueBranches = new Set(filtered.map(c => c.branch)).size;
  const avgLuggagePerSale = totalClaims > 0 ? (totalLuggage / totalClaims).toFixed(1) : '0';

  // Trend: sales per month
  const trendData = useMemo(() => {
    const m = new Map<string, { month: string; sales: number; luggage: number }>();
    for (const c of filtered) {
      const ym = toYearMonth(c.date);
      const cur = m.get(ym) ?? { month: ym, sales: 0, luggage: 0 };
      cur.sales += 1;
      cur.luggage += c.numberOfLuggage;
      m.set(ym, cur);
    }
    return [...m.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [filtered]);

  // Dimension breakdowns
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

  if (loading) return <div className="dash-page"><p>Loading customer data...</p></div>;
  if (error) return <div className="dash-page"><p style={{ color: '#ef4444' }}>Error: {error}</p></div>;

  return (
    <div className="dash-page">
      <div className="dash-header">
        <h2>Customer Dashboard</h2>
        <p>UAE Paid Customers — {totalClaims} transactions ({claims.filter(c => c.duplicated).length} duplicates excluded)</p>
      </div>

      {/* ── Filters ──────────────────────────────────────────────── */}
      <div className="dash-filters">
        <div className="dash-filter-row">
          <label>Period</label>
          <input type="month" value={fromMonth} onChange={e => setFromMonth(e.target.value)} />
          <span style={{ color: '#9ca3af' }}>→</span>
          <input type="month" value={toMonth} onChange={e => setToMonth(e.target.value)} />
          <button className="dash-btn-reset" onClick={() => { setSelBranch(new Set()); setSelPromoter(new Set()); setSelNationality(new Set()); }}>
            Reset filters
          </button>
        </div>
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
      </div>

      {/* ── KPIs ─────────────────────────────────────────────────── */}
      <div className="dash-kpis">
        <div className="dash-kpi">
          <span className="dash-kpi-label">Total Sales</span>
          <span className="dash-kpi-value">{totalClaims.toLocaleString()}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Total Luggage</span>
          <span className="dash-kpi-value">{totalLuggage.toLocaleString()}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Avg Luggage / Sale</span>
          <span className="dash-kpi-value">{avgLuggagePerSale}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Promoters</span>
          <span className="dash-kpi-value">{uniquePromoters}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Branches</span>
          <span className="dash-kpi-value">{uniqueBranches}</span>
        </div>
      </div>

      {/* ── Charts ────────────────────────────────────────────────── */}

      {/* Trend */}
      <div className="dash-charts">
        <div className="dash-chart-card dash-chart-wide">
          <h3>Sales Trend</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="sales" name="Transactions" stroke="#6366f1" strokeWidth={2} />
              <Line type="monotone" dataKey="luggage" name="Luggage" stroke="#10b981" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* By Branch */}
        <div className="dash-chart-card">
          <h3>Sales by Branch</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={byBranch} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={11} />
              <YAxis dataKey="name" type="category" fontSize={11} width={50} />
              <Tooltip />
              <Bar dataKey="value" name="Sales" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By Promoter */}
        <div className="dash-chart-card">
          <h3>Sales by Promoter</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={byPromoter} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={11} />
              <YAxis dataKey="name" type="category" fontSize={11} width={90} />
              <Tooltip />
              <Bar dataKey="value" name="Sales" fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By Nationality */}
        <div className="dash-chart-card">
          <h3>Top Nationalities</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={byNationality} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={11} />
              <YAxis dataKey="name" type="category" fontSize={11} width={80} />
              <Tooltip />
              <Bar dataKey="value" name="Customers" fill="#f59e0b" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By Model */}
        <div className="dash-chart-card">
          <h3>Product Models</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={byModel} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={11} />
              <YAxis dataKey="name" type="category" fontSize={11} width={80} />
              <Tooltip />
              <Bar dataKey="value" name="Units" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Gender Pie */}
        <div className="dash-chart-card">
          <h3>Gender</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={byGender} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {byGender.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Visa Type Pie */}
        <div className="dash-chart-card">
          <h3>Visa Type</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={byVisaType} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {byVisaType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Age Range */}
        <div className="dash-chart-card">
          <h3>Age Range</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={byAgeRange}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={10} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Bar dataKey="value" name="Customers" fill="#06b6d4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Group Type */}
        <div className="dash-chart-card">
          <h3>Group Type</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={byGroupType} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={11} />
              <YAxis dataKey="name" type="category" fontSize={10} width={120} />
              <Tooltip />
              <Bar dataKey="value" name="Customers" fill="#ec4899" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default CustomerDashboardPage;
