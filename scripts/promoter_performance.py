#!/usr/bin/env python3
"""
Promoter Performance Calculator
================================
ดึงข้อมูล orders จาก Supabase แล้วคำนวณ performance ของแต่ละ promoter

Usage:
    python promoter_performance.py                    # 3 months, completed only
    python promoter_performance.py --period 1m        # 1 month
    python promoter_performance.py --period 6m        # 6 months
    python promoter_performance.py --status all       # รวม pending ด้วย
    python promoter_performance.py --dow Fri,Sat,Sun  # เฉพาะบางวัน
    python promoter_performance.py --store VDM,JDM    # เฉพาะบาง store
    python promoter_performance.py --csv out.csv      # export CSV
    python promoter_performance.py --all-promoters    # รวม inactive

Requirements:
    pip install requests pandas python-dotenv tabulate
"""

import argparse
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

# ── load .env ────────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / '.env'
    load_dotenv(env_path)
except ImportError:
    pass  # dotenv optional; fall back to os.environ

try:
    import requests
    import pandas as pd
    from tabulate import tabulate
except ImportError as e:
    print(f"❌ Missing dependency: {e}")
    print("   Run: pip install requests pandas python-dotenv tabulate")
    sys.exit(1)

# ── config ───────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("VITE_SUPABASE_ANON_KEY", "")

# PI grade thresholds (same as React component)
GRADE_THRESHOLDS = {"A": 1.15, "B": 0.95, "C": 0.75, "D": 0.0}

# Grade → allowed store tiers
GRADE_ALLOWED_TIERS = {
    "A": {"A", "B"},
    "B": {"A", "B", "C"},
    "C": {"B", "C", "D"},
    "D": {"C", "D"},
}

DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

# Warehouse code → store code mapping (from real orders data)
# Format: "VIR - DBM" → "VDM"
WAREHOUSE_MAP: dict = {
    # Virgin
    "vir - dbm": "VDM",   # Virgin Dubai Mall
    "vir - moe": "VME",   # Virgin Mall of Emirates
    "vir - dbh": "VDH",   # Virgin Dubai Hills
    "vir - mrn": "VMN",   # Virgin Dubai Marina
    "vir - mdf": "VMF",   # Virgin Mirdif
    "vir - nkm": "VNK",   # Virgin Nakheel
    "vir - yas": "VYM",   # Virgin Yas Mall
    "vir - amy": "VAY",   # Virgin Al Maryah Island
    "vir - rem": "VRM",   # Virgin Reem Mall
    "vir - adm": "VAD",   # Virgin Abu Dhabi Mall
    "vir - arb": "VAY",   # Virgin (Abu Dhabi area)
    "vir - azc": "VNK",   # Virgin (Az Za'abeel/Nakheel area)
    # Jashanmal
    "jsm - moe": "JME",   # Jashanmal MOE
    "jsm - dbm": "JDM",   # Jashanmal Dubai Mall
    "jsm - dbh": "JDH",   # Jashanmal Dubai Hills
    # Borders
    "bdr - dbm": "BDM",   # Borders Dubai Mall
    "bdr - dbh": "JDH",   # Borders Dubai Hills (map to JDH if no separate code)
    # Hamleys
    "hls - dbm": "HDM",   # Hamleys Dubai Mall
    # Sharaf DG
    "sdg - dbm": "SDM",   # Sharaf DG Dubai Mall
    # Airwheel
    "air - 48":  "AIR",   # Airwheel Office
    "air - dcc": "ADC",   # Airwheel DCC
    # IMG
    "img - wld": "IMG",   # IMG World
}


# ── supabase helpers ─────────────────────────────────────────────────────────
def sb_get(table: str, select: str = "*", filters: Optional[dict] = None) -> list:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env")
        sys.exit(1)
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    params = {"select": select}
    if filters:
        params.update(filters)
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    resp = requests.get(url, params=params, headers=headers)
    if resp.status_code == 401:
        print("❌ 401 Unauthorized — check your SUPABASE_KEY")
        sys.exit(1)
    if resp.status_code == 403:
        print("❌ 403 Forbidden — run scripts/supabase-orders-anon.sql to grant read access")
        sys.exit(1)
    resp.raise_for_status()
    return resp.json()


# ── period helpers ────────────────────────────────────────────────────────────
def period_start(period: str) -> str:
    months = {"1m": 1, "3m": 3, "6m": 6}[period]
    today = date.today()
    # subtract months manually (no dateutil required)
    year = today.year
    month = today.month - months
    while month <= 0:
        month += 12
        year -= 1
    start = date(year, month, today.day)
    return start.isoformat()


def pi_to_grade(pi: float) -> str:
    for grade, threshold in GRADE_THRESHOLDS.items():
        if pi >= threshold:
            return grade
    return "D"


