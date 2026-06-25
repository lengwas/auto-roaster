// ============================================================
// Commission reconciliation sourced from the admin `orders` table.
// Each order row is an item sold (has serial_number + salesperson). We confirm
// it against the vendor monthly report (vendor = source of truth on quantity)
// per store × date × sku, then compute commission per the promoter's rate.
// ============================================================
import type { Order, Promoter, Store, Country } from '../types/types';

// orders.warehouse (e.g. "VIR - DBM") → our store.code. (mirrors SalesPerformancePage)
const WAREHOUSE_CODE_MAP_UAE: Record<string, string> = {
  'vir - dbm': 'VDM', 'vir - moe': 'VME', 'vir - dbh': 'VDH',
  'vir - mrn': 'VMN', 'vir - mdf': 'VMF', 'vir - nkm': 'VNK',
  'vir - yas': 'VYM', 'vir - amy': 'VAY', 'vir - rem': 'VRM',
  'vir - adm': 'VAD', 'vir - arb': 'VAY', 'vir - azc': 'VNK',
  'jsm - moe': 'JME', 'jsm - dbm': 'JDM', 'jsm - dbh': 'JDH',
  'bdr - dbm': 'BDM', 'bdr - dbh': 'JDH',
  'hls - dbm': 'HDM', 'sdg - dbm': 'SDM',
  'air - 48': 'AIR', 'air - dcc': 'ADC', 'img - wld': 'IMG',
};
const WAREHOUSE_CODE_MAP_QA: Record<string, string> = {
  'vir - vlm': 'VLM', 'vir - vmq': 'VMQ', 'vir - vdf': 'VDF',
  'vir - vvg': 'VVG', 'vir - vvd': 'VVD',
  'kdz - kvd': 'KVD', 'kdz - klm': 'KLM', 'kdz - moq': 'KMQ', 'kdz - dfc': 'VDF',
  'ron - rkt': 'RKT', 'fnc - dfc': 'VDF', 'fnc - vvd': 'VVD',
};
const WAREHOUSE_CODE_MAP: Record<Country, Record<string, string>> = {
  UAE: WAREHOUSE_CODE_MAP_UAE, QA: WAREHOUSE_CODE_MAP_QA, TH: {},
};

export type OrderVerifyStatus =
  | 'verified'        // confirmed against a vendor sale
  | 'no_vendor'       // no matching vendor sale qty (over-reported / unconfirmed)
  | 'no_store'        // warehouse couldn't be mapped to a store
  | 'no_promoter'     // salesperson couldn't be matched to a promoter
  | 'returned'        // clawed back by a vendor return (within lookback window)
  | 'excluded';       // cancelled / returned order — not paid

export interface OrderFlags {
  serialRepeat?: boolean;     // this serial appears on >1 order (returned & resold)
  serialUnverified?: boolean; // serial not found in serial_registry
  returnNote?: string;        // explanation when status === 'returned'
}

export interface CommissionBonus {
  name: string | null;
  skuPattern: string | null;
  vendor: string | null;        // 'virgin'|'jashanmal'|... ; null = all
  validFrom: string | null;     // YYYY-MM-DD
  validTo: string | null;
  bonusType: 'fixed' | 'percentage';
  bonusValue: number;
}

export interface OrderCommissionRow {
  id: string;
  date: string;
  orderId?: string;
  storeCode: string | null;
  storeName: string | null;
  sku: string | null;
  serialNumber: string | null;
  salesperson: string | null;
  promoterId: string | null;
  amount: number;
  commissionRate: number | null; // base percent
  baseCommission: number;        // amount × rate%
  bonus: number;                 // additive bonus (AED)
  bonusNote: string;             // which bonus(es) applied
  commission: number;            // base + bonus (negative when status === 'returned')
  status: OrderVerifyStatus;
  flags: OrderFlags;
}

