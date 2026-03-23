#!/usr/bin/env python3
"""
Auto-Assign Optimizer for UAE PC Shift Table
=============================================
Maximizes expected daily revenue by matching promoters to stores
based on their historical sales performance at each location.

Algorithm: Hungarian Algorithm (scipy.optimize.linear_sum_assignment)
  - Score = avg historical daily revenue at that store (+ bonus for preferred)
  - Infeasible pairs (banned, admin not AIR) get -infinity
  - Unassigned ("Off") score = 0
  - Runs per-day; respects all constraints + additional text constraints

Usage:
    python scripts/assign_optimizer.py --start 2026-03-23 --end 2026-03-30

    # Include constraints from Auto Assign textarea
    python scripts/assign_optimizer.py --start 2026-03-23 --end 2026-03-30 \\
        --constraints "Kevin ต้องการเข้ากะวันอาทิตย์ เลิกกะ 19:00\\nVDM เข้า 2 คนทุกวัน"

    # Load constraints from file (same text as you'd type in the app)
    python scripts/assign_optimizer.py --start 2026-03-23 --end 2026-03-30 \\
        --constraints-file constraints.txt --output result.json --verbose

Output: result.json contains assignments + per-day revenue forecast.

Requirements:
    pip install supabase scipy numpy python-dotenv
"""

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


# ── Warehouse text → store code (mirrors SalesPerformancePage.tsx) ────────
WAREHOUSE_MAP: dict[str, str] = {
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
}

WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

# Thai day name → short English
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
    # Minimum number of people required at a store every day: {store_code: min_n}
    store_min_people: dict[str, int] = field(default_factory=dict)
    # Force a promoter to a specific store on a specific weekday: {(first_name_lower, day): store_code}
    promoter_day_store: dict[tuple[str, str], str] = field(default_factory=dict)
    # Override shift end time for a promoter: {first_name_lower: "HH:MM"}
    promoter_end_time: dict[str, str] = field(default_factory=dict)
    # Force a promoter to be Off on specific weekday: {(first_name_lower, day)}
    promoter_force_off: set[tuple[str, str]] = field(default_factory=set)


def load_constraints_from_json(data: dict) -> ExtraConstraints:
    """
    Load ExtraConstraints from pre-parsed JSON (output of Gemini constraint parser).
    Accepts the format produced by the Auto Assign UI's 'Parse →' button:
    {
      "store_min_people": {"VDM": 2},
      "promoter_day_store": [{"promoter": "kevin", "day": "Mon", "store": "VDM"}],
      "promoter_force_off": [{"promoter": "kevin", "day": "Mon"}],
      "promoter_end_time": [{"promoter": "kevin", "end_time": "19:00"}]
    }
    """
    ec = ExtraConstraints()
    if 'store_min_people' in data and isinstance(data['store_min_people'], dict):
        ec.store_min_people = {k.upper(): int(v) for k, v in data['store_min_people'].items()}
    for item in data.get('promoter_day_store', []):
        key = (str(item['promoter']).lower(), str(item['day']))
        ec.promoter_day_store[key] = str(item['store']).upper()
    for item in data.get('promoter_force_off', []):
        ec.promoter_force_off.add((str(item['promoter']).lower(), str(item['day'])))
    for item in data.get('promoter_end_time', []):
        ec.promoter_end_time[str(item['promoter']).lower()] = str(item['end_time'])
    return ec


