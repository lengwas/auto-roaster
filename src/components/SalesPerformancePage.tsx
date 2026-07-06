import { useState, useMemo } from 'react';
import type {
  Store, Promoter, Shift,
  StoreTierSetting, PromoterGradeOverride,
  StoreTier, PromoterGrade, Country,
} from '../types/types';
import { useOrders } from '../hooks/useOrders';
import './SalesPerformancePage.css';

// ─── constants ────────────────────────────────────────────────────────────────
const TIERS: StoreTier[] = ['A', 'B', 'C', 'D'];
const GRADES: PromoterGrade[] = ['A', 'B', 'C', 'D'];
const SPECIAL_SHIFTS = new Set(['Off', 'LOP', 'SL']);

// Warehouse code (from real orders) → store code
// e.g. orders.warehouse = "VIR - DBM" → store.code = "VDM"
const WAREHOUSE_CODE_MAP_UAE: Record<string, string> = {
  'vir - dbm': 'VDM', 'vir - moe': 'VME', 'vir - dbh': 'VDH',
  'vir - mrn': 'VMN', 'vir - mdf': 'VMF', 'vir - nkm': 'VNK',
  'vir - yas': 'VYM', 'vir - amy': 'VAY', 'vir - rem': 'VRM',
  'vir - adm': 'VAD', 'vir - arb': 'VAY', 'vir - azc': 'VNK',
  'jsm - moe': 'JME', 'jsm - dbm': 'JDM', 'jsm - dbh': 'JDH',
  'bdr - dbm': 'BDM', 'bdr - dbh': 'JDH',
  'hls - dbm': 'HDM',
  'sdg - dbm': 'SDM',
  'air - 48':  'AIR', 'air - dcc': 'ADC',
  'img - wld': 'IMG',
};

const WAREHOUSE_CODE_MAP_QA: Record<string, string> = {
  'vir - vlm': 'VLM', 'vir - vmq': 'VMQ', 'vir - vdf': 'VDF',
  'vir - vvg': 'VVG', 'vir - vvd': 'VVD',
  'kdz - kvd': 'KVD', 'kdz - klm': 'KLM', 'kdz - moq': 'KMQ',
  'kdz - dfc': 'VDF', // Kiddyzone DFC → map to VDF store
  'ron - rkt': 'RKT',
  'fnc - dfc': 'VDF', // FNAC DFC → map to VDF store
  'fnc - vvd': 'VVD', // FNAC Vendome → map to VVD store
};
// Thailand — populate when store list is confirmed
const WAREHOUSE_CODE_MAP_TH: Record<string, string> = {};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Grade A can be placed at store tier A or B, etc.
const GRADE_ALLOWED_TIERS: Record<PromoterGrade, StoreTier[]> = {
  A: ['A', 'B'],
  B: ['A', 'B', 'C'],
  C: ['B', 'C', 'D'],
  D: ['C', 'D'],
};

// PI thresholds: auto-grade based on Performance Index
const PI_THRESHOLDS: Record<PromoterGrade, number> = {
  A: 1.15,  // ≥ 1.15 → A
  B: 0.95,  // ≥ 0.95 → B
  C: 0.75,  // ≥ 0.75 → C
  D: 0,     // < 0.75 → D
};

function piToGrade(pi: number): PromoterGrade {
  if (pi >= PI_THRESHOLDS.A) return 'A';
  if (pi >= PI_THRESHOLDS.B) return 'B';
  if (pi >= PI_THRESHOLDS.C) return 'C';
  return 'D';
}

function gradeCls(g: PromoterGrade | null) {
  if (!g) return '';
  return `grade-${g.toLowerCase()}`;
}
function tierCls(t: StoreTier | null) {
  if (!t) return '';
  return `tier-${t.toLowerCase()}`;
}

// ─── types ────────────────────────────────────────────────────────────────────
type Period = '1m' | '3m' | '6m';
type View = 'performance' | 'fitmap';
type SortKey = 'name' | 'totalSales' | 'dailyAvg' | 'pi' | 'grade' | 'orders' | 'days';

interface StorePerf {
  storeCode: string;
  storeName: string;
  tier: StoreTier | null;
  sales: number;
  orders: number;
  days: number;       // unique (salesperson, date) pairs = promoter-days
  avgPerDay: number;  // store avg: totalSales / days
}

interface PromoterStorePerf {
  storeCode: string;
  storeName: string;
  tier: StoreTier | null;
  sales: number;
  orders: number;
  days: number;
  dailyAvg: number;
  pi: number;         // relative to store avg
}