// Vendor inferred from store-code prefix (for bonus.vendor matching)
const VENDOR_BY_PREFIX: Record<string, string> = { V: 'virgin', J: 'jashanmal', H: 'hamleys', B: 'borders', S: 'sharaf' };
const vendorOfStore = (storeCode: string | null) =>
  (storeCode && VENDOR_BY_PREFIX[storeCode[0].toUpperCase()]) || null;

/** Match a bonus's sku_pattern against an order SKU/product (case-insensitive; % = wildcard, else substring). */
function skuMatches(pattern: string | null, sku: string | null): boolean {
  if (!pattern) return true;          // no pattern = applies to all SKUs
  if (!sku) return false;
  const p = pattern.toUpperCase().trim();
  const s = sku.toUpperCase();
  if (p.includes('%')) {
    const re = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$');
    return re.test(s);
  }
  return s.includes(p);
}

/** Sum the additive bonuses that apply to a verified order line (qty = 1). */
function bonusFor(
  sku: string | null, storeCode: string | null, date: string, amount: number, bonuses: CommissionBonus[],
): { bonus: number; note: string } {
  let bonus = 0;
  const notes: string[] = [];
  const vendor = vendorOfStore(storeCode);
  for (const b of bonuses) {
    if (b.validFrom && date < b.validFrom) continue;
    if (b.validTo && date > b.validTo) continue;
    if (b.vendor && b.vendor.toLowerCase() !== (vendor || '')) continue;
    if (!skuMatches(b.skuPattern, sku)) continue;
    const add = b.bonusType === 'fixed' ? b.bonusValue : amount * (b.bonusValue / 100);
    bonus += add;
    notes.push(`${b.name || b.skuPattern || 'bonus'} +${add}`);
  }
  return { bonus, note: notes.join('; ') };
}

// Vendor return lookback window (days) by store-code prefix → vendor.
// Matches the vendor_return_windows table (virgin 30, jashanmal 14, ...).
const RETURN_WINDOW_DAYS: Record<string, number> = { V: 30, J: 14, H: 30, B: 30, S: 30 };
const windowForStore = (storeCode: string | null) =>
  (storeCode && RETURN_WINDOW_DAYS[storeCode[0].toUpperCase()]) || 30;

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

export interface PromoterCommission {
  promoterId: string | null;
  promoterName: string;
  verifiedOrders: number;
  sales: number;
  commission: number;
}

function buildStoreByWarehouse(stores: Store[], country: Country): Map<string, Store> {
  const codeMap = new Map(stores.map(s => [s.code, s]));
  const m = new Map<string, Store>();
  Object.entries(WAREHOUSE_CODE_MAP[country]).forEach(([wh, code]) => {
    const s = codeMap.get(code); if (s) m.set(wh, s);
  });
  stores.forEach(s => {
    if (s.warehouse) m.set(s.warehouse.toLowerCase().trim(), s);
    if (s.platform) m.set(s.platform.toLowerCase().trim(), s);
    m.set(s.code.toLowerCase(), s);
  });
  return m;
}

const EXCLUDED_STATUS = new Set(['cancelled', 'canceled', 'returned', 'void', 'refund', 'cn']);

export interface VendorNet { saleDate: string; storeCode: string | null; sku: string | null; quantity: number; isReturn: boolean; }

const cellKey = (store: string | null, date: string, sku: string | null) =>
  `${store ?? ''}|${date}|${(sku ?? '').toUpperCase()}`;

