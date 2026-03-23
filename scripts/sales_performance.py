#!/usr/bin/env python3
"""
Sales Performance Analyzer — Day-Normalized Scoring
=====================================================
Calculates per-promoter, per-store average daily revenue with day-of-week
and UAE public holiday normalization.

Key features:
  - Includes zero-sales shift days in the denominator (realistic average)
  - Normalizes weekend/holiday revenue to weekday-equivalent baseline
    so that a promoter who only works weekends is fairly compared against
    one who works weekdays
  - Outputs both raw and normalized scores

Day-factor logic:
  actual_revenue / day_factor = normalized_revenue
  → A high weekend factor (e.g. 1.5) means 1500 AED on Saturday is treated
    as 1000 AED weekday-equivalent.  This removes the "weekend bonus" so
    we compare promoters by their actual selling skill, not traffic luck.

Usage:
    python scripts/sales_performance.py --lookback 90
    python scripts/sales_performance.py --lookback 90 --output scores.json
    python scripts/sales_performance.py --lookback 90 --verbose

Requirements:
    pip install supabase python-dotenv
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

# ── Load .env ────────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / '.env'
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

try:
    from supabase import create_client, Client
except ImportError:
    print("ERROR: supabase-py not installed. Run: pip install supabase", file=sys.stderr)
    sys.exit(1)


# ── Warehouse → store code mapping ──────────────────────────────────────────
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

EXCLUDED_STATUSES = {'cancelled', 'returned', 'cancel', 'void'}


# ── Day-of-week traffic factors ─────────────────────────────────────────────
# Revenue on these days is divided by the factor to get weekday-equivalent.
# Example: 1500 AED on Friday / 1.3 = 1154 AED normalized
#
# Rationale (UAE mall traffic patterns):
#   Mon-Thu: baseline weekday traffic          → factor 1.0
#   Fri:     Islamic weekend, higher traffic    → factor 1.3
#   Sat:     full weekend day, high traffic     → factor 1.5
#   Sun:     still elevated traffic in UAE      → factor 1.2
#
# These factors are configurable via --day-factors flag.
DEFAULT_DAY_FACTORS: dict[int, float] = {
    0: 1.0,   # Monday
    1: 1.0,   # Tuesday
    2: 1.0,   # Wednesday
    3: 1.0,   # Thursday
    4: 1.3,   # Friday  (UAE weekend)
    5: 1.5,   # Saturday (UAE weekend peak)
    6: 1.2,   # Sunday  (still elevated)
}

# ── Store Tier (auto-calculated from total revenue) ──────────────────────────
# Tier determines priority: promoter ที่เก่งที่สุดจะถูกจัดลงห้าง tier สูงก่อน
# Tiers are computed automatically from historical total revenue per store:
#   Tier 1 (S): top 20% stores by revenue   → must have best promoters
#   Tier 2 (A): next 30%                     → strong promoters
#   Tier 3 (B): next 30%                     → solid promoters
#   Tier 4 (C): bottom 20%                   → anyone available
# Can be overridden via --store-tiers JSON
TIER_LABELS = ['S', 'A', 'B', 'C']
TIER_PERCENTILES = [0.20, 0.50, 0.80, 1.0]  # cumulative breakpoints


def compute_store_tiers(
    orders: list[dict],
    stores: list[dict],
    wh_map: dict[str, str],
    pl_map: dict[str, str],
) -> dict[str, dict]:
    """Auto-rank stores by total revenue → assign tier S/A/B/C."""
    store_rev: dict[str, float] = defaultdict(float)
    for order in orders:
        if (order.get('status') or '').lower() in EXCLUDED_STATUSES:
            continue
        amount = float(order.get('amount_aed') or 0)
        wh = (order.get('warehouse') or '').strip().lower()
        pl = (order.get('platform') or '').strip().lower()
        sc = wh_map.get(wh) or pl_map.get(pl)
        if sc:
            store_rev[sc] += amount

    # Sort stores by revenue descending
    active_codes = {s['code'] for s in stores if s.get('active', True)}
    ranked = sorted(
        [(sc, rev) for sc, rev in store_rev.items() if sc in active_codes],
        key=lambda x: x[1],
        reverse=True,
    )
    # Also add active stores with zero revenue
    seen = {sc for sc, _ in ranked}
    for s in stores:
        if s.get('active', True) and s['code'] not in seen:
            ranked.append((s['code'], 0.0))

    total = len(ranked)
    result: dict[str, dict] = {}
    for i, (sc, rev) in enumerate(ranked):
        pct = (i + 1) / total if total > 0 else 1.0
        tier_idx = next(j for j, bp in enumerate(TIER_PERCENTILES) if pct <= bp)
        result[sc] = {
            'store_code': sc,
            'tier': TIER_LABELS[tier_idx],
            'tier_rank': i + 1,
            'total_revenue': round(rev, 2),
        }

    return result


# ── UAE Public Holidays 2025-2026 ────────────────────────────────────────────
# These dates get an additional traffic multiplier on top of the day-of-week
# factor.  holiday_factor * day_factor = total normalization factor.
UAE_HOLIDAYS: dict[str, str] = {
    # 2025
    '2025-01-01': 'New Year',
    '2025-01-13': 'Isra & Miraj (approx)',
    '2025-03-30': 'Eid al-Fitr (approx)',
    '2025-03-31': 'Eid al-Fitr (approx)',
    '2025-04-01': 'Eid al-Fitr (approx)',
    '2025-06-06': 'Eid al-Adha (approx)',
    '2025-06-07': 'Eid al-Adha (approx)',
    '2025-06-08': 'Eid al-Adha (approx)',
    '2025-06-26': 'Islamic New Year (approx)',
    '2025-09-04': 'Prophet Birthday (approx)',
    '2025-12-01': 'Commemoration Day',
    '2025-12-02': 'National Day',
    '2025-12-03': 'National Day',
    # 2026
    '2026-01-01': 'New Year',
    '2026-03-20': 'Eid al-Fitr (approx)',
    '2026-03-21': 'Eid al-Fitr (approx)',
    '2026-03-22': 'Eid al-Fitr (approx)',
    '2026-05-27': 'Eid al-Adha (approx)',
    '2026-05-28': 'Eid al-Adha (approx)',
    '2026-05-29': 'Eid al-Adha (approx)',
    '2026-06-16': 'Islamic New Year (approx)',
    '2026-08-25': 'Prophet Birthday (approx)',
    '2026-12-01': 'Commemoration Day',
    '2026-12-02': 'National Day',
    '2026-12-03': 'National Day',
}

DEFAULT_HOLIDAY_FACTOR = 1.4  # holidays get 40% more traffic than base

# ── Newbie factor (Bayesian shrinkage) ───────────────────────────────────────
# Promoters with fewer than `min_days` of data get their score pulled toward
# the global average.  This prevents a lucky 2-day streak from ranking #1.
#
# Formula:  adjusted = (n * personal + min_days * global) / (n + min_days)
#
#   n=7,  min_days=30 → personal weight = 7/37  = 19%  (mostly global)
#   n=30, min_days=30 → personal weight = 30/60 = 50%  (balanced)
#   n=90, min_days=30 → personal weight = 90/120= 75%  (trust personal)
DEFAULT_NEWBIE_MIN_DAYS = 30


# ── Helpers ──────────────────────────────────────────────────────────────────

def first_name(full: str) -> str:
    return full.strip().split()[0].lower()


def match_name(salesperson: str, name_map: dict[str, str]) -> str | None:
    sp = (salesperson or '').strip().lower()
    if not sp:
        return None
    if sp in name_map:
        return name_map[sp]
    fn = sp.split()[0]
    return name_map.get(fn)


def get_day_factor(d: date, day_factors: dict[int, float], holiday_factor: float) -> float:
    """Return the combined normalization factor for a given date."""
    base = day_factors.get(d.weekday(), 1.0)
    if d.isoformat() in UAE_HOLIDAYS:
        return base * holiday_factor
    return base


WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']


# ── Supabase fetch ───────────────────────────────────────────────────────────

def fetch_all(sb: Client, table: str, query: str = '*',
              filters: list[tuple] | None = None) -> list[dict]:
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


# ── Core: build normalized performance matrix ────────────────────────────────

def build_normalized_performance(
    orders: list[dict],
    promoters: list[dict],
    stores: list[dict],
    shifts: list[dict],
    day_factors: dict[int, float],
    holiday_factor: float,
    newbie_min_days: int = DEFAULT_NEWBIE_MIN_DAYS,
) -> dict:
    """
    Returns {
        (promoter_id, store_code): {
            'raw_avg': float,           # simple average daily revenue
            'normalized_avg': float,    # weekday-equivalent average
            'total_revenue': float,
            'work_days': int,           # total days worked (incl zero-sale)
            'sale_days': int,           # days with actual sales
            'zero_days': int,           # days at store but no sales
            'day_breakdown': {          # per-day-of-week stats
                'Mon': {'days': N, 'revenue': X, 'normalized': Y},
                ...
            }
        }
    }
    """
    # ── Name → promoter ID mapping ───────────────────────────────────────
    name_map: dict[str, str] = {}
    pid_name: dict[str, str] = {}
    for p in promoters:
        name_map[p['name'].lower()] = p['id']
        name_map.setdefault(first_name(p['name']), p['id'])
        pid_name[p['id']] = p['name']

    # ── Warehouse/platform → store code mapping ──────────────────────────
    wh_map: dict[str, str] = dict(WAREHOUSE_MAP)
    pl_map: dict[str, str] = {}
    for s in stores:
        if s.get('warehouse'):
            wh_map[s['warehouse'].lower()] = s['code']
        if s.get('platform'):
            pl_map[s['platform'].lower()] = s['code']

    # ── Aggregate order revenue per (pid, store, date) ───────────────────
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

    # ── Build shift-based worked days set ────────────────────────────────
    valid_codes = {s['code'] for s in stores}
    worked_days: dict[tuple[str, str], set[str]] = defaultdict(set)
    for sh in shifts:
        pid = str(sh.get('promoter_id') or '')
        sc = str(sh.get('shift_type') or '').upper()
        d = str(sh.get('date') or '')
        if pid and sc and d and sc in valid_codes:
            worked_days[(pid, sc)].add(d)

    # ── Also add order dates to worked_days ──────────────────────────────
    for (pid, sc, d) in daily_rev:
        if d:
            worked_days[(pid, sc)].add(d)

    # ── Calculate per-pair metrics ───────────────────────────────────────
    result: dict[tuple[str, str], dict] = {}

    for (pid, sc), all_dates in worked_days.items():
        total_raw = 0.0
        total_normalized = 0.0
        sale_days = 0
        day_breakdown: dict[str, dict] = {
            dn: {'days': 0, 'revenue': 0.0, 'normalized': 0.0}
            for dn in WEEKDAY_NAMES
        }

        for d_str in sorted(all_dates):
            try:
                d = date.fromisoformat(d_str)
            except ValueError:
                continue

            rev = daily_rev.get((pid, sc, d_str), 0.0)
            factor = get_day_factor(d, day_factors, holiday_factor)
            normalized_rev = rev / factor

            total_raw += rev
            total_normalized += normalized_rev
            if rev > 0:
                sale_days += 1

            dn = WEEKDAY_NAMES[d.weekday()]
            day_breakdown[dn]['days'] += 1
            day_breakdown[dn]['revenue'] += rev
            day_breakdown[dn]['normalized'] += normalized_rev

        n_days = len(all_dates)
        if n_days == 0:
            continue

        result[(pid, sc)] = {
            'promoter_id': pid,
            'promoter_name': pid_name.get(pid, '?'),
            'store_code': sc,
            'raw_avg': round(total_raw / n_days, 2),
            'normalized_avg': round(total_normalized / n_days, 2),
            'total_revenue': round(total_raw, 2),
            'total_normalized': round(total_normalized, 2),
            'work_days': n_days,
            'sale_days': sale_days,
            'zero_days': n_days - sale_days,
            'day_breakdown': {
                dn: {
                    'days': v['days'],
                    'revenue': round(v['revenue'], 2),
                    'normalized': round(v['normalized'], 2),
                    'avg': round(v['revenue'] / v['days'], 2) if v['days'] > 0 else 0,
                    'avg_normalized': round(v['normalized'] / v['days'], 2) if v['days'] > 0 else 0,
                }
                for dn, v in day_breakdown.items()
                if v['days'] > 0
            },
        }

    # ── Newbie adjustment (Bayesian shrinkage) ───────────────────────────
    # Compute global average normalized daily revenue across all pairs
    if result and newbie_min_days > 0:
        all_norm_avgs = [e['normalized_avg'] for e in result.values() if e['work_days'] > 0]
        global_avg = sum(all_norm_avgs) / len(all_norm_avgs) if all_norm_avgs else 0

        for entry in result.values():
            n = entry['work_days']
            personal = entry['normalized_avg']
            # Bayesian: (n * personal + min_days * global) / (n + min_days)
            adjusted = (n * personal + newbie_min_days * global_avg) / (n + newbie_min_days)
            confidence = n / (n + newbie_min_days)  # 0→1, how much we trust personal score

            entry['adjusted_avg'] = round(adjusted, 2)
            entry['confidence'] = round(confidence, 2)
            entry['is_newbie'] = n < newbie_min_days
            entry['global_avg'] = round(global_avg, 2)

    return result


# ── CLI Entry Point ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='Analyze sales performance with day-of-week normalization',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Day factors (default):
  Mon-Thu: 1.0  (baseline)
  Fri:     1.3  (UAE weekend)
  Sat:     1.5  (peak weekend)
  Sun:     1.2  (elevated)
  Holiday: ×1.4 (on top of day factor)

Example:
  python scripts/sales_performance.py --lookback 90 --verbose
  python scripts/sales_performance.py --lookback 90 --day-factors '{"4":1.4,"5":1.6,"6":1.3}'
""",
    )
    parser.add_argument('--lookback', type=int, default=90,
                        help='Days of history to analyze (default: 90)')
    parser.add_argument('--output', default=None, metavar='FILE',
                        help='Write JSON output to file (default: stdout)')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Print detailed per-promoter breakdown')
    parser.add_argument('--day-factors', default=None, metavar='JSON',
                        help='Override day-of-week factors as JSON, e.g. \'{"4":1.4,"5":1.6}\'')
    parser.add_argument('--holiday-factor', type=float, default=DEFAULT_HOLIDAY_FACTOR,
                        help=f'Holiday traffic multiplier (default: {DEFAULT_HOLIDAY_FACTOR})')
    parser.add_argument('--newbie-days', type=int, default=DEFAULT_NEWBIE_MIN_DAYS,
                        help=f'Min days for full confidence; fewer → score pulled to global avg (default: {DEFAULT_NEWBIE_MIN_DAYS})')
    parser.add_argument('--top', type=int, default=0,
                        help='Show only top N promoters per store')
    args = parser.parse_args()

    # ── Day factors ──────────────────────────────────────────────────────
    day_factors = dict(DEFAULT_DAY_FACTORS)
    if args.day_factors:
        overrides = json.loads(args.day_factors)
        for k, v in overrides.items():
            day_factors[int(k)] = float(v)

    # ── Supabase connection ──────────────────────────────────────────────
    url = os.environ.get('VITE_SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    key = (
        os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or
        os.environ.get('VITE_SUPABASE_ANON_KEY') or
        os.environ.get('SUPABASE_ANON_KEY')
    )
    if not url or not key:
        print("ERROR: Missing Supabase credentials. Set VITE_SUPABASE_URL in .env",
              file=sys.stderr)
        sys.exit(1)

    sb: Client = create_client(url, key)
    lookback_from = (date.today() - timedelta(days=args.lookback)).isoformat()

    # ── Fetch data ───────────────────────────────────────────────────────
    print(f"Fetching data (lookback: {args.lookback} days from {lookback_from})…",
          file=sys.stderr)

    promoters = fetch_all(sb, 'promoters')
    stores = fetch_all(sb, 'stores')
    orders = fetch_all(
        sb, 'orders',
        query='date,salesperson,warehouse,platform,amount_aed,status',
        filters=[('date', 'gte', lookback_from)],
    )
    shifts = fetch_all(
        sb, 'shifts',
        query='promoter_id,date,shift_type',
        filters=[('date', 'gte', lookback_from)],
    )

    print(f"  {len(promoters)} promoters, {len(stores)} stores", file=sys.stderr)
    print(f"  {len(orders)} orders, {len(shifts)} shift records", file=sys.stderr)

    # ── Compute store tiers ──────────────────────────────────────────────
    wh_map: dict[str, str] = dict(WAREHOUSE_MAP)
    pl_map: dict[str, str] = {}
    for s in stores:
        if s.get('warehouse'):
            wh_map[s['warehouse'].lower()] = s['code']
        if s.get('platform'):
            pl_map[s['platform'].lower()] = s['code']

    store_tiers = compute_store_tiers(orders, stores, wh_map, pl_map)

    print(f"\n  Store Tiers (by total revenue):", file=sys.stderr)
    print(f"  {'Tier':<6} {'Store':<8} {'Revenue':>14}", file=sys.stderr)
    print(f"  {'─'*6} {'─'*8} {'─'*14}", file=sys.stderr)
    for sc in sorted(store_tiers, key=lambda x: store_tiers[x]['tier_rank']):
        st = store_tiers[sc]
        print(f"  {st['tier']:<6} {sc:<8} {st['total_revenue']:>14,.0f} AED", file=sys.stderr)

    # ── Build performance matrix ─────────────────────────────────────────
    print("\nBuilding normalized performance matrix…", file=sys.stderr)
    print(f"  Day factors: Mon={day_factors[0]} Tue={day_factors[1]} Wed={day_factors[2]} "
          f"Thu={day_factors[3]} Fri={day_factors[4]} Sat={day_factors[5]} Sun={day_factors[6]}",
          file=sys.stderr)
    print(f"  Holiday factor: {args.holiday_factor}", file=sys.stderr)
    print(f"  Newbie min days: {args.newbie_days} (fewer → score pulled to global avg)", file=sys.stderr)

    perf = build_normalized_performance(
        orders, promoters, stores, shifts,
        day_factors, args.holiday_factor,
        newbie_min_days=args.newbie_days,
    )

    if not perf:
        print("\n  WARNING: No performance data found.", file=sys.stderr)
        sys.exit(0)

    # ── Sort by adjusted average (descending) — newbie-penalized ranking ─
    sorted_pairs = sorted(perf.values(), key=lambda x: x.get('adjusted_avg', x['normalized_avg']), reverse=True)

    # ── Print summary ────────────────────────────────────────────────────
    print(f"\n{'='*80}", file=sys.stderr)
    print(f"  Performance Summary — {len(sorted_pairs)} promoter-store pairs", file=sys.stderr)
    print(f"{'='*80}", file=sys.stderr)

    # Group by store
    by_store: dict[str, list] = defaultdict(list)
    for entry in sorted_pairs:
        by_store[entry['store_code']].append(entry)

    # Sort stores by tier (S first) then alphabetically
    for sc in sorted(by_store, key=lambda x: (store_tiers.get(x, {}).get('tier_rank', 99), x)):
        entries = sorted(by_store[sc], key=lambda x: x.get('adjusted_avg', x['normalized_avg']), reverse=True)
        if args.top > 0:
            entries = entries[:args.top]
        tier_info = store_tiers.get(sc, {})
        tier_label = tier_info.get('tier', '?')
        print(f"\n  ── {sc} [Tier {tier_label}] ──", file=sys.stderr)
        print(f"  {'Promoter':<20} {'Adj Avg':>10} {'Norm Avg':>10} {'Days':>6} "
              f"{'Conf':>6} {'Sales':>6} {'Zero':>6} {'Total Rev':>12}", file=sys.stderr)
        print(f"  {'─'*20} {'─'*10} {'─'*10} {'─'*6} {'─'*6} {'─'*6} {'─'*6} {'─'*12}",
              file=sys.stderr)
        for e in entries:
            tag = ' NEW' if e.get('is_newbie') else ''
            print(
                f"  {e['promoter_name']:<20} "
                f"{e.get('adjusted_avg', e['normalized_avg']):>10,.0f} "
                f"{e['normalized_avg']:>10,.0f} "
                f"{e['work_days']:>6} "
                f"{e.get('confidence', 1.0):>5.0%} "
                f"{e['sale_days']:>6} "
                f"{e['zero_days']:>6} "
                f"{e['total_revenue']:>12,.0f}{tag}",
                file=sys.stderr,
            )

        if args.verbose and entries:
            # Show day-of-week breakdown for top performer
            top = entries[0]
            print(f"\n    Day breakdown for {top['promoter_name']}:", file=sys.stderr)
            for dn in WEEKDAY_NAMES:
                bd = top['day_breakdown'].get(dn)
                if bd:
                    factor = day_factors[WEEKDAY_NAMES.index(dn)]
                    print(
                        f"      {dn}: {bd['days']} days | "
                        f"avg {bd['avg']:,.0f} AED | "
                        f"normalized {bd['avg_normalized']:,.0f} AED "
                        f"(÷{factor:.1f})",
                        file=sys.stderr,
                    )

    # ── Overall promoter ranking (across all stores) ─────────────────────
    promoter_totals: dict[str, dict] = {}
    for entry in sorted_pairs:
        pid = entry['promoter_id']
        if pid not in promoter_totals:
            promoter_totals[pid] = {
                'name': entry['promoter_name'],
                'total_revenue': 0, 'total_normalized': 0,
                'work_days': 0, 'sale_days': 0,
                'is_newbie': entry.get('is_newbie', False),
            }
        t = promoter_totals[pid]
        t['total_revenue'] += entry['total_revenue']
        t['total_normalized'] += entry['total_normalized']
        t['work_days'] += entry['work_days']
        t['sale_days'] += entry['sale_days']
        if entry.get('is_newbie'):
            t['is_newbie'] = True

    # Apply newbie adjustment at overall level too
    newbie_min = args.newbie_days
    all_overall_avgs = [
        t['total_normalized'] / max(t['work_days'], 1) for t in promoter_totals.values()
    ]
    global_overall = sum(all_overall_avgs) / len(all_overall_avgs) if all_overall_avgs else 0

    for t in promoter_totals.values():
        days = max(t['work_days'], 1)
        norm_avg = t['total_normalized'] / days
        adj = (days * norm_avg + newbie_min * global_overall) / (days + newbie_min)
        t['adjusted_avg'] = round(adj, 2)
        t['confidence'] = round(days / (days + newbie_min), 2)

    print(f"\n{'='*80}", file=sys.stderr)
    print(f"  Overall Promoter Ranking (adjusted for newbie confidence)", file=sys.stderr)
    print(f"{'='*80}", file=sys.stderr)
    ranked = sorted(
        promoter_totals.values(),
        key=lambda x: x['adjusted_avg'],
        reverse=True,
    )
    print(f"  {'#':<4} {'Promoter':<20} {'Adj Avg':>10} {'Norm Avg':>10} "
          f"{'Days':>6} {'Conf':>6} {'Hit%':>6}", file=sys.stderr)
    print(f"  {'─'*4} {'─'*20} {'─'*10} {'─'*10} {'─'*6} {'─'*6} {'─'*6}", file=sys.stderr)
    for i, t in enumerate(ranked, 1):
        days = max(t['work_days'], 1)
        hit_pct = t['sale_days'] / days * 100
        tag = ' NEW' if t.get('is_newbie') else ''
        print(
            f"  {i:<4} {t['name']:<20} "
            f"{t['adjusted_avg']:>10,.0f} "
            f"{t['total_normalized']/days:>10,.0f} "
            f"{t['work_days']:>6} "
            f"{t['confidence']:>5.0%} "
            f"{hit_pct:>5.0f}%{tag}",
            file=sys.stderr,
        )

    # ── JSON output ──────────────────────────────────────────────────────
    output = {
        'config': {
            'lookback_days': args.lookback,
            'lookback_from': lookback_from,
            'day_factors': {WEEKDAY_NAMES[k]: v for k, v in day_factors.items()},
            'holiday_factor': args.holiday_factor,
            'newbie_min_days': args.newbie_days,
            'tier_percentiles': dict(zip(TIER_LABELS, TIER_PERCENTILES)),
            'holidays_in_range': [
                {'date': d, 'name': n}
                for d, n in sorted(UAE_HOLIDAYS.items())
                if d >= lookback_from
            ],
        },
        'store_tiers': [
            {
                'store_code': st['store_code'],
                'tier': st['tier'],
                'tier_rank': st['tier_rank'],
                'total_revenue': st['total_revenue'],
            }
            for st in sorted(store_tiers.values(), key=lambda x: x['tier_rank'])
        ],
        'per_store': [
            {
                'promoter_id': e['promoter_id'],
                'promoter_name': e['promoter_name'],
                'store_code': e['store_code'],
                'raw_avg': e['raw_avg'],
                'normalized_avg': e['normalized_avg'],
                'adjusted_avg': e.get('adjusted_avg', e['normalized_avg']),
                'confidence': e.get('confidence', 1.0),
                'is_newbie': e.get('is_newbie', False),
                'total_revenue': e['total_revenue'],
                'work_days': e['work_days'],
                'sale_days': e['sale_days'],
                'zero_days': e['zero_days'],
                'day_breakdown': e['day_breakdown'],
            }
            for e in sorted_pairs
        ],
        'overall_ranking': [
            {
                'promoter_name': t['name'],
                'adjusted_daily_avg': t['adjusted_avg'],
                'normalized_daily_avg': round(t['total_normalized'] / max(t['work_days'], 1), 2),
                'raw_daily_avg': round(t['total_revenue'] / max(t['work_days'], 1), 2),
                'confidence': t['confidence'],
                'is_newbie': t.get('is_newbie', False),
                'work_days': t['work_days'],
                'sale_days': t['sale_days'],
                'hit_rate': round(t['sale_days'] / max(t['work_days'], 1) * 100, 1),
            }
            for t in ranked
        ],
    }

    output_json = json.dumps(output, indent=2, ensure_ascii=False)
    if args.output:
        Path(args.output).write_text(output_json, encoding='utf-8')
        print(f"\nSaved to: {args.output}", file=sys.stderr)
    else:
        print(output_json)

    print("\nDone.", file=sys.stderr)


if __name__ == '__main__':
    main()
