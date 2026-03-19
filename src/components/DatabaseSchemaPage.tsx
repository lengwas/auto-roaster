import { useMemo } from 'react';
import type { Store, Promoter, Shift } from '../types/types';
import './DatabaseSchemaPage.css';

interface DatabaseSchemaPageProps {
  stores: Store[];
  promoters: Promoter[];
  shifts: Shift[];
}

// Show only a sample of shifts for the preview
const SAMPLE_LIMIT = 20;

const DatabaseSchemaPage = ({ stores, promoters, shifts }: DatabaseSchemaPageProps) => {
  // Build lookups
  const promoterMap = useMemo(() => {
    const m = new Map<string, Promoter>();
    promoters.forEach((p) => m.set(p.id, p));
    return m;
  }, [promoters]);

  // Only shifts that are actually assigned (not empty)
  const assignedShifts = useMemo(
    () => shifts.filter((s) => s.type && s.type !== '-'),
    [shifts]
  );

  const sampleShifts = assignedShifts.slice(0, SAMPLE_LIMIT);

  // SQL CREATE statements
  const sqlSchema = `-- Supabase / PostgreSQL Schema

-- 1. Stores table
CREATE TABLE stores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(10) UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  active      BOOLEAN DEFAULT true,
  open_time   TIME NOT NULL,
  close_time  TIME NOT NULL,
  extra_allowance TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. Promoters table
CREATE TABLE promoters (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  active       BOOLEAN DEFAULT true,
  day_off      VARCHAR(3),  -- 'Sun','Mon','Tue',...
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 3. Promoter-Store assignments (many-to-many)
CREATE TABLE promoter_stores (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id  UUID REFERENCES promoters(id) ON DELETE CASCADE,
  store_id     UUID REFERENCES stores(id) ON DELETE CASCADE,
  UNIQUE(promoter_id, store_id)
);

-- 4. Shifts table (CORE: flat, only assigned shifts)
--    ไม่ได้เลือกกะ = ไม่มี row
CREATE TABLE shifts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id  UUID REFERENCES promoters(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  shift_type   TEXT NOT NULL,  -- store code ('VDM') or 'Off','LOP','SL'
  time_range   TEXT,           -- '16:00-23:00' (nullable for Off/LOP/SL)
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(promoter_id, date)   -- 1 shift per person per day
);

-- Indexes for fast queries
CREATE INDEX idx_shifts_date ON shifts(date);
CREATE INDEX idx_shifts_promoter ON shifts(promoter_id);
CREATE INDEX idx_shifts_type ON shifts(shift_type);
CREATE INDEX idx_shifts_date_type ON shifts(date, shift_type);`;

  const sqlQueries = `-- Common Queries

-- 1. ดึงตารางกะของคนเดียว (เช่น ส่งแจ้งตารางกะ)
SELECT s.date, s.shift_type, s.time_range,
       st.name as store_name
FROM shifts s
LEFT JOIN stores st ON st.code = s.shift_type
WHERE s.promoter_id = '...'
  AND s.date BETWEEN '2024-03-01' AND '2024-03-31'
ORDER BY s.date;

-- 2. นับจำนวนคนต่อ store ต่อวัน (Store Count row)
SELECT s.shift_type as store_code, s.date, COUNT(*) as count
FROM shifts s
WHERE s.shift_type NOT IN ('Off', 'LOP', 'SL')
  AND s.date BETWEEN '2024-03-01' AND '2024-03-31'
GROUP BY s.shift_type, s.date
ORDER BY s.date, s.shift_type;

-- 3. ดึงคนที่ Off ในวันที่กำหนด
SELECT p.name, s.shift_type
FROM shifts s
JOIN promoters p ON p.id = s.promoter_id
WHERE s.date = '2024-03-15'
  AND s.shift_type IN ('Off', 'LOP', 'SL');

-- 4. สรุปจำนวนวันทำงานต่อคนต่อเดือน
SELECT p.name,
  COUNT(*) FILTER (WHERE s.shift_type NOT IN ('Off','LOP','SL')) as work_days,
  COUNT(*) FILTER (WHERE s.shift_type = 'Off') as off_days,
  COUNT(*) FILTER (WHERE s.shift_type = 'LOP') as lop_days,
  COUNT(*) FILTER (WHERE s.shift_type = 'SL') as sl_days
FROM shifts s
JOIN promoters p ON p.id = s.promoter_id
WHERE s.date BETWEEN '2024-03-01' AND '2024-03-31'
GROUP BY p.name
ORDER BY p.name;

-- 5. Upsert shift (assign/change shift)
INSERT INTO shifts (promoter_id, date, shift_type, time_range)
VALUES ('...', '2024-03-15', 'VDM', '16:00-23:00')
ON CONFLICT (promoter_id, date)
DO UPDATE SET
  shift_type = EXCLUDED.shift_type,
  time_range = EXCLUDED.time_range,
  updated_at = now();

-- 6. ลบ shift (clear assignment)
DELETE FROM shifts
WHERE promoter_id = '...' AND date = '2024-03-15';`;

  return (
    <div className="schema-page">
      <div className="schema-header">
        <h2>Database Schema (Supabase)</h2>
        <p>Recommended: Flat/Normalized — store only assigned shifts, 1 row per person per day</p>
      </div>

      {/* Visual diagram */}
      <div className="schema-section">
        <h3>Table Relationships</h3>
        <div className="erd-diagram">
          <div className="erd-table">
            <div className="erd-title">stores</div>
            <div className="erd-col"><span className="erd-pk">id</span> UUID PK</div>
            <div className="erd-col"><span className="erd-key">code</span> VARCHAR(10) UNIQUE</div>
            <div className="erd-col">name TEXT</div>
            <div className="erd-col">active BOOLEAN</div>
            <div className="erd-col">open_time TIME</div>
            <div className="erd-col">close_time TIME</div>
            <div className="erd-col">extra_allowance TEXT?</div>
          </div>

          <div className="erd-table">
            <div className="erd-title">promoters</div>
            <div className="erd-col"><span className="erd-pk">id</span> UUID PK</div>
            <div className="erd-col">name TEXT</div>
            <div className="erd-col">active BOOLEAN</div>
            <div className="erd-col">day_off VARCHAR(3)</div>
          </div>

          <div className="erd-table">
            <div className="erd-title">promoter_stores</div>
            <div className="erd-col"><span className="erd-pk">id</span> UUID PK</div>
            <div className="erd-col"><span className="erd-fk">promoter_id</span> UUID FK</div>
            <div className="erd-col"><span className="erd-fk">store_id</span> UUID FK</div>
          </div>

          <div className="erd-table erd-highlight">
            <div className="erd-title">shifts</div>
            <div className="erd-col"><span className="erd-pk">id</span> UUID PK</div>
            <div className="erd-col"><span className="erd-fk">promoter_id</span> UUID FK</div>
            <div className="erd-col"><span className="erd-key">date</span> DATE</div>
            <div className="erd-col">shift_type TEXT</div>
            <div className="erd-col">time_range TEXT?</div>
            <div className="erd-col erd-constraint">UNIQUE(promoter_id, date)</div>
          </div>
        </div>
      </div>

      {/* Why this approach */}
      <div className="schema-section">
        <h3>Why Flat/Normalized?</h3>
        <div className="comparison-grid">
          <div className="compare-card compare-good">
            <h4>Flat (Recommended)</h4>
            <ul>
              <li>1 row = 1 person + 1 day</li>
              <li>ไม่เลือกกะ = ไม่มี row (ประหยัด)</li>
              <li>Query ง่าย: WHERE date BETWEEN ...</li>
              <li>Index ได้ดี, scale ได้</li>
              <li>Upsert ง่าย (ON CONFLICT)</li>
              <li>เพิ่มวัน/คนไม่ต้องแก้ schema</li>
            </ul>
          </div>
          <div className="compare-card compare-bad">
            <h4>Wide Table (Grid-style)</h4>
            <ul>
              <li>1 row = 1 person, columns = dates</li>
              <li>ต้อง ALTER TABLE ทุกวัน</li>
              <li>เปลือง storage (NULL cells)</li>
              <li>Query ซับซ้อน, pivot ยาก</li>
              <li>Limit 1,600 columns ใน PostgreSQL</li>
              <li>ไม่ standard, ไม่แนะนำ</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Live data preview */}
      <div className="schema-section">
        <h3>Live Data Preview — shifts table</h3>
        <p className="schema-hint">
          Showing {sampleShifts.length} of {assignedShifts.toLocaleString()} assigned rows
          ({promoters.filter(p => p.active).length} promoters)
        </p>
        <div className="schema-table-wrap">
          <table className="schema-table">
            <thead>
              <tr>
                <th>id</th>
                <th>promoter_id</th>
                <th>promoter (name)</th>
                <th>date</th>
                <th>shift_type</th>
                <th>time_range</th>
              </tr>
            </thead>
            <tbody>
              {sampleShifts.map((s) => {
                const p = promoterMap.get(s.promoterId);
                return (
                  <tr key={s.id}>
                    <td className="mono">{s.id.substring(0, 12)}...</td>
                    <td className="mono">{s.promoterId}</td>
                    <td>{p?.name || '-'}</td>
                    <td className="mono">{s.date}</td>
                    <td>
                      <span className={`type-badge type-${s.type === 'Off' || s.type === 'LOP' || s.type === 'SL' ? 'special' : 'store'}`}>
                        {s.type}
                      </span>
                    </td>
                    <td className="mono">{s.timeRange || 'NULL'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stores table preview */}
      <div className="schema-section">
        <h3>Live Data Preview — stores table</h3>
        <div className="schema-table-wrap">
          <table className="schema-table">
            <thead>
              <tr>
                <th>id</th>
                <th>code</th>
                <th>name</th>
                <th>active</th>
                <th>open_time</th>
                <th>close_time</th>
                <th>extra_allowance</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.id} className={!s.active ? 'row-dim' : ''}>
                  <td className="mono">{s.id}</td>
                  <td><span className="type-badge type-store">{s.code}</span></td>
                  <td>{s.name}</td>
                  <td>{s.active ? 'true' : 'false'}</td>
                  <td className="mono">{s.openTime}</td>
                  <td className="mono">{s.closeTime}</td>
                  <td className="mono">{s.extraAllowance || 'NULL'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SQL Schema */}
      <div className="schema-section">
        <h3>SQL — CREATE TABLE</h3>
        <pre className="sql-block">{sqlSchema}</pre>
      </div>

      {/* SQL Queries */}
      <div className="schema-section">
        <h3>SQL — Common Queries</h3>
        <pre className="sql-block">{sqlQueries}</pre>
      </div>
    </div>
  );
};

export default DatabaseSchemaPage;
