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
  | 'excluded';       // cancelled / returned order — not paid

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
  commissionRate: number | null; // percent
  commission: number;
  status: OrderVerifyStatus;
}

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

export interface VendorNet { saleDate: string; storeCode: string | null; sku: string | null; quantity: number; }

const cellKey = (store: string | null, date: string, sku: string | null) =>
  `${store ?? ''}|${date}|${(sku ?? '').toUpperCase()}`;

/**
 * Reconcile admin orders for a month against vendor net quantities.
 * `rateOf(promoterId)` returns the promoter commission rate (percent).
 */
export function reconcileOrders(
  orders: Order[],
  vendorLines: VendorNet[],
  stores: Store[],
  promoters: Promoter[],
  country: Country,
): { rows: OrderCommissionRow[]; byPromoter: PromoterCommission[] } {
  const storeByWarehouse = buildStoreByWarehouse(stores, country);
  const promoterByName = new Map(promoters.map(p => [p.name.toLowerCase().trim(), p]));

  // Net vendor quantity available per (store, date, sku)
  const vendorPool = new Map<string, number>();
  for (const v of vendorLines) {
    if (!v.storeCode) continue;
    const k = cellKey(v.storeCode, v.saleDate, v.sku);
    vendorPool.set(k, (vendorPool.get(k) ?? 0) + (v.quantity || 0));
  }

  // Deterministic order: by date asc then id (so confirmation assignment is stable)
  const sorted = [...orders].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const rows: OrderCommissionRow[] = [];
  for (const o of sorted) {
    const store = o.warehouse ? storeByWarehouse.get(o.warehouse.toLowerCase().trim()) : undefined;
    const storeCode = store?.code ?? null;
    const promoter = o.salesperson ? promoterByName.get(o.salesperson.toLowerCase().trim()) : undefined;
    const amount = o.amountAed ?? 0;
    const rate = promoter ? (promoter.commissionRate ?? 0.5) : null;

    let status: OrderVerifyStatus;
    if (EXCLUDED_STATUS.has(o.status.toLowerCase())) status = 'excluded';
    else if (!storeCode) status = 'no_store';
    else {
      // consume one unit of vendor-confirmed qty for this cell
      const k = cellKey(storeCode, o.date, o.sku ?? null);
      const remaining = vendorPool.get(k) ?? 0;
      if (remaining >= 1) { vendorPool.set(k, remaining - 1); status = promoter ? 'verified' : 'no_promoter'; }
      else status = 'no_vendor';
    }

    const commission = status === 'verified' && rate != null ? amount * (rate / 100) : 0;
    rows.push({
      id: o.id, date: o.date, orderId: o.orderId,
      storeCode, storeName: store?.name ?? null,
      sku: o.sku ?? null, serialNumber: o.serialNumber ?? null,
      salesperson: o.salesperson ?? null, promoterId: promoter?.id ?? null,
      amount, commissionRate: rate, commission, status,
    });
  }

  // Per-promoter summary (verified only)
  const byP = new Map<string, PromoterCommission>();
  for (const r of rows) {
    if (r.status !== 'verified' || !r.promoterId) continue;
    const e = byP.get(r.promoterId) ?? { promoterId: r.promoterId, promoterName: r.salesperson ?? '', verifiedOrders: 0, sales: 0, commission: 0 };
    e.verifiedOrders += 1; e.sales += r.amount; e.commission += r.commission;
    byP.set(r.promoterId, e);
  }
  const byPromoter = [...byP.values()].sort((a, b) => b.commission - a.commission);

  return { rows, byPromoter };
}
