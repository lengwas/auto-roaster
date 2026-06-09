#!/usr/bin/env python3
"""
Import shifts from UAE PC Shift Table (wide-matrix CSV) into Supabase shifts table.

CSV format (PC store table):
  Row 1: Y/M header  (e.g. 24/02, 24/03 …)
  Row 2: Day-of-month (e.g. 27, 28, 01 …)
  Row 3: Day name    (TUE, WED …)
  Row 4+: Store rows then Promoter rows
  Promoter rows: col 6 = TRUE / FALSE (Active flag)
    col 0: RANK  col 1: Name  col 2: Location  col 3: Off-day
    col 7+: shift value per date  e.g. "VDM 10.00-19.00", "Off", "SL"

Usage:
    python scripts/import_shifts_csv.py --file "🇦🇪UAE PC Shift Table 🇦🇪 - PC store table.csv"
    python scripts/import_shifts_csv.py --file ... --dry-run
    python scripts/import_shifts_csv.py --file ... --from 2026-01-01
    python scripts/import_shifts_csv.py --file ... --from 2025-01-01 --to 2026-05-31
"""

import argparse
import csv
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Optional

try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / '.env'
    if env_path.exists():
        load_dotenv(env_path)
        print(f"Loaded env from {env_path}", file=sys.stderr)
except ImportError:
    pass

try:
    from supabase import create_client
except ImportError:
    print("ERROR: supabase-py not installed. Run: pip install supabase", file=sys.stderr)
    sys.exit(1)

# ── Column indices ───────────────────────────────────────────────────────────
COL_RANK   = 0
COL_NAME   = 1   # promoter short name  e.g. "Tammy Bo"
COL_LOC    = 2   # location / team
COL_OFFDAY = 3   # off-day note (irrelevant for import)
COL_ACTIVE = 6   # "TRUE" or "FALSE"
DATA_START = 7   # first date column

# Special shift codes with no time_range
LEAVE_CODES = {'Off', 'OFF', 'off', 'AL', 'SL', 'LOP', 'AIR'}

# Regex: "VDM 10.00-19.00"  or  "JDH 13:00-22:00"  or  "VME"
SHIFT_RE = re.compile(
    r'^(?P<code>[A-Za-z]{2,5})'          # store/leave code
    r'(?:\s+(?P<time>\d+[:.]\d+\s*-\s*\d+[:.]\d+))?'  # optional time range
    r'\s*$'
)


# ── Name matching ────────────────────────────────────────────────────────────
def normalize(s: str) -> str:
    return s.strip().lower()


def build_name_map(promoters: list[dict]) -> dict[str, str]:
    """Build lookup keys: full name, first name, 'First XX' (first 2 chars of last)."""
    m: dict[str, str] = {}
    for p in promoters:
        full = p['name'].strip()
        pid  = p['id']
        m[normalize(full)] = pid
        parts = full.split()
        if parts:
            m[normalize(parts[0])] = pid
        if len(parts) >= 2:
            m[normalize(f"{parts[0]} {parts[1][:2]}")] = pid
    return m


def match_name(raw: str, name_map: dict[str, str]) -> Optional[str]:
    key = normalize(raw)
    if key in name_map:
        return name_map[key]
    first = key.split()[0] if key else ''
    if first and first in name_map:
        return name_map[first]
    parts = key.split()
    if len(parts) >= 2:
        short = f"{parts[0]} {parts[1][:2]}"
        if short in name_map:
            return name_map[short]
    return None


# ── Shift value parsing ──────────────────────────────────────────────────────
def parse_shift(raw: str) -> Optional[tuple[str, Optional[str]]]:
    """
    Returns (shift_type, time_range) or None if cell should be skipped.
    e.g.  "VDM 10.00-19.00"  → ("VDM", "10.00-19.00")
          "Off"               → ("Off", None)
          ""                  → None  (skip)
    """
    val = raw.strip()
    if not val:
        return None
    m = SHIFT_RE.match(val)
    if not m:
        # Could be a holiday label, numeric count, or garbage — skip
        return None
    code = m.group('code')
    time = m.group('time')
    if time:
        time = time.strip()
    return (code, time)


