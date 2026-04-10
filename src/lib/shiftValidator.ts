/**
 * Validates a set of shift assignments and returns alerts per (promoter, date).
 *
 * Errors (red):
 *   - banned       : store is in promoter's banned list
 *   - no-access    : store has explicit access list and promoter is not in it
 *   - day-off      : promoter is assigned on a regular day off (workingDays)
 *   - conflict     : two conflicting promoters assigned to the same store on the same day
 *
 * Warnings (yellow):
 *   - low-perf     : promoter has historically poor revenue at this store
 *   - late-early   : late shift (end ≥ 22:30) followed by an early shift next day (start ≤ 11:00)
 */

import type {
  Shift, Promoter, Store, StorePreference, PromoterConflict,
} from '../types/types';

export type AlertSeverity = 'error' | 'warning';
export type AlertType =
  | 'banned'
  | 'no-access'
  | 'day-off'
  | 'conflict'
  | 'low-perf'
  | 'late-early';

export interface ShiftAlert {
  type: AlertType;
  severity: AlertSeverity;
  message: string;
}

export type AlertMap = Map<string, ShiftAlert[]>;  // key: `${promoterId}_${date}`

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SPECIAL = new Set(['Off', 'LOP', 'SL', 'AL', '-', '']);

function dayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return DAY_NAMES[d.getDay()];
}

function parseHHMM(t?: string): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function isNextDay(a: string, b: string): boolean {
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.round((db - da) / 86_400_000) === 1;
}

export function validateShifts(
  shifts: Shift[],
  promoters: Promoter[],
  _stores: Store[],
  storePreferences: StorePreference[],
  conflicts: PromoterConflict[],
  perfMatrix?: Map<string, number>,
): AlertMap {
  const alerts: AlertMap = new Map();
  const add = (key: string, a: ShiftAlert) => {
    const list = alerts.get(key);
    if (list) list.push(a);
    else alerts.set(key, [a]);
  };

  const promoterById = new Map(promoters.map(p => [p.id, p]));

  // Build preference maps
  const mustMap = new Map<string, Set<string>>();       // promoterId → must
  const preferredMap = new Map<string, Set<string>>();  // promoterId → preferred
  const bannedMap = new Map<string, Set<string>>();     // promoterId → banned
  const storeAccessList = new Map<string, Set<string>>(); // storeCode → promoterIds with must

  for (const pref of storePreferences) {
    const target =
      pref.preference === 'must' ? mustMap :
      pref.preference === 'preferred' ? preferredMap :
      pref.preference === 'banned' ? bannedMap : null;
    if (!target) continue;
    if (!target.has(pref.promoterId)) target.set(pref.promoterId, new Set());
    target.get(pref.promoterId)!.add(pref.storeCode);

    if (pref.preference === 'must') {
      if (!storeAccessList.has(pref.storeCode)) storeAccessList.set(pref.storeCode, new Set());
      storeAccessList.get(pref.storeCode)!.add(pref.promoterId);
    }
  }

  // Performance threshold for low-perf warning
  let globalMean = 0;
  if (perfMatrix && perfMatrix.size > 0) {
    let sum = 0;
    for (const v of perfMatrix.values()) sum += v;
    globalMean = sum / perfMatrix.size;
  }
  const lowPerfThreshold = globalMean * 0.4;

  // Group for cross-shift checks
  const shiftsByDateStore = new Map<string, Shift[]>();   // `${date}_${store}` → shifts
  const shiftsByPromoter = new Map<string, Shift[]>();    // promoterId → shifts (sorted later)

  for (const s of shifts) {
    if (!s.type || SPECIAL.has(s.type)) continue;
    const dsKey = `${s.date}_${s.type}`;
    if (!shiftsByDateStore.has(dsKey)) shiftsByDateStore.set(dsKey, []);
    shiftsByDateStore.get(dsKey)!.push(s);

    if (!shiftsByPromoter.has(s.promoterId)) shiftsByPromoter.set(s.promoterId, []);
    shiftsByPromoter.get(s.promoterId)!.push(s);
  }

  // ── Per-shift checks ────────────────────────────────────────────────────
  for (const s of shifts) {
    if (!s.type || SPECIAL.has(s.type)) continue;
    const promoter = promoterById.get(s.promoterId);
    if (!promoter) continue;
    const key = `${s.promoterId}_${s.date}`;

    // Day off
    const daysOff = new Set(promoter.workingDays.split(',').map(d => d.trim()).filter(Boolean));
    if (daysOff.has(dayOf(s.date))) {
      add(key, { type: 'day-off', severity: 'error', message: `วันหยุดประจำ (${dayOf(s.date)})` });
    }

    // Banned
    if (bannedMap.get(s.promoterId)?.has(s.type)) {
      add(key, { type: 'banned', severity: 'error', message: `ถูกแบนจาก ${s.type}` });
    }

    // No-access (restricted store, not in must/preferred)
    const accessList = storeAccessList.get(s.type);
    if (accessList && accessList.size > 0) {
      const must = mustMap.get(s.promoterId);
      const pref = preferredMap.get(s.promoterId);
      if (!must?.has(s.type) && !pref?.has(s.type)) {
        add(key, { type: 'no-access', severity: 'error', message: `ไม่มีสิทธิ์เข้า ${s.type} (no card)` });
      }
    }

    // Low perf
    if (perfMatrix && globalMean > 0) {
      const score = perfMatrix.get(`${s.promoterId}_${s.type}`);
      if (score !== undefined && score > 0 && score < lowPerfThreshold) {
        add(key, { type: 'low-perf', severity: 'warning', message: `ขายไม่ค่อยได้ที่ ${s.type} (avg ${Math.round(score)})` });
      }
    }
  }

  // ── Conflict pairs ──────────────────────────────────────────────────────
  for (const c of conflicts) {
    for (const list of shiftsByDateStore.values()) {
      const a = list.find(s => s.promoterId === c.promoterAId);
      const b = list.find(s => s.promoterId === c.promoterBId);
      if (a && b) {
        const pA = promoterById.get(a.promoterId);
        const pB = promoterById.get(b.promoterId);
        const reason = c.reason ? ` (${c.reason})` : '';
        add(`${a.promoterId}_${a.date}`, {
          type: 'conflict',
          severity: 'error',
          message: `Conflict กับ ${pB?.name ?? '?'}${reason}`,
        });
        add(`${b.promoterId}_${b.date}`, {
          type: 'conflict',
          severity: 'error',
          message: `Conflict กับ ${pA?.name ?? '?'}${reason}`,
        });
      }
    }
  }

  // ── Late → Early per promoter ────────────────────────────────────────────
  for (const list of shiftsByPromoter.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < list.length - 1; i++) {
      const cur = list[i];
      const nxt = list[i + 1];
      if (!isNextDay(cur.date, nxt.date)) continue;
      const endStr = cur.timeRange?.split('-')[1];
      const startStr = nxt.timeRange?.split('-')[0];
      const end = parseHHMM(endStr);
      const start = parseHHMM(startStr);
      if (end == null || start == null) continue;
      if (end >= 22 * 60 + 30 && start <= 11 * 60) {
        add(`${nxt.promoterId}_${nxt.date}`, {
          type: 'late-early',
          severity: 'warning',
          message: `กะดึก ${endStr} → กะเช้า ${startStr}`,
        });
      }
    }
  }

  return alerts;
}

export function alertSeverity(list: ShiftAlert[] | undefined): AlertSeverity | null {
  if (!list || list.length === 0) return null;
  return list.some(a => a.severity === 'error') ? 'error' : 'warning';
}
