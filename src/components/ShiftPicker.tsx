import { useState, useRef, useEffect } from 'react';
import type { Store } from '../types/types';
import { SPECIAL_SHIFTS } from '../types/types';
import { matchAllShiftSlots } from '../lib/shiftSlotUtils';
import './ShiftPicker.css';

interface ShiftPickerProps {
  value: string;
  stores: Store[];
  date: string; // YYYY-MM-DD — needed to resolve shift slots
  onChange: (storeCode: string, timeRange?: string) => void;
}

const ShiftPicker = ({ value, stores, date, onChange }: ShiftPickerProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
        setSelectedStore(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const q = search.toLowerCase();
  const filteredStores = stores.filter(
    (s) => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
  );

  const handleClose = () => {
    setOpen(false);
    setSearch('');
    setSelectedStore(null);
  };

  const handleSelectStore = (store: Store) => {
    // Get available slots for this date
    const slots = store.shiftSlots && store.shiftSlots.length > 0
      ? matchAllShiftSlots(store.shiftSlots, date)
      : [`${store.openTime}-${store.closeTime}`];

    if (slots.length <= 1) {
      // Single slot — select immediately
      onChange(store.code, slots[0]);
      handleClose();
    } else {
      // Multiple slots — show step 2
      setSelectedStore(store);
      setSearch('');
    }
  };

  const handleSelectSlot = (storeCode: string, timeRange: string) => {
    onChange(storeCode, timeRange);
    handleClose();
  };

  const handleSelectSpecial = (val: string) => {
    onChange(val);
    handleClose();
  };

  const handleClear = () => {
    onChange('-');
    handleClose();
  };

  // Step 2: show time slot options for selected store
  if (open && selectedStore) {
    const slots = selectedStore.shiftSlots && selectedStore.shiftSlots.length > 0
      ? matchAllShiftSlots(selectedStore.shiftSlots, date)
      : [`${selectedStore.openTime}-${selectedStore.closeTime}`];

    return (
      <div className="shift-picker" ref={ref}>
        <button className="shift-picker-trigger" onClick={() => setOpen(!open)}>
          {value || '-'}
        </button>
        <div className="shift-picker-dropdown">
          <div
            className="shift-picker-back"
            onClick={() => setSelectedStore(null)}
          >
            <span className="shift-picker-back-arrow">&#8592;</span>
            <span className="shift-picker-back-store">{selectedStore.code}</span>
            <span className="shift-picker-back-name">{selectedStore.name}</span>
          </div>
          <div className="shift-picker-group">Select shift time</div>
          <div className="shift-picker-options">
            {slots.map((slot) => (
              <div
                key={slot}
                className="shift-picker-item shift-picker-slot"
                onClick={() => handleSelectSlot(selectedStore.code, slot)}
              >
                <span className="shift-picker-slot-time">{slot}</span>
                <span className="shift-picker-slot-label">
                  {formatSlotLabel(slot)}
                </span>
              </div>
            ))}
            {/* Full day option — only if not already in slots */}
            {!slots.includes(`${selectedStore.openTime}-${selectedStore.closeTime}`) && (
              <div
                className="shift-picker-item shift-picker-slot"
                onClick={() => handleSelectSlot(
                  selectedStore.code,
                  `${selectedStore.openTime}-${selectedStore.closeTime}`
                )}
              >
                <span className="shift-picker-slot-time">
                  {selectedStore.openTime}-{selectedStore.closeTime}
                </span>
                <span className="shift-picker-slot-label">Full day</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Step 1: store / special shift selection
  return (
    <div className="shift-picker" ref={ref}>
      <button className="shift-picker-trigger" onClick={() => setOpen(!open)}>
        {value || '-'}
      </button>
      {open && (
        <div className="shift-picker-dropdown">
          <input
            ref={inputRef}
            className="shift-picker-search"
            type="text"
            placeholder="Search store..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleClose();
            }}
          />
          <div className="shift-picker-options">
            <div className="shift-picker-item shift-picker-clear" onClick={handleClear}>
              -
            </div>
            {filteredStores.length > 0 && (
              <>
                <div className="shift-picker-group">Stores</div>
                {filteredStores.map((store) => {
                  const hasMultiSlots = store.shiftSlots && store.shiftSlots.length > 1;
                  return (
                    <div
                      key={store.id}
                      className={`shift-picker-item ${value === store.code ? 'shift-picker-active' : ''}`}
                      onClick={() => handleSelectStore(store)}
                    >
                      <span className="shift-picker-code">{store.code}</span>
                      <span className="shift-picker-store-info">
                        <span className="shift-picker-time">
                          {store.openTime}-{store.closeTime}
                        </span>
                        {hasMultiSlots && (
                          <span className="shift-picker-slots-badge">
                            {store.shiftSlots!.length} slots
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
            {!search && (
              <>
                <div className="shift-picker-group">Other</div>
                {SPECIAL_SHIFTS.map((s) => (
                  <div
                    key={s}
                    className={`shift-picker-item ${value === s ? 'shift-picker-active' : ''}`}
                    onClick={() => handleSelectSpecial(s)}
                  >
                    {s}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** Format a slot like "10:00-19:00" into a helpful label. */
function formatSlotLabel(slot: string): string {
  const [start, end] = slot.split('-');
  if (!start || !end) return '';
  const sh = parseInt(start);
  const eh = parseInt(end);
  if (sh < 12) return 'Morning';
  if (sh < 15) return 'Midday';
  return 'Evening';
}

export default ShiftPicker;
