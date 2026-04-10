import './UserGuidePage.css';

const UserGuidePage = () => {
  return (
    <div className="ug-page">
      <div className="ug-header">
        <h2>User Guide</h2>
        <p>วิธีใช้งาน ShiftPro แบบย่อ</p>
      </div>

      <section className="ug-section">
        <h3>📅 Shift Table</h3>
        <ul>
          <li><strong>Hover</strong> ที่ cell เพื่อ focus, แล้วใช้ <code>arrow keys</code> เลื่อนได้</li>
          <li><strong>Enter</strong> บน cell ที่ focus → เปิด quick-edit input</li>
          <li>พิมพ์ชื่อร้านสั้น ๆ เช่น <code>vdm</code> หรือ <code>vdm 10</code> (ชื่อร้าน + ชั่วโมงเริ่มกะ)</li>
          <li>พิมพ์ <code>off</code>, <code>lop</code>, <code>sl</code> สำหรับ special shifts, หรือ <code>-</code> เพื่อล้าง</li>
          <li><strong>Enter</strong> ยืนยัน + ไปลง · <strong>Tab</strong> ยืนยัน + ไปขวา · <strong>Esc</strong> ยกเลิก</li>
          <li><strong>Cmd+C</strong> / <strong>Cmd+V</strong> copy/paste cell · <strong>Cmd+Z</strong> / <strong>Cmd+Shift+Z</strong> undo/redo</li>
          <li><strong>Double-click</strong> เพื่อแก้ note</li>
          <li>Cell ที่มี <span className="ug-badge ug-badge-error">!</span> = error (banned, conflict, day off, no access) — hover ดู detail</li>
          <li>Cell ที่มี <span className="ug-badge ug-badge-warn">⚠</span> = warning (low performance, late→early shift)</li>
        </ul>
      </section>

      <section className="ug-section">
        <h3>🤖 Auto Assign</h3>
        <ul>
          <li>เลือก date range, กด <strong>Optimize Revenue</strong> เพื่อรัน Hungarian algorithm</li>
          <li>Algorithm จะใช้ historical revenue + preferences + conflicts + saved snippets</li>
          <li>ใน <strong>Additional Constraints</strong> เขียน Python DSL เช่น:
            <pre className="ug-code">{`store_min_people["VDM"] = 2
assign("kevin", "Mon", "VDM")
day_off("maureen", "Tue")
end_time("kevin", "22:00")`}</pre>
          </li>
          <li>กด <strong>Save Snippet</strong> เก็บไว้ใช้ครั้งหน้า, toggle ✓ เพื่อเปิด/ปิด</li>
          <li>กด <strong>Save Draft</strong> เก็บ draft ไว้ก่อน apply จริง</li>
          <li>กด <strong>Apply to Shift Table →</strong> เพื่อ commit ลง shift table</li>
        </ul>
      </section>

      <section className="ug-section">
        <h3>👥 Attendance</h3>
        <ul>
          <li>Records ดึงจาก LINE webhook (OCR check-in/out)</li>
          <li>Alerts: <strong>Late In</strong>, <strong>Early Out</strong>, <strong>Wrong Store</strong>, <strong>Wrong Spot</strong>, <strong>Short Hours</strong> (&lt;9h), <strong>Long Hours</strong> (&gt;9.5h)</li>
          <li>คอลัมน์ <strong>Hours</strong> = check_out − check_in. ช่วง Ramadan (mark ผ่าน specialDates) จะไม่ alert ถ้าทำงานน้อยกว่า 9h</li>
          <li>กด <strong>Edit</strong> เพื่อแก้ promoter / store / time / note</li>
          <li>Note ของ shift และ attendance sync กันสองทาง (แสดงรวมเป็น <code>shift · attendance</code>)</li>
        </ul>
      </section>

      <section className="ug-section">
        <h3>⚙️ Settings</h3>
        <ul>
          <li><strong>Store Setting</strong> — กำหนด store, shift slots, capacity</li>
          <li><strong>PC Setting</strong> — กำหนด promoter, conflicts, preferences (must / preferred / banned)</li>
          <li>Stores ที่มีคน <code>must</code> อย่างน้อย 1 คน → ระบบถือเป็น <em>restricted store</em> (ต้องมีบัตร), คนอื่นเข้าจะมี alert <code>no-access</code></li>
        </ul>
      </section>

      <section className="ug-section">
        <h3>🌙 Ramadan</h3>
        <ul>
          <li>ในหน้า Shift Table → คลิกหัวคอลัมน์วัน → mark วันด้วย label ที่มีคำว่า <code>ramadan</code></li>
          <li>วันที่ mark แล้ว → คอลัมน์ Hours จะแสดงไอคอน 🌙 และ short-hours alert จะถูก suppress</li>
        </ul>
      </section>
    </div>
  );
};

export default UserGuidePage;
