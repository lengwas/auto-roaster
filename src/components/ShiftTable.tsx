import { useState, useCallback } from 'react';
import type { Store, Promoter, Shift, StoreCount, SpecialDate } from '../types/types';
import { SPECIAL_SHIFTS } from '../types/types';
import ShiftPicker from './ShiftPicker';
import './ShiftTable.css';

interface ShiftTableProps {
  stores: Store[];
  promoters: Promoter[];
  shifts: Shift[];
  storeCounts: StoreCount[];
  dates: string[];
  onShiftChange?: (promoterId: string, date: string, newType: string, timeRange?: string, note?: string) => void;
  specialDates?: SpecialDate[];
  onMarkDate?: (date: string, label: string, color: string) => void;
  onUnmarkDate?: (date: string) => void;
}

const PRESET_COLORS = [
  { label: 'Holiday', color: '#ef4444' },
  { label: 'Event', color: '#f59e0b' },
  { label: 'Promo', color: '#8b5cf6' },
  { label: 'Note', color: '#3b82f6' },
  { label: 'Payday', color: '#10b981' },
];

interface DateMarkPopup {
  date: string;
  label: string;
  color: string;
}

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function formatDate(dateStr: string): { day: string; date: string; dow: string; isSun: boolean; isSat: boolean } {
  const d = new Date(dateStr + 'T00:00:00');
  const dayNum = d.getDay();
  return {
    day: d.getDate().toString(),
    date: `${d.getMonth() + 1}/${d.getDate()}`,
    dow: DAY_NAMES[dayNum],
    isSun: dayNum === 0,
    isSat: dayNum === 6,
  };
}

const SHIFT_COLOR_MAP: Record<string, string> = {
  VDM: 'shift-vdm', VDH: 'shift-vdh', VME: 'shift-vme',
  BDM: 'shift-bdm', JME: 'shift-jme', AIR: 'shift-air',
  VAY: 'shift-vay', VYM: 'shift-vym', VRM: 'shift-vrm',
  VMF: 'shift-vmf', VMN: 'shift-vmn', VNK: 'shift-vnk',
  JDM: 'shift-jdm', JDH: 'shift-jdh', SDM: 'shift-sdm',
  HDM: 'shift-hdm',
  LOP: 'shift-lop', Off: 'shift-off', SL: 'shift-sl',
};

function getShiftClass(type: string): string {
  return SHIFT_COLOR_MAP[type] || 'shift-store-default';
}