// Normalize an order's product name to the vendor SKU format ("Airwheel-SE3S - Black" → "SE3S_BK").
// MUST mirror normalizeSku in scripts/import-vendor-report.mjs / api/lib/vendor-parse.ts so both
// sides of the (store,date,sku) match key agree. Vendor lines are already normalized.
const SKU_COLOUR: Record<string, string> = {
  BLACK: 'BK', SILVER: 'SLV', PINK: 'PK', BLUE: 'BLU',
  WHITE: 'WH', RED: 'RD', GREEN: 'GN', GREY: 'GRY', GRAY: 'GRY',
};
const SKU_MODELS = ['SE3SL', 'SE3MINIT', 'SE3S', 'SQ3S', 'SQ3', 'SR5', 'SR6', 'SE3T'];
export function normalizeProductSku(desc: string | null | undefined): string {
  if (!desc) return '';
  const up = String(desc).toUpperCase();
  let model: string | null = null;
  for (const m of SKU_MODELS) { if (up.includes(m)) { model = m; break; } }
  if (!model) return up.replace(/\s+/g, ' ').trim(); // unknown model → keep (won't match vendor)
  let colour: string | null = null;
  for (const [c, a] of Object.entries(SKU_COLOUR)) { if (up.includes(c)) { colour = a; break; } }
  return model + (colour ? '_' + colour : '');
}

interface Resolved { store: Store | undefined; storeCode: string | null; promoter: Promoter | undefined; amount: number; rate: number | null; }

/**
 * Reconcile admin `orders` against vendor report data for a month.
 * - Sales: orders dated in `month` are confirmed against vendor sale quantity per store/date/sku.
 * - Serial: flags duplicate serials (resold units) and serials missing from serial_registry.
 * - Returns: each vendor return unit in `month` (no serial) claws back the most recent prior
 *   sale in the same store within the vendor lookback window (virgin 30d / jashanmal 14d).
 *
 * `allOrders` should span enough history to cover the return lookback window.
 */