def parse_extra_constraints(text: str, stores: list[dict]) -> ExtraConstraints:
    """
    Parse natural-language constraint text (Thai or English) into structured form.

    Supported patterns:
      "VDM เข้า 2 คน[ทุกวัน]"            → store_min_people[VDM] = 2
      "Kevin ไป VDM ทุกวัน"               → (kevin, *) → VDM
      "Kevin วันอาทิตย์ ไป AIR"           → (kevin, Sun) → AIR
      "Kevin วันอาทิตย์"                  → Kevin must work Sunday (remove from days-off)
      "Kevin เลิกกะ 19:00"               → end time 19:00
      "Kevin หยุดวันจันทร์"              → force Off on Monday
    """
    ec = ExtraConstraints()
    if not text:
        return ec

    store_codes = {s['code'].upper() for s in stores}
    store_code_pattern = '|'.join(sorted(store_codes, key=len, reverse=True))

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue
        # ── Store minimum people: "VDM เข้า 2 คน" / "VDM needs 2 people" ─────
        m = re.search(
            rf'({store_code_pattern})\s+(?:เข้า|ต้องมี|needs?|min)\s+(\d+)\s*(?:คน|people|persons?)?',
            line, re.IGNORECASE
        )
        if m:
            code = m.group(1).upper()
            n = int(m.group(2))
            ec.store_min_people[code] = max(ec.store_min_people.get(code, 0), n)
            continue

        # ── Promoter → store on specific day: "Kevin วันอาทิตย์ ไป VDM" ───────
        m = re.search(
            rf'(\w+)\s+(?:วัน)?({"|".join(THAI_DAYS.keys())})[^\n]*(?:ไป|go|→|->|at)\s+({store_code_pattern})',
            line, re.IGNORECASE
        )
        if m:
            name = m.group(1).lower()
            day = THAI_DAYS.get(m.group(2).lower(), m.group(2))
            store = m.group(3).upper()
            ec.promoter_day_store[(name, day)] = store
            continue

        # Also try: "Kevin ไป VDM วันอาทิตย์"
        m = re.search(
            rf'(\w+)\s+(?:ไป|go to|→|->)\s+({store_code_pattern})[^\n]*(?:วัน)?({"|".join(THAI_DAYS.keys())})',
            line, re.IGNORECASE
        )
        if m:
            name = m.group(1).lower()
            store = m.group(2).upper()
            day = THAI_DAYS.get(m.group(3).lower(), m.group(3))
            ec.promoter_day_store[(name, day)] = store
            continue

        # ── Promoter force off: "Kevin หยุดวันจันทร์" ─────────────────────────
        m = re.search(
            rf'(\w+)\s+(?:หยุด|off|day.?off)[^\n]*(?:วัน)?({"|".join(THAI_DAYS.keys())})',
            line, re.IGNORECASE
        )
        if m:
            name = m.group(1).lower()
            day = THAI_DAYS.get(m.group(2).lower(), m.group(2))
            ec.promoter_force_off.add((name, day))
            continue

        # ── Promoter end time: "Kevin เลิกกะ 19:00" ───────────────────────────
        m = re.search(
            r'(\w+)\s+(?:เลิกกะ|เลิก|end.?time|close.?at|out)\s+(\d{1,2}:\d{2})',
            line, re.IGNORECASE
        )
        if m:
            name = m.group(1).lower()
            ec.promoter_end_time[name] = m.group(2)
            continue

    if ec.store_min_people or ec.promoter_day_store or ec.promoter_end_time or ec.promoter_force_off:
        print("\nParsed extra constraints:", file=sys.stderr)
        if ec.store_min_people:
            print(f"  Store min people : {ec.store_min_people}", file=sys.stderr)
        if ec.promoter_day_store:
            print(f"  Promoter-day→store: {dict(ec.promoter_day_store)}", file=sys.stderr)
        if ec.promoter_end_time:
            print(f"  End time overrides: {ec.promoter_end_time}", file=sys.stderr)
        if ec.promoter_force_off:
            print(f"  Force off       : {ec.promoter_force_off}", file=sys.stderr)
    else:
        print("  (no structured constraints parsed from text)", file=sys.stderr)

    return ec


# ─────────────────────────────────────────────────────────────────────────────
# Data helpers
# ─────────────────────────────────────────────────────────────────────────────

def weekday_name(d: date) -> str:
    return WEEKDAY_NAMES[d.weekday()]


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
# Performance matrix builder
# ─────────────────────────────────────────────────────────────────────────────

def build_performance_matrix(
    orders: list[dict],
    promoters: list[dict],
    stores: list[dict],
) -> dict[tuple[str, str], float]:
    """Returns {(promoter_id, store_code): avg_daily_revenue_aed}"""
    name_map: dict[str, str] = {}
    for p in promoters:
        name_map[p['name'].lower()] = p['id']
        name_map.setdefault(first_name(p['name']), p['id'])

    wh_map: dict[str, str] = dict(WAREHOUSE_MAP)
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
        amount = float(order.get('amount_aed') or 0)
        pid = match_name(order.get('salesperson') or '', name_map)
        if not pid:
            continue
        wh = (order.get('warehouse') or '').strip().lower()
        pl = (order.get('platform') or '').strip().lower()
        store_code = wh_map.get(wh) or pl_map.get(pl)
        if not store_code:
            continue
        daily_rev[(pid, store_code, order.get('date') or '')] += amount

    pair_totals: dict[tuple[str, str], list[float]] = defaultdict(list)
    for (pid, sc, _d), rev in daily_rev.items():
        pair_totals[(pid, sc)].append(rev)

    return {k: sum(v) / len(v) for k, v in pair_totals.items()}


