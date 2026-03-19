import { useState, useRef, useEffect } from 'react';
import type { Store } from '../types/types';
import { SPECIAL_SHIFTS } from '../types/types';
import './ShiftPicker.css';

interface ShiftPickerProps {
  value: string;
  stores: Store[];
  onChange: (value: string) => void;
}

const ShiftPicker = ({ value, stores, onChange }: ShiftPickerProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
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
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const q = search.toLowerCase();
  const filteredStores = stores.filter(
    (s) => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
  );

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
    setSearch('');
  };

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
              if (e.key === 'Escape') { setOpen(false); setSearch(''); }
            }}
          />
          <div className="shift-picker-options">
            <div className="shift-picker-item shift-picker-clear" onClick={() => handleSelect('-')}>
              -
            </div>
            {filteredStores.length > 0 && (
              <>
                <div className="shift-picker-group">Stores</div>
                {filteredStores.map((store) => (
                  <div
                    key={store.id}
                    className={`shift-picker-item ${value === store.code ? 'shift-picker-active' : ''}`}
                    onClick={() => handleSelect(store.code)}
                  >
                    <span className="shift-picker-code">{store.code}</span>
                    <span className="shift-picker-time">{store.openTime}-{store.closeTime}</span>
                  </div>
                ))}
              </>
            )}
            {!search && (
              <>
                <div className="shift-picker-group">Other</div>
                {SPECIAL_SHIFTS.map((s) => (
                  <div
                    key={s}
                    className={`shift-picker-item ${value === s ? 'shift-picker-active' : ''}`}
                    onClick={() => handleSelect(s)}
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

export default ShiftPicker;
