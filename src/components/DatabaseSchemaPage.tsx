import { useMemo, useState } from 'react';
import type { Store, Promoter, Shift } from '../types/types';
import './DatabaseSchemaPage.css';

interface DatabaseSchemaPageProps {
  stores: Store[];
  promoters: Promoter[];
  shifts: Shift[];
}

const SPECIAL_SHIFTS = new Set(['Off', 'LOP', 'SL']);
const PAGE_SIZE = 50;

const DatabaseSchemaPage = ({ stores, promoters, shifts }: DatabaseSchemaPageProps) => {

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
  max_capacity   INT,            -- max promoters per day (NULL = unlimited)
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
  note         TEXT,           -- optional note per shift
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(promoter_id, date)   -- 1 shift per person per day
);

-- Indexes for fast queries
CREATE INDEX idx_shifts_date ON shifts(date);
CREATE INDEX idx_shifts_promoter ON shifts(promoter_id);
CREATE INDEX idx_shifts_type ON shifts(shift_type);
CREATE INDEX idx_shifts_date_type ON shifts(date, shift_type);

-- 5. Shift change log (audit trail)
CREATE TABLE shift_change_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id     UUID REFERENCES shifts(id) ON DELETE SET NULL,
  promoter_id  UUID REFERENCES promoters(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  old_type     TEXT,            -- previous shift_type (NULL = new)
  new_type     TEXT,            -- new shift_type (NULL = deleted)
  old_note     TEXT,
  new_note     TEXT,
  changed_by   TEXT NOT NULL,   -- user email or name
  changed_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_changelog_promoter ON shift_change_log(promoter_id);
CREATE INDEX idx_changelog_date ON shift_change_log(date);
CREATE INDEX idx_changelog_changed_at ON shift_change_log(changed_at);

-- 6. Store preferences per promoter (must/preferred/banned)
CREATE TABLE promoter_store_preferences (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id  UUID REFERENCES promoters(id) ON DELETE CASCADE,
  store_id     UUID REFERENCES stores(id) ON DELETE CASCADE,
  preference   TEXT NOT NULL CHECK (preference IN ('must','preferred','banned')),
  UNIQUE(promoter_id, store_id)
);

-- 7. Promoter conflicts (pairs that should not work same store same day)
CREATE TABLE promoter_conflicts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_a_id  UUID REFERENCES promoters(id) ON DELETE CASCADE,
  promoter_b_id  UUID REFERENCES promoters(id) ON DELETE CASCADE,
  reason         TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  CHECK (promoter_a_id < promoter_b_id),
  UNIQUE(promoter_a_id, promoter_b_id)
);`;

  const sqlQueries = `-- Common Queries

-- 1. ดึงตารางกะของคนเดียว (เช่น ส่งแจ้งตารางกะ)
SELECT s.date, s.shift_type, s.time_range, s.note,
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
INSERT INTO shifts (promoter_id, date, shift_type, time_range, note)
VALUES ('...', '2024-03-15', 'VDM', '16:00-23:00', 'arrived late')
ON CONFLICT (promoter_id, date)
DO UPDATE SET
  shift_type = EXCLUDED.shift_type,
  time_range = EXCLUDED.time_range,
  note = EXCLUDED.note,
  updated_at = now();

-- 6. ลบ shift (clear assignment)
DELETE FROM shifts
WHERE promoter_id = '...' AND date = '2024-03-15';

-- 7. บันทึก log เมื่อเปลี่ยนกะ
INSERT INTO shift_change_log (shift_id, promoter_id, date, old_type, new_type, old_note, new_note, changed_by)
VALUES ('...', '...', '2024-03-15', 'VDM', 'HDM', NULL, 'moved store', 'admin@company.com');

-- 8. ดู log การเปลี่ยนกะของคนเดียว
SELECT cl.changed_at, cl.old_type, cl.new_type, cl.old_note, cl.new_note, cl.changed_by
FROM shift_change_log cl
WHERE cl.promoter_id = '...'
  AND cl.date = '2024-03-15'