def print_performance_summary(
    perf: dict[tuple[str, str], float],
    promoters: list[dict],
    stores: list[dict],
) -> None:
    codes = sorted(s['code'] for s in stores if s.get('active'))
    print("\n── Performance Matrix (avg daily AED) ──────────────────", file=sys.stderr)
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
# Core optimizer
# ─────────────────────────────────────────────────────────────────────────────

def run_optimizer(
    target_dates: list[date],
    promoters: list[dict],
    stores: list[dict],
    preferences: list[dict],
    conflicts: list[dict],
    perf: dict[tuple[str, str], float],
    extra: ExtraConstraints,
    verbose: bool = False,
) -> tuple[list[dict], list[dict]]:
    """
    Returns:
      assignments: [{"promoterId", "date", "store", "timeRange?}]
      daily_summary: [{"date", "day", "expected_aed", "assigned_count", "breakdown"}]
    """
    active_promoters = [p for p in promoters if p.get('active', True)]
    active_stores = [s for s in stores if s.get('active', True)]

    # Store open/close time map for building timeRange
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

    # Admin → AIR only
    all_store_codes = {s['code'] for s in active_stores}
    for p in active_promoters:
        if p.get('role') == 'admin':
            must[p['id']] = {'AIR'}
            banned[p['id']] = all_store_codes - {'AIR'}

    # Conflict pairs
    conflict_pairs: set[frozenset] = {
        frozenset([c['promoter_a_id'], c['promoter_b_id']]) for c in conflicts
    }

    # Score fallbacks
    all_values = list(perf.values())
    global_mean = sum(all_values) / len(all_values) if all_values else 500.0
    fallback_score = global_mean * 0.4
    pref_bonus = global_mean * 0.25

    # Extra constraint: name lookup (first name → promoter_id / promoter_id → first name)
    pid_to_fname: dict[str, str] = {p['id']: first_name(p['name']) for p in active_promoters}

    assignments: list[dict] = []
    daily_summary: list[dict] = []
    total_expected = 0.0

    for d in target_dates:
        day_name = weekday_name(d)
        date_str = d.isoformat()

        # Promoters on this day: not on regular day-off AND not force-off today
        working = []
        for p in active_promoters:
            fname = first_name(p['name'])
            regular_off = parse_days_off(p.get('day_off'))
            if day_name in regular_off:
                continue
            if (fname, day_name) in extra.promoter_force_off:
                continue
            working.append(p)

        if not working:
            for p in active_promoters:
                assignments.append({'promoterId': p['id'], 'date': date_str, 'store': 'Off'})
            daily_summary.append({
                'date': date_str, 'day': day_name,
                'expected_aed': 0, 'assigned_count': 0, 'breakdown': [],
            })
            continue

        # Store slots: expand by max_capacity, also enforce store_min_people from extra constraints
        store_slots: list[str] = []
        for s in active_stores:
            base_cap = max(1, int(s.get('max_capacity') or 2))
            min_people = extra.store_min_people.get(s['code'], 0)
            cap = max(base_cap, min_people)
            store_slots.extend([s['code']] * cap)

        n_proms = len(working)
        n_slots = len(store_slots)
        n_cols = n_slots + n_proms  # extra Off columns

        score = np.zeros((n_proms, n_cols), dtype=float)

        for i, p in enumerate(working):
            pid = p['id']
            fname = first_name(p['name'])
            has_must = bool(must.get(pid))

            # Check if extra constraint forces this promoter to a specific store today
            forced_store = extra.promoter_day_store.get((fname, day_name))

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
                # Extra bonus if forced to this store (guarantee selection)
                if forced_store and sc == forced_store:
                    bonus += global_mean * 10
                score[i, j] = base + bonus

        # Hungarian algorithm
        row_ind, col_ind = linear_sum_assignment(-score)

        day_map: dict[str, str] = {}
        for i, j in zip(row_ind, col_ind):
            pid = working[i]['id']
            day_map[pid] = store_slots[j] if j < n_slots and score[i, j] > INFEASIBLE / 2 else 'Off'

        # Resolve conflicts
        for pair in conflict_pairs:
            pid_a, pid_b = tuple(pair)
            sc_a = day_map.get(pid_a, 'Off')
            sc_b = day_map.get(pid_b, 'Off')
            if sc_a != 'Off' and sc_a == sc_b:
                s_a = perf.get((pid_a, sc_a), fallback_score)
                s_b = perf.get((pid_b, sc_b), fallback_score)
                loser = pid_a if s_a <= s_b else pid_b
                day_map[loser] = 'Off'

        # Enforce store_min_people: if a store has fewer than min, try to add more
        store_count: dict[str, int] = defaultdict(int)
        for sc in day_map.values():
            if sc != 'Off':
                store_count[sc] += 1
        for store_code, min_n in extra.store_min_people.items():
            current = store_count.get(store_code, 0)
            if current < min_n:
                # Find Off promoters who can go to this store
                shortage = min_n - current
                candidates = [
                    p for p in working
                    if day_map.get(p['id'], 'Off') == 'Off'
                    and store_code not in banned.get(p['id'], set())
                    and (not must.get(p['id']) or store_code in must.get(p['id'], set()))
                ]
                candidates.sort(
                    key=lambda p: perf.get((p['id'], store_code), fallback_score),
                    reverse=True,
                )
                for p in candidates[:shortage]:
                    day_map[p['id']] = store_code

        # Build time ranges
        def build_time_range(pid: str, sc: str) -> str | None:
            fname = pid_to_fname.get(pid, '')
            open_t, close_t = store_times.get(sc, ('10:00', '22:00'))
            end_override = extra.promoter_end_time.get(fname)
            if end_override:
                return f"{open_t}-{end_override}"
            return None  # use store default (app will fill it in)

        # Expected revenue this day
        day_rev = 0.0
        breakdown: list[dict] = []
        for pid, sc in day_map.items():
            if sc == 'Off':
                continue
            rev = perf.get((pid, sc), fallback_score)
            day_rev += rev
            pname = next((p['name'] for p in active_promoters if p['id'] == pid), pid)
            breakdown.append({'promoter': pname, 'store': sc, 'expected_aed': round(rev)})

        breakdown.sort(key=lambda x: -x['expected_aed'])
        total_expected += day_rev

        if verbose:
            print(f"\n{date_str} ({day_name}) — expected {day_rev:,.0f} AED", file=sys.stderr)
            for b in breakdown:
                print(f"  {b['promoter']:<22} → {b['store']:>5}   {b['expected_aed']:>7,} AED", file=sys.stderr)

        # Emit assignments
        working_ids = {p['id'] for p in working}
        for p in active_promoters:
            if p['id'] in working_ids:
                sc = day_map.get(p['id'], 'Off')
            else:
                sc = 'Off'
            entry: dict = {'promoterId': p['id'], 'date': date_str, 'store': sc}
            if sc != 'Off':
                tr = build_time_range(p['id'], sc)
                if tr:
                    entry['timeRange'] = tr
            assignments.append(entry)

        daily_summary.append({
            'date': date_str,
            'day': day_name,
            'expected_aed': round(day_rev),
            'assigned_count': len(breakdown),
            'breakdown': breakdown,
        })

    # Print revenue table
    print(f"\n{'─'*52}", file=sys.stderr)
    print(f"{'Date':<12} {'Day':<5} {'People':>6}  {'Expected (AED)':>14}", file=sys.stderr)
    print(f"{'─'*52}", file=sys.stderr)
    for ds in daily_summary:
        print(
            f"{ds['date']:<12} {ds['day']:<5} {ds['assigned_count']:>6}  {ds['expected_aed']:>14,}",
            file=sys.stderr,
        )
    print(f"{'─'*52}", file=sys.stderr)
    print(f"{'TOTAL':<12} {'':<5} {'':<6}  {total_expected:>14,.0f}", file=sys.stderr)
    print(f"{'─'*52}\n", file=sys.stderr)

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
        description='Optimize shift assignments to maximize expected revenue',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--start', required=True, metavar='YYYY-MM-DD')
    parser.add_argument('--end', required=True, metavar='YYYY-MM-DD')
    parser.add_argument('--output', default=None, metavar='FILE',
                        help='Write JSON output to file (default: stdout)')
    parser.add_argument('--lookback', type=int, default=90,
                        help='Days of order history for scoring (default: 90)')
    parser.add_argument('--constraints', default=None, metavar='TEXT',
                        help='Additional constraints text (same as Auto Assign textarea)')
    parser.add_argument('--constraints-file', default=None, metavar='FILE',
                        help='Load constraints from a text file')
    parser.add_argument('--constraints-json', default=None, metavar='JSON',
                        help='Pre-parsed constraints JSON (from Auto Assign UI Parse button)')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Print per-day assignment breakdown')
    parser.add_argument('--show-matrix', action='store_true',
                        help='Print the promoter-store performance matrix')
    args = parser.parse_args()

    url = os.environ.get('VITE_SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    key = (
        os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or
        os.environ.get('VITE_SUPABASE_ANON_KEY') or
        os.environ.get('SUPABASE_ANON_KEY')
    )
    if not url or not key:
        print(
            "ERROR: Missing Supabase credentials.\n"
            "Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env",
            file=sys.stderr,
        )
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
    print(f"Auto-Assign Optimizer", file=sys.stderr)
    print(f"  Period  : {args.start} → {args.end} ({len(target_dates)} days)", file=sys.stderr)
    print(f"  Lookback: {args.lookback} days (since {lookback_from})", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)

    # ── Load extra constraints text ──────────────────────────────────────────
    constraint_text = ''
    if args.constraints_file:
        constraint_text = Path(args.constraints_file).read_text(encoding='utf-8')
        print(f"\nLoaded constraints from: {args.constraints_file}", file=sys.stderr)
    elif args.constraints:
        constraint_text = args.constraints
    if constraint_text:
        print(f"\nConstraints text:\n{constraint_text}", file=sys.stderr)

    # ── Fetch data ───────────────────────────────────────────────────────────
    print("\nFetching data from Supabase…", file=sys.stderr)
    promoters = fetch_all(sb, 'promoters')
    stores = fetch_all(sb, 'stores')
    preferences_raw = fetch_all(sb, 'promoter_store_preferences')
    conflicts_raw = fetch_all(sb, 'promoter_conflicts')

    print(
        f"  Promoters: {sum(1 for p in promoters if p.get('active'))} active / {len(promoters)} total",
        file=sys.stderr,
    )
    print(
        f"  Stores   : {sum(1 for s in stores if s.get('active'))} active / {len(stores)} total",
        file=sys.stderr,
    )

    print(f"\nFetching orders since {lookback_from}…", file=sys.stderr)
    orders = fetch_all(
        sb, 'orders',
        query='date,salesperson,warehouse,platform,amount_aed,status',
        filters=[('date', 'gte', lookback_from)],
    )
    print(f"  {len(orders)} orders loaded", file=sys.stderr)

    # ── Resolve store_id → store_code ────────────────────────────────────────
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

    # ── Performance matrix ───────────────────────────────────────────────────
    print("\nBuilding performance matrix…", file=sys.stderr)
    perf = build_performance_matrix(orders, promoters, stores)
    print(f"  {len(perf)} (promoter, store) score pairs", file=sys.stderr)

    if len(perf) == 0:
        print(
            "  WARNING: No performance data. Check salesperson names match promoter names,\n"
            "  and orders have warehouse/platform fields. Using equal scores.",
            file=sys.stderr,
        )

    if args.show_matrix:
        print_performance_summary(perf, promoters, stores)

    # ── Parse extra constraints ──────────────────────────────────────────────
    print("\nParsing constraints…", file=sys.stderr)
    if args.constraints_json:
        try:
            cj = json.loads(args.constraints_json)
            extra = load_constraints_from_json(cj)
            print("  Loaded pre-parsed constraints from --constraints-json", file=sys.stderr)
        except (json.JSONDecodeError, KeyError) as e:
            print(f"  WARNING: Failed to parse --constraints-json: {e}. Falling back to text.", file=sys.stderr)
            extra = parse_extra_constraints(constraint_text, stores)
    else:
        extra = parse_extra_constraints(constraint_text, stores)

    # ── Run optimizer ────────────────────────────────────────────────────────
    print("\nRunning optimizer…", file=sys.stderr)
    assignments, daily_summary = run_optimizer(
        target_dates, promoters, stores,
        preferences, conflicts, perf, extra,
        verbose=args.verbose,
    )

    # ── Output ───────────────────────────────────────────────────────────────
    output_data = {
        'assignments': assignments,
        'revenue_forecast': daily_summary,
        'total_expected_aed': sum(d['expected_aed'] for d in daily_summary),
        'period': {'start': args.start, 'end': args.end, 'days': len(target_dates)},
    }
    output_json = json.dumps(output_data, indent=2, ensure_ascii=False)

    if args.output:
        Path(args.output).write_text(output_json, encoding='utf-8')
        print(f"Saved to: {args.output}", file=sys.stderr)
        print(f"  → assignments    : {len(assignments)} rows", file=sys.stderr)
        print(f"  → revenue_forecast: {len(daily_summary)} days", file=sys.stderr)
        print(f"  → total_expected : {output_data['total_expected_aed']:,} AED", file=sys.stderr)
    else:
        print(output_json)

    print("\nDone.", file=sys.stderr)


if __name__ == '__main__':
    main()
