import { useState } from 'react';
import './UserGuidePage.css';

type SectionId =
  | 'overview'
  | 'shift-table'
  | 'auto-assign'
  | 'constraints'
  | 'pc-setting'
  | 'store-setting'
  | 'sales'
  | 'attendance'
  | 'database'
  | 'export'
  | 'guide'
  | 'changelog'
  | 'shortcuts'
  | 'data-flow';

interface SectionLink { id: SectionId; label: string; emoji: string; }

const SECTIONS: SectionLink[] = [
  { id: 'overview',     label: 'Overview',           emoji: '📋' },
  { id: 'shortcuts',    label: 'Keyboard Shortcuts', emoji: '⌨️' },
  { id: 'shift-table',  label: 'Shift Table',        emoji: '📅' },
  { id: 'auto-assign',  label: 'Auto Assign',        emoji: '🤖' },
  { id: 'constraints',  label: 'Constraint DSL',     emoji: '🧩' },
  { id: 'pc-setting',   label: 'PC Setting',         emoji: '👥' },
  { id: 'store-setting',label: 'Store Setting',      emoji: '🏬' },
  { id: 'sales',        label: 'Sales Performance',  emoji: '📊' },
  { id: 'attendance',   label: 'Attendance',         emoji: '🕘' },
  { id: 'database',     label: 'Database',           emoji: '🗄️' },
  { id: 'export',       label: 'Export',             emoji: '📤' },
  { id: 'data-flow',    label: 'Data Flow',          emoji: '🔄' },
  { id: 'guide',        label: 'Guide & Changelog',  emoji: '📖' },
];