interface PromoterRow {
  promoterId: string;
  name: string;
  totalSales: number;
  orderCount: number;
  workDays: number;   // distinct days with a sale (used for daily-avg / PI)
  shiftDays: number;  // distinct days actually on shift (from the roster)
  dailyAvg: number;
  pi: number;         // weighted overall performance index
  autoGrade: PromoterGrade;
  effectiveGrade: PromoterGrade; // override if set, else autoGrade
  storePerfs: PromoterStorePerf[];
  dowSales: number[];  // index 0=Sun…6=Sat, total sales per DOW
  misfit: boolean;     // any current-period store assignment that violates grade-tier rule
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function periodToMonths(p: Period): number {
  return p === '1m' ? 1 : p === '3m' ? 3 : 6;
}

function getDateRange(months: number): [string, string] {
  const now = new Date();
  const from = new Date(now);
  from.setMonth(from.getMonth() - months);
  return [from.toISOString().split('T')[0], now.toISOString().split('T')[0]];
}

function dowOf(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00Z').getUTCDay(); // 0=Sun
}

function fmtAed(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
}

// ─── component ────────────────────────────────────────────────────────────────
interface Props {
  stores: Store[];
  promoters: Promoter[];
  shifts: Shift[];
  storeTiers: StoreTierSetting[];
  onStoreTiersChange: (t: StoreTierSetting[]) => void;
  gradeOverrides: PromoterGradeOverride[];
  onGradeOverridesChange: (o: PromoterGradeOverride[]) => void;
  country?: Country;
}

const SalesPerformancePage = ({
  stores, promoters, shifts,
  storeTiers, onStoreTiersChange,
  gradeOverrides, onGradeOverridesChange,
  country = 'UAE',
}: Props) => {
  const [period, setPeriod] = useState<Period>('3m');
  const [view, setView] = useState<View>('performance');
  const [activeOnly, setActiveOnly] = useState(true);
  const [tierPanelOpen, setTierPanelOpen] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('pi');
  const [sortDesc, setSortDesc] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch all orders going back 6m so period filter is client-side
  const { orders, loading, error } = useOrders(6, country);
  const WAREHOUSE_CODE_MAP = { UAE: WAREHOUSE_CODE_MAP_UAE, QA: WAREHOUSE_CODE_MAP_QA, TH: WAREHOUSE_CODE_MAP_TH }[country];
  const currencyLabel = { UAE: 'AED', QA: 'QAR', TH: 'THB' }[country];

  // ── lookups ──────────────────────────────────────────────────────────────
  // Match orders.warehouse → store using:
  // 1. WAREHOUSE_CODE_MAP ("VIR - DBM" → VDM)
  // 2. stores.warehouse / stores.platform text match
  // 3. direct store code match
  const storeByWarehouse = useMemo(() => {
    const codeMap = new Map<string, Store>();
    // Build code lookup first
    stores.forEach(s => codeMap.set(s.code, s));

    const m = new Map<string, Store>();
    // WAREHOUSE_CODE_MAP entries
    Object.entries(WAREHOUSE_CODE_MAP).forEach(([wh, code]) => {
      const store = codeMap.get(code);
      if (store) m.set(wh, store);
    });
    // stores.warehouse / stores.platform / stores.code
    stores.forEach(s => {
      if (s.warehouse) m.set(s.warehouse.toLowerCase().trim(), s);
      if (s.platform)  m.set(s.platform.toLowerCase().trim(), s);
      m.set(s.code.toLowerCase(), s);
    });
    return m;
  }, [stores]);

  const storeByCode = useMemo(() => {
    const m = new Map<string, Store>();
    stores.forEach(s => m.set(s.code, s));
    return m;
  }, [stores]);

  const promoterByName = useMemo(() => {
    const m = new Map<string, Promoter>();
    promoters.forEach(p => m.set(p.name.toLowerCase().trim(), p));
    return m;
  }, [promoters]);

  const tierMap = useMemo(() => {
    const m = new Map<string, StoreTier>();
    storeTiers.forEach(t => m.set(t.storeCode, t.tier));
    return m;
  }, [storeTiers]);

  const overrideMap = useMemo(() => {
    const m = new Map<string, PromoterGrade>();
    gradeOverrides.forEach(o => m.set(o.promoterId, o.grade));
    return m;
  }, [gradeOverrides]);

  // ── filter orders ────────────────────────────────────────────────────────
  const filteredOrders = useMemo(() => {
    const months = periodToMonths(period);
    const [fromDate] = getDateRange(months);
    return orders.filter(o => {
      if (o.date < fromDate) return false;
      if (o.status.toLowerCase() !== 'completed') return false; // always completed only
      return true;
    });
  }, [orders, period]);

  // ── store-level stats ────────────────────────────────────────────────────
  const storePerfs = useMemo(() => {
    // sales: Map<storeCode, { sales, orders, days: Set<`${salesperson}_${date}`> }>
    const acc = new Map<string, { sales: number; orders: number; daySet: Set<string> }>();

    filteredOrders.forEach(o => {
      if (!o.warehouse) return;
      const store = storeByWarehouse.get(o.warehouse.toLowerCase().trim());
      if (!store) return;
      const sp = o.salesperson?.toLowerCase().trim() || '_unknown';
      const key = `${sp}_${o.date}`;
      if (!acc.has(store.code)) acc.set(store.code, { sales: 0, orders: 0, daySet: new Set() });
      const entry = acc.get(store.code)!;
      entry.sales += o.amountAed ?? 0;
      entry.orders += 1;
      entry.daySet.add(key);
    });

    const result = new Map<string, StorePerf>();
    acc.forEach(({ sales, orders, daySet }, code) => {
      const store = storeByCode.get(code)!;
      const days = daySet.size;
      result.set(code, {
        storeCode: code,
        storeName: store.name,
        tier: tierMap.get(code) ?? null,
        sales,
        orders,
        days,
        avgPerDay: days > 0 ? sales / days : 0,
      });
    });
    return result;
  }, [filteredOrders, storeByWarehouse, storeByCode, tierMap]);

  // ── per-promoter stats ───────────────────────────────────────────────────
  const promoterRows = useMemo(() => {
    // Distinct days each promoter was actually on shift (roster), within the
    // selected period. Excludes off/leave codes — "days on shift", not sales days.
    const SHIFT_LEAVE = new Set(['off', 'al', 'sl', 'lop', 'air', 'ph', 'do', '-', '']);
    const [shiftFrom] = getDateRange(periodToMonths(period));
    const shiftDaysBy = new Map<string, Set<string>>();
    for (const s of shifts) {
      if (s.date < shiftFrom) continue;
      const t = (s.type ?? '').toLowerCase().trim();
      if (!t || SHIFT_LEAVE.has(t)) continue;
      if (!shiftDaysBy.has(s.promoterId)) shiftDaysBy.set(s.promoterId, new Set());
      shiftDaysBy.get(s.promoterId)!.add(s.date);
    }
    const shiftDaysOf = (pid: string) => shiftDaysBy.get(pid)?.size ?? 0;

    // Accumulate: promoterId → storeCode → { sales, orders, dateSet }
    const acc = new Map<string, Map<string, { sales: number; orders: number; dateSet: Set<string> }>>();

    filteredOrders.forEach(o => {
      if (!o.salesperson || !o.warehouse) return;
      const store = storeByWarehouse.get(o.warehouse.toLowerCase().trim());
      if (!store) return;
      const promoter = promoterByName.get(o.salesperson.toLowerCase().trim());
      if (!promoter) return;
      if (activeOnly && !promoter.active) return;

      if (!acc.has(promoter.id)) acc.set(promoter.id, new Map());
      const storeMap = acc.get(promoter.id)!;
      if (!storeMap.has(store.code)) storeMap.set(store.code, { sales: 0, orders: 0, dateSet: new Set() });
      const entry = storeMap.get(store.code)!;
      entry.sales += o.amountAed ?? 0;
      entry.orders += 1;
      entry.dateSet.add(o.date);
    });

    // DOW breakdown per promoter
    const dowAcc = new Map<string, number[]>(); // promoterId → [sun..sat]
    filteredOrders.forEach(o => {
      if (!o.salesperson) return;
      const promoter = promoterByName.get(o.salesperson.toLowerCase().trim());
      if (!promoter) return;
      if (activeOnly && !promoter.active) return;
      if (!dowAcc.has(promoter.id)) dowAcc.set(promoter.id, [0, 0, 0, 0, 0, 0, 0]);
      dowAcc.get(promoter.id)![dowOf(o.date)] += o.amountAed ?? 0;
    });

    const rows: PromoterRow[] = [];

    const targetPromoters = activeOnly ? promoters.filter(p => p.active) : promoters;

    targetPromoters.forEach(promoter => {
      const storeData = acc.get(promoter.id);
      const dowSales = dowAcc.get(promoter.id) ?? [0, 0, 0, 0, 0, 0, 0];

      if (!storeData || storeData.size === 0) {
        rows.push({
          promoterId: promoter.id,
          name: promoter.name,
          totalSales: 0,
          orderCount: 0,
          workDays: 0,
          shiftDays: shiftDaysOf(promoter.id),
          dailyAvg: 0,
          pi: 0,
          autoGrade: 'D',
          effectiveGrade: overrideMap.get(promoter.id) ?? 'D',
          storePerfs: [],
          dowSales,
          misfit: false,
        });
        return;
      }

      const storePerfsArr: PromoterStorePerf[] = [];
      let totalSales = 0;
      let totalOrders = 0;
      let totalWorkDays = 0;
      let weightedExpected = 0;

      storeData.forEach((data, storeCode) => {
        const store = storeByCode.get(storeCode);
        if (!store) return;
        const days = data.dateSet.size;
        const dailyAvg = days > 0 ? data.sales / days : 0;
        const storeStat = storePerfs.get(storeCode);
        const storeAvg = storeStat?.avgPerDay ?? 0;
        const pi = storeAvg > 0 ? dailyAvg / storeAvg : 0;

        storePerfsArr.push({
          storeCode,
          storeName: store.name,
          tier: tierMap.get(storeCode) ?? null,
          sales: data.sales,
          orders: data.orders,
          days,
          dailyAvg,
          pi,
        });

        totalSales += data.sales;
        totalOrders += data.orders;
        totalWorkDays += days;
        weightedExpected += days * storeAvg;
      });

      const overallPI = weightedExpected > 0 ? totalSales / weightedExpected : 0;
      const autoGrade = piToGrade(overallPI);
      const effectiveGrade = overrideMap.get(promoter.id) ?? autoGrade;

      // Check misfit: any store assignment violates grade-tier rule
      const allowed = GRADE_ALLOWED_TIERS[effectiveGrade];
      const misfit = storePerfsArr.some(sp => {
        if (!sp.tier) return false;
        return !allowed.includes(sp.tier);
      });

      rows.push({
        promoterId: promoter.id,
        name: promoter.name,
        totalSales,
        orderCount: totalOrders,
        workDays: totalWorkDays,
        shiftDays: shiftDaysOf(promoter.id),
        dailyAvg: totalWorkDays > 0 ? totalSales / totalWorkDays : 0,
        pi: overallPI,
        autoGrade,
        effectiveGrade,
        storePerfs: storePerfsArr.sort((a, b) => b.sales - a.sales),
        dowSales,
        misfit,
      });
    });

    // Sort
    rows.sort((a, b) => {
      let va = 0, vb = 0;
      if (sortKey === 'name') return sortDesc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
      if (sortKey === 'grade') {
        va = GRADES.indexOf(a.effectiveGrade);
        vb = GRADES.indexOf(b.effectiveGrade);
      } else if (sortKey === 'totalSales') { va = a.totalSales; vb = b.totalSales; }
      else if (sortKey === 'dailyAvg') { va = a.dailyAvg; vb = b.dailyAvg; }
      else if (sortKey === 'pi') { va = a.pi; vb = b.pi; }
      else if (sortKey === 'orders') { va = a.orderCount; vb = b.orderCount; }
      else if (sortKey === 'days') { va = a.shiftDays; vb = b.shiftDays; }
      return sortDesc ? vb - va : va - vb;
    });

    return rows;
  }, [
    filteredOrders, promoters, storeByWarehouse, storeByCode, promoterByName,
    storePerfs, tierMap, overrideMap, activeOnly, sortKey, sortDesc, shifts, period,
  ]);

  // ── handlers ─────────────────────────────────────────────────────────────
  const setStoreTier = (code: string, tier: StoreTier | null) => {
    const filtered = storeTiers.filter(t => t.storeCode !== code);
    onStoreTiersChange(tier ? [...filtered, { storeCode: code, tier }] : filtered);
  };

  const cycleStoreTier = (code: string) => {
    const current = tierMap.get(code) ?? null;
    const order: (StoreTier | null)[] = [null, 'A', 'B', 'C', 'D'];
    const idx = order.indexOf(current);
    setStoreTier(code, order[(idx + 1) % order.length] ?? null);
  };

  const autoCalcTiers = () => {
    // Sum amount_aed per store from filtered orders
    const totals = new Map<string, number>();
    filteredOrders.forEach(o => {
      if (!o.warehouse) return;
      const store = storeByWarehouse.get(o.warehouse.toLowerCase().trim());
      if (!store) return;
      totals.set(store.code, (totals.get(store.code) ?? 0) + (o.amountAed ?? 0));
    });
    // Sort stores by total revenue descending
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const n = sorted.length;
    if (n === 0) return;
    // Assign tiers: top 20% = A, next 30% = B, next 30% = C, bottom 20% = D
    const tiers: StoreTierSetting[] = sorted.map(([code], i) => {
      const pct = i / n;
      let tier: StoreTier;
      if (pct < 0.2) tier = 'A';
      else if (pct < 0.5) tier = 'B';
      else if (pct < 0.8) tier = 'C';
      else tier = 'D';
      return { storeCode: code, tier };
    });
    onStoreTiersChange(tiers);
  };

  const setGradeOverride = (promoterId: string, grade: PromoterGrade | null) => {
    const filtered = gradeOverrides.filter(o => o.promoterId !== promoterId);
    onGradeOverridesChange(grade ? [...filtered, { promoterId, grade }] : filtered);
  };

  const cycleOverride = (row: PromoterRow) => {
    const current = overrideMap.get(row.promoterId) ?? null;
    const order: (PromoterGrade | null)[] = [null, 'A', 'B', 'C', 'D'];
    const idx = order.indexOf(current);
    setGradeOverride(row.promoterId, order[(idx + 1) % order.length] ?? null);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc(d => !d);
    else { setSortKey(key); setSortDesc(true); }
  };

  const sortIcon = (key: SortKey) =>
    sortKey !== key ? '' : sortDesc ? ' ↓' : ' ↑';

  // ── stats summary ─────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const total = filteredOrders.reduce((s, o) => s + (o.amountAed ?? 0), 0);
    const misfits = promoterRows.filter(r => r.misfit && r.workDays > 0).length;
    const withData = promoterRows.filter(r => r.workDays > 0);
    const gradeDist = GRADES.map(g => ({
      grade: g,
      count: withData.filter(r => r.effectiveGrade === g).length,
      totalSales: withData.filter(r => r.effectiveGrade === g).reduce((s, r) => s + r.totalSales, 0),
      avgPI: withData.filter(r => r.effectiveGrade === g).reduce((s, r) => s + r.pi, 0) /
             Math.max(withData.filter(r => r.effectiveGrade === g).length, 1),
    }));
    return { totalOrders: filteredOrders.length, totalSales: total, misfits, gradeDist, withData: withData.length };
  }, [filteredOrders, promoterRows]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="sp-page">
      {/* ── TOP CONTROLS ── */}
      <div className="sp-controls">
        <div className="sp-controls-left">
          {/* Period */}
          <div className="sp-ctrl-group">
            <span className="sp-ctrl-label">Period</span>
            <div className="sp-btn-group">
              {(['1m', '3m', '6m'] as Period[]).map(p => (
                <button
                  key={p}
                  className={`sp-period-btn ${period === p ? 'active' : ''}`}
                  onClick={() => setPeriod(p)}
                >{p === '1m' ? '1 Month' : p === '3m' ? '3 Months' : '6 Months'}</button>
              ))}
            </div>
          </div>

