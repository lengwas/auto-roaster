import { useMemo, useState } from 'react';
import type { Store, Promoter, Shift, SpecialDate } from '../types/types';
import type { Attendance } from '../hooks/useAttendance';
import './AttendancePage.css';

interface AttendancePageProps {
  stores: Store[];
  promoters: Promoter[];
  shifts: Shift[];
  attendance: Attendance[];
  specialDates?: SpecialDate[];
  loading: boolean;
  onUpdate: (id: string, updates: {
    promoter_id?: string | null;
    promoter_name?: string | null;
    store_code?: string | null;
    store_name?: string | null;
    check_in?: string | null;
    check_out?: string | null;
    status?: string;
    note?: string | null;
  }, originalOcrName?: string | null) => Promise<void>;
  onMergeDuplicates: () => Promise<number>;
  /** Sync the attendance note back to the matching shift's note (same promoter+date). */
  onSyncNoteToShift?: (promoterId: string, date: string, note: string) => void;
}

const PAGE_SIZE = 50;

/** Parse "HH:MM" or "HH:MM:SS" to minutes since midnight */
function toMinutes(t: string | null): number | null {
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length < 2) return null;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/** Format "HH:MM:SS" to "HH:MM" */
function fmtTime(t: string | null): string {
  if (!t) return '-';
  return t.substring(0, 5);
}

/** Minutes to "Xh Ym" */
function fmtDuration(min: number): string {
  const sign = min < 0 ? '-' : '+';
  const abs = Math.abs(min);
  if (abs < 60) return `${sign}${abs}m`;
  return `${sign}${Math.floor(abs / 60)}h${abs % 60 > 0 ? ` ${abs % 60}m` : ''}`;
}

type AlertType = 'late-in' | 'early-out' | 'no-checkin' | 'no-checkout' | 'unmatched' | 'no-shift' | 'wrong-store' | 'wrong-spot' | 'short-hours' | 'long-hours';

const MIN_HOURS = 9;       // alert if worked < 9h
const MAX_HOURS = 9.5;     // alert if worked > 9.5h

interface AlertInfo {
  type: AlertType;
  label: string;
  detail?: string;
}

interface AttendanceRow {
  id: string;
  date: string;
  promoterName: string;
  promoterId: string | null;
  storeCode: string | null;
  storeName: string | null;
  // Scheduled
  scheduledStore: string | null;
  scheduledTime: string | null;
  // Actual
  checkIn: string | null;
  checkOut: string | null;
  // Analysis
  alerts: AlertInfo[];
  status: string;
  confidence: string | null;
  note: string | null;
  shiftNote: string | null;
  workedMin: number | null;
  isRamadan: boolean;
}

const LATE_THRESHOLD = 15; // minutes grace period

interface EditState {
  id: string;
  promoterId: string | null;
  storeCode: string | null;
  checkIn: string;
  checkOut: string;
  note: string;
  originalOcrName: string | null; // raw name from attendance for alias saving
}