const UserGuidePage = () => {
  const [active, setActive] = useState<SectionId>('overview');

  const scrollTo = (id: SectionId) => {
    setActive(id);
    document.getElementById(`ug-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="ug-layout">
      <aside className="ug-sidebar">
        <div className="ug-sidebar-title">User Guide</div>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            className={`ug-nav-item${active === s.id ? ' active' : ''}`}
            onClick={() => scrollTo(s.id)}
          >
            <span className="ug-nav-emoji">{s.emoji}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </aside>

      <div className="ug-content">
        <section id="ug-overview" className="ug-section">
          <h2>📋 Overview</h2>
          <p>
            <strong>ShiftPro</strong> เป็น webapp สำหรับบริหารกะของพนักงาน promoter ทั้งใน UAE และ Qatar
            ระบบเชื่อมกับ Supabase สำหรับเก็บข้อมูล + LINE webhook สำหรับ check-in/out จากหน้างาน
          </p>
          <h3>โครงสร้างหลัก</h3>
          <ul>
            <li><strong>Shift Table</strong> — ตารางกะหลัก แก้ไขกะรายวันได้</li>
            <li><strong>PC Setting</strong> — กำหนดข้อมูล promoter, preferences, conflicts</li>
            <li><strong>Store Setting</strong> — กำหนดร้าน, capacity, shift slots, GPS</li>
            <li><strong>Sales Performance</strong> — ดูยอดขายต่อร้าน/promoter, จัดเกรด</li>
            <li><strong>Auto Assign</strong> — ใช้ Hungarian algorithm จัดกะให้ revenue สูงสุด</li>
            <li><strong>Attendance</strong> — บันทึก check-in/out จาก LINE OCR</li>
            <li><strong>Database</strong> — ดูข้อมูลกะดิบทั้งหมด</li>
            <li><strong>Guide / Changelog</strong> — เอกสารและประวัติการแก้ไข</li>
          </ul>
          <h3>Country switcher</h3>
          <p>
            มุมขวาบนมีปุ่มสลับ <strong>🇦🇪 UAE / 🇶🇦 QA</strong> ระบบจะโหลดข้อมูลคนละชุดจาก Supabase
            (table prefix แตกต่างกัน) และจำค่าใน localStorage
          </p>
        </section>

        <section id="ug-shortcuts" className="ug-section">
          <h2>⌨️ Keyboard Shortcuts (Shift Table)</h2>
          <table className="ug-table">
            <thead>
              <tr><th>Key</th><th>Action</th></tr>
            </thead>
            <tbody>
              <tr><td><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></td><td>เลื่อน focus ระหว่าง cells</td></tr>
              <tr><td><kbd>Enter</kbd></td><td>เปิด quick-edit input บน cell ที่ focus</td></tr>
              <tr><td>พิมพ์ใน quick-edit</td><td>เช่น <code>vdm</code>, <code>vdm 10</code>, <code>off</code>, <code>lop</code>, <code>sl</code>, <code>-</code></td></tr>
              <tr><td><kbd>Enter</kbd> ใน quick-edit</td><td>commit + ไปลง</td></tr>
              <tr><td><kbd>Tab</kbd> ใน quick-edit</td><td>commit + ไปขวา</td></tr>
              <tr><td><kbd>Esc</kbd> ใน quick-edit</td><td>ยกเลิก ไม่บันทึก</td></tr>
              <tr><td><kbd>Cmd/Ctrl</kbd>+<kbd>C</kbd></td><td>copy cell ที่ focus (type + time + note)</td></tr>
              <tr><td><kbd>Cmd/Ctrl</kbd>+<kbd>V</kbd></td><td>paste มาที่ cell ที่ focus</td></tr>
              <tr><td><kbd>Cmd/Ctrl</kbd>+<kbd>Z</kbd></td><td>undo (เก็บได้สูงสุด 50 รายการ)</td></tr>
              <tr><td><kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td><td>redo</td></tr>
              <tr><td><strong>Double-click</strong> cell</td><td>เปิด note editor</td></tr>
              <tr><td><strong>Hover</strong> cell</td><td>ตั้ง focus cell</td></tr>
            </tbody>
          </table>
        </section>

        <section id="ug-shift-table" className="ug-section">
          <h2>📅 Shift Table</h2>

          <h3>โครงสร้างตาราง</h3>
          <ul>
            <li><strong>คอลัมน์ซ้าย (sticky)</strong> — Promoter name, Conditions (must/banned/grade), Days off</li>
            <li><strong>Header แถวบน</strong> — Date number, day of week (Mon-Sun), special date markers</li>
            <li><strong>Cell</strong> — แสดง shift code (เช่น <code>VDM</code>, <code>Off</code>, <code>LOP</code>, <code>SL</code>) + time range</li>
            <li><strong>แถวสรุป (revenue forecast)</strong> — แสดง expected revenue ต่อวัน (ถ้ามี perf data)</li>
          </ul>

          <h3>Filter Panel</h3>
          <p>กดปุ่ม Filter เพื่อเปิด sidebar มี:</p>
          <ul>
            <li><strong>Date range</strong> — เลือกช่วงวันที่จะแสดง (default = current month)</li>
            <li><strong>Active only promoters</strong> — ซ่อนคนที่ active=false</li>
            <li><strong>Hide empty stores</strong> — ซ่อนร้านที่ไม่มีกะใน range</li>
            <li>เลือก hide รายตัวได้ทั้ง store และ promoter</li>
          </ul>

          <h3>Mark Date Popup</h3>
          <p>คลิกที่ header วันที่ → popup เลือก label สีพร้อม preset:</p>
          <ul>
            <li><span className="ug-color-dot" style={{ background: '#ef4444' }}/> <strong>Holiday</strong></li>
            <li><span className="ug-color-dot" style={{ background: '#f59e0b' }}/> <strong>Event</strong></li>
            <li><span className="ug-color-dot" style={{ background: '#8b5cf6' }}/> <strong>Promo</strong></li>
            <li><span className="ug-color-dot" style={{ background: '#3b82f6' }}/> <strong>Note</strong></li>
            <li><span className="ug-color-dot" style={{ background: '#10b981' }}/> <strong>Payday</strong></li>
          </ul>
          <p><strong>Tip:</strong> ตั้ง label ที่มีคำว่า <code>ramadan</code> จะทำให้หน้า Attendance ไม่ alert short-hours สำหรับวันนั้น</p>

          <h3>Validation Alerts บน cell</h3>
          <p>ระบบเช็คทุก cell อัตโนมัติ ถ้ามีปัญหาจะแสดง badge มุมขวาบน:</p>
          <ul>
            <li><span className="ug-badge ug-badge-error">!</span> <strong>Error (red)</strong> — hover ดู detail
              <ul>
                <li><strong>banned</strong> — assign ไปร้านที่อยู่ใน banned list</li>
                <li><strong>no-access</strong> — ร้านนั้นมี restricted access (มีคน <code>must</code> อย่างน้อย 1) แต่คนนี้ไม่ได้อยู่ใน must/preferred</li>
                <li><strong>day-off</strong> — assign ในวันที่อยู่ใน workingDays (วันหยุดประจำ)</li>
                <li><strong>conflict</strong> — มีคู่ที่ระบุใน conflicts ไปร้านเดียวกันวันเดียวกัน</li>
              </ul>
            </li>
            <li><span className="ug-badge ug-badge-warn">⚠</span> <strong>Warning (yellow)</strong>
              <ul>
                <li><strong>low-perf</strong> — promoter ขายไม่ค่อยได้ที่ร้านนี้ (avg revenue &lt; 40% global mean)</li>
                <li><strong>late-early</strong> — กะดึก (จบ ≥ 22:30) ตามด้วยกะเช้า (เริ่ม ≤ 11:00) วันถัดไป</li>
              </ul>
            </li>
          </ul>

          <h3>Notes</h3>
          <ul>
            <li><strong>Double-click</strong> cell → textarea overlay → พิมพ์ note → Save</li>
            <li>Note ของ shift จะ sync กับ attendance row เดียวกัน (promoter+date)</li>
            <li>Cell ที่มี note จะมี dot สีฟ้ามุมขวา hover เห็น tooltip</li>
            <li>Tooltip แสดง <em>combined</em>: <code>shift.note · attendance.note</code></li>
          </ul>
        </section>

        <section id="ug-auto-assign" className="ug-section">
          <h2>🤖 Auto Assign</h2>

          <h3>หลักการ</h3>
          <p>
            ใช้ <strong>Hungarian Algorithm</strong> (weighted bipartite matching) จัดกะแบบ
            maximize expected revenue โดยอิงจาก:
          </p>
          <ul>
            <li><strong>Performance matrix</strong> — คำนวณจาก historical orders (avg daily revenue ต่อ promoter × store)</li>
            <li><strong>Store preferences</strong> — must / preferred / banned</li>
            <li><strong>Conflicts</strong> — คนที่ห้ามอยู่ร้านเดียวกันวันเดียวกัน</li>
            <li><strong>Grade-Tier fit</strong> — A→A/B, B→A/B/C, C→B/C/D, D→C/D</li>
            <li><strong>Days off</strong> — workingDays ของแต่ละ promoter</li>
            <li><strong>Max capacity</strong> — แต่ละร้านมีจำนวน promoter ที่จุได้ต่อวัน</li>
            <li><strong>Saved snippets</strong> — Python DSL constraints ที่ active</li>
          </ul>

          <h3>Workflow</h3>
          <ol>
            <li>เลือก <strong>From / To</strong> date range</li>
            <li>(ถ้าต้องการ) เขียน <strong>Additional Constraints</strong> ใน editor — ดู section ถัดไป</li>
            <li>กด <strong>💾 Save Snippet</strong> ถ้าจะเก็บไว้ใช้ครั้งหน้า — toggle ✓ เปิด/ปิดได้</li>
            <li>กด <strong>Optimize Revenue</strong> → Hungarian algorithm รัน → ผลโผล่ใน ShiftTable ฝั่งขวา</li>
            <li>ตรวจสอบ alerts (แดง/เหลือง) และแก้ inline ได้</li>
            <li>(ถ้าต้องการ) พิมพ์ชื่อ + กด <strong>Save Draft</strong> เก็บไว้ใน localStorage</li>
            <li>กด <strong>Apply to Shift Table →</strong> เพื่อ commit ลง Supabase</li>
          </ol>

          <h3>Apply Conflict Dialog</h3>
          <p>
            ถ้าวันที่ apply มี shift อยู่แล้ว ระบบจะแสดง dialog เปรียบเทียบทุกแถวที่ conflict
            ให้เลือก <strong>"Keep Existing"</strong> เพื่อไม่ทับ หรือ <strong>"Overwrite All"</strong> เพื่อใช้ draft แทน
          </p>

          <h3>Saved Drafts</h3>
          <p>Drafts ถูกเก็บใน <code>localStorage</code> key: <code>auto_roaster_drafts</code></p>
          <ul>
            <li>คลิกที่ card ของ draft ที่บันทึกไว้ เพื่อโหลดกลับมา (รีเซ็ต date range ตามที่บันทึก)</li>
            <li>กด ✕ เพื่อลบ</li>
          </ul>

          <h3>Gemini Chat (optional)</h3>
          <p>
            ถ้าตั้ง <code>VITE_GEMINI_API_KEY</code> ใน <code>.env</code> จะมี chat panel ให้คุยกับ Gemini
            สำหรับให้ feedback ปรับ draft ในแบบ natural language ระบบแสดง token usage รวม (input/output/total + จำนวน calls)
          </p>
        </section>

        <section id="ug-constraints" className="ug-section">
          <h2>🧩 Constraint DSL</h2>
          <p>
            เขียนใน <strong>Additional Constraints</strong> textarea บนหน้า Auto Assign
            หรือกดปุ่ม <strong>? Examples</strong> ข้าง label เพื่อดูตัวอย่างทั้งหมด
          </p>

          <h3>Syntax สั้น ๆ</h3>
          <pre className="ug-code">{`store_min_people["STORE"] = N
assign("name", "Day", "STORE")
day_off("name", "Day")
end_time("name", "HH:MM")
shift_time("name", "Day", "HH:MM-HH:MM")
# comment lines start with hash`}</pre>

          <h3>shift_time — ล็อกเวลาโดยไม่ล็อกร้าน</h3>
          <p>
            ใช้เมื่ออยากบังคับเวลาเข้า-ออก แต่ให้ optimizer เลือกร้านให้เอง
            ระบบจะเลือกเฉพาะร้านที่มี <em>shift slot ตรงกับ time range นี้</em> พอดี
          </p>
          <pre className="ug-code">{`# kevin เข้ากะเช้า 10:00-19:00 วันอาทิตย์ ไม่จำกัดร้าน
shift_time("kevin", "Sun", "10:00-19:00")

# ใช้คู่กับ assign() ก็ได้ — ล็อกทั้งร้านและเวลา
assign("kevin", "Sun", "VDM")
shift_time("kevin", "Sun", "10:00-19:00")`}</pre>
          <p className="ug-note">
            <strong>หมายเหตุ:</strong> ถ้าร้านใน store setting มี shiftSlots หลายช่วง
            (เช่น <code>10:00-19:00, 13:30-22:30</code>) optimizer จะเลือกให้ตรงกับที่เขียนไว้
            — ถ้าไม่มีร้านไหนมี slot นี้เลย promoter จะได้ <code>Off</code>
          </p>

          <h3>กฎ</h3>
          <ul>
            <li><code>name</code> = lowercase first name (เช่น <code>"kevin"</code>, <code>"angela"</code>)</li>
            <li><code>Day</code> = หนึ่งใน <code>Mon, Tue, Wed, Thu, Fri, Sat, Sun</code></li>
            <li><code>STORE</code> = store code uppercase (เช่น <code>VDM</code>, <code>AIR</code>)</li>
            <li>บรรทัดที่ไม่ตรง pattern จะถูก parser ข้ามอย่างเงียบ ๆ ไม่ error</li>
            <li>ใน Save Snippet — ตั้งชื่อแล้วกด ✓ เพื่อ activate; snippet ที่ active เท่านั้นที่ optimizer อ่าน</li>
          </ul>

          <h3>ตัวอย่าง</h3>
          <pre className="ug-code">{`# Weekly base
store_min_people["VDM"] = 2
store_min_people["AIR"] = 3

# Lock kevin to VDM Mon/Tue
assign("kevin", "Mon", "VDM")
assign("kevin", "Tue", "VDM")

# Maureen takes Tuesday off
day_off("maureen", "Tue")

# Kevin ends at 22:00
end_time("kevin", "22:00")`}</pre>
          <p><strong>Tip:</strong> ปุ่ม <code>? Examples</code> ในหน้า Auto Assign จะเปิด modal ที่มีตัวอย่างทุกแบบ — copy หรือ insert ตรง ๆ ได้</p>
        </section>

        <section id="ug-pc-setting" className="ug-section">
          <h2>👥 PC Setting (Promoter & Conflicts)</h2>

          <h3>Promoter list</h3>
          <ul>
            <li><strong>Name</strong>, <strong>Active</strong> toggle, <strong>Role</strong> (Promoter / Admin)</li>
            <li><strong>Days Off</strong> — เลือก 7 day chips (เก็บเป็น string เช่น <code>"Fri,Sat"</code>)</li>
            <li>Admin role → ระบบจะ pin ไปร้าน <code>AIR</code> เท่านั้น (Auto Assign)</li>
          </ul>

          <h3>Store Preferences</h3>
          <p>ขยาย row ของ promoter เห็นรายการร้านทุกร้าน — คลิก badge เพื่อหมุน preference:</p>
          <ul>
            <li><span className="ug-pref ug-pref-must">Must</span> — บังคับให้เลือกจากกลุ่มนี้เท่านั้น</li>
            <li><span className="ug-pref ug-pref-pref">Preferred</span> — ชอบ ให้คะแนน bonus</li>
            <li><span className="ug-pref ug-pref-banned">Banned</span> — ห้าม</li>
            <li>(ไม่เลือก) = neutral</li>
          </ul>
          <p><strong>Card-required stores:</strong> ถ้ามีคน <code>must</code> ที่ร้านนั้นอย่างน้อย 1 คน → ระบบถือว่าร้านนี้เป็น <em>restricted store</em> คนที่ไม่ได้อยู่ใน must/preferred จะถูก validate เป็น <code>no-access</code> alert</p>

          <h3>Conflicts</h3>
          <p>กำหนดคู่ที่ห้ามทำงานร้านเดียวกันในวันเดียวกัน:</p>
          <ul>
            <li>เลือก Promoter A + Promoter B + reason (optional) → กด + Add</li>
            <li>Auto Assign จะหลีกเลี่ยงไม่ assign ทั้งคู่ไปร้านเดียวกันวันเดียวกัน</li>
            <li>ถ้า manual แก้ตรง shift table ให้ทั้งคู่อยู่ร้านเดียวกัน → ระบบจะแสดง <code>conflict</code> alert</li>
          </ul>
        </section>

        <section id="ug-store-setting" className="ug-section">
          <h2>🏬 Store Setting</h2>
          <h3>Fields ต่อร้าน</h3>
          <ul>
            <li><strong>Code</strong> — รหัสสั้น (เช่น VDM, AIR)</li>
            <li><strong>Name</strong> — ชื่อเต็ม</li>
            <li><strong>Active</strong> toggle — ปิดได้ถ้าไม่ใช้แล้ว</li>
            <li><strong>Open / Close Time</strong> — เวลาเปิด-ปิด</li>
            <li><strong>Max Capacity</strong> — จำนวน promoter สูงสุดต่อวัน (default 2)</li>
            <li><strong>Extra Allowance</strong> — ค่าเดินทางพิเศษ (free text)</li>
            <li><strong>Platform / Warehouse</strong> — ใช้ map กับยอดขายจาก orders</li>
            <li><strong>Shift Slots</strong> — รายการ time range ที่ใช้สำหรับร้านนี้</li>
          </ul>

          <h3>Shift Slot format</h3>
          <pre className="ug-code">{`10:00-19:00              # ทุกวัน
Mon-Thu 12:30-21:30      # ช่วงวัน (range)
Fri,Sat,Sun 13:00-22:00  # ลิสต์วัน (comma)`}</pre>
          <p>ระบบจะ match อัตโนมัติตามวัน — day-specific slots มี priority สูงกว่า plain slots</p>
        </section>

        <section id="ug-sales" className="ug-section">
          <h2>📊 Sales Performance</h2>
          <ul>
            <li>ดึงข้อมูลจาก <code>orders</code> table (last 3 months default)</li>
            <li>แสดง <strong>Store Performance</strong> — ยอดขาย, จำนวน orders, days worked, avg ต่อวัน</li>
            <li>แสดง <strong>Promoter Performance Grid</strong> — promoter × store พร้อมยอด</li>
            <li>คำนวณ <strong>Performance Index</strong> เพื่อช่วย optimize</li>
            <li>ตั้ง <strong>Store Tier</strong> (A/B/C/D) และ <strong>Promoter Grade Override</strong> ได้ที่นี่</li>
            <li>ใช้ map: warehouse → store code (เช่น <code>vir - dbm</code> → <code>VDM</code>)</li>
          </ul>
        </section>

        <section id="ug-attendance" className="ug-section">
          <h2>🕘 Attendance</h2>

          <h3>Source</h3>
          <p>
            ข้อมูลมาจาก LINE webhook ที่ใช้ OCR อ่าน screenshot check-in/out จากแอป CheckIn ของ third party
            ระบบ auto-match OCR name → promoter ผ่านตาราง alias <code>promoter_name_map</code>
          </p>

          <h3>Summary Cards</h3>
          <ul>
            <li>Total Records, Today, Alerts, Late In, Early Out</li>
          </ul>

          <h3>Filter Controls</h3>
          <ul>
            <li><strong>Search</strong> — ค้นหาตามวันที่ / ชื่อ / store code / alert label</li>
            <li><strong>Date range</strong> — From / To</li>
            <li><strong>Alert filter</strong> — All Records / Alerts Only</li>
            <li><strong>Merge Duplicates</strong> — รวม record ซ้ำของ promoter+date เดียวกัน (เก็บ check-in กับ check-out)</li>
          </ul>

          <h3>Columns</h3>
          <ol>
            <li><strong>Date</strong></li>
            <li><strong>Promoter</strong> — แก้ได้ผ่าน Edit (จะ save alias ไปด้วย)</li>
            <li><strong>Store</strong> — store ที่ check-in</li>
            <li><strong>Scheduled</strong> — กะที่จัดไว้ + เวลา</li>
            <li><strong>Check-in</strong> — แดงถ้า late</li>
            <li><strong>Check-out</strong> — แดงถ้า early</li>
            <li><strong>Hours</strong> — ชั่วโมงทำงาน (check_out − check_in) แสดง 🌙 ถ้าตรงกับวัน Ramadan</li>
            <li><strong>Status</strong> — matched / unmatched / error</li>
            <li><strong>Note</strong> — รวม shift.note + attendance.note (sync 2 ทาง)</li>
            <li><strong>Alerts / Actions</strong> — badges + ปุ่ม Edit</li>
          </ol>

          <h3>Alerts</h3>
          <ul>
            <li><strong>Late In</strong> — check-in ช้ากว่า scheduled start &gt; 15 นาที</li>
            <li><strong>Early Out</strong> — check-out เร็วกว่า scheduled end &gt; 15 นาที</li>
            <li><strong>No Check-in / No Check-out</strong></li>
            <li><strong>Unmatched</strong> — ไม่พบ promoter</li>
            <li><strong>No Shift</strong> — มีคนมา check-in แต่ไม่มีกะ</li>
            <li><strong>Wrong Store</strong> — check-in ที่ร้านอื่น (คนละห้าง)</li>
            <li><strong>Wrong Spot</strong> — check-in ที่จุดอื่นในห้างเดียวกัน (last 2 chars match)</li>
            <li><strong>Short Hours</strong> — ทำงาน &lt; 9 ชั่วโมง (suppressed ถ้าวันนั้นเป็น Ramadan)</li>
            <li><strong>Long Hours</strong> — ทำงาน &gt; 9.5 ชั่วโมง</li>
          </ul>

          <h3>Edit row</h3>
          <p>กด Edit → แก้ promoter / store / check-in / check-out / note → Save</p>
          <ul>
            <li>แก้ promoter จะ save alias สำหรับ OCR name → promoter ที่ <code>promoter_name_map</code></li>
            <li>แก้ note จะ sync กลับไปหา shift.note ทันที</li>
          </ul>

          <h3>Ramadan exception</h3>
          <ol>
            <li>ไปที่ Shift Table → คลิก header วัน → mark ด้วย label ที่มีคำว่า <code>ramadan</code></li>
            <li>คอลัมน์ Hours จะแสดง 🌙</li>
            <li>Short Hours alert ถูก suppress สำหรับวันนั้น</li>
          </ol>
        </section>

        <section id="ug-database" className="ug-section">
          <h2>🗄️ Database</h2>
          <ul>
            <li>แสดงรายการ shift ดิบทั้งหมด (date, promoter, type, time, note)</li>
            <li>มี search filter + pagination</li>
            <li>ใช้สำหรับ debug หรือ audit ข้อมูลใน Supabase</li>
          </ul>
        </section>

        <section id="ug-export" className="ug-section">
          <h2>📤 Export</h2>
          <p>ปุ่ม Export ใน Shift Table เปิด modal มี 3 รูปแบบ:</p>
          <ul>
            <li><strong>Image Card (PNG)</strong> — schedule รายคน เป็นรูปภาพ (สำหรับส่งให้ promoter)</li>
            <li><strong>Text (for messaging)</strong> — text format ที่อ่านง่ายมี emoji (ส่งใน LINE / WhatsApp)</li>
            <li><strong>CSV</strong> — สำหรับ Excel / Google Sheets</li>
          </ul>
        </section>

        <section id="ug-data-flow" className="ug-section">
          <h2>🔄 Data Flow</h2>
          <h3>Storage</h3>
          <ul>
            <li><strong>Supabase</strong> — shifts, promoters, stores, store_preferences, conflicts, special_dates, orders, attendance, promoter_name_map</li>
            <li><strong>localStorage</strong> — country, <code>auto_roaster_constraints</code> (snippets), <code>auto_roaster_drafts</code> (saved drafts)</li>
            <li><strong>Built-in JSON</strong> — <code>src/data/changelog.json</code> (auto-generated จาก git log)</li>
          </ul>

          <h3>Note Sync</h3>
          <p>shift.note ↔ attendance.note (ผ่าน promoter_id + date):</p>
          <ul>
            <li>แก้ shift note → save shift → call <code>onSyncNoteToAttendance</code> → update attendance row</li>
            <li>แก้ attendance note → save → call <code>onSyncNoteToShift</code> → update shift row</li>
            <li>UI แสดงรวม: <code>shift.note · attendance.note</code></li>
          </ul>

          <h3>Country switching</h3>
          <p>เปลี่ยนประเทศ → ทุก hook reload จาก table prefix ใหม่ (เช่น <code>shifts</code> ↔ <code>shifts_qa</code>)</p>
        </section>

        <section id="ug-guide" className="ug-section">
          <h2>📖 Guide & Changelog</h2>
          <ul>
            <li><strong>Guide</strong> — หน้านี้ แก้ที่ <code>src/components/UserGuidePage.tsx</code></li>
            <li><strong>Changelog</strong> — อ่านจาก <code>src/data/changelog.json</code> ที่ auto-generate ตอน <code>npm run dev</code> / <code>npm run build</code> โดย <code>scripts/build-changelog.mjs</code></li>
            <li>บน Vercel build script จะ no-op เพราะ git ไม่มีใน build sandbox — ใช้ JSON ที่ commit ไว้แทน</li>
            <li>Manual rebuild: <code>npm run changelog</code></li>
          </ul>
        </section>
      </div>
    </div>
  );
};

export default UserGuidePage;