ORDER BY cl.changed_at DESC;`;

  const storeMap = useMemo(() => {
    const m = new Map<string, Store>();
    stores.forEach(s => m.set(s.code, s));
    return m;
  }, [stores]);

  const promoterMap = useMemo(() => {
    const m = new Map<string, Promoter>();
    promoters.forEach(p => m.set(p.id, p));
    return m;
  }, [promoters]);

  // Build flat rows sorted by date
  const flatRows = useMemo(() => {
    return [...shifts]
      .sort((a, b) => a.date.localeCompare(b.date) || (promoterMap.get(a.promoterId)?.name || '').localeCompare(promoterMap.get(b.promoterId)?.name || ''))
      .map(s => {
        const promoter = promoterMap.get(s.promoterId);
        const store = storeMap.get(s.type);
        return {
          date: s.date,
          promoter: promoter?.name || s.promoterId,
          shiftType: s.type,
          storeName: store?.name || (SPECIAL_SHIFTS.has(s.type) ? s.type : '-'),
          openTime: store?.openTime || '-',
          closeTime: store?.closeTime || '-',
          timeRange: s.timeRange || '-',
          note: s.note || '',
        };
      });
  }, [shifts, storeMap, promoterMap]);

  const [flatPage, setFlatPage] = useState(0);
  const [flatSearch, setFlatSearch] = useState('');

  const filteredFlat = useMemo(() => {
    if (!flatSearch.trim()) return flatRows;
    const q = flatSearch.toLowerCase();
    return flatRows.filter(r =>
      r.date.includes(q) || r.promoter.toLowerCase().includes(q) ||
      r.shiftType.toLowerCase().includes(q) || r.storeName.toLowerCase().includes(q)
    );
  }, [flatRows, flatSearch]);

  const totalPages = Math.ceil(filteredFlat.length / PAGE_SIZE);
  const pagedFlat = filteredFlat.slice(flatPage * PAGE_SIZE, (flatPage + 1) * PAGE_SIZE);

  return (
    <div className="schema-page">
      <div className="schema-header">
        <h2>Database</h2>
        <p>Recommended: Flat/Normalized — store only assigned shifts, 1 row per person per day</p>
      </div>

      {/* Flat View Table */}
      <div className="schema-section">
        <h3>Shift Data (Flat View)</h3>
        <p className="flat-desc">1 row = 1 person + 1 day — sorted by date</p>
        <div className="flat-toolbar">
          <input
            type="text"
            className="flat-search"
            placeholder="Search date, promoter, store..."
            value={flatSearch}
            onChange={(e) => { setFlatSearch(e.target.value); setFlatPage(0); }}
          />
          <span className="flat-count">{filteredFlat.length.toLocaleString()} rows</span>
        </div>
        <div className="flat-table-wrap">
          <table className="flat-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Promoter</th>
                <th>Shift Type</th>
                <th>Store Name</th>
                <th>Time Range</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {pagedFlat.map((r, i) => (
                <tr key={`${r.date}_${r.promoter}_${i}`} className={SPECIAL_SHIFTS.has(r.shiftType) ? 'flat-row-special' : ''}>
                  <td>{r.date}</td>
                  <td>{r.promoter}</td>
                  <td><span className={`flat-badge flat-badge-${SPECIAL_SHIFTS.has(r.shiftType) ? r.shiftType.toLowerCase() : 'store'}`}>{r.shiftType}</span></td>
                  <td>{r.storeName}</td>
                  <td>{r.timeRange}</td>
                  <td className="flat-note">{r.note || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flat-pagination">
            <button className="btn btn-small btn-ghost" disabled={flatPage === 0} onClick={() => setFlatPage(p => p - 1)}>← Prev</button>
            <span className="flat-page-info">Page {flatPage + 1} / {totalPages}</span>
            <button className="btn btn-small btn-ghost" disabled={flatPage >= totalPages - 1} onClick={() => setFlatPage(p => p + 1)}>Next →</button>
          </div>
        )}
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
            <div className="erd-col">max_capacity INT?</div>
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
            <div className="erd-col">note TEXT?</div>
            <div className="erd-col erd-constraint">UNIQUE(promoter_id, date)</div>
          </div>

          <div className="erd-table">
            <div className="erd-title">shift_change_log</div>
            <div className="erd-col"><span className="erd-pk">id</span> UUID PK</div>
            <div className="erd-col"><span className="erd-fk">shift_id</span> UUID FK?</div>
            <div className="erd-col"><span className="erd-fk">promoter_id</span> UUID FK</div>
            <div className="erd-col">date DATE</div>
            <div className="erd-col">old_type TEXT?</div>
            <div className="erd-col">new_type TEXT?</div>
            <div className="erd-col">old_note TEXT?</div>
            <div className="erd-col">new_note TEXT?</div>
            <div className="erd-col">changed_by TEXT</div>
            <div className="erd-col">changed_at TIMESTAMPTZ</div>
          </div>

          <div className="erd-table">
            <div className="erd-title">promoter_store_preferences</div>
            <div className="erd-col"><span className="erd-pk">id</span> UUID PK</div>
            <div className="erd-col"><span className="erd-fk">promoter_id</span> UUID FK</div>
            <div className="erd-col"><span className="erd-fk">store_id</span> UUID FK</div>
            <div className="erd-col">preference TEXT</div>
            <div className="erd-col erd-constraint">UNIQUE(promoter_id, store_id)</div>
          </div>

          <div className="erd-table">
            <div className="erd-title">promoter_conflicts</div>
            <div className="erd-col"><span className="erd-pk">id</span> UUID PK</div>
            <div className="erd-col"><span className="erd-fk">promoter_a_id</span> UUID FK</div>
            <div className="erd-col"><span className="erd-fk">promoter_b_id</span> UUID FK</div>
            <div className="erd-col">reason TEXT?</div>
            <div className="erd-col erd-constraint">CHECK(a_id &lt; b_id)</div>
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
