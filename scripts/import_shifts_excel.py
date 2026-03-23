#!/usr/bin/env python3
"""
Import shifts from UAE_PC_Shift_Table_Flatten_All.xlsx into Supabase shifts table.

Usage:
    python scripts/import_shifts_excel.py --file /path/to/UAE_PC_Shift_Table_Flatten_All.xlsx
    python scripts/import_shifts_excel.py --file /path/to/file.xlsx --dry-run
    python scripts/import_shifts_excel.py --file /path/to/file.xlsx --from 2025-01-01

Excel columns: Date | Name | Store | Open shift | Closed shift
Supabase table: shifts (promoter_id, date, shift_type, time_range)
"""

import argparse
import os
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional

try:
    import openpyxl
except ImportError:
    print("ERROR: openpyxl not installed. Run: pip install openpyxl", file=sys.stderr)
    sys.exit(1)

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


def normalize_name(name: str) -> str:
    return name.strip().lower()


def build_name_map(promoters):
    """Build multiple lookup keys for each promoter: full name, first name, first+last initial."""
    m: dict[str, str] = {}
    for p in promoters:
        full = p['name'].strip()
        pid = p['id']
        m[normalize_name(full)] = pid
        parts = full.split()
        if parts:
            m[normalize_name(parts[0])] = pid  # first name only
        if len(parts) >= 2:
            # "First La" → match "First La" or "First L"
            m[normalize_name(f"{parts[0]} {parts[1][:2]}")] = pid
    return m


def match_name(raw: str, name_map: dict) -> Optional[str]:
    key = normalize_name(raw)
    if key in name_map:
        return name_map[key]
    # Try first word only
    first = key.split()[0] if key else ''
    if first and first in name_map:
        return name_map[first]
    # Try first two chars of second word
    parts = key.split()
    if len(parts) >= 2:
        short = f"{parts[0]} {parts[1][:2]}"
        if short in name_map:
            return name_map[short]
    return None


def main():
    parser = argparse.ArgumentParser(description='Import Excel shifts into Supabase')
    parser.add_argument('--file', required=True, metavar='PATH', help='Path to .xlsx file')
    parser.add_argument('--dry-run', action='store_true', help='Parse only, do not write to DB')
    parser.add_argument('--from', dest='from_date', default=None, metavar='YYYY-MM-DD',
                        help='Only import rows on or after this date')
    parser.add_argument('--to', dest='to_date', default=None, metavar='YYYY-MM-DD',
                        help='Only import rows on or before this date')
    parser.add_argument('--batch', type=int, default=200, help='Upsert batch size (default: 200)')
    args = parser.parse_args()

    xlsx_path = Path(args.file)
    if not xlsx_path.exists():
        print(f"ERROR: File not found: {xlsx_path}", file=sys.stderr)
        sys.exit(1)

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
    promoters = sb.from_('promoters').select('id,name').execute().data or []
    print(f"  {len(promoters)} promoters loaded", file=sys.stderr)
    name_map = build_name_map(promoters)

    # ── Read Excel ───────────────────────────────────────────────────────────
    print(f"Reading {xlsx_path.name}…", file=sys.stderr)
    wb = openpyxl.load_workbook(str(xlsx_path))
    ws = wb.active
    all_rows = list(ws.iter_rows(values_only=True))
    data_rows = all_rows[1:]  # skip header
    print(f"  {len(data_rows)} data rows", file=sys.stderr)

    # Date filters
    from_dt = datetime.fromisoformat(args.from_date) if args.from_date else None
    to_dt   = datetime.fromisoformat(args.to_date)   if args.to_date   else None

    # ── Parse rows ───────────────────────────────────────────────────────────
    records: list[dict] = []
    skipped_name: list[str] = []
    skipped_date: int = 0

    for i, row in enumerate(data_rows, start=2):
        date_val, name_raw, store_raw, open_t, close_t = row[0], row[1], row[2], row[3], row[4]

        # Parse date
        if isinstance(date_val, datetime):
            dt = date_val
        elif isinstance(date_val, str):
            try:
                dt = datetime.fromisoformat(date_val)
            except ValueError:
                continue
        else:
            continue

        date_str = dt.strftime('%Y-%m-%d')

        # Apply date filter
        if from_dt and dt < from_dt:
            skipped_date += 1
            continue
        if to_dt and dt > to_dt:
            skipped_date += 1
            continue

        # Match promoter
        pid = match_name(str(name_raw or ''), name_map)
        if not pid:
            skipped_name.append(str(name_raw))
            continue

        # Build time_range
        shift_type = str(store_raw or '').strip().upper()
        if not shift_type:
            continue
        time_range = None
        if open_t and close_t:
            time_range = f"{str(open_t).strip()}-{str(close_t).strip()}"

        records.append({
            'promoter_id': pid,
            'date': date_str,
            'shift_type': shift_type,
            'time_range': time_range,
        })

    print(f"\nParsed: {len(records)} valid rows", file=sys.stderr)
    if skipped_date:
        print(f"  Skipped (date filter): {skipped_date}", file=sys.stderr)
    if skipped_name:
        unique_missing = sorted(set(skipped_name))
        print(f"  Skipped (name not found): {len(skipped_name)} rows — {unique_missing}", file=sys.stderr)

    if not records:
        print("Nothing to import.", file=sys.stderr)
        sys.exit(0)

    if args.dry_run:
        print("\n[DRY RUN] Sample records:", file=sys.stderr)
        for r in records[:5]:
            print(f"  {r}", file=sys.stderr)
        print(f"\n[DRY RUN] Would upsert {len(records)} rows. Pass without --dry-run to write.", file=sys.stderr)
        sys.exit(0)

    # ── Upsert in batches ────────────────────────────────────────────────────
    print(f"\nUpserting {len(records)} rows in batches of {args.batch}…", file=sys.stderr)
    total_ok = 0
    total_err = 0

    for start in range(0, len(records), args.batch):
        batch = records[start:start + args.batch]
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
