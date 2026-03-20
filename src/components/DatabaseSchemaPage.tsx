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
          timeRange: s.timeRange || '-',
          note: s.note || '',
        };
      });
  }, [shifts, storeMap, promoterMap]);

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return flatRows;
    const q = search.toLowerCase();
    return flatRows.filter(r =>
      r.date.includes(q) || r.promoter.toLowerCase().includes(q) ||
      r.shiftType.toLowerCase().includes(q) || r.storeName.toLowerCase().includes(q)
    );
  }, [flatRows, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="schema-page">
      <div className="schema-header">
        <h2>Shift Data</h2>
        <p>1 row = 1 person + 1 day</p>
      </div>

      <div className="schema-section">
        <div className="flat-toolbar">
          <input
            type="text"
            className="flat-search"
            placeholder="Search date, promoter, store..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
          <span className="flat-count">{filtered.length.toLocaleString()} rows</span>
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
              {paged.map((r, i) => (
                <tr key={`${r.date}_${r.promoter}_${i}`} className={SPECIAL_SHIFTS.has(r.shiftType) ? 'flat-row-special' : ''}>
                  <td>{r.date}</td>
                  <td>{r.promoter}</td>
                  <td><span className={`flat-badge flat-badge-${SPECIAL_SHIFTS.has(r.shiftType) ? r.shiftType.toLowerCase() : 'store'}`}>{r.shiftType}</span></td>
                  <td>{r.storeName}</td>
                  <td>{r.timeRange}</td>
                  <td className="flat-note">{r.note || '-'}</td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: '32px' }}>No shift data</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flat-pagination">
            <button className="btn btn-small btn-ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span className="flat-page-info">Page {page + 1} / {totalPages}</span>
            <button className="btn btn-small btn-ghost" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DatabaseSchemaPage;
