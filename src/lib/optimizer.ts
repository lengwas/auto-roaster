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
import { matchShiftSlot, matchAllShiftSlots } from './shiftSlotUtils';

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
  storeNetRevenue?: Map<string, number>, // storeCode → total net revenue (amount - pmgw, last 3 months)
): OptimizerResult {
  const activePromoters = promoters.filter(p => p.active);
  const activeStores = stores.filter(s => s.active);
  const allStoreCodes = new Set(activeStores.map(s => s.code));

  // Debug: log stores with shift slots
  for (const s of activeStores) {
    if (s.shiftSlots && s.shiftSlots.length > 0) {
      console.log(`[Optimizer] ${s.code} shiftSlots:`, s.shiftSlots, 'maxCapacity:', s.maxCapacity);
    }
  }

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

  // Compute store-level average from perf matrix
  const storeScores = new Map<string, number[]>();
  for (const [key, val] of perfMatrix) {
    const sc = key.split('_')[1];
    if (!storeScores.has(sc)) storeScores.set(sc, []);
    storeScores.get(sc)!.push(val);
  }
  const storePerfAvg = new Map<string, number>();
  for (const [sc, scores] of storeScores) {
    storePerfAvg.set(sc, scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  // Build storeAvgMap: use actual net revenue (normalized) as primary fallback.
  // Stores with zero/no revenue get near-zero score so they're deprioritized.
  const storeAvgMap = new Map<string, number>();
  const allValues = [...perfMatrix.values()];
  const globalMean = allValues.length > 0
    ? allValues.reduce((a, b) => a + b, 0) / allValues.length
    : 500;
  const globalFallback = globalMean * 0.4;
  const prefBonus = globalMean * 0.25;

  if (storeNetRevenue && storeNetRevenue.size > 0) {
    const maxRev = Math.max(...storeNetRevenue.values());
    const perfMax = storePerfAvg.size > 0 ? Math.max(...storePerfAvg.values()) : globalMean;
    for (const s of activeStores) {
      const rev = storeNetRevenue.get(s.code);
      if (rev != null && rev > 0 && maxRev > 0) {
        // Scale proportionally: top store → perfMax, zero → near zero
        storeAvgMap.set(s.code, (rev / maxRev) * perfMax);
      } else {
        // No revenue or zero revenue → very low score (1% of globalMean)
        // so optimizer avoids sending people to stores with no sales
        storeAvgMap.set(s.code, globalMean * 0.01);
      }
    }
  } else {
    for (const [sc, avg] of storePerfAvg) {
      storeAvgMap.set(sc, avg);
    }
  }

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
    // Use maxCapacity as source of truth (shift slots may differ per DOW, not per person)
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
        // Use store average revenue as fallback so higher-revenue stores are preferred
        const base = perfMatrix.get(`${pid}_${sc}`)
                  ?? storeAvgMap.get(sc)
                  ?? globalFallback;
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
            // Check conflicts: skip if a conflicting promoter is already at this store
            for (const [pidA, pidB] of conflictPairs) {
              const other = pidA === p.id ? pidB : pidB === p.id ? pidA : null;
              if (other && dayMap.get(other) === storeCode) return false;
            }
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

    // Reassign remaining Off promoters to best available store by revenue
    // Sort by overall performance (best first) so top promoters get first pick of stores
    const curCount = new Map<string, number>();
    for (const sc of dayMap.values()) {
      if (sc !== 'Off') curCount.set(sc, (curCount.get(sc) ?? 0) + 1);
    }
    const capMap = new Map<string, number>();
    for (const s of activeStores) {
      capMap.set(s.code, Math.max(1, s.maxCapacity ?? 1));
    }
    // Sort Off promoters by their overall perf score (best first → best stores)
    const offPromoters = working
      .filter(p => dayMap.get(p.id) === 'Off')
      .sort((a, b) => {
        const scoreA = Math.max(...activeStores.map(s => perfMatrix.get(`${a.id}_${s.code}`) ?? 0));
        const scoreB = Math.max(...activeStores.map(s => perfMatrix.get(`${b.id}_${s.code}`) ?? 0));
        return scoreB - scoreA;
      });
    for (const p of offPromoters) {
      // Find best store: not banned, not full, check conflicts, pick highest revenue
      let bestStore = '';
      let bestScore = -Infinity;
      for (const s of activeStores) {
        if (bannedMap.get(p.id)?.has(s.code)) continue;
        // Check capacity
        const cap = capMap.get(s.code) ?? 1;
        if ((curCount.get(s.code) ?? 0) >= cap) continue;
        // Check conflicts
        let hasConflict = false;
        for (const [pidA, pidB] of conflictPairs) {
          const other = pidA === p.id ? pidB : pidB === p.id ? pidA : null;
          if (other && dayMap.get(other) === s.code) { hasConflict = true; break; }
        }
        if (hasConflict) continue;
        const score = perfMatrix.get(`${p.id}_${s.code}`)
                   ?? storeAvgMap.get(s.code)
                   ?? globalFallback;
        if (score > bestScore) {
          bestScore = score;
          bestStore = s.code;
        }
      }
      if (bestStore) {
        dayMap.set(p.id, bestStore);
        curCount.set(bestStore, (curCount.get(bestStore) ?? 0) + 1);
      }
    }

    // Pre-compute shift slot assignments per store:
    // For stores with multiple slots, assign best performer → latest (afternoon) slot
    const storeSlotAssign = new Map<string, Map<string, string>>(); // storeCode → (promoterId → timeRange)
    {
      // Group promoters by assigned store
      const storePromoters = new Map<string, string[]>(); // storeCode → promoterIds
      for (const p of working) {
        const sc = dayMap.get(p.id);
        if (sc && sc !== 'Off') {
          if (!storePromoters.has(sc)) storePromoters.set(sc, []);
          storePromoters.get(sc)!.push(p.id);
        }
      }
      for (const [sc, pids] of storePromoters) {
        const store = activeStores.find(s => s.code === sc);
        if (!store?.shiftSlots?.length) {
          if (pids.length > 1) console.log(`[Optimizer] ${sc} has ${pids.length} promoters but NO shiftSlots configured`);
          continue;
        }
        const allSlots = matchAllShiftSlots(store.shiftSlots, dateStr);
        if (allSlots.length <= 1) {
          if (pids.length > 1) console.log(`[Optimizer] ${sc} has ${pids.length} promoters but only ${allSlots.length} matching slot for ${dateStr}`);
          continue;
        }
        console.log(`[Optimizer] ${sc}: assigning ${pids.length} promoters to ${allSlots.length} slots:`, allSlots);
        // Sort slots by start time ascending (early → late)
        const sortedSlots = [...allSlots].sort((a, b) => a.localeCompare(b));
        // Sort promoters by performance DESC (best first)
        const sorted = [...pids].sort((a, b) =>
          (perfMatrix.get(`${b}_${sc}`) ?? storeAvgMap.get(sc) ?? globalFallback) -
          (perfMatrix.get(`${a}_${sc}`) ?? storeAvgMap.get(sc) ?? globalFallback)
        );
        // Best performer → last slot (afternoon/peak), weakest → first slot (morning)
        const slotMap = new Map<string, string>();
        for (let k = 0; k < sorted.length; k++) {
          // Assign from the end: best gets last slot, second best gets second-to-last, etc.
          const slotIdx = sortedSlots.length - 1 - (k % sortedSlots.length);
          slotMap.set(sorted[k], sortedSlots[slotIdx]);
        }
        storeSlotAssign.set(sc, slotMap);
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
        const store = activeStores.find(s => s.code === sc);
        const fname = firstName(p.name);
        const endOverride = extra.promoterEndTime.get(fname);
        if (store) {
          if (endOverride) {
            entry.timeRange = `${store.openTime}-${endOverride}`;
          } else if (storeSlotAssign.has(sc) && storeSlotAssign.get(sc)!.has(p.id)) {
            // Performance-based slot assignment
            entry.timeRange = storeSlotAssign.get(sc)!.get(p.id)!;
          } else if (store.shiftSlots && store.shiftSlots.length > 0) {
            entry.timeRange = matchShiftSlot(store.shiftSlots, dateStr);
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
