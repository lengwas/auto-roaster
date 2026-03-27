/**
 * Revenue-maximizing shift optimizer using the Hungarian Algorithm.
 *
 * For each day in the target range, builds a profit matrix
 *   profit[promoter][storeSlot] = expected daily revenue (from historical orders)
 * and solves the assignment problem to maximize total expected revenue.
 *
 * Respects: must/banned preferences, conflicts, days-off, max capacity,
 * admin→AIR constraint, and extra parsed constraints.
 */

import type {
  Store, Promoter, StorePreference, PromoterConflict,
} from '../types/types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DraftAssignment {
  promoterId: string;
  date: string;
  store: string;       // store code | 'Off'
  timeRange?: string;
}

export interface ParsedConstraints {
  store_min_people?: Record<string, number>;
  promoter_day_store?: { promoter: string; day: string; store: string }[];
  promoter_force_off?: { promoter: string; day: string }[];
  promoter_end_time?: { promoter: string; end_time: string }[];
}

export interface DaySummary {
  date: string;
  expected: number;
  count: number;
}

export interface OptimizerResult {
  assignments: DraftAssignment[];
  dailySummary: DaySummary[];
  totalExpected: number;
}

interface InternalConstraints {
  storeMinPeople: Map<string, number>;
  promoterDayStore: Map<string, string>;   // `${fname}_${day}` → storeCode
  promoterForceOff: Set<string>;           // `${fname}_${day}`
  promoterEndTime: Map<string, string>;    // fname → "HH:MM"
}

// ── Day helpers ──────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayName(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return DAY_NAMES[d.getDay()];
}

function firstName(full: string): string {
  return full.trim().split(' ')[0].toLowerCase();
}

function parseDaysOff(s: string): Set<string> {
  if (!s) return new Set();
  return new Set(s.split(',').map(d => d.trim()).filter(Boolean));
}

// ── Hungarian Algorithm (Munkres) ────────────────────────────────────────────
// Finds minimum-cost assignment for an n×m cost matrix (n ≤ m).
// Returns [rowAssign, colAssign] where rowAssign[i] = column assigned to row i.

const INF = 1e15;

function hungarianMinimize(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0].length;
  if (m < n) throw new Error('Cost matrix must have cols >= rows');

  // Pad to square if needed
  const sz = Math.max(n, m);
  const c: number[][] = Array.from({ length: sz }, (_, i) =>
    Array.from({ length: sz }, (_, j) => (i < n && j < m ? cost[i][j] : 0))
  );

  // u[i], v[j]: potentials; p[j]: row matched to col j; way[j]: previous col in augmenting path
  const u = new Float64Array(sz + 1);
  const v = new Float64Array(sz + 1);
  const p = new Int32Array(sz + 1).fill(-1);
  const way = new Int32Array(sz + 1);

  for (let i = 0; i < sz; i++) {
    // Start augmenting path from row i
    const minv = new Float64Array(sz + 1).fill(INF);
    const used = new Uint8Array(sz + 1);
    p[sz] = i; // virtual col sz matched to row i
    let j0 = sz;

    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = INF;
      let j1 = -1;

      for (let j = 0; j < sz; j++) {
        if (used[j]) continue;
        const cur = c[i0][j] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      // Update potentials
      for (let j = 0; j <= sz; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== -1);

    // Update matching along augmenting path
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== sz);
  }

  // Extract result: rowAssign[i] = col assigned to row i
  const rowAssign = new Array<number>(n).fill(-1);
  for (let j = 0; j < sz; j++) {
    if (p[j] >= 0 && p[j] < n) {
      rowAssign[p[j]] = j < m ? j : -1;
    }
  }
  return rowAssign;
}

// ── Load constraints ─────────────────────────────────────────────────────────

export function loadConstraints(parsed: ParsedConstraints | null): InternalConstraints {
  const ic: InternalConstraints = {
    storeMinPeople: new Map(),
    promoterDayStore: new Map(),
    promoterForceOff: new Set(),
    promoterEndTime: new Map(),
  };
  if (!parsed) return ic;

  if (parsed.store_min_people) {
    for (const [code, n] of Object.entries(parsed.store_min_people)) {
      ic.storeMinPeople.set(code.toUpperCase(), n);
    }
  }
  for (const item of parsed.promoter_day_store ?? []) {
    ic.promoterDayStore.set(`${item.promoter.toLowerCase()}_${item.day}`, item.store.toUpperCase());
  }
  for (const item of parsed.promoter_force_off ?? []) {
    ic.promoterForceOff.add(`${item.promoter.toLowerCase()}_${item.day}`);
  }
  for (const item of parsed.promoter_end_time ?? []) {
    ic.promoterEndTime.set(item.promoter.toLowerCase(), item.end_time);
  }
  return ic;
}