# ── CSV parsing ──────────────────────────────────────────────────────────────
def parse_csv(path: Path) -> tuple[list[tuple[int, str]], list[dict]]:
    """
    Returns:
      dates     — list of (col_index, 'YYYY-MM-DD')
      promoters — list of {'name': str, 'row': list}
    """
    with open(path, encoding='utf-8-sig') as f:
        rows = list(csv.reader(f))

    ym_row = rows[0]  # row 1: Y/M
    d_row  = rows[1]  # row 2: day of month

    # Build date → column index map
    dates: list[tuple[int, str]] = []
    for i in range(DATA_START, len(ym_row)):
        ym = ym_row[i].strip()
        d  = d_row[i].strip()
        if not ym or not d:
            continue
        try:
            yr = int('20' + ym[:2])
            mo = int(ym[3:5])
            dy = int(d)
            dt = date(yr, mo, dy).isoformat()
            dates.append((i, dt))
        except (ValueError, IndexError):
            continue

    # Collect promoter rows (col 6 = TRUE / FALSE, col 1 = non-empty name)
    promoters: list[dict] = []
    for r in rows[3:]:   # skip header rows 1–3
        if len(r) <= COL_ACTIVE:
            continue
        active = r[COL_ACTIVE].strip().upper()
        name   = r[COL_NAME].strip()
        if active in ('TRUE', 'FALSE') and name and name not in ('Team', 'Shift', 'Name'):
            promoters.append({'name': name, 'row': r})

    return dates, promoters


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Import UAE PC shift CSV into Supabase')
    parser.add_argument('--file', required=True, metavar='PATH',
                        help='Path to CSV file (PC store table)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Parse only, do not write to DB')
    parser.add_argument('--from', dest='from_date', default=None, metavar='YYYY-MM-DD',
                        help='Import rows on or after this date')
    parser.add_argument('--to', dest='to_date', default=None, metavar='YYYY-MM-DD',
                        help='Import rows on or before this date')
    parser.add_argument('--batch', type=int, default=200,
                        help='Upsert batch size (default: 200)')
    args = parser.parse_args()

    csv_path = Path(args.file)
    if not csv_path.exists():
        print(f"ERROR: File not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    from_dt: Optional[date] = date.fromisoformat(args.from_date) if args.from_date else None
    to_dt:   Optional[date] = date.fromisoformat(args.to_date)   if args.to_date   else None

    # ── Supabase setup ───────────────────────────────────────────────────────
    url = os.environ.get('VITE_SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    key = (
        os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or
        os.environ.get('VITE_SUPABASE_ANON_KEY') or
        os.environ.get('SUPABASE_ANON_KEY')
    )
    if not url or not key:
        print("ERROR: Missing Supabase credentials. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env",
              file=sys.stderr)
        sys.exit(1)

    sb = create_client(url, key)

    # ── Fetch promoters ──────────────────────────────────────────────────────
    print("Fetching promoters from Supabase…", file=sys.stderr)
    db_promoters = (
        sb.from_('promoters')
          .select('id,name')
          .eq('country', 'UAE')
          .execute()
          .data or []
    )
    print(f"  {len(db_promoters)} UAE promoters loaded", file=sys.stderr)
    name_map = build_name_map(db_promoters)

    # ── Parse CSV ────────────────────────────────────────────────────────────
    print(f"Parsing {csv_path.name}…", file=sys.stderr)
    dates, promo_rows = parse_csv(csv_path)
    print(f"  {len(dates)} date columns  ({dates[0][1]} → {dates[-1][1]})", file=sys.stderr)
    print(f"  {len(promo_rows)} promoter rows", file=sys.stderr)

    # ── Build records ────────────────────────────────────────────────────────
    records:      list[dict] = []
    skipped_name: list[str]  = []
    skipped_date: int        = 0
    skipped_empty: int       = 0
    skipped_parse: int       = 0

    for promo in promo_rows:
        name = promo['name']
        row  = promo['row']

        pid = match_name(name, name_map)
        if not pid:
            skipped_name.append(name)
            continue

        for col_idx, date_str in dates:
            # Date filter
            dt = date.fromisoformat(date_str)
            if from_dt and dt < from_dt:
                skipped_date += 1
                continue
            if to_dt and dt > to_dt:
                skipped_date += 1
                continue

            raw = row[col_idx].strip() if col_idx < len(row) else ''
            if not raw:
                skipped_empty += 1
                continue

            parsed = parse_shift(raw)
            if parsed is None:
                skipped_parse += 1
                continue

            shift_type, time_range = parsed
            records.append({
                'promoter_id': pid,
                'date':        date_str,
                'shift_type':  shift_type,
                'time_range':  time_range,
                'country':     'UAE',
            })

    print(f"\nParsed: {len(records)} valid shift records", file=sys.stderr)
    if skipped_date:
        print(f"  Skipped (date filter):  {skipped_date}", file=sys.stderr)
    if skipped_empty:
        print(f"  Skipped (empty cell):   {skipped_empty}", file=sys.stderr)
    if skipped_parse:
        print(f"  Skipped (unparseable):  {skipped_parse}", file=sys.stderr)
    if skipped_name:
        unique_missing = sorted(set(skipped_name))
        print(f"  Skipped (name not found in DB): {len(skipped_name)} rows — {unique_missing}",
              file=sys.stderr)

    if not records:
        print("Nothing to import.", file=sys.stderr)
        sys.exit(0)

    if args.dry_run:
        print("\n[DRY RUN] Sample records:", file=sys.stderr)
        for r in records[:10]:
            print(f"  {r}", file=sys.stderr)
        print(f"\n[DRY RUN] Would upsert {len(records)} rows. Remove --dry-run to write.",
              file=sys.stderr)
        sys.exit(0)

    # ── Upsert in batches ────────────────────────────────────────────────────
    print(f"\nUpserting {len(records)} rows in batches of {args.batch}…", file=sys.stderr)
    total_ok  = 0
    total_err = 0

    for start in range(0, len(records), args.batch):
        batch  = records[start:start + args.batch]
        result = sb.from_('shifts').upsert(
            batch,
            on_conflict='promoter_id,date'
        ).execute()
        if hasattr(result, 'data') and result.data is not None:
            total_ok += len(batch)
        else:
            total_err += len(batch)
            print(f"  ERROR in batch {start}–{start+len(batch)}: {result}", file=sys.stderr)

        done = min(start + args.batch, len(records))
        print(f"  {done}/{len(records)} rows processed…", file=sys.stderr)

    print(f"\nDone. {total_ok} rows upserted, {total_err} errors.", file=sys.stderr)


if __name__ == '__main__':
    main()
