import { useMemo, useState } from 'react';
import type { Store, Promoter, Shift } from '../types/types';
import type { Attendance } from '../hooks/useAttendance';
import './AttendancePage.css';

interface AttendancePageProps {
  stores: Store[];
  promoters: Promoter[];
  shifts: Shift[];
  attendance: Attendance[];
  loading: boolean;
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

type AlertType = 'late-in' | 'early-out' | 'no-checkin' | 'no-checkout' | 'unmatched' | 'no-shift';

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
}

const LATE_THRESHOLD = 15; // minutes grace period

const AttendancePage = ({ stores, promoters, shifts, attendance, loading }: AttendancePageProps) => {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [alertFilter, setAlertFilter] = useState<'all' | 'alerts-only'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

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
      };
    });
  }, [attendance, shiftLookup, storeMap, promoterMap]);

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
              <th>Status</th>
              <th>Alerts</th>
            </tr>
          </thead>
          <tbody>
            {paged.map(r => (
              <tr key={r.id} className={r.alerts.length > 0 ? 'att-row-alert' : ''}>
                <td>{r.date}</td>
                <td className="att-name">{r.promoterName}</td>
                <td>
                  {r.storeCode ? (
                    <span className="att-store-badge">{r.storeCode}</span>
                  ) : (
                    <span className="att-muted">-</span>
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
                <td className={r.alerts.some(a => a.type === 'late-in') ? 'att-time-bad' : 'att-time-ok'}>
                  {fmtTime(r.checkIn)}
                </td>
                <td className={r.alerts.some(a => a.type === 'early-out') ? 'att-time-bad' : 'att-time-ok'}>
                  {fmtTime(r.checkOut)}
                </td>
                <td>
                  <span className={`att-status att-status-${r.status}`}>{r.status}</span>
                </td>
                <td>
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
                </td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: '#94a3b8', padding: '32px' }}>
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
