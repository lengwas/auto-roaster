import React from 'react';
import type { Store, Promoter, Shift, StoreCount } from '../types/types';
import './ShiftTable.css';

interface ShiftTableProps {
  stores: Store[];
  promoters: Promoter[];
  shifts: Shift[];
  storeCounts: StoreCount[];
  dates: string[];
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

function getShiftClass(type: string): string {
  const map: Record<string, string> = {
    VDM: 'shift-vdm',
    VDH: 'shift-vdh',
    VME: 'shift-vme',
    BDM: 'shift-bdm',
    JME: 'shift-jme',
    AIR: 'shift-air',
    VAY: 'shift-vay',
    LOP: 'shift-lop',
    Off: 'shift-off',
    SL: 'shift-sl',
  };
  return map[type] || '';
}

function getTodayStr(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

const ShiftTable: React.FC<ShiftTableProps> = ({ stores, promoters, shifts, storeCounts, dates }) => {
  const shiftMap = new Map<string, Shift>();
  shifts.forEach((s) => {
    shiftMap.set(`${s.promoterId}_${s.date}`, s);
  });

  const countMap = new Map<string, number>();
  storeCounts.forEach((sc) => {
    countMap.set(`${sc.storeId}_${sc.date}`, sc.count);
  });

  const dateInfos = dates.map(formatDate);
  const todayStr = getTodayStr();

  return (
    <div className="table-container">
      <div className="shift-grid">
        {/* ===== HEADER SECTION (Sticky Top) ===== */}
        <div className="header-section">
          {/* Row 1: Date numbers */}
          <div className="grid-row header-date-row">
            <div className="cell cell-fixed-left col-name">Locked</div>
            <div className="cell cell-fixed-left-2 col-stores"></div>
            <div className="cell cell-fixed-left-3 col-day"></div>
            {dates.map((dateStr, i) => (
              <div
                key={dateStr}
                className={`cell col-date ${dateStr === todayStr ? 'col-today' : ''}`}
              >
                {dateInfos[i].date}
              </div>
            ))}
          </div>

          {/* Row 2: Day of week */}
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
                <div className="cell cell-fixed-left-3 col-day" style={{ backgroundColor: hasExtra ? 'var(--row-store-alt)' : 'var(--row-store)' }}>
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

        {/* ===== PROMOTER SECTION (Scrollable) ===== */}
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
              return (
                <div
                  key={dateStr}
                  className={`cell col-date ${dateStr === todayStr ? 'col-today' : ''} ${shiftClass}`}
                >
                  {shift ? (
                    <div className="shift-cell-content">
                      <span className="shift-type">{shift.type}</span>
                      {shift.timeRange && (
                        <span className="shift-time">{shift.timeRange}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-dash">-</span>
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
