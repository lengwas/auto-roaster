/**
 * Shared helpers for slicing & summarizing Order data.
 * Used by the Dashboard page, and by AutoAssignPage via the re-exported
 * warehouse → store-code maps.
 */

import type { Order, Country } from '../types/types';

// ── Warehouse text → store code (hoisted from AutoAssignPage) ───────────────

export const WAREHOUSE_CODE_MAP_UAE: Record<string, string> = {
  'vir - dbm': 'VDM', 'vir - moe': 'VME', 'vir - dbh': 'VDH',
  'vir - mrn': 'VMN', 'vir - mdf': 'VMF', 'vir - nkm': 'VNK',
  'vir - yas': 'VYM', 'vir - amy': 'VAY', 'vir - rem': 'VRM',
  'vir - adm': 'VAD', 'vir - arb': 'VAY', 'vir - azc': 'VNK',
  'jsm - moe': 'JME', 'jsm - dbm': 'JDM', 'jsm - dbh': 'JDH',
  'bdr - dbm': 'BDM', 'bdr - dbh': 'JDH',
  'hls - dbm': 'HDM', 'sdg - dbm': 'SDM',
  'air - 48': 'AIR', 'air - dcc': 'ADC', 'img - wld': 'IMG',
};

export const WAREHOUSE_CODE_MAP_QA: Record<string, string> = {
  'vir - vlm': 'VLM', 'vir - vmq': 'VMQ', 'vir - vdf': 'VDF',
  'vir - vvg': 'VVG', 'vir - vvd': 'VVD',
  'kdz - kvd': 'KVD', 'kdz - klm': 'KLM', 'kdz - moq': 'KMQ',
  'kdz - dfc': 'VDF', 'ron - rkt': 'RKT',
  'fnc - dfc': 'VDF', 'fnc - vvd': 'VVD',
};

export function getWarehouseMap(country: Country): Record<string, string> {
  return country === 'QA' ? WAREHOUSE_CODE_MAP_QA : WAREHOUSE_CODE_MAP_UAE;
}

/** Resolve an order's store code from its warehouse text. */
export function getStoreCodeFromOrder(
  order: Order,
  warehouseMap: Record<string, string>,
): string | null {
  if (!order.warehouse) return null;
  const key = order.warehouse.trim().toLowerCase();
  return warehouseMap[key] ?? null;
}

// ── Product name parser: vendor + model ─────────────────────────────────────

/**
 * Parse a product name like "Airwheel-SE3S-Black" into
 *   { vendor: "Airwheel", model: "SE3S" }.
 *
 * Falls back to "Unknown" when the name is missing or too short.
 * Separators accepted: `-`, `_`, `/`, whitespace.
 */
export function parseVendorModel(name?: string | null): { vendor: string; model: string } {
  if (!name) return { vendor: 'Unknown', model: 'Unknown' };
  const parts = name.trim().split(/[-_/\s]+/).filter(Boolean);
  const vendor = parts[0] ?? 'Unknown';
  const model = parts[1] ?? 'Unknown';
  return { vendor, model };
}

// ── Mall derivation ─────────────────────────────────────────────────────────

/** Last 2 chars of a store code (uppercase). Matches the same-mall heuristic
 *  in AttendancePage / shiftValidator. */
export function getMallCode(storeCode: string): string {
  if (!storeCode || storeCode.length < 2) return '';
  return storeCode.slice(-2).toUpperCase();
}

export const MALL_NAMES_UAE: Record<string, string> = {
  DM: 'Dubai Mall',
  ME: 'Mall of the Emirates',
  MN: 'Mirdif City Centre',
  MF: 'Dubai Marina Mall',
  NK: 'Nakheel Mall',
  YM: 'Yas Mall',
  AY: 'Al Ain',
  RM: 'Reem Mall',
  AD: 'Abu Dhabi Mall',
  DH: 'Dubai Hills',
  IR: 'Airport',
  DC: 'DCC',
};

export const MALL_NAMES_QA: Record<string, string> = {
  LM: 'Landmark Mall',
  MQ: 'Mall of Qatar',
  DF: 'Doha Festival City',
  VG: 'Villaggio',
  VD: 'Vendome',
  KT: 'Katara',
};

export function getMallName(storeCode: string, country: Country): string {
  const code = getMallCode(storeCode);
  const map = country === 'QA' ? MALL_NAMES_QA : MALL_NAMES_UAE;
  return map[code] ?? code ?? 'Unknown';
}

// ── Aggregation helpers ─────────────────────────────────────────────────────

