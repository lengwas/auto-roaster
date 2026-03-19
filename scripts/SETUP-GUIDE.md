# Google Sheet → Supabase Sync Setup Guide

## สิ่งที่ต้องเตรียม
1. **Supabase Project** — สร้างที่ [supabase.com](https://supabase.com)
2. **Google Sheet** — ที่มี schedule data

---

## Step 1: สร้าง Supabase Tables

ไปที่ Supabase Dashboard → SQL Editor → รัน SQL จากไฟล์ `DatabaseSchemaPage.tsx` (CREATE TABLE statements)

## Step 2: เอา Supabase Keys

1. ไปที่ Supabase Dashboard → Settings → API
2. จด **Project URL** (e.g. `https://xxxxx.supabase.co`)
3. จด **service_role key** (ไม่ใช่ anon key — ต้องใช้ service_role เพื่อ bypass RLS)

## Step 3: เตรียม Google Sheet Format

### Sheet "Schedule" (หลัก)
| Name | 2024-03-01 | 2024-03-02 | 2024-03-03 | ... |
|------|-----------|-----------|-----------|-----|
| Kevin Ka | VDM | Off | VME | ... |
| Maureen Wa | VME | JDM | LOP | ... |

- Row 1 = วันที่ (Date objects หรือ text "YYYY-MM-DD")
- Row 2+ = ชื่อ promoter + store code ต่อวัน
- Cell = store code (`VDM`, `VME`) หรือ `Off`, `LOP`, `SL`
- ใส่เวลาต่อท้ายได้: `VDM 16:00-23:00`

### Sheet "Stores" (optional)
| Code | Name | Open | Close | Extra Allowance | Max Capacity |
|------|------|------|-------|----------------|-------------|
| VDM | Vox Deira Mall | 16:00 | 23:00 | | 4 |

### Sheet "Promoters" (optional)
| Name | Day Off | Active |
|------|---------|--------|
| Kevin Ka | Thu | TRUE |

## Step 4: ติดตั้ง Apps Script

1. เปิด Google Sheet
2. **Extensions → Apps Script**
3. ลบ code เดิม แล้ววาง code จาก `scripts/google-apps-script.js`
4. ไปที่ **Project Settings** (ไอคอนฟันเฟือง)
5. เพิ่ม **Script Properties**:
   - `SUPABASE_URL` = `https://xxxxx.supabase.co`
   - `SUPABASE_SERVICE_KEY` = `eyJ...` (service_role key)
   - `SHEET_NAME` = `Schedule` (ชื่อ tab ใน sheet)

## Step 5: ทดสอบ

1. เลือก function `testSync` จาก dropdown
2. กด **Run**
3. ดู Execution log — ควรเห็น "✅ Sync complete!"

## Step 6: ตั้ง Trigger (Auto-run ตี 1)

1. ใน Apps Script → คลิก **Triggers** (ไอคอนนาฬิกา)
2. กด **+ Add Trigger**
3. ตั้งค่า:
   - Function: `syncToSupabase` (หรือ `syncAll` ถ้าต้องการ sync stores + promoters ด้วย)
   - Event source: **Time-driven**
   - Type: **Day timer**
   - Time: **1am to 2am**
4. Save → Authorize

---

## Flow Diagram

```
Google Sheet (Schedule)
        │
        ▼  (1:00 AM daily — Apps Script Trigger)
   Apps Script
   ├─ Read sheet rows
   ├─ GET /promoters (map name → id)
   ├─ GET /stores (map code → time)
   └─ POST /shifts (upsert by promoter_id + date)
        │
        ▼
   Supabase (PostgreSQL)
   └─ shifts table
        │
        ▼
   Web App (auto-roaster)
   └─ Query shifts for performance dashboard
```

## Troubleshooting

- **"Promoter not found in DB"** → ชื่อใน Sheet ไม่ตรงกับ DB ตรวจสอบ spelling/spaces
- **403 error** → ใช้ service_role key ไม่ใช่ anon key
- **Date parse fail** → ตรวจ format วันที่ใน row แรก (ใช้ Date หรือ "YYYY-MM-DD")
- **ดู log** → Apps Script → Executions → คลิก execution ดู log