# ── main calculation ──────────────────────────────────────────────────────────
def run(args: argparse.Namespace) -> None:
    # ── 1. fetch reference data ───────────────────────────────────────────────
    print("🔄 Fetching stores…")
    stores_raw = sb_get("stores", "code,name,active,platform,warehouse")
    stores_df = pd.DataFrame(stores_raw)

    print("🔄 Fetching promoters…")
    promoters_raw = sb_get("promoters", "id,name,active")
    promoters_df = pd.DataFrame(promoters_raw)
    if not args.all_promoters:
        promoters_df = promoters_df[promoters_df["active"] == True]

    # ── 2. fetch orders ───────────────────────────────────────────────────────
    from_date = period_start(args.period)
    print(f"🔄 Fetching orders from {from_date}…")
    filters = {"date": f"gte.{from_date}", "order": "date.desc", "limit": "10000"}
    orders_raw = sb_get("orders", "id,date,salesperson,warehouse,platform,amount_aed,status", filters)
    orders_df = pd.DataFrame(orders_raw) if orders_raw else pd.DataFrame()

    if orders_df.empty:
        print("⚠️  No orders found for this period. Check RLS policies or date range.")
        return

    # Normalise
    orders_df["amount_aed"] = pd.to_numeric(orders_df["amount_aed"], errors="coerce").fillna(0)
    orders_df["date"] = pd.to_datetime(orders_df["date"]).dt.date
    orders_df["dow"] = pd.to_datetime(orders_df["date"]).dt.dayofweek  # Mon=0…Sun=6
    # Convert to Sun=0…Sat=6 (same as JS Date.getDay)
    orders_df["dow_js"] = (orders_df["dow"] + 1) % 7

    # Filter by status case-insensitively (real data uses "Completed" not "completed")
    if args.status == "completed":
        orders_df = orders_df[orders_df["status"].str.lower() == "completed"]

    # ── 3. DOW filter ─────────────────────────────────────────────────────────
    if args.dow:
        requested = {DOW_NAMES.index(d.strip().capitalize()) for d in args.dow.split(",") if d.strip().capitalize() in DOW_NAMES}
        if requested:
            orders_df = orders_df[orders_df["dow_js"].isin(requested)]
            print(f"   DOW filter: {[DOW_NAMES[d] for d in sorted(requested)]}")

    print(f"   {len(orders_df)} orders loaded (period={args.period}, status={args.status})")

    # ── 4. build store lookup ─────────────────────────────────────────────────
    # warehouse field in orders matches stores.platform OR stores.warehouse
    store_lookup: dict[str, str] = {}  # lower_key → store_code
    for _, s in stores_df.iterrows():
        code = s["code"]
        if pd.notna(s.get("warehouse")) and s["warehouse"]:
            store_lookup[str(s["warehouse"]).lower().strip()] = code
        if pd.notna(s.get("platform")) and s["platform"]:
            store_lookup[str(s["platform"]).lower().strip()] = code
        store_lookup[code.lower()] = code

    def resolve_store(warehouse_val) -> Optional[str]:
        if pd.isna(warehouse_val) or not warehouse_val:
            return None
        key = str(warehouse_val).lower().strip()
        # Try WAREHOUSE_MAP first (handles "VIR - DBM" style codes)
        if key in WAREHOUSE_MAP:
            return WAREHOUSE_MAP[key]
        # Then try stores.warehouse / stores.platform / stores.code
        return store_lookup.get(key)

    orders_df["store_code"] = orders_df["warehouse"].apply(resolve_store)

    # ── 5. promoter lookup ────────────────────────────────────────────────────
    promoter_lookup = {
        str(r["name"]).lower().strip(): r["name"]
        for _, r in promoters_df.iterrows()
    }
    orders_df["promoter_name"] = orders_df["salesperson"].apply(
        lambda x: promoter_lookup.get(str(x).lower().strip()) if pd.notna(x) else None
    )

    # Drop orders we can't attribute
    matched = orders_df.dropna(subset=["store_code", "promoter_name"])
    unmatched = len(orders_df) - len(matched)
    if unmatched:
        print(f"   ⚠️  {unmatched} orders skipped (salesperson or warehouse not matched)")

    # ── 6. filter by specific stores ─────────────────────────────────────────
    if args.store:
        store_filter = {s.strip().upper() for s in args.store.split(",")}
        matched = matched[matched["store_code"].isin(store_filter)]
        print(f"   Store filter: {sorted(store_filter)}")

    if matched.empty:
        print("⚠️  No matched orders after filtering.")
        return

    # ── 7. per-store stats (store average) ────────────────────────────────────
    # promoter-days at store = unique (promoter_name, date) per store
    store_stats = (
        matched.groupby("store_code")
        .agg(
            store_total=("amount_aed", "sum"),
            store_promoter_days=("amount_aed", lambda x: matched.loc[x.index].drop_duplicates(["promoter_name", "date"]).shape[0]),
        )
        .reset_index()
    )
    store_stats["store_avg_per_day"] = store_stats["store_total"] / store_stats["store_promoter_days"].clip(lower=1)
    store_avg = dict(zip(store_stats["store_code"], store_stats["store_avg_per_day"]))

    # ── 8. per-(promoter, store) stats ────────────────────────────────────────
    pair = (
        matched.groupby(["promoter_name", "store_code"])
        .agg(
            pair_sales=("amount_aed", "sum"),
            pair_orders=("amount_aed", "count"),
            pair_days=("date", "nunique"),
        )
        .reset_index()
    )
    pair["pair_daily_avg"] = pair["pair_sales"] / pair["pair_days"].clip(lower=1)
    pair["pair_pi"] = pair.apply(
        lambda r: r["pair_daily_avg"] / store_avg.get(r["store_code"], 1)
        if store_avg.get(r["store_code"], 0) > 0 else 0,
        axis=1,
    )

    # ── 9. per-promoter aggregate ─────────────────────────────────────────────
    # weighted PI = total_sales / sum(days_at_store × store_avg)
    pair["expected"] = pair["pair_days"] * pair["store_code"].map(store_avg)

    promoter_agg = (
        pair.groupby("promoter_name")
        .agg(
            total_sales=("pair_sales", "sum"),
            total_orders=("pair_orders", "sum"),
            total_days=("pair_days", "sum"),
            total_expected=("expected", "sum"),
        )
        .reset_index()
    )
    promoter_agg["daily_avg"] = promoter_agg["total_sales"] / promoter_agg["total_days"].clip(lower=1)
    promoter_agg["pi"] = promoter_agg["total_sales"] / promoter_agg["total_expected"].clip(lower=0.01)
    promoter_agg["grade"] = promoter_agg["pi"].apply(pi_to_grade)
    promoter_agg = promoter_agg.sort_values("pi", ascending=False).reset_index(drop=True)
    promoter_agg.index += 1  # rank starts at 1

    # ── 10. DOW breakdown per promoter ────────────────────────────────────────
    dow_pivot = (
        matched.groupby(["promoter_name", "dow_js"])["amount_aed"]
        .sum()
        .unstack(fill_value=0)
        .reindex(columns=range(7), fill_value=0)
    )
    dow_pivot.columns = [DOW_NAMES[i] for i in range(7)]
    dow_pivot["best_dow"] = dow_pivot.idxmax(axis=1)

    # ── 11. store breakdown per promoter ─────────────────────────────────────
    store_detail = pair.sort_values(["promoter_name", "pair_sales"], ascending=[True, False])

    # ── 12. multi-promoter days detection ────────────────────────────────────
    multi = (
        matched.groupby(["store_code", "date"])["promoter_name"]
        .nunique()
        .reset_index()
        .rename(columns={"promoter_name": "promoter_count"})
    )
    multi_days = multi[multi["promoter_count"] > 1]

    # ── 13. print results ─────────────────────────────────────────────────────
    print("\n" + "═" * 80)
    print(f"  PROMOTER PERFORMANCE REPORT")
    print(f"  Period: {from_date} → {date.today()}  |  Status: {args.status}")
    print("═" * 80)

    # Summary
    print(f"\n  Total orders  : {len(matched):,}")
    print(f"  Total sales   : AED {matched['amount_aed'].sum():,.0f}")
    print(f"  Promoters     : {len(promoter_agg)}")
    print(f"  Stores        : {matched['store_code'].nunique()}")
    print(f"  Multi-PC days : {len(multi_days)} (days with 2+ promoters at same store)")

    # Main table
    print("\n── PROMOTER RANKING ──────────────────────────────────────────────────────\n")
    display = promoter_agg[["promoter_name", "grade", "pi", "total_sales", "daily_avg", "total_orders", "total_days"]].copy()
    display.columns = ["Promoter", "Grade", "PI", "Total AED", "Daily Avg", "Orders", "Days"]
    display["Total AED"]  = display["Total AED"].map("{:,.0f}".format)
    display["Daily Avg"]  = display["Daily Avg"].map("{:,.0f}".format)
    display["PI"]         = display["PI"].map("{:.3f}".format)
    print(tabulate(display, headers="keys", tablefmt="rounded_outline", showindex=True))

    # Store breakdown
    print("\n── STORE BREAKDOWN ───────────────────────────────────────────────────────\n")
    sb = store_detail.copy()
    sb["PI"] = sb["pair_pi"].map("{:.3f}".format)
    sb["Sales"] = sb["pair_sales"].map("{:,.0f}".format)
    sb["Daily Avg"] = sb["pair_daily_avg"].map("{:,.0f}".format)
    sb = sb[["promoter_name", "store_code", "PI", "Sales", "Daily Avg", "pair_orders", "pair_days"]]
    sb.columns = ["Promoter", "Store", "PI", "Sales AED", "Daily Avg", "Orders", "Days"]
    print(tabulate(sb, headers="keys", tablefmt="rounded_outline", showindex=False))

    # DOW breakdown
    print("\n── SALES BY DAY OF WEEK (AED) ────────────────────────────────────────────\n")
    dow_display = dow_pivot.copy()
    dow_display["Best DOW"] = dow_display["best_dow"]
    for col in DOW_NAMES:
        dow_display[col] = dow_display[col].map("{:,.0f}".format)
    print(tabulate(dow_display.reset_index(), headers="keys", tablefmt="rounded_outline", showindex=False))

    # Grade summary
    print("\n── GRADE DISTRIBUTION ────────────────────────────────────────────────────\n")
    grade_counts = promoter_agg["grade"].value_counts().reindex(["A", "B", "C", "D"], fill_value=0)
    grade_pi = promoter_agg.groupby("grade")["pi"].agg(["min", "mean", "max"]).reindex(["A", "B", "C", "D"])
    grade_sales = promoter_agg.groupby("grade")["total_sales"].sum().reindex(["A", "B", "C", "D"])
    grade_summary = pd.DataFrame({
        "Grade": ["A", "B", "C", "D"],
        "Count": grade_counts.values,
        "PI min": grade_pi["min"].map("{:.2f}".format),
        "PI mean": grade_pi["mean"].map("{:.2f}".format),
        "PI max": grade_pi["max"].map("{:.2f}".format),
        "Total Sales AED": grade_sales.map("{:,.0f}".format),
        "Allowed Tiers": ["A, B", "A, B, C", "B, C, D", "C, D"],
    })
    print(tabulate(grade_summary, headers="keys", tablefmt="rounded_outline", showindex=False))

    # PI thresholds reminder
    print("\n  Grade thresholds (PI = promoter daily avg / store avg):")
    for g, t in GRADE_THRESHOLDS.items():
        print(f"    {g}: PI ≥ {t:.2f}" if g != "D" else f"    {g}: PI < 0.75")

    print("\n" + "═" * 80 + "\n")

    # ── 14. CSV export ────────────────────────────────────────────────────────
    if args.csv:
        out = args.csv
        # Full detail: promoter + store + DOW
        rows = []
        for _, p in promoter_agg.iterrows():
            name = p["promoter_name"]
            stores_for_promoter = store_detail[store_detail["promoter_name"] == name]
            dow_row = dow_pivot.loc[name] if name in dow_pivot.index else pd.Series({d: 0 for d in DOW_NAMES})
            for _, s in stores_for_promoter.iterrows():
                rows.append({
                    "promoter": name,
                    "grade": p["grade"],
                    "overall_pi": round(p["pi"], 4),
                    "total_sales_aed": round(p["total_sales"], 2),
                    "daily_avg_aed": round(p["daily_avg"], 2),
                    "total_orders": int(p["total_orders"]),
                    "total_days": int(p["total_days"]),
                    "store": s["store_code"],
                    "store_sales_aed": round(s["pair_sales"], 2),
                    "store_daily_avg": round(s["pair_daily_avg"], 2),
                    "store_orders": int(s["pair_orders"]),
                    "store_days": int(s["pair_days"]),
                    "store_pi": round(s["pair_pi"], 4),
                    "best_dow": dow_row.get("best_dow", ""),
                    **{f"sales_{d}": round(float(dow_row.get(d, 0)), 2) for d in DOW_NAMES},
                })
        pd.DataFrame(rows).to_csv(out, index=False)
        print(f"  📄 CSV exported → {out}")


# ── CLI ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Promoter Performance Calculator — UAE PC Shift Table"
    )
    parser.add_argument(
        "--period", choices=["1m", "3m", "6m"], default="3m",
        help="Lookback period (default: 3m)"
    )
    parser.add_argument(
        "--status", choices=["completed", "all"], default="completed",
        help="Order status filter (default: completed)"
    )
    parser.add_argument(
        "--dow", default=None,
        help="Day-of-week filter, comma-separated (e.g. Fri,Sat,Sun)"
    )
    parser.add_argument(
        "--store", default=None,
        help="Store code filter, comma-separated (e.g. VDM,JDM)"
    )
    parser.add_argument(
        "--csv", default=None, metavar="FILE",
        help="Export full detail to CSV file"
    )
    parser.add_argument(
        "--all-promoters", action="store_true",
        help="Include inactive promoters"
    )
    args = parser.parse_args()
    run(args)


if __name__ == "__main__":
    main()