// ── Core optimizer ───────────────────────────────────────────────────────────

const INFEASIBLE = -1e9;

export function runOptimizer(
  dates: string[],
  promoters: Promoter[],
  stores: Store[],
  storePreferences: StorePreference[],
  conflicts: PromoterConflict[],
  perfMatrix: Map<string, number>,   // `${promoterId}_${storeCode}` → avg daily revenue
  extra: InternalConstraints,
): OptimizerResult {
  const activePromoters = promoters.filter(p => p.active);
  const activeStores = stores.filter(s => s.active);
  const allStoreCodes = new Set(activeStores.map(s => s.code));

  // Preference lookups
  const mustMap = new Map<string, Set<string>>();
  const preferredMap = new Map<string, Set<string>>();
  const bannedMap = new Map<string, Set<string>>();

  for (const pref of storePreferences) {
    const map = pref.preference === 'must' ? mustMap
              : pref.preference === 'preferred' ? preferredMap
              : pref.preference === 'banned' ? bannedMap : null;
    if (!map) continue;
    if (!map.has(pref.promoterId)) map.set(pref.promoterId, new Set());
    map.get(pref.promoterId)!.add(pref.storeCode);
  }

  // Admin → AIR only
  for (const p of activePromoters) {
    if (p.role === 'admin') {
      mustMap.set(p.id, new Set(['AIR']));
      const banned = new Set(allStoreCodes);
      banned.delete('AIR');
      bannedMap.set(p.id, banned);
    }
  }

  // Conflict pairs
  const conflictPairs: [string, string][] = conflicts.map(c => [c.promoterAId, c.promoterBId]);

  // Compute store-level average revenue for smarter fallback
  const storeScores = new Map<string, number[]>();
  for (const [key, val] of perfMatrix) {
    const sc = key.split('_')[1];
    if (!storeScores.has(sc)) storeScores.set(sc, []);
    storeScores.get(sc)!.push(val);
  }
  const storeAvgMap = new Map<string, number>();
  for (const [sc, scores] of storeScores) {
    storeAvgMap.set(sc, scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  const allValues = [...perfMatrix.values()];
  const globalMean = allValues.length > 0
    ? allValues.reduce((a, b) => a + b, 0) / allValues.length
    : 500;
  const globalFallback = globalMean * 0.4;
  const prefBonus = globalMean * 0.25;

  const assignments: DraftAssignment[] = [];
  const dailySummary: DaySummary[] = [];
  let totalExpected = 0;

  for (const dateStr of dates) {
    const day = dayName(dateStr);

    // Determine working promoters
    const working: Promoter[] = [];
    for (const p of activePromoters) {
      const fname = firstName(p.name);
      const daysOff = parseDaysOff(p.workingDays);
      if (daysOff.has(day)) continue;
      if (extra.promoterForceOff.has(`${fname}_${day}`)) continue;
      working.push(p);
    }

    // Everyone off if nobody working
    if (working.length === 0) {
      for (const p of activePromoters) {
        assignments.push({ promoterId: p.id, date: dateStr, store: 'Off' });
      }
      dailySummary.push({ date: dateStr, expected: 0, count: 0 });
      continue;
    }

    // Build store slots (expand by capacity)
    // Default minPeople to maxCapacity so high-capacity stores are fully staffed
    const storeSlots: string[] = [];
    for (const s of activeStores) {
      const baseCap = Math.max(1, s.maxCapacity ?? 1);
      const minPeople = extra.storeMinPeople.get(s.code) ?? baseCap;
      const cap = Math.max(baseCap, minPeople);
      for (let k = 0; k < cap; k++) storeSlots.push(s.code);
    }

    const nProms = working.length;
    const nSlots = storeSlots.length;
    const nCols = nSlots + nProms; // extra "Off" columns

    // Build profit matrix (we'll negate for the minimizer)
    const profit: number[][] = Array.from({ length: nProms }, () =>
      new Array(nCols).fill(0)
    );

    for (let i = 0; i < nProms; i++) {
      const p = working[i];
      const pid = p.id;
      const fname = firstName(p.name);
      const hasMust = mustMap.has(pid) && mustMap.get(pid)!.size > 0;
      const forcedStore = extra.promoterDayStore.get(`${fname}_${day}`);

      for (let j = 0; j < nSlots; j++) {
        const sc = storeSlots[j];

        // Check feasibility
        if (bannedMap.get(pid)?.has(sc)) {
          profit[i][j] = INFEASIBLE;
          continue;
        }
        if (hasMust && !mustMap.get(pid)!.has(sc)) {
          profit[i][j] = INFEASIBLE;
          continue;
        }
        if (forcedStore && sc !== forcedStore) {
          profit[i][j] = INFEASIBLE;
          continue;
        }

        // Score = historical avg daily revenue + bonuses
        const base = perfMatrix.get(`${pid}_${sc}`) ?? globalFallback;
        let bonus = 0;
        if (preferredMap.get(pid)?.has(sc)) bonus += prefBonus;
        if (forcedStore && sc === forcedStore) bonus += globalMean * 10;

        profit[i][j] = base + bonus;
      }
      // Off columns: score = 0 (already initialized)
    }

    // Negate for minimization, then solve
    const cost = profit.map(row => row.map(v => -v));
    const rowAssign = hungarianMinimize(cost);

    // Extract day assignments
    const dayMap = new Map<string, string>();
    for (let i = 0; i < nProms; i++) {
      const j = rowAssign[i];
      const pid = working[i].id;
      if (j >= 0 && j < nSlots && profit[i][j] > INFEASIBLE / 2) {
        dayMap.set(pid, storeSlots[j]);
      } else {
        dayMap.set(pid, 'Off');
      }
    }

    // Resolve conflicts: demote lower-revenue promoter to Off
    for (const [pidA, pidB] of conflictPairs) {
      const scA = dayMap.get(pidA);
      const scB = dayMap.get(pidB);
      if (scA && scB && scA !== 'Off' && scA === scB) {
        const sA = perfMatrix.get(`${pidA}_${scA}`) ?? globalFallback;
        const sB = perfMatrix.get(`${pidB}_${scB}`) ?? globalFallback;
        dayMap.set(sA <= sB ? pidA : pidB, 'Off');
      }
    }

    // Enforce min staffing: pull Off promoters into understaffed stores
    // Use maxCapacity as default minimum, override with explicit store_min_people
    const storeCount = new Map<string, number>();
    for (const sc of dayMap.values()) {
      if (sc !== 'Off') storeCount.set(sc, (storeCount.get(sc) ?? 0) + 1);
    }
    const storeMinMap = new Map<string, number>();
    for (const s of activeStores) {
      const baseCap = Math.max(1, s.maxCapacity ?? 1);
      storeMinMap.set(s.code, extra.storeMinPeople.get(s.code) ?? baseCap);
    }
    for (const [storeCode, minN] of storeMinMap) {
      const current = storeCount.get(storeCode) ?? 0;
      if (current < minN) {
        const shortage = minN - current;
        const candidates = working
          .filter(p => {
            if (dayMap.get(p.id) !== 'Off') return false;
            if (bannedMap.get(p.id)?.has(storeCode)) return false;
            const hasMust = mustMap.has(p.id) && mustMap.get(p.id)!.size > 0;
            if (hasMust && !mustMap.get(p.id)!.has(storeCode)) return false;
            return true;
          })
          .sort((a, b) =>
            (perfMatrix.get(`${b.id}_${storeCode}`) ?? globalFallback) -
            (perfMatrix.get(`${a.id}_${storeCode}`) ?? globalFallback)
          );
        for (const p of candidates.slice(0, shortage)) {
          dayMap.set(p.id, storeCode);
        }
      }
    }

    // Build assignments + revenue
    let dayRev = 0;
    let dayCount = 0;
    const workingIds = new Set(working.map(p => p.id));

    for (const p of activePromoters) {
      const sc = workingIds.has(p.id) ? (dayMap.get(p.id) ?? 'Off') : 'Off';
      const entry: DraftAssignment = { promoterId: p.id, date: dateStr, store: sc };

      if (sc !== 'Off') {
        // Determine timeRange
        const store = activeStores.find(s => s.code === sc);
        const fname = firstName(p.name);
        const endOverride = extra.promoterEndTime.get(fname);
        if (store) {
          if (endOverride) {
            entry.timeRange = `${store.openTime}-${endOverride}`;
          } else if (store.shiftSlots && store.shiftSlots.length > 0) {
            entry.timeRange = store.shiftSlots[0]; // pick first slot
          } else {
            entry.timeRange = `${store.openTime}-${store.closeTime}`;
          }
        }
        const rev = perfMatrix.get(`${p.id}_${sc}`) ?? globalFallback;
        dayRev += rev;
        dayCount++;
      }

      assignments.push(entry);
    }

    totalExpected += dayRev;
    dailySummary.push({ date: dateStr, expected: Math.round(dayRev), count: dayCount });
  }

  return { assignments, dailySummary, totalExpected: Math.round(totalExpected) };
}