function getTodayStr(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

const ShiftTable = ({ stores, promoters, shifts, storeCounts, dates, onShiftChange, specialDates = [], onMarkDate, onUnmarkDate }: ShiftTableProps) => {
  const [editingNote, setEditingNote] = useState<string | null>(null); // key: promoterId_date
  const [noteText, setNoteText] = useState('');
  const [popup, setPopup] = useState<DateMarkPopup | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [hiddenStoreIds, setHiddenStoreIds] = useState<Set<string>>(new Set());
  const [hiddenPromoterIds, setHiddenPromoterIds] = useState<Set<string>>(new Set());
  const [activeOnlyPromoters, setActiveOnlyPromoters] = useState(true);

  const toggleStore = (id: string) => setHiddenStoreIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const togglePromoter = (id: string) => setHiddenPromoterIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const specialMap = new Map<string, SpecialDate>();
  specialDates.forEach(sd => specialMap.set(sd.date, sd));

  const openDatePopup = (dateStr: string) => {
    const existing = specialMap.get(dateStr);
    setPopup({ date: dateStr, label: existing?.label || '', color: existing?.color || '#f59e0b' });
  };

  const shiftMap = new Map<string, Shift>();
  shifts.forEach((s) => {
    shiftMap.set(`${s.promoterId}_${s.date}`, s);
  });

  const countMap = new Map<string, number>();
  storeCounts.forEach((sc) => {
    countMap.set(`${sc.storeId}_${sc.date}`, sc.count);
  });

  const storeByCode = new Map<string, Store>();
  stores.filter(s => s.active).forEach(s => storeByCode.set(s.code, s));

  const dateInfos = dates.map(formatDate);
  const todayStr = getTodayStr();

  const activeStores = stores.filter(s => s.active);
  const visibleStores = stores.filter(s => !hiddenStoreIds.has(s.id));
  const activePromoters = promoters.filter(p => p.active);
  const promoterPool = activeOnlyPromoters ? activePromoters : promoters;
  const visiblePromoters = promoterPool.filter(p => !hiddenPromoterIds.has(p.id));

  const handleChange = useCallback((promoterId: string, date: string, value: string) => {
    if (!onShiftChange) return;
    if (value === '-') {
      onShiftChange(promoterId, date, '', undefined, undefined);
      return;
    }
    if (SPECIAL_SHIFTS.includes(value as typeof SPECIAL_SHIFTS[number])) {
      onShiftChange(promoterId, date, value, undefined, undefined);
      return;
    }
    const store = storeByCode.get(value);
    const timeRange = store ? `${store.openTime}-${store.closeTime}` : undefined;
    onShiftChange(promoterId, date, value, timeRange, undefined);
  }, [onShiftChange, storeByCode]);

  const handleNoteClick = (key: string, currentNote: string) => {
    setEditingNote(key);
    setNoteText(currentNote);
  };

  const handleNoteSave = (promoterId: string, date: string) => {
    if (!onShiftChange) return;
    const shift = shiftMap.get(`${promoterId}_${date}`);
    onShiftChange(promoterId, date, shift?.type || '', shift?.timeRange, noteText);
    setEditingNote(null);
    setNoteText('');
  };

  const handleNoteKeyDown = (e: React.KeyboardEvent, promoterId: string, date: string) => {
    if (e.key === 'Escape') {
      setEditingNote(null);
      setNoteText('');
    }
    // Enter inside textarea creates newline; save via button or blur
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleNoteSave(promoterId, date);
    }
  };

  return (
    <div className="shift-table-root">
      {/* Filter Panel — sidebar, not overlay */}
      {filterOpen && (
        <div className="filter-panel">
          <div className="filter-panel-header">
            <span>Filter</span>
            <button className="filter-close-btn" onClick={() => setFilterOpen(false)}>✕</button>
          </div>

            <div className="filter-section">
              <div className="filter-section-title">
                Stores
                <span className="filter-section-actions">
                  <button onClick={() => setHiddenStoreIds(new Set())}>All</button>
                  <button onClick={() => setHiddenStoreIds(new Set(stores.map(s => s.id)))}>None</button>
                </span>
              </div>
              {stores.map(s => (
                <label key={s.id} className="filter-item">
                  <input
                    type="checkbox"
                    checked={!hiddenStoreIds.has(s.id)}
                    onChange={() => toggleStore(s.id)}
                  />
                  <span className="filter-item-code">{s.code}</span>
                  <span className="filter-item-name">{s.name}</span>
                  {!s.active && <span className="filter-inactive-badge">inactive</span>}
                </label>
              ))}
            </div>

            <div className="filter-section">
              <div className="filter-section-title">
                Promoters
                <span className="filter-section-actions">
                  <button onClick={() => setHiddenPromoterIds(new Set())}>All</button>
                  <button onClick={() => setHiddenPromoterIds(new Set(promoterPool.map(p => p.id)))}>None</button>
                </span>
              </div>
              <label className="filter-item filter-active-only">
                <input
                  type="checkbox"
                  checked={activeOnlyPromoters}
                  onChange={e => { setActiveOnlyPromoters(e.target.checked); setHiddenPromoterIds(new Set()); }}
                />
                <span className="filter-item-name" style={{ fontWeight: 600 }}>Active only</span>
                <span className="filter-item-stores">{activePromoters.length} / {promoters.length}</span>
              </label>
              {promoterPool.map(p => (
                <label key={p.id} className="filter-item">
                  <input
                    type="checkbox"
                    checked={!hiddenPromoterIds.has(p.id)}
                    onChange={() => togglePromoter(p.id)}
                  />
                  <span className="filter-item-name">{p.name}</span>
                  {!p.active && <span className="filter-inactive-badge">inactive</span>}
                  {p.storesLabel && <span className="filter-item-stores">{p.storesLabel}</span>}
                </label>
              ))}
            </div>
          </div>
      )}

      <div className="table-container">
      {/* Filter Button */}
      <div className="filter-toolbar">
        <button className="filter-btn" onClick={() => setFilterOpen(true)}>
          ▼ Filter
          {(hiddenStoreIds.size > 0 || hiddenPromoterIds.size > 0) && (
            <span className="filter-badge">{hiddenStoreIds.size + hiddenPromoterIds.size}</span>
          )}
        </button>
      </div>

      {/* Date Mark Popup */}
      {popup && (
        <div className="date-mark-overlay" onClick={() => setPopup(null)}>
          <div className="date-mark-popup" onClick={e => e.stopPropagation()}>
            <div className="date-mark-title">Mark Date: {popup.date}</div>
            <div className="date-mark-presets">
              {PRESET_COLORS.map(p => (
                <button
                  key={p.color}
                  className="date-mark-preset"
                  style={{ backgroundColor: p.color, outline: popup.color === p.color ? '2px solid #000' : 'none' }}
                  onClick={() => setPopup({ ...popup, label: popup.label || p.label, color: p.color })}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              className="date-mark-input"
              type="text"
              placeholder="Label (e.g. National Day)"
              value={popup.label}
              onChange={e => setPopup({ ...popup, label: e.target.value })}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <input
                type="color"
                value={popup.color}
                onChange={e => setPopup({ ...popup, color: e.target.value })}
                style={{ width: 36, height: 32, cursor: 'pointer', border: 'none', borderRadius: 4 }}
              />
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => { onMarkDate?.(popup.date, popup.label, popup.color); setPopup(null); }}
                disabled={!popup.label.trim()}
              >
                Save
              </button>
              {specialMap.has(popup.date) && (
                <button
                  className="btn btn-danger-ghost"
                  onClick={() => { onUnmarkDate?.(popup.date); setPopup(null); }}
                >
                  Remove
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => setPopup(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="shift-grid">
        {/* ===== HEADER SECTION (Sticky Top) ===== */}
        <div className="header-section">
          <div className="grid-row header-date-row">
            <div className="cell cell-fixed-left col-name">Locked</div>
            <div className="cell cell-fixed-left-2 col-stores"></div>
            <div className="cell cell-fixed-left-3 col-day"></div>
            {dates.map((dateStr, i) => {
              const special = specialMap.get(dateStr);
              return (
                <div
                  key={dateStr}
                  className={`cell col-date date-header-cell ${dateStr === todayStr ? 'col-today' : ''}`}
                  style={special ? { backgroundColor: special.color + '33', borderTop: `3px solid ${special.color}` } : {}}
                  onClick={() => openDatePopup(dateStr)}
                  title={special ? special.label : 'Click to mark this date'}
                >
                  {dateInfos[i].date}
                  {special && <span className="date-mark-dot" style={{ backgroundColor: special.color }} title={special.label} />}
                </div>
              );
            })}
          </div>

          <div className="grid-row header-dow-row">
            <div className="cell cell-fixed-left col-name" style={{ fontWeight: 700 }}>Name</div>
            <div className="cell cell-fixed-left-2 col-stores" style={{ fontWeight: 700 }}>Stores</div>
            <div className="cell cell-fixed-left-3 col-day" style={{ fontWeight: 700 }}>Day Off</div>
            {dates.map((dateStr, i) => {
              const special = specialMap.get(dateStr);
              return (
                <div
                  key={dateStr}
                  className={`cell col-date ${dateStr === todayStr ? 'col-today' : ''} ${dateInfos[i].isSun ? 'dow-sun' : ''} ${dateInfos[i].isSat ? 'dow-sat' : ''}`}
                  style={{ fontWeight: 600, ...(special ? { backgroundColor: special.color + '22' } : {}) }}
                >
                  {special ? <span style={{ color: special.color, fontWeight: 700 }}>{special.label.slice(0, 4)}</span> : dateInfos[i].dow}
                </div>
              );
            })}
          </div>
        </div>

        {/* ===== STORE SECTION (Sticky below header) ===== */}
        <div className="store-section">
          <div className="section-spacer">Stores ({visibleStores.length}{hiddenStoreIds.size > 0 ? ` / ${stores.length}` : ''})</div>
          {visibleStores.map((store) => {
            const hasExtra = !!store.extraAllowance;
            return (
              <div
                key={store.id}
                className="grid-row"
                style={{ backgroundColor: hasExtra ? 'var(--row-store-alt)' : 'var(--row-store)' }}
              >
                <div className="cell cell-fixed-left col-name" style={{ backgroundColor: hasExtra ? 'var(--row-store-alt)' : 'var(--row-store)' }}>
                  {store.code}
                  {store.extraAllowance && (
                    <span className="extra-allowance">{store.extraAllowance}</span>
                  )}
                </div>
                <div className="cell cell-fixed-left-2 col-stores" style={{ backgroundColor: hasExtra ? 'var(--row-store-alt)' : 'var(--row-store)' }}>
                  {store.name}
                </div>
                <div className="cell cell-fixed-left-3 col-day" style={{ backgroundColor: hasExtra ? 'var(--row-store-alt)' : 'var(--row-store)', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {store.openTime}-{store.closeTime}
                </div>
                {dates.map((dateStr) => {
                  const count = countMap.get(`${store.id}_${dateStr}`) ?? 0;
                  return (
                    <div
                      key={dateStr}
                      className={`cell col-date ${dateStr === todayStr ? 'col-today' : ''}`}
                      style={{ backgroundColor: hasExtra ? 'var(--row-store-alt)' : undefined }}
                    >
                      <span className={count === 0 ? 'zero-count' : 'active-count'}>
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* ===== PROMOTER SECTION (Scrollable with dropdowns) ===== */}
        <div className="section-spacer">Promoters ({visiblePromoters.length}{(hiddenPromoterIds.size > 0 || !activeOnlyPromoters) ? ` / ${promoterPool.length}` : ''} Active)</div>
        {visiblePromoters.map((promoter) => (
          <div key={promoter.id} className="grid-row promoter-row">
            <div className="cell cell-fixed-left col-name">
              {promoter.name}
            </div>
            <div className="cell cell-fixed-left-2 col-stores">
              {promoter.storesLabel}
            </div>
            <div className="cell cell-fixed-left-3 col-day">
              {promoter.workingDays}
            </div>
            {dates.map((dateStr) => {
              const shift = shiftMap.get(`${promoter.id}_${dateStr}`);
              const shiftClass = shift ? getShiftClass(shift.type) : '';
              const cellKey = `${promoter.id}_${dateStr}`;
              const isEditingNote = editingNote === cellKey;
              return (
                <div
                  key={dateStr}
                  className={`cell col-date ${dateStr === todayStr ? 'col-today' : ''} ${shiftClass} ${shift?.note ? 'has-note' : ''}`}
                  onDoubleClick={() => handleNoteClick(cellKey, shift?.note || '')}
                >
                  <ShiftPicker
                    value={shift?.type || '-'}
                    stores={activeStores}
                    onChange={(val) => handleChange(promoter.id, dateStr, val)}
                  />
                  {shift?.timeRange && (
                    <span className="shift-time">{shift.timeRange}</span>
                  )}
                  {shift?.note && (
                    <span className="note-tooltip">{shift.note}</span>
                  )}
                  {shift && shift.type && shift.type !== '-' && isEditingNote && (
                    <div className="note-overlay" onClick={(e) => e.stopPropagation()}>
                      <textarea
                        className="note-textarea"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        onKeyDown={(e) => handleNoteKeyDown(e, promoter.id, dateStr)}
                        placeholder="Add note..."
                        autoFocus
                        rows={3}
                      />
                      <div className="note-actions">
                        <button className="note-btn note-btn-cancel" onClick={() => { setEditingNote(null); setNoteText(''); }}>Cancel</button>
                        <button className="note-btn note-btn-save" onClick={() => handleNoteSave(promoter.id, dateStr)}>Save</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
};

export default ShiftTable;