const AttendancePage = ({ stores, promoters, shifts, attendance, specialDates = [], loading, onUpdate, onMergeDuplicates, onSyncNoteToShift }: AttendancePageProps) => {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [alertFilter, setAlertFilter] = useState<'all' | 'alerts-only'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [merging, setMerging] = useState(false);

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

  // Build shift lookup: promoterId_date -> Shift
  const shiftLookup = useMemo(() => {
    const m = new Map<string, Shift>();
    shifts.forEach(s => m.set(`${s.promoterId}_${s.date}`, s));
    return m;
  }, [shifts]);

  // Set of YYYY-MM-DD dates marked as Ramadan via specialDates (label contains 'ramadan')
  const ramadanDays = useMemo(() => {
    const set = new Set<string>();
    for (const sd of specialDates) {
      if (sd.label.toLowerCase().includes('ramadan')) set.add(sd.date);
    }
    return set;
  }, [specialDates]);

  const rows: AttendanceRow[] = useMemo(() => {
    return attendance.map(a => {
      const alerts: AlertInfo[] = [];

      // Find scheduled shift for this promoter + date
      const shift = a.promoterId ? shiftLookup.get(`${a.promoterId}_${a.date}`) : null;
      const scheduledStore = shift?.type || null;
      const scheduledTime = shift?.timeRange || null;

      // Determine expected start/end times
      let expectedStart: number | null = null;
      let expectedEnd: number | null = null;

      if (scheduledTime && scheduledTime.includes('-')) {
        const [s, e] = scheduledTime.split('-');
        expectedStart = toMinutes(s.trim());
        expectedEnd = toMinutes(e.trim());
      } else if (scheduledStore && storeMap.has(scheduledStore)) {
        const store = storeMap.get(scheduledStore)!;
        expectedStart = toMinutes(store.openTime);
        expectedEnd = toMinutes(store.closeTime);
      }

      // Unmatched promoter
      if (a.status === 'unmatched') {
        alerts.push({ type: 'unmatched', label: 'Unmatched', detail: 'ไม่พบ Promoter ในระบบ' });
      }

      // No scheduled shift
      if (!shift && a.promoterId) {
        alerts.push({ type: 'no-shift', label: 'No Shift', detail: 'ไม่มีกะที่จัดไว้ในวันนี้' });
      }

      // Wrong store — check-in at different store than scheduled.
      // If the last 2 chars match (e.g. VDM vs JDM, both = Dubai Mall), it's the same mall —
      // downgrade to a soft "wrong-spot" note instead of a hard "wrong-store" alert.
      if (a.storeCode && scheduledStore && a.storeCode !== scheduledStore
          && !['Off', 'LOP', 'SL', 'AL'].includes(scheduledStore)) {
        const sameMall = a.storeCode.length >= 2 && scheduledStore.length >= 2
          && a.storeCode.slice(-2).toUpperCase() === scheduledStore.slice(-2).toUpperCase();

        if (sameMall) {
          alerts.push({
            type: 'wrong-spot',
            label: 'Wrong Spot',
            detail: `Check-in ที่ ${a.storeCode} (ห้างเดียวกับ ${scheduledStore} แต่คนละจุด)`,
          });
        } else {
          alerts.push({
            type: 'wrong-store',
            label: 'Wrong Store',
            detail: `Check-in ที่ ${a.storeCode} แต่กะจัดไว้ที่ ${scheduledStore}`,
          });
        }
      }

      // Check-in analysis
      if (a.checkIn && expectedStart !== null) {
        const actualIn = toMinutes(a.checkIn);
        if (actualIn !== null) {
          const diff = actualIn - expectedStart;
          if (diff > LATE_THRESHOLD) {
            alerts.push({
              type: 'late-in',
              label: 'Late In',
              detail: `เข้างานสาย ${fmtDuration(diff)} (กะเริ่ม ${fmtTime(scheduledTime?.split('-')[0]?.trim() || null)})`,
            });
          }
        }
      } else if (!a.checkIn && a.checkOut) {
        alerts.push({ type: 'no-checkin', label: 'No Check-in', detail: 'มีแต่ check-out ไม่มี check-in' });
      }

      // Check-out analysis
      if (a.checkOut && expectedEnd !== null) {
        const actualOut = toMinutes(a.checkOut);
        if (actualOut !== null) {
          const diff = expectedEnd - actualOut;
          if (diff > LATE_THRESHOLD) {
            alerts.push({
              type: 'early-out',
              label: 'Early Out',
              detail: `ออกก่อนเวลา ${fmtDuration(diff)} (กะจบ ${fmtTime(scheduledTime?.split('-')[1]?.trim() || null)})`,
            });
          }
        }
      } else if (a.checkIn && !a.checkOut) {
        // Only flag no-checkout for records older than today
        const today = new Date().toISOString().split('T')[0];
        if (a.date < today) {
          alerts.push({ type: 'no-checkout', label: 'No Check-out', detail: 'ยังไม่ได้ check-out' });
        }
      }

      // Worked hours analysis (check_out - check_in)
      let workedMin: number | null = null;
      if (a.checkIn && a.checkOut) {
        const inMin = toMinutes(a.checkIn);
        const outMin = toMinutes(a.checkOut);
        if (inMin !== null && outMin !== null) {
          workedMin = outMin - inMin;
          if (workedMin < 0) workedMin += 24 * 60; // overnight wraps
          const hours = workedMin / 60;
          const isRamadan = ramadanDays.has(a.date);
          if (hours < MIN_HOURS && !isRamadan) {
            alerts.push({
              type: 'short-hours',
              label: 'Short Hours',
              detail: `ทำงาน ${hours.toFixed(1)}h (ต่ำกว่า ${MIN_HOURS}h)`,
            });
          }
          if (hours > MAX_HOURS) {
            alerts.push({
              type: 'long-hours',
              label: 'Long Hours',
              detail: `ทำงาน ${hours.toFixed(1)}h (เกิน ${MAX_HOURS}h)`,
            });
          }
        }
      }

      const promoter = a.promoterId ? promoterMap.get(a.promoterId) : null;

      return {
        id: a.id,
        date: a.date,
        promoterName: promoter?.name || a.promoterName || 'Unknown',
        promoterId: a.promoterId,
        storeCode: a.storeCode,
        storeName: a.storeName || (a.storeCode ? storeMap.get(a.storeCode)?.name : null) || null,
        scheduledStore,
        scheduledTime,
        checkIn: a.checkIn,
        checkOut: a.checkOut,
        alerts,
        status: a.status,
        confidence: a.ocrConfidence,
        note: a.note,
        shiftNote: shift?.note ?? null,
        workedMin,
        isRamadan: ramadanDays.has(a.date),
      };
    });
  }, [attendance, shiftLookup, storeMap, promoterMap, ramadanDays]);

  const filtered = useMemo(() => {
    let result = rows;

    // Date filter
    if (dateFrom) result = result.filter(r => r.date >= dateFrom);
    if (dateTo) result = result.filter(r => r.date <= dateTo);

    // Alert filter
    if (alertFilter === 'alerts-only') {
      result = result.filter(r => r.alerts.length > 0);
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.date.includes(q) ||
        r.promoterName.toLowerCase().includes(q) ||
        (r.storeCode || '').toLowerCase().includes(q) ||
        (r.storeName || '').toLowerCase().includes(q) ||
        r.alerts.some(a => a.label.toLowerCase().includes(q))
      );
    }

    return result;
  }, [rows, search, alertFilter, dateFrom, dateTo]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Summary stats
  const stats = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayRecords = rows.filter(r => r.date === today);
    const totalAlerts = rows.filter(r => r.alerts.length > 0).length;
    const lateCount = rows.filter(r => r.alerts.some(a => a.type === 'late-in')).length;
    const earlyOutCount = rows.filter(r => r.alerts.some(a => a.type === 'early-out')).length;
    return { total: rows.length, today: todayRecords.length, totalAlerts, lateCount, earlyOutCount };
  }, [rows]);

  const startEdit = (r: AttendanceRow) => {
    // Find the original attendance record to get the raw OCR name
    const orig = attendance.find(a => a.id === r.id);
    setEditing({
      id: r.id,
      promoterId: r.promoterId,
      storeCode: r.storeCode,
      checkIn: r.checkIn ? r.checkIn.substring(0, 5) : '',
      checkOut: r.checkOut ? r.checkOut.substring(0, 5) : '',
      note: r.note ?? '',
      originalOcrName: orig?.promoterName || null,
    });
  };

  const cancelEdit = () => setEditing(null);

  const handleMerge = async () => {
    setMerging(true);
    const count = await onMergeDuplicates();
    setMerging(false);
    if (count > 0) {
      alert(`รวมสำเร็จ: ลบ ${count} รายการซ้ำ`);
    } else {
      alert('ไม่มีรายการซ้ำ');
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    const promoter = editing.promoterId ? promoterMap.get(editing.promoterId) : null;
    const store = editing.storeCode ? storeMap.get(editing.storeCode) : null;
    await onUpdate(editing.id, {
      promoter_id: editing.promoterId || null,
      promoter_name: promoter?.name || null,
      store_code: editing.storeCode || null,
      store_name: store?.name || null,
      check_in: editing.checkIn ? editing.checkIn + ':00' : null,
      check_out: editing.checkOut ? editing.checkOut + ':00' : null,
      status: editing.promoterId ? 'matched' : 'unmatched',
      note: editing.note || null,
    }, editing.originalOcrName);
    // Sync note to the matching shift (if any)
    if (onSyncNoteToShift && editing.promoterId) {
      const orig = attendance.find(a => a.id === editing.id);
      if (orig) onSyncNoteToShift(editing.promoterId, orig.date, editing.note);
    }
    setSaving(false);
    setEditing(null);
  };

  if (loading) {
    return (
      <div className="att-page">
        <div className="att-header">
          <h2>Attendance</h2>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="att-page">
      <div className="att-header">
        <h2>Attendance</h2>
        <p>LINE check-in/out records with shift comparison</p>
      </div>

      {/* Summary Cards */}
      <div className="att-summary">
        <div className="att-stat-card">
          <div className="att-stat-value">{stats.total}</div>
          <div className="att-stat-label">Total Records</div>
        </div>
        <div className="att-stat-card att-stat-today">
          <div className="att-stat-value">{stats.today}</div>
          <div className="att-stat-label">Today</div>
        </div>
        <div className="att-stat-card att-stat-alert">
          <div className="att-stat-value">{stats.totalAlerts}</div>
          <div className="att-stat-label">Alerts</div>
        </div>
        <div className="att-stat-card att-stat-late">
          <div className="att-stat-value">{stats.lateCount}</div>
          <div className="att-stat-label">Late In</div>
        </div>
        <div className="att-stat-card att-stat-early">
          <div className="att-stat-value">{stats.earlyOutCount}</div>
          <div className="att-stat-label">Early Out</div>
        </div>
      </div>

      {/* Filters */}
      <div className="att-toolbar">
        <input
          type="text"
          className="att-search"
          placeholder="Search name, store, date..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
        />
        <input type="date" className="att-date-input" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0); }} />
        <span className="att-date-sep">~</span>
        <input type="date" className="att-date-input" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0); }} />
        <select
          className="att-filter-select"
          value={alertFilter}
          onChange={e => { setAlertFilter(e.target.value as 'all' | 'alerts-only'); setPage(0); }}
        >
          <option value="all">All Records</option>
          <option value="alerts-only">Alerts Only</option>
        </select>
        <button
          className="btn btn-small"
          style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer' }}
          onClick={handleMerge}
          disabled={merging}
        >
          {merging ? 'Merging...' : 'Merge Duplicates'}
        </button>
        <span className="att-count">{filtered.length} records</span>
      </div>

      {/* Table */}
      <div className="att-table-wrap">
        <table className="att-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Promoter</th>
              <th>Store</th>
              <th>Scheduled</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th>Hours</th>
              <th>Status</th>
              <th>Note</th>
              <th>Alerts / Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.map(r => {
              const isEditing = editing?.id === r.id;
              return (
              <tr key={r.id} className={r.alerts.length > 0 ? 'att-row-alert' : ''}>
                <td>{r.date}</td>
                <td>
                  {isEditing ? (
                    <select
                      className="att-edit-select"
                      value={editing.promoterId || ''}
                      onChange={e => setEditing({ ...editing, promoterId: e.target.value || null })}
                    >
                      <option value="">-- None --</option>
                      {promoters.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="att-name">{r.promoterName}</span>
                  )}
                </td>
                <td>
                  {isEditing ? (
                    <select
                      className="att-edit-select"
                      value={editing.storeCode || ''}
                      onChange={e => setEditing({ ...editing, storeCode: e.target.value || null })}
                    >
                      <option value="">-- None --</option>
                      {stores.map(s => (
                        <option key={s.code} value={s.code}>{s.code}</option>
                      ))}
                    </select>
                  ) : (
                    r.storeCode ? (
                      <span className="att-store-badge">{r.storeCode}</span>
                    ) : (
                      <span className="att-muted">-</span>
                    )
                  )}
                </td>
                <td>
                  {r.scheduledStore ? (
                    <span>
                      <span className="att-sched-store">{r.scheduledStore}</span>
                      {r.scheduledTime && <span className="att-sched-time">{r.scheduledTime}</span>}
                    </span>
                  ) : (
                    <span className="att-muted">-</span>
                  )}
                </td>
                <td>
                  {isEditing ? (
                    <input
                      type="time"
                      className="att-edit-time"
                      value={editing.checkIn}
                      onChange={e => setEditing({ ...editing, checkIn: e.target.value })}
                    />
                  ) : (
                    <span className={r.alerts.some(a => a.type === 'late-in') ? 'att-time-bad' : 'att-time-ok'}>
                      {fmtTime(r.checkIn)}
                    </span>
                  )}
                </td>
                <td>
                  {isEditing ? (
                    <input
                      type="time"
                      className="att-edit-time"
                      value={editing.checkOut}
                      onChange={e => setEditing({ ...editing, checkOut: e.target.value })}
                    />
                  ) : (
                    <span className={r.alerts.some(a => a.type === 'early-out') ? 'att-time-bad' : 'att-time-ok'}>
                      {fmtTime(r.checkOut)}
                    </span>
                  )}
                </td>
                <td>
                  {r.workedMin !== null ? (() => {
                    const hours = r.workedMin / 60;
                    const isShort = hours < MIN_HOURS && !r.isRamadan;
                    const isLong = hours > MAX_HOURS;
                    const cls = isShort ? 'att-time-bad' : isLong ? 'att-time-bad' : 'att-time-ok';
                    const label = `${hours.toFixed(1)}h${r.isRamadan ? ' 🌙' : ''}`;
                    return <span className={cls} title={r.isRamadan ? 'Ramadan — short hours allowed' : undefined}>{label}</span>;
                  })() : (
                    <span className="att-muted">-</span>
                  )}
                </td>
                <td>
                  <span className={`att-status att-status-${r.status}`}>{r.status}</span>
                </td>
                <td className="att-note-cell">
                  {isEditing ? (
                    <textarea
                      className="att-edit-note"
                      placeholder="Note…"
                      value={editing.note}
                      rows={2}
                      onChange={e => setEditing({ ...editing, note: e.target.value })}
                    />
                  ) : (
                    (() => {
                      const parts: string[] = [];
                      if (r.shiftNote) parts.push(r.shiftNote);
                      if (r.note) parts.push(r.note);
                      const combined = parts.join(' · ');
                      return combined ? <span className="att-note-text" title={combined}>{combined}</span> : <span className="att-muted">-</span>;
                    })()
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {r.alerts.length > 0 ? (
                      <div className="att-alerts">
                        {r.alerts.map((a, i) => (
                          <span key={i} className={`att-alert-tag att-alert-${a.type}`} title={a.detail}>
                            {a.label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="att-ok-tag">OK</span>
                    )}
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                        <button className="att-edit-btn att-edit-save" onClick={saveEdit} disabled={saving}>
                          {saving ? '...' : 'Save'}
                        </button>
                        <button className="att-edit-btn att-edit-cancel" onClick={cancelEdit} disabled={saving}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button className="att-edit-btn att-edit-start" style={{ marginLeft: 'auto' }} onClick={() => startEdit(r)}>
                        Edit
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
            {paged.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', color: '#94a3b8', padding: '32px' }}>
                  {attendance.length === 0 ? 'No attendance data yet' : 'No matching records'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="att-pagination">
          <button className="btn btn-small btn-ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            &larr; Prev
          </button>
          <span className="att-page-info">Page {page + 1} / {totalPages}</span>
          <button className="btn btn-small btn-ghost" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            Next &rarr;
          </button>
        </div>
      )}
    </div>
  );
};

export default AttendancePage;