export function groupBy<T, K extends string | number>(
  rows: T[],
  key: (t: T) => K,
): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = m.get(k);
    if (list) list.push(row);
    else m.set(k, [row]);
  }
  return m;
}

const EXCLUDED_STATUSES = new Set(['cancelled', 'returned']);

/** Sum `amount_aed` over the given orders, skipping cancelled/returned rows. */
export function sumAmount(orders: Order[]): number {
  let total = 0;
  for (const o of orders) {
    if (EXCLUDED_STATUSES.has((o.status ?? '').toLowerCase())) continue;
    if (o.amountAed != null) total += o.amountAed;
  }
  return total;
}

export function countOrders(orders: Order[]): number {
  let n = 0;
  for (const o of orders) {
    if (EXCLUDED_STATUSES.has((o.status ?? '').toLowerCase())) continue;
    n++;
  }
  return n;
}

/** Convert YYYY-MM-DD → YYYY-MM. */
export function toYearMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

// ── Branch anomaly detection ────────────────────────────────────────────────

export interface BranchAnomaly {
  storeCode: string;
  prev: number;
  curr: number;
  delta: number;    // (curr - prev) / prev
  totalDelta: number;
}

/**
 * Flag stores where current-period sales dropped ≥ 20% while the overall total
 * is roughly flat or up (within −5%). Skips tiny-baseline stores to avoid noise.
 */
export function detectBranchAnomalies(
  orders: Order[],
  curStart: string,       // YYYY-MM-DD (inclusive)
  curEnd: string,         // YYYY-MM-DD (inclusive)
  country: Country,
  opts: { storeDropThreshold?: number; totalFloor?: number } = {},
): BranchAnomaly[] {
  const storeDropThreshold = opts.storeDropThreshold ?? -0.2;
  const totalFloor = opts.totalFloor ?? -0.05;

  const curStartDate = new Date(curStart + 'T00:00:00');
  const curEndDate = new Date(curEnd + 'T00:00:00');
  const spanDays = Math.max(
    1,
    Math.round((curEndDate.getTime() - curStartDate.getTime()) / 86_400_000) + 1,
  );
  const prevEndDate = new Date(curStartDate);
  prevEndDate.setDate(prevEndDate.getDate() - 1);
  const prevStartDate = new Date(prevEndDate);
  prevStartDate.setDate(prevStartDate.getDate() - (spanDays - 1));
  const prevStart = prevStartDate.toISOString().split('T')[0];
  const prevEnd = prevEndDate.toISOString().split('T')[0];

  const warehouseMap = getWarehouseMap(country);
  const inRange = (d: string, a: string, b: string) => d >= a && d <= b;

  const curByStore = new Map<string, number>();
  const prevByStore = new Map<string, number>();
  let curTotal = 0;
  let prevTotal = 0;

  for (const o of orders) {
    if (EXCLUDED_STATUSES.has((o.status ?? '').toLowerCase())) continue;
    if (o.amountAed == null) continue;
    const sc = getStoreCodeFromOrder(o, warehouseMap);
    if (!sc) continue;
    if (inRange(o.date, curStart, curEnd)) {
      curByStore.set(sc, (curByStore.get(sc) ?? 0) + o.amountAed);
      curTotal += o.amountAed;
    } else if (inRange(o.date, prevStart, prevEnd)) {
      prevByStore.set(sc, (prevByStore.get(sc) ?? 0) + o.amountAed);
      prevTotal += o.amountAed;
    }
  }

  const totalDelta = prevTotal > 0 ? (curTotal - prevTotal) / prevTotal : 0;
  if (totalDelta < totalFloor) return [];

  const noiseFloor = Math.max(1000, prevTotal * 0.01);
  const anomalies: BranchAnomaly[] = [];
  for (const [sc, prev] of prevByStore) {
    if (prev < noiseFloor) continue;
    const curr = curByStore.get(sc) ?? 0;
    const delta = (curr - prev) / prev;
    if (delta <= storeDropThreshold) {
      anomalies.push({ storeCode: sc, prev, curr, delta, totalDelta });
    }
  }
  anomalies.sort((a, b) => a.delta - b.delta);
  return anomalies;
}

// ── Period helpers ──────────────────────────────────────────────────────────

/** Return first-day / last-day of the month-range string `YYYY-MM` → `YYYY-MM-DD`. */
export function monthToStart(ym: string): string {
  return `${ym}-01`;
}
export function monthToEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${ym}-${String(last).padStart(2, '0')}`;
}

export function nMonthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 7);
}

export function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
