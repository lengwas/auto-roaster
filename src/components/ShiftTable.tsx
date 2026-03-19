import { useState, useCallback } from 'react';
import type { Store, Promoter, Shift, StoreCount } from '../types/types';
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

const ShiftTable = ({ stores, promoters, shifts, storeCounts, dates, onShiftChange }: ShiftTableProps) => {
  const [editingNote, setEditingNote] = useState<string | null>(null); // key: promoterId_date
  const [noteText, setNoteText] = useState('');

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
    if (shift) {
      onShiftChange(promoterId, date, shift.type, shift.timeRange, noteText);
    }
    setEditingNote(null);
    setNoteText('');
  };

  const handleNoteKeyDown = (e: React.KeyboardEvent, promoterId: string, date: string) => {
    if (e.key === 'Enter') {
      handleNoteSave(promoterId, date);
    } else if (e.key === 'Escape') {
      setEditingNote(null);
      setNoteText('');
    }
  };

  return (
    <div className="table-container">
      <div className="shift-grid">
        {/* ===== HEADER SECTION (Sticky Top) ===== */}
        <div className="header-section">
          <div className="grid-row header-date-row">
            <div className="cell cell-fixed-left col-name">Locked</div>
            <div className="cell cell-fixed-left-2 col-stores"></div>
            <div className="cell cell-fixed-left-3 col-day"></div>
            {dates.map((dateStr, i) => (
              <div key={dateStr} className={`cell col-date ${dateStr === todayStr ? 'col-today' : ''}`}>
                {dateInfos[i].date}
              </div>
            ))}
          </div>

          <div className="grid-row header-dow-row">
            <div className="cell cell-fixed-left col-name" style={{ fontWeight: 700 }}>Name</div>
            <div className="cell cell-fixed-left-2 col-stores" style={{ fontWeight: 700 }}>Stores</div>
            <div className="cell cell-fixed-left-3 col-day" style={{ fontWeight: 700 }}>Day Off</div>
            {dates.map((dateStr, i) => (
              <div
                key={dateStr}
                className={`cell col-date ${dateStr === todayStr ? 'col-today' : ''} ${dateInfos[i].isSun ? 'dow-sun' : ''} ${dateInfos[i].isSat ? 'dow-sat' : ''}`}
                style={{ fontWeight: 600 }}
              >
                {dateInfos[i].dow}
              </div>
            ))}
          </div>
        </div>

        {/* ===== STORE SECTION (Sticky below header) ===== */}
        <div className="store-section">
          <div className="section-spacer">Stores ({stores.length})</div>
          {stores.map((store) => {
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
        <div className="section-spacer">Promoters ({promoters.filter(p => p.active).length} Active)</div>
        {promoters.filter(p => p.active).map((promoter) => (
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
                  className={`cell col-date ${dateStr === todayStr ? 'col-today' : ''} ${shiftClass}`}
                >
                  <ShiftPicker
                    value={shift?.type || '-'}
                    stores={activeStores}
                    onChange={(val) => handleChange(promoter.id, dateStr, val)}
                  />
                  {shift?.timeRange && (
                    <span className="shift-time">{shift.timeRange}</span>
                  )}
                  {shift && shift.type && shift.type !== '-' && (
                    isEditingNote ? (
                      <input
                        className="shift-note-input"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        onBlur={() => handleNoteSave(promoter.id, dateStr)}
                        onKeyDown={(e) => handleNoteKeyDown(e, promoter.id, dateStr)}
                        placeholder="note..."
                        autoFocus
                      />
                    ) : (
                      <span
                        className={`shift-note ${shift.note ? 'shift-note-has' : 'shift-note-empty'}`}
                        onClick={() => handleNoteClick(cellKey, shift.note || '')}
                        title={shift.note || 'Click to add note'}
                      >
                        {shift.note || '+'}
                      </span>
                    )
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ShiftTable;