        </div>

        <div className="sp-controls-right">
          <label className="sp-toggle-label">
            <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} />
            Active only
          </label>
          {/* View toggle */}
          <div className="sp-btn-group">
            <button className={`sp-period-btn ${view === 'performance' ? 'active' : ''}`} onClick={() => setView('performance')}>Performance</button>
            <button className={`sp-period-btn ${view === 'fitmap' ? 'active' : ''}`} onClick={() => setView('fitmap')}>Fit Map</button>
          </div>
        </div>
      </div>

      {/* ── SUMMARY BAR ── */}
      <div className="sp-summary-bar">
        <div className="sp-summary-item">
          <span className="sp-summary-value">{filteredOrders.length.toLocaleString()}</span>
          <span className="sp-summary-label">Orders</span>
        </div>
        <div className="sp-summary-item">
          <span className="sp-summary-value">{currencyLabel} {fmtAed(summary.totalSales)}</span>
          <span className="sp-summary-label">Total Sales</span>
        </div>
        <div className="sp-summary-item">
          <span className="sp-summary-value">{promoterRows.filter(r => r.workDays > 0).length}</span>
          <span className="sp-summary-label">Active Promoters</span>
        </div>
        <div className="sp-summary-item">
          <span className={`sp-summary-value ${summary.misfits > 0 ? 'sp-warn' : 'sp-ok'}`}>{summary.misfits}</span>
          <span className="sp-summary-label">Grade Misfits</span>
        </div>
        {loading && <span className="sp-loading-badge">Loading…</span>}
        {error && (
          <span className="sp-error-badge" title={error}>
            ⚠ Cannot load orders
            {error.includes('permission') || error.includes('RLS') || error.includes('policy')
              ? ' — run supabase-orders-anon.sql'
              : ''}
          </span>
        )}
      </div>

      {/* ── GRADE DISTRIBUTION BAR ── */}
      {summary.withData > 0 && (
        <div className="sp-grade-bar">
          {summary.gradeDist.map(({ grade, count, totalSales, avgPI }) => (
            <div
              key={grade}
              className={`sp-grade-bar-item grade-bg-${grade.toLowerCase()}`}
              style={{ flex: Math.max(count, 0.5) }}
              title={`Grade ${grade}: ${count} promoter${count !== 1 ? 's' : ''} · ${currencyLabel} ${fmtAed(totalSales)} · avg PI ${avgPI.toFixed(2)}`}
            >
              <span className="sp-grade-bar-label">
                <span className={`sp-grade-badge ${gradeCls(grade as PromoterGrade)}`}>{grade}</span>
                <span className="sp-grade-bar-count">{count}</span>
              </span>
              <span className="sp-grade-bar-sales">{currencyLabel} {fmtAed(totalSales)}</span>
              <span className="sp-grade-bar-pi">PI {avgPI.toFixed(2)}</span>
            </div>
          ))}
          <button
            className={`sp-info-btn ${showInfo ? 'active' : ''}`}
            onClick={() => setShowInfo(v => !v)}
            title="How grades are calculated"
          >ℹ How it works</button>
        </div>
      )}

      {/* ── METHODOLOGY PANEL ── */}
      {showInfo && (
        <div className="sp-info-panel">
          <button className="sp-info-close" onClick={() => setShowInfo(false)}>✕</button>
          <h3 className="sp-info-title">How Promoter Grades are Calculated</h3>
          <div className="sp-info-cols">
            {/* Step 1 */}
            <div className="sp-info-step">
              <div className="sp-info-step-num">1</div>
              <div className="sp-info-step-body">
                <div className="sp-info-step-title">Store Average Daily Sales</div>
                <div className="sp-info-formula">
                  Store Avg = Total store sales ÷ Total promoter-days at store
                </div>
                <div className="sp-info-note">
                  "Promoter-day" = 1 unique (promoter, date) pair. เช่น ถ้ามี 2 คนทำงานวันเดียวกัน นับเป็น 2 promoter-days
                </div>
              </div>
            </div>
            {/* Step 2 */}
            <div className="sp-info-step">
              <div className="sp-info-step-num">2</div>
              <div className="sp-info-step-body">
                <div className="sp-info-step-title">Performance Index (PI)</div>
                <div className="sp-info-formula">
                  PI = Promoter daily avg at store ÷ Store avg daily sales
                </div>
                <div className="sp-info-note">
                  PI &gt; 1.0 = ขายได้มากกว่า store average · PI &lt; 1.0 = ต่ำกว่า average
                </div>
                <div className="sp-info-example">
                  เช่น Store avg = {currencyLabel} 6,000/วัน, Promoter avg = {currencyLabel} 7,200/วัน → PI = 1.20
                </div>
              </div>
            </div>
            {/* Step 3 */}
            <div className="sp-info-step">
              <div className="sp-info-step-num">3</div>
              <div className="sp-info-step-body">
                <div className="sp-info-step-title">Overall PI (Weighted)</div>
                <div className="sp-info-formula">
                  Overall PI = Total sales ÷ Σ(days at store × store avg)
                </div>
                <div className="sp-info-note">
                  Weighted by days worked → promoter ที่ทำงานหลาย store จะถูก normalize ตาม store ที่ทำงานนานกว่า
                </div>
              </div>
            </div>
            {/* Step 4 */}
            <div className="sp-info-step">
              <div className="sp-info-step-num">4</div>
              <div className="sp-info-step-body">
                <div className="sp-info-step-title">Auto Grade</div>
                <div className="sp-info-grades">
                  <span className="sp-grade-badge grade-a">A</span>
                  <span className="sp-info-grade-rule">PI ≥ 1.15 (15%+ above avg)</span>
                  <span className="sp-grade-badge grade-b">B</span>
                  <span className="sp-info-grade-rule">PI ≥ 0.95 (within 5% below avg)</span>
                  <span className="sp-grade-badge grade-c">C</span>
                  <span className="sp-info-grade-rule">PI ≥ 0.75 (up to 25% below avg)</span>
                  <span className="sp-grade-badge grade-d">D</span>
                  <span className="sp-info-grade-rule">PI &lt; 0.75 (more than 25% below avg)</span>
                </div>
              </div>
            </div>
            {/* Step 5 */}
            <div className="sp-info-step">
              <div className="sp-info-step-num">5</div>
              <div className="sp-info-step-body">
                <div className="sp-info-step-title">Grade–Tier Fit Rules</div>
                <div className="sp-info-grades">
                  {(Object.entries(GRADE_ALLOWED_TIERS) as [PromoterGrade, StoreTier[]][]).map(([g, tiers]) => (
                    <><span className={`sp-grade-badge ${gradeCls(g)}`}>{g}</span>
                    <span className="sp-info-grade-rule">
                      → Store tier {tiers.map(t => <span key={t} className={`sp-tier-badge ${tierCls(t)}`}>{t}</span>)}
                    </span></>
                  ))}
                </div>
              </div>
            </div>
            {/* Adjustments */}
            <div className="sp-info-step">
              <div className="sp-info-step-num">★</div>
              <div className="sp-info-step-body">
                <div className="sp-info-step-title">Filters & Adjustments</div>
                <ul className="sp-info-list">
                  <li><strong>Period</strong> — ย้อนหลัง 1/3/6 เดือน (more months = more stable)</li>
                  <li><strong>Day of Week (DOW)</strong> — isolate weekday vs weekend performance</li>
                  <li><strong>Status</strong> — completed orders only (excludes cancelled/returned)</li>
                  <li><strong>Multi-PC days</strong> — วันที่มี 2 promoter ที่ store เดียวกัน อาจทำให้ PI ลดลง เพราะ sales แบ่งกัน</li>
                  <li><strong>Manual Override</strong> — ปรับ grade ด้วยมือได้ (ไม่กระทบ auto grade)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      {view === 'performance' ? (
        <div className="sp-body">
          {/* Store Tier Panel */}
          <div className={`sp-tier-panel ${tierPanelOpen ? 'open' : 'closed'}`}>
            <div className="sp-tier-panel-header">
              {tierPanelOpen && <span>Store Tiers</span>}
              <button className="sp-tier-close" onClick={() => setTierPanelOpen(o => !o)}>
                {tierPanelOpen ? '←' : '→'}
              </button>
            </div>
            {tierPanelOpen && (
              <>
                <p className="sp-tier-desc">Click to cycle: — → A → B → C → D</p>
                <div className="sp-tier-legend">
                  {TIERS.map(t => (
                    <span key={t} className={`sp-tier-badge ${tierCls(t)}`}>{t}</span>
                  ))}
                </div>
                <button
                  className="btn btn-primary btn-small"
                  style={{ margin: '8px 0', width: '100%' }}
                  onClick={autoCalcTiers}
                  disabled={filteredOrders.length === 0}
                >
                  Auto-calculate from Revenue
                </button>
                <div className="sp-tier-list">
                  {[...stores].sort((a, b) => {
                    // Active stores first, then by revenue
                    if (a.active !== b.active) return a.active ? -1 : 1;
                    const ra = storePerfs.get(a.code)?.sales ?? 0;
                    const rb = storePerfs.get(b.code)?.sales ?? 0;
                    return rb - ra;
                  }).map(store => {
                    const tier = tierMap.get(store.code) ?? null;
                    const rev = storePerfs.get(store.code)?.sales;
                    return (
                      <div key={store.code} className={`sp-tier-row ${!store.active ? 'sp-tier-row-inactive' : ''}`} onClick={() => cycleStoreTier(store.code)}>
                        <span className="sp-tier-code">{store.code}</span>
                        <span className="sp-tier-name">{store.name}</span>
                        {rev != null && rev > 0 && (
                          <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 'auto', marginRight: 6 }}>
                            {Math.round(rev).toLocaleString()}
                          </span>
                        )}
                        <span className={`sp-tier-badge ${tier ? tierCls(tier) : 'no-tier'}`}>
                          {tier ?? '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Performance Table */}
          <div className="sp-table-wrap">
            {orders.length === 0 && !loading && (
              <div className="sp-empty">
                <p>No orders data found.</p>
                <p className="sp-empty-sub">Make sure orders are synced to Supabase and the <code>anon</code> role has read access (run <code>scripts/supabase-orders-anon.sql</code>).</p>
              </div>
            )}
            {(orders.length > 0 || loading) && (
              <table className="sp-table">
                <thead>
                  <tr>
                    <th className="sp-th-num">#</th>
                    <th className="sp-th-name sp-sortable" onClick={() => handleSort('name')}>Name{sortIcon('name')}</th>
                    <th className="sp-th-grade sp-sortable" onClick={() => handleSort('grade')}>Grade{sortIcon('grade')}</th>
                    <th className="sp-th-override">Override</th>
                    <th className="sp-sortable sp-th-c" onClick={() => handleSort('totalSales')}>Total {currencyLabel}{sortIcon('totalSales')}</th>
                    <th className="sp-sortable sp-th-c" onClick={() => handleSort('dailyAvg')}>Daily Avg{sortIcon('dailyAvg')}</th>
                    <th className="sp-sortable sp-th-c" onClick={() => handleSort('pi')}>Perf. Index{sortIcon('pi')}</th>
                    <th className="sp-sortable sp-th-c" onClick={() => handleSort('orders')}>Orders{sortIcon('orders')}</th>
                    <th className="sp-sortable sp-th-c" onClick={() => handleSort('days')}>Days{sortIcon('days')}</th>
                    <th>Stores</th>
                  </tr>
                </thead>
                <tbody>
                  {promoterRows.map((row, idx) => {
                    const isExpanded = expandedId === row.promoterId;
                    const overridden = overrideMap.has(row.promoterId);
                    const noData = row.workDays === 0;
                    return (
                      <>
                        <tr
                          key={row.promoterId}
                          className={`sp-row ${row.misfit ? 'sp-row-misfit' : ''} ${noData ? 'sp-row-nodata' : ''}`}
                        >
                          <td className="sp-td-num">{idx + 1}</td>
                          <td className="sp-td-name">
                            <button className="sp-expand-btn" onClick={() => setExpandedId(isExpanded ? null : row.promoterId)}>
                              {isExpanded ? '▼' : '▶'}
                            </button>
                            {row.name}
                          </td>
                          <td className="sp-td-grade">
                            <span className={`sp-grade-badge ${gradeCls(row.effectiveGrade)} ${overridden ? 'overridden' : ''}`}>
                              {row.effectiveGrade}
                            </span>
                            {overridden && (
                              <span className="sp-auto-grade" title="Auto grade">{row.autoGrade}</span>
                            )}
                          </td>
                          <td className="sp-td-override">
                            <button
                              className={`sp-override-btn ${overridden ? 'set' : ''}`}
                              onClick={() => cycleOverride(row)}
                              title="Click to set manual grade override (cycles A→B→C→D→clear)"
                            >
                              {overridden ? `${overrideMap.get(row.promoterId)} ✕` : '+'}
                            </button>
                          </td>
                          <td className="sp-td-num">{noData ? '—' : `${fmtAed(row.totalSales)}`}</td>
                          <td className="sp-td-num">{noData ? '—' : `${fmtAed(row.dailyAvg)}`}</td>
                          <td className="sp-td-num">
                            {noData ? '—' : (
                              <span className={`sp-pi ${row.pi >= 1.15 ? 'pi-high' : row.pi >= 0.75 ? 'pi-mid' : 'pi-low'}`}>
                                {row.pi.toFixed(2)}
                              </span>
                            )}
                          </td>
                          <td className="sp-td-num">{noData ? '—' : row.orderCount}</td>
                          <td className="sp-td-num">{row.shiftDays}</td>
                          <td className="sp-td-stores">
                            {row.storePerfs.slice(0, 3).map(sp => {
                              const allowed = GRADE_ALLOWED_TIERS[row.effectiveGrade];
                              const fit = !sp.tier || allowed.includes(sp.tier);
                              return (
                                <span
                                  key={sp.storeCode}
                                  className={`sp-store-chip ${fit ? 'fit-ok' : 'fit-bad'}`}
                                  title={`${sp.storeName}${sp.tier ? ` (Tier ${sp.tier})` : ''} · ${currencyLabel} ${fmtAed(sp.sales)} · PI ${sp.pi.toFixed(2)}`}
                                >
                                  {sp.storeCode}
                                  {sp.tier && <sup>{sp.tier}</sup>}
                                  {!fit && ' ⚠'}
                                </span>
                              );
                            })}
                            {row.storePerfs.length > 3 && (
                              <span className="sp-store-more">+{row.storePerfs.length - 3}</span>
                            )}
                          </td>
                        </tr>

                        {/* ── Expanded Detail Row ── */}
                        {isExpanded && (
                          <tr key={`${row.promoterId}-expand`} className="sp-expand-row">
                            <td colSpan={10}>
                              <div className="sp-expand-content">
                                {/* Store breakdown */}
                                <div className="sp-expand-section">
                                  <h4 className="sp-expand-title">Store Breakdown</h4>
                                  <table className="sp-sub-table">
                                    <thead>
                                      <tr>
                                        <th>Store</th>
                                        <th>Tier</th>
                                        <th>Sales ({currencyLabel})</th>
                                        <th>Daily Avg</th>
                                        <th>Orders</th>
                                        <th>Days</th>
                                        <th>Perf. Index</th>
                                        <th>Fit</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.storePerfs.map(sp => {
                                        const allowed = GRADE_ALLOWED_TIERS[row.effectiveGrade];
                                        const fit = !sp.tier || allowed.includes(sp.tier);
                                        return (
                                          <tr key={sp.storeCode} className={fit ? '' : 'sp-sub-misfit'}>
                                            <td>{sp.storeName} <span className="sp-sub-code">({sp.storeCode})</span></td>
                                            <td>
                                              {sp.tier
                                                ? <span className={`sp-tier-badge ${tierCls(sp.tier)}`}>{sp.tier}</span>
                                                : <span className="sp-muted">—</span>}
                                            </td>
                                            <td>{fmtAed(sp.sales)}</td>
                                            <td>{fmtAed(sp.dailyAvg)}</td>
                                            <td>{sp.orders}</td>
                                            <td>{sp.days}</td>
                                            <td>
                                              <span className={`sp-pi ${sp.pi >= 1.15 ? 'pi-high' : sp.pi >= 0.75 ? 'pi-mid' : 'pi-low'}`}>
                                                {sp.pi.toFixed(2)}
                                              </span>
                                            </td>
                                            <td>{fit ? <span className="sp-fit-ok">✓</span> : <span className="sp-fit-bad">✗ Grade {row.effectiveGrade} → Tier {sp.tier}</span>}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                {/* DOW breakdown */}
                                <div className="sp-expand-section">
                                  <h4 className="sp-expand-title">Sales by Day of Week</h4>
                                  <div className="sp-dow-chart">
                                    {DAYS.map((d, i) => {
                                      const val = row.dowSales[i];
                                      const max = Math.max(...row.dowSales, 1);
                                      const pct = (val / max) * 100;
                                      return (
                                        <div key={d} className="sp-dow-col">
                                          <div className="sp-dow-bar-wrap">
                                            <div
                                              className={`sp-dow-bar ${i === 0 || i === 6 ? 'weekend' : ''}`}
                                              style={{ height: `${Math.max(pct, 2)}%` }}
                                            />
                                          </div>
                                          <span className="sp-dow-label">{d}</span>
                                          <span className="sp-dow-val">{val > 0 ? fmtAed(val) : '—'}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {promoterRows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="sp-empty-cell">No promoter data for this period</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        /* ── FIT MAP VIEW ── */
        <FitMapView
          promoterRows={promoterRows}
          stores={stores}
          tierMap={tierMap}
          shifts={shifts}
          period={period}
          country={country}
        />
      )}
    </div>
  );
};

// ─── Fit Map sub-component ─────────────────────────────────────────────────────
interface FitMapProps {
  promoterRows: PromoterRow[];
  stores: Store[];
  tierMap: Map<string, StoreTier>;
  shifts: Shift[];
  period: Period;
  country: Country;
}

const FitMapView = ({ promoterRows, stores, tierMap, shifts, period, country }: FitMapProps) => {
  const currencyLabel = { UAE: 'AED', QA: 'QAR', TH: 'THB' }[country];
  // Which stores each promoter has been at (from orders data this period)
  // storePerfs already contains this

  // Determine columns: active stores sorted by tier (A→D→unset), then code
  const sortedStores = useMemo(() => {
    const tierOrder = (t: StoreTier | null) => t ? TIERS.indexOf(t) : 99;
    return [...stores].sort((a, b) => {
      const td = tierOrder(tierMap.get(a.code) ?? null) - tierOrder(tierMap.get(b.code) ?? null);
      return td !== 0 ? td : a.code.localeCompare(b.code);
    });
  }, [stores, tierMap]);

  // Determine rows: promoters sorted by effective grade (A→D), then name
  const sortedPromoters = useMemo(() => {
    return [...promoterRows].sort((a, b) => {
      const gd = GRADES.indexOf(a.effectiveGrade) - GRADES.indexOf(b.effectiveGrade);
      return gd !== 0 ? gd : a.name.localeCompare(b.name);
    });
  }, [promoterRows]);

  // Build lookup: promoterId → storeCode → PromoterStorePerf
  const perfLookup = useMemo(() => {
    const m = new Map<string, Map<string, PromoterStorePerf>>();
    promoterRows.forEach(row => {
      const sm = new Map<string, PromoterStorePerf>();
      row.storePerfs.forEach(sp => sm.set(sp.storeCode, sp));
      m.set(row.promoterId, sm);
    });
    return m;
  }, [promoterRows]);

  // Build lookup: promoterId → Set<storeCode> from shifts in period
  const shiftStoreLookup = useMemo(() => {
    const months = periodToMonths(period);
    const [fromDate] = getDateRange(months);
    const m = new Map<string, Set<string>>();
    shifts.forEach(s => {
      if (s.date < fromDate) return;
      if (SPECIAL_SHIFTS.has(s.type)) return;
      if (!m.has(s.promoterId)) m.set(s.promoterId, new Set());
      m.get(s.promoterId)!.add(s.type);
    });
    return m;
  }, [shifts, period]);

  if (sortedPromoters.length === 0) {
    return <div className="sp-fitmap-empty">No data to display. Select a period with orders data.</div>;
  }

  return (
    <div className="sp-fitmap">
      <div className="sp-fitmap-legend">
        <div className="sp-fitmap-legend-items">
          <span className="sp-fitmap-legend-item fm-has-sales fm-fit">✓ Sold here · Grade fits</span>
          <span className="sp-fitmap-legend-item fm-has-sales fm-misfit">⚠ Sold here · Grade mismatch</span>
          <span className="sp-fitmap-legend-item fm-shift-only">Assigned (no sales)</span>
          <span className="sp-fitmap-legend-item fm-empty">Not assigned</span>
        </div>
        <p className="sp-fitmap-note">Cell = daily avg {currencyLabel}. Intensity = performance vs store avg.</p>
      </div>

      <div className="sp-fitmap-scroll">
        <table className="sp-fitmap-table">
          <thead>
            <tr>
              <th className="fm-th-name">Promoter</th>
              <th className="fm-th-grade">Grade</th>
              {sortedStores.map(store => {
                const tier = tierMap.get(store.code) ?? null;
                return (
                  <th key={store.code} className="fm-th-store">
                    <div className="fm-store-header">
                      <span className="fm-store-code">{store.code}</span>
                      {tier && <span className={`fm-store-tier ${tierCls(tier)}`}>{tier}</span>}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* Grade group headers */}
            {GRADES.map(grade => {
              const gradeRows = sortedPromoters.filter(r => r.effectiveGrade === grade);
              if (gradeRows.length === 0) return null;
              return (
                <>
                  <tr key={`grade-header-${grade}`} className="fm-grade-header">
                    <td colSpan={sortedStores.length + 2} className={`fm-grade-label ${gradeCls(grade)}`}>
                      Grade {grade}  ·  allowed tiers: {GRADE_ALLOWED_TIERS[grade].join(', ')}  ·  {gradeRows.length} promoter{gradeRows.length !== 1 ? 's' : ''}
                    </td>
                  </tr>
                  {gradeRows.map(row => (
                    <tr key={row.promoterId} className="fm-promoter-row">
                      <td className="fm-td-name">{row.name}</td>
                      <td className="fm-td-grade">
                        <span className={`sp-grade-badge ${gradeCls(row.effectiveGrade)}`}>{row.effectiveGrade}</span>
                      </td>
                      {sortedStores.map(store => {
                        const perf = perfLookup.get(row.promoterId)?.get(store.code);
                        const inShift = shiftStoreLookup.get(row.promoterId)?.has(store.code) ?? false;
                        const storeTier = tierMap.get(store.code) ?? null;
                        const allowed = GRADE_ALLOWED_TIERS[row.effectiveGrade];
                        const tierFit = !storeTier || allowed.includes(storeTier);

                        if (perf && perf.days > 0) {
                          // has sales data
                          const intensity = Math.min(perf.pi, 2) / 2; // 0..1
                          return (
                            <td
                              key={store.code}
                              className={`fm-cell fm-has-sales ${tierFit ? 'fm-fit' : 'fm-misfit'}`}
                              style={{ '--intensity': intensity } as React.CSSProperties}
                              title={`${row.name} @ ${store.name}\nTier: ${storeTier ?? '—'}  Grade: ${row.effectiveGrade}\nSales: ${currencyLabel} ${fmtAed(perf.sales)}  Daily avg: ${currencyLabel} ${fmtAed(perf.dailyAvg)}\nPI: ${perf.pi.toFixed(2)}  Days: ${perf.days}\n${tierFit ? '✓ Grade-Tier OK' : `⚠ Mismatch: Grade ${row.effectiveGrade} not allowed in Tier ${storeTier}`}`}
                            >
                              <span className="fm-cell-val">{fmtAed(perf.dailyAvg)}</span>
                              {!tierFit && <span className="fm-misfit-icon">⚠</span>}
                            </td>
                          );
                        } else if (inShift) {
                          return (
                            <td
                              key={store.code}
                              className="fm-cell fm-shift-only"
                              title={`${row.name} assigned to ${store.name} (no orders recorded)`}
                            >
                              <span className="fm-cell-val">·</span>
                            </td>
                          );
                        } else {
                          return <td key={store.code} className="fm-cell fm-empty" />;
                        }
                      })}
                    </tr>
                  ))}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SalesPerformancePage;
