import { useState, useCallback } from 'react';
import type { Store, Promoter, Shift, StoreCount, SpecialDate, Order, StoreTierSetting, PromoterGradeOverride } from '../types/types';
import { SPECIAL_SHIFTS } from '../types/types';
import ShiftPicker from './ShiftPicker';
import { matchShiftSlot } from '../lib/shiftSlotUtils';
import './ShiftTable.css';

interface RevenueForecastEntry {
  date: string;
  expected: number;
  count: number;
}

interface ShiftTableProps {
  stores: Store[];
  promoters: Promoter[];
  shifts: Shift[];
  storeCounts: StoreCount[];
  dates: string[];
  orders?: Order[];
  onShiftChange?: (promoterId: string, date: string, newType: string, timeRange?: string, note?: string) => void;
  specialDates?: SpecialDate[];
  onMarkDate?: (date: string, label: string, color: string) => void;
  onUnmarkDate?: (date: string) => void;
  revenueForecast?: RevenueForecastEntry[];
  storeTiers?: StoreTierSetting[];
  gradeOverrides?: PromoterGradeOverride[];
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


// Grade-Tier fit mapping
const GRADE_TIER_FIT: Record<string, string[]> = {
  A: ['A', 'B'],
  B: ['A', 'B', 'C'],
  C: ['B', 'C', 'D'],
  D: ['C', 'D'],
};

const ShiftTable = ({ stores, promoters, shifts, storeCounts, dates, orders = [], onShiftChange, specialDates = [], onMarkDate, onUnmarkDate, revenueForecast, storeTiers = [], gradeOverrides = [] }: ShiftTableProps) => {
  const [editingNote, setEditingNote] = useState<string | null>(null); // key: promoterId_date
  const [noteText, setNoteText] = useState('');
  const [popup, setPopup] = useState<DateMarkPopup | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [hiddenStoreIds, setHiddenStoreIds] = useState<Set<string>>(new Set());
  const [hiddenPromoterIds, setHiddenPromoterIds] = useState<Set<string>>(new Set());
  const [activeOnlyPromoters, setActiveOnlyPromoters] = useState(true);
  const [hideEmptyStores, setHideEmptyStores] = useState(true);
  // Default to current month view
  const [filterStart, setFilterStart] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  });
  const [filterEnd, setFilterEnd] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
  });

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

  // Tier & grade lookups
  const tierMap = new Map<string, string>();
  storeTiers.forEach(t => tierMap.set(t.storeCode, t.tier));
  const gradeMap = new Map<string, string>();
  gradeOverrides.forEach(g => gradeMap.set(g.promoterId, g.grade));

  const visibleDates = dates.filter(d => d >= filterStart && d <= filterEnd);
  const dateInfos = visibleDates.map(formatDate);
  const todayStr = getTodayStr();

  const activeStores = stores.filter(s => s.active);
  const storesWithAssignments = new Set(
    visibleDates.flatMap(dateStr =>
      stores.filter(s => (countMap.get(`${s.id}_${dateStr}`) ?? 0) > 0).map(s => s.id)
    )
  );
  // Compute net revenue per store and per promoter from orders
  // Warehouse text → store code fallback map (when store.warehouse is not set)
  const WAREHOUSE_CODE_MAP: Record<string, string> = {
    'vir - dbm': 'VDM', 'vir - moe': 'VME', 'vir - dbh': 'VDH',
    'vir - mrn': 'VMN', 'vir - mdf': 'VMF', 'vir - nkm': 'VNK',
    'vir - yas': 'VYM', 'vir - amy': 'VAY', 'vir - rem': 'VRM',
    'vir - adm': 'VAD', 'vir - arb': 'VAY', 'vir - azc': 'VNK',
    'jsm - moe': 'JME', 'jsm - dbm': 'JDM', 'jsm - dbh': 'JDH',
    'bdr - dbm': 'BDM', 'bdr - dbh': 'JDH',
    'hls - dbm': 'HDM', 'sdg - dbm': 'SDM',
    'air - 48': 'AIR', 'air - dcc': 'ADC', 'img - wld': 'IMG',
  };
  const storeRevenueMap = new Map<string, number>();
  const promoterRevenueMap = new Map<string, number>();
  if (orders.length > 0) {
    const whToCode = new Map<string, string>();
    // Add hardcoded warehouse mappings first
    for (const [wh, code] of Object.entries(WAREHOUSE_CODE_MAP)) {
      whToCode.set(wh, code);
    }
    // Override with store-specific mappings
    stores.forEach(s => {
      if (s.warehouse) whToCode.set(s.warehouse.toLowerCase().trim(), s.code);
      if (s.platform) whToCode.set(s.platform.toLowerCase().trim(), s.code);
      whToCode.set(s.code.toLowerCase(), s.code);
    });
    const nameToId = new Map<string, string>();
    promoters.forEach(p => {
      nameToId.set(p.name.toLowerCase().trim(), p.id);
      const firstName = p.name.split(' ')[0].toLowerCase().trim();
      if (!nameToId.has(firstName)) nameToId.set(firstName, p.id);
    });
    for (const o of orders) {
      const net = (o.amountAed ?? 0) - (o.paidAmountAed ?? 0);
      const wh = (o.warehouse ?? '').toLowerCase().trim();
      const pl = (o.platform ?? '').toLowerCase().trim();
      const code = whToCode.get(wh) ?? whToCode.get(pl);
      if (code) storeRevenueMap.set(code, (storeRevenueMap.get(code) ?? 0) + net);
      if (o.salesperson) {
        const pid = nameToId.get(o.salesperson.toLowerCase().trim())
                 ?? nameToId.get(o.salesperson.split(' ')[0].toLowerCase().trim());
        if (pid) promoterRevenueMap.set(pid, (promoterRevenueMap.get(pid) ?? 0) + net);
      }
    }
  }

  // Sort stores by net revenue descending
  const filteredStores = stores.filter(s =>
    !hiddenStoreIds.has(s.id) &&
    (!hideEmptyStores || storesWithAssignments.has(s.id))
  );
  const TIER_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
  const visibleStores = [...filteredStores].sort((a, b) => {
    const ta = TIER_ORDER[tierMap.get(a.code) ?? 'D'] ?? 3;
    const tb = TIER_ORDER[tierMap.get(b.code) ?? 'D'] ?? 3;
    if (ta !== tb) return ta - tb;
    const ra = storeRevenueMap.get(a.code) ?? -Infinity;
    const rb = storeRevenueMap.get(b.code) ?? -Infinity;
    return rb - ra;
  });

  // Sort promoters by name alphabetically, admins at bottom
  const activePromoters = promoters.filter(p => p.active);
  const promoterPool = activeOnlyPromoters ? activePromoters : promoters;
  const filteredPromoters = promoterPool.filter(p => !hiddenPromoterIds.has(p.id));
  const visiblePromoters = [...filteredPromoters].sort((a, b) => {
    if (a.role === 'admin' && b.role !== 'admin') return 1;
    if (a.role !== 'admin' && b.role === 'admin') return -1;
    return a.name.localeCompare(b.name);
  });

  const handleChange = useCallback((promoterId: string, date: string, value: string) => {
    if (!onShiftChange) return;
    // Preserve existing note when changing shift type
    const existingShift = shifts.find(s => s.promoterId === promoterId && s.date === date);
    const existingNote = existingShift?.note;
    if (value === '-') {
      onShiftChange(promoterId, date, '', undefined, undefined);
      return;
    }
    if (SPECIAL_SHIFTS.includes(value as typeof SPECIAL_SHIFTS[number])) {
      onShiftChange(promoterId, date, value, undefined, existingNote);
      return;
    }
    const store = storeByCode.get(value);
    let timeRange = store ? `${store.openTime}-${store.closeTime}` : undefined;
    if (store?.shiftSlots && store.shiftSlots.length > 0) {
      timeRange = matchShiftSlot(store.shiftSlots, date);
    }
    onShiftChange(promoterId, date, value, timeRange, existingNote);
  }, [onShiftChange, storeByCode, shifts]);

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
              <label className="filter-item filter-active-only">
                <input
                  type="checkbox"
                  checked={hideEmptyStores}
                  onChange={e => setHideEmptyStores(e.target.checked)}
                />
                <span className="filter-item-name" style={{ fontWeight: 600 }}>Hide empty stores</span>
                <span className="filter-item-stores">{storesWithAssignments.size} / {stores.length}</span>
              </label>
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
        <div className="date-range-filter">
          <button
            className="date-range-reset"
            onClick={() => {
              const d = new Date(filterStart + 'T00:00:00');
              d.setMonth(d.getMonth() - 1);
              const s = d.toISOString().split('T')[0];
              const e = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
              if (s >= (dates[0] ?? '')) { setFilterStart(s); setFilterEnd(e < (dates[dates.length - 1] ?? '') ? e : dates[dates.length - 1] ?? ''); }
            }}
            title="Previous month"
          >
            ◀
          </button>
          <input
            type="date"
            className="date-range-input"
            value={filterStart}
            min={dates[0]}
            max={filterEnd}
            onChange={e => setFilterStart(e.target.value)}
          />
          <span className="date-range-sep">–</span>
          <input
            type="date"
            className="date-range-input"
            value={filterEnd}
            min={filterStart}
            max={dates[dates.length - 1]}
            onChange={e => setFilterEnd(e.target.value)}
          />
          <button
            className="date-range-reset"
            onClick={() => {
              const d = new Date(filterStart + 'T00:00:00');
              d.setMonth(d.getMonth() + 1);
              const s = d.toISOString().split('T')[0];
              const e = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
              if (s <= (dates[dates.length - 1] ?? '')) { setFilterStart(s); setFilterEnd(e < (dates[dates.length - 1] ?? '') ? e : dates[dates.length - 1] ?? ''); }
            }}
            title="Next month"
          >
            ▶
          </button>
          <button
            className="date-range-reset"
            onClick={() => {
              const t = getTodayStr();
              const d = new Date(t + 'T00:00:00');
              const s = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
              const e = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
              setFilterStart(s >= (dates[0] ?? '') ? s : dates[0] ?? '');
              setFilterEnd(e <= (dates[dates.length - 1] ?? '') ? e : dates[dates.length - 1] ?? '');
            }}
            title="Jump to current month"
          >
            Today
          </button>
          <button
            className="date-range-reset"
            onClick={() => { setFilterStart(dates[0] ?? ''); setFilterEnd(dates[dates.length - 1] ?? ''); }}
            title="Reset to full range"
          >
            All
          </button>
        </div>
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
            {visibleDates.map((dateStr, i) => {
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
            {visibleDates.map((dateStr, i) => {
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

          {revenueForecast && revenueForecast.length > 0 && (
            <div className="grid-row header-revenue-row">
              <div className="cell cell-fixed-left col-name" style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600 }}>Expected</div>
              <div className="cell cell-fixed-left-2 col-stores" style={{ fontSize: 10, color: 'var(--text-secondary)' }}>AED</div>
              <div className="cell cell-fixed-left-3 col-day"></div>
              {visibleDates.map((dateStr) => {
                const entry = revenueForecast.find(r => r.date === dateStr);
                return (
                  <div
                    key={dateStr}
                    className={`cell col-date ${dateStr === todayStr ? 'col-today' : ''}`}
                    style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}
                  >
                    {entry ? entry.expected.toLocaleString() : '—'}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ===== STORE SECTION (Sticky below header) ===== */}
        <div className="store-section">
          <div className="section-spacer">Stores ({visibleStores.length}{(hiddenStoreIds.size > 0 || hideEmptyStores) ? ` / ${stores.length}` : ''})</div>
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
                  {tierMap.has(store.code) && (
                    <span style={{ fontSize: 9, color: '#6366f1', marginLeft: 3, fontWeight: 600 }}>({tierMap.get(store.code)})</span>
                  )}
                  {store.extraAllowance && (
                    <span className="extra-allowance">{store.extraAllowance}</span>
                  )}
                </div>
                <div className="cell cell-fixed-left-2 col-stores" style={{ backgroundColor: hasExtra ? 'var(--row-store-alt)' : 'var(--row-store)' }}>
                  {store.name}
                </div>
                <div className="cell cell-fixed-left-3 col-day" style={{ backgroundColor: hasExtra ? 'var(--row-store-alt)' : 'var(--row-store)', fontSize: '10px', color: 'var(--text-secondary)' }}>
                  {storeRevenueMap.has(store.code)
                    ? <span style={{ color: '#059669' }}>{Math.round(storeRevenueMap.get(store.code)!).toLocaleString()}</span>
                    : ''}
                </div>
                {visibleDates.map((dateStr) => {
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
        {visiblePromoters.map((promoter) => {
          const rev = promoterRevenueMap.get(promoter.id);
          return (
          <div key={promoter.id} className="grid-row promoter-row">
            <div className="cell cell-fixed-left col-name">
              {promoter.name}
              {(() => {
                const grade = gradeMap.get(promoter.id) ?? 'C';
                const gradeColor = grade === 'A' ? '#059669' : grade === 'B' ? '#2563eb' : grade === 'C' ? '#d97706' : '#dc2626';
                return <span style={{ fontSize: 9, color: gradeColor, marginLeft: 3, fontWeight: 700 }}>({grade})</span>;
              })()}
              {rev != null && rev !== 0 && (
                <span style={{ fontSize: 9, color: rev > 0 ? '#059669' : '#dc2626', marginLeft: 4 }}>
                  {rev > 0 ? '+' : ''}{Math.round(rev).toLocaleString()}
                </span>
              )}
            </div>
            <div className="cell cell-fixed-left-2 col-stores">
              {(() => {
                const grade = gradeMap.get(promoter.id) ?? 'C';
                const fitTiers = GRADE_TIER_FIT[grade] ?? ['C', 'D'];
                const recStores = stores
                  .filter(s => s.active && fitTiers.includes(tierMap.get(s.code) ?? 'D'))
                  .sort((a, b) => (storeRevenueMap.get(b.code) ?? 0) - (storeRevenueMap.get(a.code) ?? 0));
                if (recStores.length === 0) return <span style={{ fontSize: 9, color: '#9ca3af' }}>{promoter.storesLabel || '—'}</span>;
                return <span style={{ fontSize: 9, color: '#6366f1', lineHeight: 1.3 }}>{recStores.map(s => s.code).join(', ')}</span>;
              })()}
            </div>
            <div className="cell cell-fixed-left-3 col-day">
              {promoter.workingDays}
            </div>
            {visibleDates.map((dateStr) => {
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
                  {shift?.type && !['Off', 'LOP', 'SL', '-', ''].includes(shift.type) && (() => {
                    const timeLabel = shift.timeRange || (() => {
                      const s = storeByCode.get(shift.type);
                      return s ? `${s.openTime}-${s.closeTime}` : undefined;
                    })();
                    return timeLabel ? <span className="shift-time">{timeLabel}</span> : null;
                  })()}
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
          );
        })}
      </div>
      </div>
    </div>
  );
};

export default ShiftTable;