export function reconcileOrders(
  allOrders: Order[],
  vendorLines: VendorNet[],
  stores: Store[],
  promoters: Promoter[],
  country: Country,
  month: string,
  registrySerials: Set<string>,
  bonuses: CommissionBonus[] = [],
): { rows: OrderCommissionRow[]; byPromoter: PromoterCommission[] } {
  const storeByWarehouse = buildStoreByWarehouse(stores, country);
  const promoterByName = new Map(promoters.map(p => [p.name.toLowerCase().trim(), p]));

  // Count each serial across all orders → repeats = returned & resold
  const serialCount = new Map<string, number>();
  for (const o of allOrders) {
    const s = (o.serialNumber || '').trim().toUpperCase();
    if (s) serialCount.set(s, (serialCount.get(s) ?? 0) + 1);
  }

  const resolve = (o: Order): Resolved => {
    const store = o.warehouse ? storeByWarehouse.get(o.warehouse.toLowerCase().trim()) : undefined;
    const promoter = o.salesperson ? promoterByName.get(o.salesperson.toLowerCase().trim()) : undefined;
    return { store, storeCode: store?.code ?? null, promoter, amount: o.amountAed ?? 0, rate: promoter ? (promoter.commissionRate ?? 0.5) : null };
  };

  const flagsFor = (o: Order): OrderFlags => {
    const s = (o.serialNumber || '').trim().toUpperCase();
    const f: OrderFlags = {};
    if (s && (serialCount.get(s) ?? 0) > 1) f.serialRepeat = true;
    if (s && registrySerials.size > 0 && !registrySerials.has(s)) f.serialUnverified = true;
    return f;
  };

  // Vendor sale-quantity pool (per store/date/sku), sales only
  const salePool = new Map<string, number>();
  for (const v of vendorLines) {
    if (v.isReturn || !v.storeCode) continue;
    const k = cellKey(v.storeCode, v.saleDate, v.sku);
    salePool.set(k, (salePool.get(k) ?? 0) + v.quantity);
  }

  // ── 1. Reconcile this month's sale orders against vendor sale qty ──
  const monthOrders = allOrders
    .filter(o => o.date.startsWith(month) && !EXCLUDED_STATUS.has(o.status.toLowerCase()))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const rows: OrderCommissionRow[] = [];
  for (const o of monthOrders) {
    const r = resolve(o);
    let status: OrderVerifyStatus;
    if (!r.storeCode) status = 'no_store';
    else {
      const k = cellKey(r.storeCode, o.date, normalizeProductSku(o.sku));
      const remaining = salePool.get(k) ?? 0;
      if (remaining >= 1) { salePool.set(k, remaining - 1); status = r.promoter ? 'verified' : 'no_promoter'; }
      else status = 'no_vendor';
    }
    const base = status === 'verified' && r.rate != null ? r.amount * (r.rate / 100) : 0;
    const { bonus, note: bonusNote } = status === 'verified'
      ? bonusFor(o.sku ?? null, r.storeCode, o.date, r.amount, bonuses)
      : { bonus: 0, note: '' };
    rows.push({
      id: o.id, date: o.date, orderId: o.orderId,
      storeCode: r.storeCode, storeName: r.store?.name ?? null,
      sku: o.sku ?? null, serialNumber: o.serialNumber ?? null,
      salesperson: o.salesperson ?? null, promoterId: r.promoter?.id ?? null,
      amount: r.amount, commissionRate: r.rate,
      baseCommission: base, bonus, bonusNote, commission: base + bonus,
      status, flags: flagsFor(o),
    });
  }

  // ── 2. Cross-month return clawback (vendor returns carry no serial) ──
  const clawedIds = new Set<string>();
  const soldByStore = new Map<string, { o: Order; r: Resolved }[]>();
  for (const o of allOrders) {
    if (EXCLUDED_STATUS.has(o.status.toLowerCase())) continue;
    const r = resolve(o);
    if (!r.storeCode) continue;
    (soldByStore.get(r.storeCode) ?? soldByStore.set(r.storeCode, []).get(r.storeCode)!).push({ o, r });
  }
  for (const arr of soldByStore.values()) arr.sort((a, b) => b.o.date.localeCompare(a.o.date)); // most recent first

  for (const v of vendorLines) {
    if (!v.isReturn || !v.storeCode) continue;
    const win = windowForStore(v.storeCode);
    let toClaw = Math.round(v.quantity);
    for (const { o, r } of soldByStore.get(v.storeCode) ?? []) {
      if (toClaw <= 0) break;
      if (clawedIds.has(o.id)) continue;
      const age = daysBetween(o.date, v.saleDate);
      if (age < 0 || age > win) continue; // outside the lookback window
      clawedIds.add(o.id);
      toClaw -= 1;
      const base = r.rate != null ? r.amount * (r.rate / 100) : 0;
      rows.push({
        id: `${o.id}__ret_${v.saleDate}`, date: v.saleDate, orderId: o.orderId,
        storeCode: r.storeCode, storeName: r.store?.name ?? null,
        sku: o.sku ?? null, serialNumber: o.serialNumber ?? null,
        salesperson: o.salesperson ?? null, promoterId: r.promoter?.id ?? null,
        amount: r.amount, commissionRate: r.rate,
        baseCommission: -base, bonus: 0, bonusNote: '', commission: -base, status: 'returned',
        flags: { returnNote: `Return ${v.saleDate}; sold ${o.date} (≤${win}d)` },
      });
    }
  }

  // ── 3. Per-promoter summary (verified sales + returned clawbacks) ──
  const byP = new Map<string, PromoterCommission>();
  for (const r of rows) {
    if (!r.promoterId || (r.status !== 'verified' && r.status !== 'returned')) continue;
    const e = byP.get(r.promoterId) ?? { promoterId: r.promoterId, promoterName: r.salesperson ?? '', verifiedOrders: 0, sales: 0, commission: 0 };
    if (r.status === 'verified') { e.verifiedOrders += 1; e.sales += r.amount; }
    e.commission += r.commission;
    byP.set(r.promoterId, e);
  }
  const byPromoter = [...byP.values()].sort((a, b) => b.commission - a.commission);

  return { rows, byPromoter };
}
