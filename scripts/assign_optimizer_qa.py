#!/usr/bin/env python3
"""
Auto-Assign Optimizer for Qatar PC Shift Table
================================================
Maximizes expected revenue with Qatar-specific constraints:

1. BLOCK ASSIGNMENT (~2 weeks): Promoters stay at the same store for
   the entire period (not reassigned daily like UAE).
   The optimizer picks the best promoter→store mapping once, then
   repeats it across all dates (respecting day-off).

2. INSPECTION ROTATION: At least 1 person is rotated to the
   lowest-performing store each week (weekdays only, Qatar weekend =
   Fri+Sat) so every branch gets a quality check.

3. Qatar weekend = Friday + Saturday (not Fri+Sun like UAE).

Algorithm:
  - Build performance matrix from historical orders (amount_qar).
  - Run Hungarian once for the whole block to assign promoter→store.
  - For each week, pick 1 promoter to rotate to the worst-performing
    store on a weekday.

Usage:
    python scripts/assign_optimizer_qa.py --start 2026-04-12 --end 2026-04-25

    python scripts/assign_optimizer_qa.py --start 2026-04-12 --end 2026-04-25 \\
        --constraints "VDF เข้า 2 คน" --verbose

Output: JSON with assignments + per-day revenue forecast.

Requirements:
    pip install supabase scipy numpy python-dotenv
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

# ── Optional: load .env from project root ────────────────────────────────────
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / '.env'
    if env_path.exists():
        load_dotenv(env_path)
        print(f"Loaded env from {env_path}", file=sys.stderr)
except ImportError:
    pass

try:
    import numpy as np
    from scipy.optimize import linear_sum_assignment
except ImportError:
    print("ERROR: scipy/numpy not installed. Run: pip install scipy numpy", file=sys.stderr)
    sys.exit(1)

try:
    from supabase import create_client, Client
except ImportError:
    print("ERROR: supabase-py not installed. Run: pip install supabase", file=sys.stderr)
    sys.exit(1)


# ── Qatar warehouse → store code ────────────────────────────────────────────
WAREHOUSE_MAP_QA: dict[str, str] = {
    'vir - vlm': 'VLM', 'vir - vmq': 'VMQ', 'vir - vdf': 'VDF',
    'vir - vvg': 'VVG', 'vir - vvd': 'VVD',
    'kdz - kvd': 'KVD', 'kdz - klm': 'KLM', 'kdz - moq': 'KMQ',
    'kdz - dfc': 'VDF', 'ron - rkt': 'RKT',
    'fnc - dfc': 'VDF', 'fnc - vvd': 'VVD',
}

WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

# Qatar weekend = Friday (4) + Saturday (5)
QATAR_WEEKEND = {'Fri', 'Sat'}

THAI_DAYS: dict[str, str] = {
    'อาทิตย์': 'Sun', 'จันทร์': 'Mon', 'อังคาร': 'Tue',
    'พุธ': 'Wed', 'พฤหัส': 'Thu', 'ศุกร์': 'Fri', 'เสาร์': 'Sat',
    'sunday': 'Sun', 'monday': 'Mon', 'tuesday': 'Tue', 'wednesday': 'Wed',
    'thursday': 'Thu', 'friday': 'Fri', 'saturday': 'Sat',
    'sun': 'Sun', 'mon': 'Mon', 'tue': 'Tue', 'wed': 'Wed',
    'thu': 'Thu', 'fri': 'Fri', 'sat': 'Sat',
}

INFEASIBLE = -1e9
EXCLUDED_STATUSES = {'cancelled', 'returned'}


# ─────────────────────────────────────────────────────────────────────────────
# Parsed constraints dataclass
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ExtraConstraints:
    store_min_people: dict[str, int] = field(default_factory=dict)
    promoter_day_store: dict[tuple[str, str], str] = field(default_factory=dict)
    promoter_end_time: dict[str, str] = field(default_factory=dict)
    promoter_force_off: set[tuple[str, str]] = field(default_factory=set)
    # Qatar-specific: force a promoter to a specific store for entire block
    promoter_block_store: dict[str, str] = field(default_factory=dict)


def parse_extra_constraints(text: str, stores: list[dict]) -> ExtraConstraints:
    """Parse natural-language constraint text (Thai or English)."""
    ec = ExtraConstraints()
    if not text:
        return ec

    store_codes = {s['code'].upper() for s in stores}
    store_code_pattern = '|'.join(sorted(store_codes, key=len, reverse=True))

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue

        # Store minimum people
        m = re.search(
            rf'({store_code_pattern})\s+(?:เข้า|ต้องมี|needs?|min)\s+(\d+)\s*(?:คน|people|persons?)?',
            line, re.IGNORECASE
        )
        if m:
            ec.store_min_people[m.group(1).upper()] = max(
                ec.store_min_people.get(m.group(1).upper(), 0), int(m.group(2))
            )
            continue

        # Promoter → specific store for entire block: "Kevin ประจำ VDF"
        m = re.search(
            rf'(\w+)\s+(?:ประจำ|fixed|lock|always)\s+({store_code_pattern})',
            line, re.IGNORECASE
        )
        if m:
            ec.promoter_block_store[m.group(1).lower()] = m.group(2).upper()
            continue

        # Promoter → store on specific day
        m = re.search(
            rf'(\w+)\s+(?:วัน)?({"|".join(THAI_DAYS.keys())})[^\n]*(?:ไป|go|→|->|at)\s+({store_code_pattern})',
            line, re.IGNORECASE
        )
        if m:
            name = m.group(1).lower()
            day = THAI_DAYS.get(m.group(2).lower(), m.group(2))
            ec.promoter_day_store[(name, day)] = m.group(3).upper()
            continue

        # Promoter force off
        m = re.search(
            rf'(\w+)\s+(?:หยุด|off|day.?off)[^\n]*(?:วัน)?({"|".join(THAI_DAYS.keys())})',
            line, re.IGNORECASE
        )
        if m:
            name = m.group(1).lower()
            day = THAI_DAYS.get(m.group(2).lower(), m.group(2))
            ec.promoter_force_off.add((name, day))
            continue

        # Promoter end time
        m = re.search(
            r'(\w+)\s+(?:เลิกกะ|เลิก|end.?time|close.?at|out)\s+(\d{1,2}:\d{2})',
            line, re.IGNORECASE
        )
        if m:
            ec.promoter_end_time[m.group(1).lower()] = m.group(2)
            continue

    if any([ec.store_min_people, ec.promoter_day_store, ec.promoter_end_time,
            ec.promoter_force_off, ec.promoter_block_store]):
        print("\nParsed extra constraints:", file=sys.stderr)
        if ec.store_min_people:
            print(f"  Store min people : {ec.store_min_people}", file=sys.stderr)
        if ec.promoter_block_store:
            print(f"  Block assignment : {ec.promoter_block_store}", file=sys.stderr)
        if ec.promoter_day_store:
            print(f"  Day→store        : {dict(ec.promoter_day_store)}", file=sys.stderr)
        if ec.promoter_end_time:
            print(f"  End time         : {ec.promoter_end_time}", file=sys.stderr)
        if ec.promoter_force_off:
            print(f"  Force off        : {ec.promoter_force_off}", file=sys.stderr)

    return ec


def load_constraints_from_json(data: dict) -> ExtraConstraints:
    ec = ExtraConstraints()
    if 'store_min_people' in data and isinstance(data['store_min_people'], dict):
        ec.store_min_people = {k.upper(): int(v) for k, v in data['store_min_people'].items()}
    for item in data.get('promoter_day_store', []):
        ec.promoter_day_store[(str(item['promoter']).lower(), str(item['day']))] = str(item['store']).upper()
    for item in data.get('promoter_force_off', []):
        ec.promoter_force_off.add((str(item['promoter']).lower(), str(item['day'])))
    for item in data.get('promoter_end_time', []):
        ec.promoter_end_time[str(item['promoter']).lower()] = str(item['end_time'])
    for item in data.get('promoter_block_store', []):
        ec.promoter_block_store[str(item['promoter']).lower()] = str(item['store']).upper()
    return ec


# ─────────────────────────────────────────────────────────────────────────────
# Data helpers
# ─────────────────────────────────────────────────────────────────────────────

def weekday_name(d: date) -> str:
    return WEEKDAY_NAMES[d.weekday()]


def is_qatar_weekend(d: date) -> bool:
    return weekday_name(d) in QATAR_WEEKEND


def is_qatar_weekday(d: date) -> bool:
    return not is_qatar_weekend(d)


def parse_days_off(day_off_str: str | None) -> set[str]:
    if not day_off_str:
        return set()
    return {s.strip() for s in day_off_str.split(',') if s.strip()}


def match_name(raw: str, name_map: dict[str, str]) -> str | None:
    raw = raw.strip().lower()
    if raw in name_map:
        return name_map[raw]
    first = raw.split()[0] if raw else ''
    return name_map.get(first)


def first_name(full: str) -> str:
    return full.strip().split()[0].lower()


# ─────────────────────────────────────────────────────────────────────────────
# Performance matrix builder (Qatar uses amount_qar)
# ─────────────────────────────────────────────────────────────────────────────

def build_performance_matrix(
    orders: list[dict],
    promoters: list[dict],
    stores: list[dict],
    shifts: list[dict] | None = None,
) -> dict[tuple[str, str], float]:
    """Returns {(promoter_id, store_code): avg_daily_revenue_qar}"""
    name_map: dict[str, str] = {}
    for p in promoters:
        name_map[p['name'].lower()] = p['id']
        name_map.setdefault(first_name(p['name']), p['id'])

    wh_map: dict[str, str] = dict(WAREHOUSE_MAP_QA)
    pl_map: dict[str, str] = {}
    for s in stores:
        if s.get('warehouse'):
            wh_map[s['warehouse'].lower()] = s['code']
        if s.get('platform'):
            pl_map[s['platform'].lower()] = s['code']

    daily_rev: dict[tuple[str, str, str], float] = defaultdict(float)

    for order in orders:
        if (order.get('status') or '').lower() in EXCLUDED_STATUSES:
            continue
        # Qatar uses amount_qar
        amount = float(order.get('amount_qar') or order.get('amount_aed') or 0)
        pid = match_name(order.get('salesperson') or '', name_map)
        if not pid:
            continue
        wh = (order.get('warehouse') or '').strip().lower()
        pl = (order.get('platform') or '').strip().lower()
        store_code = wh_map.get(wh) or pl_map.get(pl)
        if not store_code:
            continue
        daily_rev[(pid, store_code, order.get('date') or '')] += amount

    # Include zero-sales days from shifts
    worked_days: dict[tuple[str, str], set[str]] = defaultdict(set)
    if shifts:
        valid_codes = {s['code'] for s in stores}
        for sh in shifts:
            pid = str(sh.get('promoter_id') or '')
            sc = str(sh.get('shift_type') or '').upper()
            d = str(sh.get('date') or '')
            if pid and sc and d and sc in valid_codes:
                worked_days[(pid, sc)].add(d)

    pair_totals: dict[tuple[str, str], dict[str, float]] = defaultdict(dict)
    for (pid, sc, d), rev in daily_rev.items():
        pair_totals[(pid, sc)][d] = rev

    result: dict[tuple[str, str], float] = {}
    for (pid, sc), day_revs in pair_totals.items():
        total_rev = sum(day_revs.values())
        n_days = max(len(day_revs), len(worked_days.get((pid, sc), set())))
        result[(pid, sc)] = total_rev / n_days

    return result


def print_performance_summary(
    perf: dict[tuple[str, str], float],
    promoters: list[dict],
    stores: list[dict],
) -> None:
    codes = sorted(s['code'] for s in stores if s.get('active'))
    print("\n── Performance Matrix (avg daily QAR) ──────────────────", file=sys.stderr)
    print(f"{'Promoter':<22}", end='', file=sys.stderr)
    for c in codes:
        print(f"  {c:>6}", end='', file=sys.stderr)
    print(file=sys.stderr)
    for p in sorted(promoters, key=lambda x: x['name']):
        if not p.get('active'):
            continue
        print(f"{p['name']:<22}", end='', file=sys.stderr)
        for c in codes:
            val = perf.get((p['id'], c))
            print(f"  {val:>6.0f}" if val is not None else f"  {'—':>6}", end='', file=sys.stderr)
        print(file=sys.stderr)
    print(file=sys.stderr)


# ─────────────────────────────────────────────────────────────────────────────
# Store performance ranking (for inspection rotation)
# ─────────────────────────────────────────────────────────────────────────────

def rank_stores_by_revenue(
    orders: list[dict],
    stores: list[dict],
) -> list[tuple[str, float]]:
    """Returns [(store_code, total_revenue)] sorted ascending (worst first)."""
    wh_map: dict[str, str] = dict(WAREHOUSE_MAP_QA)
    pl_map: dict[str, str] = {}
    for s in stores:
        if s.get('warehouse'):
            wh_map[s['warehouse'].lower()] = s['code']
        if s.get('platform'):
            pl_map[s['platform'].lower()] = s['code']

    store_rev: dict[str, float] = defaultdict(float)
    active_codes = {s['code'] for s in stores if s.get('active')}

    for order in orders:
        if (order.get('status') or '').lower() in EXCLUDED_STATUSES:
            continue
        amount = float(order.get('amount_qar') or order.get('amount_aed') or 0)
        wh = (order.get('warehouse') or '').strip().lower()
        pl = (order.get('platform') or '').strip().lower()
        code = wh_map.get(wh) or pl_map.get(pl)
        if code and code in active_codes:
            store_rev[code] += amount

    # Include stores with zero revenue
    for code in active_codes:
        if code not in store_rev:
            store_rev[code] = 0.0

    return sorted(store_rev.items(), key=lambda x: x[1])


# ─────────────────────────────────────────────────────────────────────────────
# Core optimizer — Qatar block assignment
# ─────────────────────────────────────────────────────────────────────────────

def run_optimizer(
    target_dates: list[date],
    promoters: list[dict],
    stores: list[dict],
    preferences: list[dict],
    conflicts: list[dict],
    perf: dict[tuple[str, str], float],
    extra: ExtraConstraints,
    store_ranking: list[tuple[str, float]],
    verbose: bool = False,
) -> tuple[list[dict], list[dict]]:
    """
    Qatar optimizer: block-assign promoters to stores for the whole period,
    then rotate 1 person/week to lowest-performing store on a weekday.
    """
    active_promoters = [p for p in promoters if p.get('active', True)]
    active_stores = [s for s in stores if s.get('active', True)]

    store_times: dict[str, tuple[str, str]] = {
        s['code']: (s.get('open_time') or '10:00', s.get('close_time') or '22:00')
        for s in stores
    }

    # Preference lookups
    must: dict[str, set[str]] = defaultdict(set)
    preferred_stores: dict[str, set[str]] = defaultdict(set)
    banned: dict[str, set[str]] = defaultdict(set)
    for pref in preferences:
        pid, sc, lv = pref['promoter_id'], pref['store_code'], pref['preference']
        if lv == 'must':
            must[pid].add(sc)
        elif lv == 'preferred':
            preferred_stores[pid].add(sc)
        elif lv == 'banned':
            banned[pid].add(sc)

    # Conflict pairs
    conflict_pairs: set[frozenset] = {
        frozenset([c['promoter_a_id'], c['promoter_b_id']]) for c in conflicts
    }

    # Score params
    all_values = list(perf.values())
    global_mean = sum(all_values) / len(all_values) if all_values else 500.0
    fallback_score = global_mean * 0.4
    pref_bonus = global_mean * 0.25

    # ── Step 1: Block assignment via Hungarian ──────────────────────────────
    # One assignment for the whole period (not per-day)
    # Store slots: expand by max_capacity
    store_slots: list[str] = []
    for s in active_stores:
        base_cap = max(1, int(s.get('max_capacity') or 1))
        min_people = extra.store_min_people.get(s['code'], 0)
        cap = max(base_cap, min_people)
        store_slots.extend([s['code']] * cap)

    n_proms = len(active_promoters)
    n_slots = len(store_slots)
    n_cols = n_slots + n_proms  # extra Off columns

    score = np.zeros((n_proms, n_cols), dtype=float)

    for i, p in enumerate(active_promoters):
        pid = p['id']
        fname = first_name(p['name'])
        has_must = bool(must.get(pid))
        forced_store = extra.promoter_block_store.get(fname)

        for j, sc in enumerate(store_slots):
            if sc in banned.get(pid, set()):
                score[i, j] = INFEASIBLE
                continue
            if has_must and sc not in must.get(pid, set()):
                score[i, j] = INFEASIBLE
                continue
            if forced_store and sc != forced_store:
                score[i, j] = INFEASIBLE
                continue

            base = perf.get((pid, sc), fallback_score)
            bonus = pref_bonus if sc in preferred_stores.get(pid, set()) else 0.0
            if forced_store and sc == forced_store:
                bonus += global_mean * 10
            score[i, j] = base + bonus

    # Run Hungarian
    row_ind, col_ind = linear_sum_assignment(-score)

    # Build block assignment: pid → store_code
    block_map: dict[str, str] = {}
    for i, j in zip(row_ind, col_ind):
        pid = active_promoters[i]['id']
        if j < n_slots and score[i, j] > INFEASIBLE / 2:
            block_map[pid] = store_slots[j]
        else:
            block_map[pid] = 'Off'

    # Resolve conflicts: if two conflicting promoters at same store, demote lower scorer
    for pair in conflict_pairs:
        pids = list(pair)
        if len(pids) < 2:
            continue
        pid_a, pid_b = pids[0], pids[1]
        sc_a = block_map.get(pid_a, 'Off')
        sc_b = block_map.get(pid_b, 'Off')
        if sc_a != 'Off' and sc_a == sc_b:
            s_a = perf.get((pid_a, sc_a), fallback_score)
            s_b = perf.get((pid_b, sc_b), fallback_score)
            loser = pid_a if s_a <= s_b else pid_b
            block_map[loser] = 'Off'

    # Enforce store_min_people
    store_count: dict[str, int] = defaultdict(int)
    for sc in block_map.values():
        if sc != 'Off':
            store_count[sc] += 1
    for store_code, min_n in extra.store_min_people.items():
        current = store_count.get(store_code, 0)
        if current < min_n:
            shortage = min_n - current
            candidates = [
                p for p in active_promoters
                if block_map.get(p['id'], 'Off') == 'Off'
                and store_code not in banned.get(p['id'], set())
                and (not must.get(p['id']) or store_code in must.get(p['id'], set()))
            ]
            candidates.sort(
                key=lambda p: perf.get((p['id'], store_code), fallback_score),
                reverse=True,
            )
            for p in candidates[:shortage]:
                block_map[p['id']] = store_code

    # Print block assignment summary
    print("\n── Block Assignment (whole period) ──────────────────────", file=sys.stderr)
    for p in sorted(active_promoters, key=lambda x: x['name']):
        sc = block_map.get(p['id'], 'Off')
        rev = perf.get((p['id'], sc), 0) if sc != 'Off' else 0
        print(f"  {p['name']:<22} → {sc:>5}   (avg {rev:>7,.0f} QAR/day)", file=sys.stderr)
    print(file=sys.stderr)

    # ── Step 2: Inspection rotation ─────────────────────────────────────────
    # Group dates into ISO weeks
    weeks: dict[int, list[date]] = defaultdict(list)
    for d in target_dates:
        weeks[d.isocalendar()[1]].append(d)

    # Identify worst-performing stores (those not already staffed or with lowest revenue)
    worst_stores = [code for code, _ in store_ranking if code not in store_count or store_count[code] == 0]
    # If all stores are staffed, use the ones with lowest revenue
    if not worst_stores:
        worst_stores = [code for code, _ in store_ranking]

    # Rotation schedule: for each week, pick a weekday and rotate 1 promoter
    # to the worst store that doesn't already have someone
    rotation: dict[str, dict[str, str]] = {}  # date_str → {pid: rotated_store}

    staffed_stores = {sc for sc in block_map.values() if sc != 'Off'}
    unstaffed_worst = [sc for sc in worst_stores if sc not in staffed_stores]

    # Track which stores have been inspected
    inspected: set[str] = set()
    rotation_idx = 0

    for week_num in sorted(weeks.keys()):
        week_dates = weeks[week_num]
        weekday_dates = [d for d in week_dates if is_qatar_weekday(d)]
        if not weekday_dates:
            continue

        # Pick the store to inspect this week
        # Priority: unstaffed stores first, then lowest-revenue staffed stores
        inspect_store = None
        if unstaffed_worst:
            # Cycle through unstaffed stores
            for sc in unstaffed_worst:
                if sc not in inspected:
                    inspect_store = sc
                    break
            if not inspect_store:
                inspected.clear()
                inspect_store = unstaffed_worst[0]
        else:
            # All stores staffed — rotate to lowest-revenue store
            for sc, _ in store_ranking:
                if sc not in inspected:
                    inspect_store = sc
                    break
            if not inspect_store:
                inspected.clear()
                inspect_store = store_ranking[0][0] if store_ranking else None

        if not inspect_store:
            continue

        inspected.add(inspect_store)

        # Pick a weekday for inspection (spread across the week)
        inspect_date = weekday_dates[rotation_idx % len(weekday_dates)]
        rotation_idx += 1

        # Pick the promoter to rotate: prefer the one with best overall score
        # (send your best person to check the worst store)
        rotatable = [
            p for p in active_promoters
            if block_map.get(p['id'], 'Off') != 'Off'
            and block_map.get(p['id']) != inspect_store
            and inspect_store not in banned.get(p['id'], set())
        ]
        if not rotatable:
            continue

        # Pick promoter with highest overall average (best inspector)
        def avg_score(p):
            pid = p['id']
            scores = [v for (pi, _), v in perf.items() if pi == pid]
            return sum(scores) / len(scores) if scores else 0

        rotatable.sort(key=avg_score, reverse=True)
        chosen = rotatable[0]

        date_str = inspect_date.isoformat()
        if date_str not in rotation:
            rotation[date_str] = {}
        rotation[date_str][chosen['id']] = inspect_store

        print(
            f"  Inspection: Week {week_num} — {chosen['name']} → {inspect_store} "
            f"on {date_str} ({weekday_name(inspect_date)})",
            file=sys.stderr,
        )

    # ── Step 3: Generate daily assignments ──────────────────────────────────
    assignments: list[dict] = []
    daily_summary: list[dict] = []
    total_expected = 0.0

    for d in target_dates:
        day_name = weekday_name(d)
        date_str = d.isoformat()
        day_rotations = rotation.get(date_str, {})

        day_rev = 0.0
        breakdown: list[dict] = []

        for p in active_promoters:
            pid = p['id']
            fname = first_name(p['name'])

            # Check day-off
            regular_off = parse_days_off(p.get('day_off'))
            if day_name in regular_off or (fname, day_name) in extra.promoter_force_off:
                assignments.append({'promoterId': pid, 'date': date_str, 'store': 'Off'})
                continue

            # Check day-specific override
            day_override = extra.promoter_day_store.get((fname, day_name))

            # Determine store: rotation > day override > block assignment
            if pid in day_rotations:
                sc = day_rotations[pid]
            elif day_override:
                sc = day_override
            else:
                sc = block_map.get(pid, 'Off')

            entry: dict = {'promoterId': pid, 'date': date_str, 'store': sc}

            if sc != 'Off':
                open_t, close_t = store_times.get(sc, ('10:00', '22:00'))
                end_override = extra.promoter_end_time.get(fname)
                if end_override:
                    entry['timeRange'] = f"{open_t}-{end_override}"

                rev = perf.get((pid, sc), fallback_score)
                day_rev += rev
                breakdown.append({
                    'promoter': p['name'],
                    'store': sc,
                    'expected_qar': round(rev),
                    'is_rotation': pid in day_rotations,
                })

            assignments.append(entry)

        breakdown.sort(key=lambda x: -x['expected_qar'])
        total_expected += day_rev

        if verbose:
            print(f"\n{date_str} ({day_name}) — expected {day_rev:,.0f} QAR", file=sys.stderr)
            for b in breakdown:
                tag = ' [INSPECT]' if b.get('is_rotation') else ''
                print(f"  {b['promoter']:<22} → {b['store']:>5}   {b['expected_qar']:>7,} QAR{tag}", file=sys.stderr)

        daily_summary.append({
            'date': date_str,
            'day': day_name,
            'expected_qar': round(day_rev),
            'assigned_count': len(breakdown),
            'breakdown': breakdown,
        })

    # Print revenue table
    print(f"\n{'─'*52}", file=sys.stderr)
    print(f"{'Date':<12} {'Day':<5} {'People':>6}  {'Expected (QAR)':>14}", file=sys.stderr)
    print(f"{'─'*52}", file=sys.stderr)
    for ds in daily_summary:
        has_rotation = any(b.get('is_rotation') for b in ds['breakdown'])
        tag = ' *' if has_rotation else ''
        print(
            f"{ds['date']:<12} {ds['day']:<5} {ds['assigned_count']:>6}  {ds['expected_qar']:>14,}{tag}",
            file=sys.stderr,
        )
    print(f"{'─'*52}", file=sys.stderr)
    print(f"{'TOTAL':<12} {'':<5} {'':<6}  {total_expected:>14,.0f}", file=sys.stderr)
    print(f"{'─'*52}", file=sys.stderr)
    print("  * = has inspection rotation", file=sys.stderr)

    return assignments, daily_summary


# ─────────────────────────────────────────────────────────────────────────────
# Supabase helpers
# ─────────────────────────────────────────────────────────────────────────────

def fetch_all(sb: Client, table: str, query: str = '*', filters: list[tuple] | None = None) -> list[dict]:
    PAGE = 1000
    offset = 0
    results = []
    while True:
        q = sb.from_(table).select(query).range(offset, offset + PAGE - 1)
        if filters:
            for col, op, val in filters:
                if op == 'gte':
                    q = q.gte(col, val)
        batch = q.execute().data or []
        results.extend(batch)
        if len(batch) < PAGE:
            break
        offset += PAGE
    return results


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='Qatar optimizer: block assignment + inspection rotation',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--start', required=True, metavar='YYYY-MM-DD')
    parser.add_argument('--end', required=True, metavar='YYYY-MM-DD')
    parser.add_argument('--output', default=None, metavar='FILE')
    parser.add_argument('--lookback', type=int, default=90)
    parser.add_argument('--constraints', default=None, metavar='TEXT')
    parser.add_argument('--constraints-file', default=None, metavar='FILE')
    parser.add_argument('--constraints-json', default=None, metavar='JSON')
    parser.add_argument('--verbose', '-v', action='store_true')
    parser.add_argument('--show-matrix', action='store_true')
    args = parser.parse_args()

    url = os.environ.get('VITE_SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    key = (
        os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or
        os.environ.get('VITE_SUPABASE_ANON_KEY') or
        os.environ.get('SUPABASE_ANON_KEY')
    )
    if not url or not key:
        print("ERROR: Missing Supabase credentials. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env", file=sys.stderr)
        sys.exit(1)

    sb: Client = create_client(url, key)
    start_date = date.fromisoformat(args.start)
    end_date = date.fromisoformat(args.end)
    lookback_from = (start_date - timedelta(days=args.lookback)).isoformat()

    target_dates: list[date] = []
    cur = start_date
    while cur <= end_date:
        target_dates.append(cur)
        cur += timedelta(days=1)

    if not target_dates:
        print("ERROR: end date must be >= start date.", file=sys.stderr)
        sys.exit(1)

    print(f"\n{'='*60}", file=sys.stderr)
    print(f"Qatar Auto-Assign Optimizer (Block + Inspection)", file=sys.stderr)
    print(f"  Period  : {args.start} → {args.end} ({len(target_dates)} days)", file=sys.stderr)
    print(f"  Lookback: {args.lookback} days (since {lookback_from})", file=sys.stderr)
    print(f"  Weekend : Friday + Saturday", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)

    # Load constraints
    constraint_text = ''
    if args.constraints_file:
        constraint_text = Path(args.constraints_file).read_text(encoding='utf-8')
    elif args.constraints:
        constraint_text = args.constraints

    # Fetch data from Qatar tables (_qa suffix)
    print("\nFetching data from Supabase (Qatar tables)…", file=sys.stderr)
    promoters = fetch_all(sb, 'promoters_qa')
    stores = fetch_all(sb, 'stores_qa')

    # Qatar may or may not have preference/conflict tables — handle gracefully
    try:
        preferences_raw = fetch_all(sb, 'promoter_store_preferences_qa')
    except Exception:
        preferences_raw = []
        print("  (no promoter_store_preferences_qa table — skipping)", file=sys.stderr)
    try:
        conflicts_raw = fetch_all(sb, 'promoter_conflicts_qa')
    except Exception:
        conflicts_raw = []
        print("  (no promoter_conflicts_qa table — skipping)", file=sys.stderr)

    print(f"  Promoters: {sum(1 for p in promoters if p.get('active'))} active / {len(promoters)} total", file=sys.stderr)
    print(f"  Stores   : {sum(1 for s in stores if s.get('active'))} active / {len(stores)} total", file=sys.stderr)

    # Qatar orders use amount_qar
    print(f"\nFetching orders since {lookback_from}…", file=sys.stderr)
    try:
        orders = fetch_all(
            sb, 'orders_qa',
            query='date,salesperson,warehouse,platform,amount_qar,status',
            filters=[('date', 'gte', lookback_from)],
        )
    except Exception:
        # Fallback: try with amount_aed
        print("  Retrying with amount_aed column…", file=sys.stderr)
        orders = fetch_all(
            sb, 'orders_qa',
            query='date,salesperson,warehouse,platform,amount_aed,status',
            filters=[('date', 'gte', lookback_from)],
        )
    print(f"  {len(orders)} orders loaded", file=sys.stderr)

    print(f"Fetching shifts since {lookback_from}…", file=sys.stderr)
    shifts = fetch_all(
        sb, 'shifts_qa',
        query='promoter_id,date,shift_type',
        filters=[('date', 'gte', lookback_from)],
    )
    print(f"  {len(shifts)} shift records loaded", file=sys.stderr)

    # Resolve preferences
    store_id_to_code = {s['id']: s['code'] for s in stores}
    preferences = [
        {
            'promoter_id': r['promoter_id'],
            'store_code': store_id_to_code.get(r.get('store_id', ''), ''),
            'preference': r['preference'],
        }
        for r in preferences_raw
        if store_id_to_code.get(r.get('store_id', ''))
    ]
    conflicts = [
        {'promoter_a_id': r['promoter_a_id'], 'promoter_b_id': r['promoter_b_id']}
        for r in conflicts_raw
    ]

    # Performance matrix
    print("\nBuilding performance matrix…", file=sys.stderr)
    perf = build_performance_matrix(orders, promoters, stores, shifts=shifts)
    print(f"  {len(perf)} (promoter, store) score pairs", file=sys.stderr)

    if len(perf) == 0:
        print("  WARNING: No performance data found.", file=sys.stderr)

    if args.show_matrix:
        print_performance_summary(perf, promoters, stores)

    # Store revenue ranking
    store_ranking = rank_stores_by_revenue(orders, stores)
    print("\nStore revenue ranking (worst → best):", file=sys.stderr)
    for code, rev in store_ranking:
        print(f"  {code:>5}: {rev:>12,.0f} QAR", file=sys.stderr)

    # Parse constraints
    if args.constraints_json:
        try:
            cj = json.loads(args.constraints_json)
            extra = load_constraints_from_json(cj)
        except (json.JSONDecodeError, KeyError):
            extra = parse_extra_constraints(constraint_text, stores)
    else:
        extra = parse_extra_constraints(constraint_text, stores)

    # Run optimizer
    print("\nRunning Qatar block optimizer…", file=sys.stderr)
    assignments, daily_summary = run_optimizer(
        target_dates, promoters, stores,
        preferences, conflicts, perf, extra,
        store_ranking,
        verbose=args.verbose,
    )

    # Output
    # Re-derive block assignment for output (first non-Off assignment per promoter)
    block_summary: dict[str, str] = {}
    if assignments:
        for a in assignments:
            pid = a['promoterId']
            if pid not in block_summary and a['store'] != 'Off':
                block_summary[pid] = a['store']
    name_map = {p['id']: p['name'] for p in promoters}

    output_data = {
        'assignments': assignments,
        'revenue_forecast': daily_summary,
        'total_expected_qar': sum(d['expected_qar'] for d in daily_summary),
        'period': {'start': args.start, 'end': args.end, 'days': len(target_dates)},
        'block_assignment': {
            name_map.get(pid, pid): sc for pid, sc in block_summary.items()
        },
    }

    output_json = json.dumps(output_data, indent=2, ensure_ascii=False)

    if args.output:
        Path(args.output).write_text(output_json, encoding='utf-8')
        print(f"\nSaved to: {args.output}", file=sys.stderr)
        print(f"  → assignments     : {len(assignments)} rows", file=sys.stderr)
        print(f"  → revenue_forecast: {len(daily_summary)} days", file=sys.stderr)
        print(f"  → total_expected  : {output_data['total_expected_qar']:,} QAR", file=sys.stderr)
    else:
        print(output_json)

    print("\nDone.", file=sys.stderr)


if __name__ == '__main__':
    main()
