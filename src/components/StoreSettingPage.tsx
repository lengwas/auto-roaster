import { useState, useRef } from 'react';
import type { Store, Promoter, StorePreference, PreferenceLevel } from '../types/types';
import './SettingPage.css';

interface StoreSettingPageProps {
  stores: Store[];
  promoters?: Promoter[];
  storePreferences?: StorePreference[];
  onStoresChange: (stores: Store[]) => void;
  onSaveStore?: (s: Store) => void;
  onDeleteStore?: (id: string) => void;
  onSavePreference?: (promoterId: string, storeCode: string, preference: PreferenceLevel) => Promise<void>;
  onDeletePreference?: (promoterId: string, storeCode: string) => Promise<void>;
  onPreferencesChange?: (prefs: StorePreference[]) => void;
}

const EMPTY_STORE: Omit<Store, 'id'> & { shiftSlots: string[] } = {
  code: '',
  name: '',
  active: true,
  openTime: '10:00',
  closeTime: '22:00',
  extraAllowance: '',
  maxCapacity: undefined,
  shiftSlots: [],
  platform: '',
  warehouse: '',
};

const StoreSettingPage = ({ stores, promoters = [], storePreferences = [], onStoresChange, onSaveStore, onDeleteStore, onSavePreference, onDeletePreference, onPreferencesChange }: StoreSettingPageProps) => {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_STORE);
  const [search, setSearch] = useState('');
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandedStoreId, setExpandedStoreId] = useState<string | null>(null);

  const activePromoters = promoters.filter(p => p.active);

  const togglePromoterForStore = (promoterId: string, storeCode: string) => {
    const current = storePreferences.find(
      sp => sp.promoterId === promoterId && sp.storeCode === storeCode
    );
    if (current) {
      onDeletePreference?.(promoterId, storeCode);
      onPreferencesChange?.(storePreferences.filter(
        sp => !(sp.promoterId === promoterId && sp.storeCode === storeCode)
      ));
    } else {
      onSavePreference?.(promoterId, storeCode, 'must');
      onPreferencesChange?.([...storePreferences, { promoterId, storeCode, preference: 'must' }]);
    }
  };

  const markDirty = (id: string) => {
    setDirtyIds(prev => new Set(prev).add(id));
    setSaveStatus('idle');
  };

  const handleSaveAll = () => {
    if (!onSaveStore || dirtyIds.size === 0) return;
    stores.filter(s => dirtyIds.has(s.id)).forEach(onSaveStore);
    setDirtyIds(new Set());
    setSaveStatus('saved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000);
  };

  const filtered = stores.filter(
    (s) =>
      s.code.toLowerCase().includes(search.toLowerCase()) ||
      s.name.toLowerCase().includes(search.toLowerCase())
  );

  const openAddForm = () => {
    setForm(EMPTY_STORE);
    setEditingId(null);
    setShowForm(true);
  };

  const openEditForm = (store: Store) => {
    setForm({
      code: store.code,
      name: store.name,
      active: store.active,
      openTime: store.openTime,
      closeTime: store.closeTime,
      extraAllowance: store.extraAllowance || '',
      maxCapacity: store.maxCapacity,
      shiftSlots: store.shiftSlots ?? [],
      platform: store.platform || '',
      warehouse: store.warehouse || '',
    });
    setEditingId(store.id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.code.trim() || !form.name.trim()) return;

    if (editingId) {
      const slots = form.shiftSlots.filter(s => s.trim());
      const updated = stores.map((s) =>
        s.id === editingId
          ? {
              ...s, ...form,
              extraAllowance: form.extraAllowance || undefined,
              maxCapacity: form.maxCapacity || undefined,
              shiftSlots: slots.length > 0 ? slots : undefined,
              platform: (form.platform as string) || undefined,
              warehouse: (form.warehouse as string) || undefined,
            }
          : s
      );
      onStoresChange(updated);
      markDirty(editingId);
    } else {
      const slots = form.shiftSlots.filter(s => s.trim());
      const newStore: Store = {
        id: `store_${Date.now()}`,
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        active: form.active,
        openTime: form.openTime,
        closeTime: form.closeTime,
        extraAllowance: form.extraAllowance || undefined,
        maxCapacity: form.maxCapacity || undefined,
        shiftSlots: slots.length > 0 ? slots : undefined,
        platform: (form.platform as string) || undefined,
        warehouse: (form.warehouse as string) || undefined,
      };
      onStoresChange([...stores, newStore]);
      markDirty(newStore.id);
    }
    setShowForm(false);
    setEditingId(null);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
  };

  const toggleActive = (storeId: string) => {
    onStoresChange(stores.map((s) => (s.id === storeId ? { ...s, active: !s.active } : s)));
    markDirty(storeId);
  };

  const handleDelete = (storeId: string) => {
    onStoresChange(stores.filter((s) => s.id !== storeId));
    onDeleteStore?.(storeId);
    setDirtyIds(prev => { const next = new Set(prev); next.delete(storeId); return next; });
  };

  const renderShiftSlotsEditor = () => (
    <div className="form-field" style={{ gridColumn: '1 / -1' }}>
      <label>Shift Slots <span style={{ fontWeight: 400, fontSize: 11, color: '#6b7280' }}>(format: HH:MM-HH:MM or WD HH:MM-HH:MM / WE HH:MM-HH:MM)</span></label>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6, lineHeight: 1.4 }}>
        WD = Weekday (Mon-Fri), WE = Weekend (Sat-Sun). Examples:<br />
        <code style={{ fontSize: 10 }}>10:00-19:00</code> &nbsp; <code style={{ fontSize: 10 }}>WD 12:30-21:30</code> &nbsp; <code style={{ fontSize: 10 }}>WE 13:00-22:00</code>
      </div>
      {form.shiftSlots.map((slot, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
          <input
            type="text"
            className="form-input"
            placeholder="e.g. 10:00-19:00 or WD 12:30-21:30"
            value={slot}
            onChange={(e) => {
              const next = [...form.shiftSlots];
              next[i] = e.target.value;
              setForm({ ...form, shiftSlots: next });
            }}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn btn-small btn-danger-ghost"
            onClick={() => setForm({ ...form, shiftSlots: form.shiftSlots.filter((_, j) => j !== i) })}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-small btn-ghost"
        onClick={() => setForm({ ...form, shiftSlots: [...form.shiftSlots, ''] })}
        style={{ marginTop: 4 }}
      >
        + Add Slot
      </button>
    </div>
  );

  return (
    <div className="setting-page">
      <div className="setting-header">
        <h2>Store Settings</h2>
        <p>Manage store locations, operating hours, and shift visibility</p>
      </div>

      <div className="setting-toolbar">
        <div className="setting-search">
          <input
            type="text"
            placeholder="Search store..."
            className="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="setting-actions">
          <span className="badge">{stores.filter((s) => s.active).length} Active</span>
          <span className="badge badge-muted">{stores.filter((s) => !s.active).length} Hidden</span>
          {saveStatus === 'saved' ? (
            <span className="save-status-ok">✓ Saved</span>
          ) : (
            <button
              className="btn btn-primary btn-small"
              onClick={handleSaveAll}
              disabled={dirtyIds.size === 0}
            >
              Save to Database{dirtyIds.size > 0 ? ` (${dirtyIds.size})` : ''}
            </button>
          )}
          <button className="btn btn-primary" onClick={openAddForm}>
            + Add Store
          </button>
        </div>
      </div>

      {/* Add New Store Form (top) */}
      {showForm && !editingId && (
        <div className="form-card">
          <h3 className="form-title">Add New Store</h3>
          <div className="form-grid">
            <div className="form-field">
              <label>Store Code</label>
              <input type="text" className="form-input" placeholder="e.g. VDM" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} maxLength={5} />
            </div>
            <div className="form-field">
              <label>Store Name</label>
              <input type="text" className="form-input" placeholder="e.g. Vox Deira Mall" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-field">
              <label>Extra Allowance</label>
              <input type="text" className="form-input" placeholder="e.g. +10 AED" value={form.extraAllowance} onChange={(e) => setForm({ ...form, extraAllowance: e.target.value })} />
            </div>
            <div className="form-field">
              <label>Open Time</label>
              <input type="time" className="form-input" value={form.openTime} onChange={(e) => setForm({ ...form, openTime: e.target.value })} />
            </div>
            <div className="form-field">
              <label>Close Time</label>
              <input type="time" className="form-input" value={form.closeTime} onChange={(e) => setForm({ ...form, closeTime: e.target.value })} />
            </div>
            <div className="form-field">
              <label>Max Capacity <span style={{ fontWeight: 400, fontSize: 11, color: '#6b7280' }}>(คน/วัน)</span></label>
              <input type="number" className="form-input" placeholder="e.g. 2" min={1} value={form.maxCapacity ?? ''} onChange={(e) => setForm({ ...form, maxCapacity: e.target.value ? Number(e.target.value) : undefined })} />
            </div>
            {renderShiftSlotsEditor()}
            <div className="form-field">
              <label>Platform (Orders mapping)</label>
              <input type="text" className="form-input" placeholder="e.g. Virgin - Dubai Mall" value={(form.platform as string) || ''} onChange={(e) => setForm({ ...form, platform: e.target.value })} />
            </div>
            <div className="form-field">
              <label>Warehouse (Orders mapping)</label>
              <input type="text" className="form-input" placeholder="e.g. VIR - DBM" value={(form.warehouse as string) || ''} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} />
            </div>
            <div className="form-field">
              <label>Visible in Shift Table</label>
              <button type="button" className={`toggle-btn ${form.active ? 'toggle-on' : 'toggle-off'}`} onClick={() => setForm({ ...form, active: !form.active })}>
                {form.active ? 'Active' : 'Hidden'}
              </button>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={!form.code.trim() || !form.name.trim()}>Add Store</button>
          </div>
        </div>
      )}

      <div className="setting-table-wrap">
        <table className="setting-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th style={{ width: 70 }}>Code</th>
              <th style={{ width: 160 }}>Store Name</th>
              <th style={{ width: 90 }}>Shift Table</th>
              <th style={{ width: 80 }}>Open</th>
              <th style={{ width: 80 }}>Close</th>
              <th style={{ width: 70 }}>Hours</th>
              <th style={{ width: 160 }}>Shift Slots</th>
              <th style={{ width: 100 }}>Allowance</th>
              <th style={{ width: 50 }}>Max</th>
              <th style={{ width: 180 }}>Platform</th>
              <th style={{ width: 120 }}>Warehouse</th>
              <th style={{ width: 100 }}>Promoters</th>
              <th style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((store, idx) => {
              const [openH, openM] = store.openTime.split(':').map(Number);
              const [closeH, closeM] = store.closeTime.split(':').map(Number);
              const totalMinutes = (closeH * 60 + closeM) - (openH * 60 + openM);
              const hours = Math.floor(totalMinutes / 60);
              const mins = totalMinutes % 60;
              const hoursLabel = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;

              const assignedCount = storePreferences.filter(
                sp => sp.storeCode === store.code && sp.preference === 'must'
              ).length;
              const isExpanded = expandedStoreId === store.id;
              return (
                <>
                <tr key={store.id} className={!store.active ? 'row-inactive' : ''}>
                  <td className="cell-center">{idx + 1}</td>
                  <td>
                    <span className="store-code-badge">{store.code}</span>
                  </td>
                  <td className="cell-name">{store.name}</td>
                  <td className="cell-center">
                    <button
                      className={`toggle-btn toggle-sm ${store.active ? 'toggle-on' : 'toggle-off'}`}
                      onClick={() => toggleActive(store.id)}
                    >
                      {store.active ? 'Active' : 'Hidden'}
                    </button>
                  </td>
                  <td className="cell-center">
                    <span className="time-badge">{store.openTime}</span>
                  </td>
                  <td className="cell-center">
                    <span className="time-badge">{store.closeTime}</span>
                  </td>
                  <td className="cell-center">
                    <span className="hours-badge">{hoursLabel}</span>
                  </td>
                  <td className="cell-center" style={{ fontSize: 11 }}>
                    {store.shiftSlots && store.shiftSlots.length > 0
                      ? store.shiftSlots.map((slot, i) => (
                          <div key={i}><span className="time-badge">{slot}</span></div>
                        ))
                      : <span className="text-muted">—</span>
                    }
                  </td>
                  <td className="cell-center">
                    {store.extraAllowance ? (
                      <span className="allowance-badge">{store.extraAllowance}</span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className="cell-center">
                    {store.maxCapacity ? (
                      <span className="hours-badge">{store.maxCapacity}</span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className="cell-name" style={{ fontSize: '12px' }}>
                    {store.platform || <span className="text-muted">-</span>}
                  </td>
                  <td style={{ fontSize: '12px' }}>
                    {store.warehouse || <span className="text-muted">-</span>}
                  </td>
                  <td className="cell-center">
                    {assignedCount > 0 ? (
                      <span className="store-code-badge" style={{ fontSize: 11 }}>{assignedCount} คน</span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className="cell-center">
                    <button className="btn btn-small btn-ghost" onClick={() => openEditForm(store)}>Edit</button>
                    <button
                      className={`btn btn-small ${isExpanded ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setExpandedStoreId(isExpanded ? null : store.id)}
                      title="Assign promoters"
                    >
                      {isExpanded ? 'Close' : 'Assign'}
                    </button>
                    <button className="btn btn-small btn-danger-ghost" onClick={() => handleDelete(store.id)}>Del</button>
                  </td>
                </tr>
                {/* Inline Edit Form */}
                {showForm && editingId === store.id && (
                  <tr key={`${store.id}-edit`} className="expand-row">
                    <td colSpan={14}>
                      <div className="form-card" style={{ margin: 0, borderRadius: 0, borderTop: '2px solid #6366f1' }}>
                        <h3 className="form-title">Edit Store — {store.code}</h3>
                        <div className="form-grid">
                          <div className="form-field">
                            <label>Store Code</label>
                            <input type="text" className="form-input" placeholder="e.g. VDM" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} maxLength={5} />
                          </div>
                          <div className="form-field">
                            <label>Store Name</label>
                            <input type="text" className="form-input" placeholder="e.g. Vox Deira Mall" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                          </div>
                          <div className="form-field">
                            <label>Extra Allowance</label>
                            <input type="text" className="form-input" placeholder="e.g. +10 AED" value={form.extraAllowance} onChange={(e) => setForm({ ...form, extraAllowance: e.target.value })} />
                          </div>
                          <div className="form-field">
                            <label>Open Time</label>
                            <input type="time" className="form-input" value={form.openTime} onChange={(e) => setForm({ ...form, openTime: e.target.value })} />
                          </div>
                          <div className="form-field">
                            <label>Close Time</label>
                            <input type="time" className="form-input" value={form.closeTime} onChange={(e) => setForm({ ...form, closeTime: e.target.value })} />
                          </div>
                          <div className="form-field">
                            <label>Max Capacity <span style={{ fontWeight: 400, fontSize: 11, color: '#6b7280' }}>(คน/วัน)</span></label>
                            <input type="number" className="form-input" placeholder="e.g. 2" min={1} value={form.maxCapacity ?? ''} onChange={(e) => setForm({ ...form, maxCapacity: e.target.value ? Number(e.target.value) : undefined })} />
                          </div>
                          {renderShiftSlotsEditor()}
                          <div className="form-field">
                            <label>Platform (Orders mapping)</label>
                            <input type="text" className="form-input" placeholder="e.g. Virgin - Dubai Mall" value={(form.platform as string) || ''} onChange={(e) => setForm({ ...form, platform: e.target.value })} />
                          </div>
                          <div className="form-field">
                            <label>Warehouse (Orders mapping)</label>
                            <input type="text" className="form-input" placeholder="e.g. VIR - DBM" value={(form.warehouse as string) || ''} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} />
                          </div>
                          <div className="form-field">
                            <label>Visible in Shift Table</label>
                            <button type="button" className={`toggle-btn ${form.active ? 'toggle-on' : 'toggle-off'}`} onClick={() => setForm({ ...form, active: !form.active })}>
                              {form.active ? 'Active' : 'Hidden'}
                            </button>
                          </div>
                        </div>
                        <div className="form-actions">
                          <button className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
                          <button className="btn btn-primary" onClick={handleSave} disabled={!form.code.trim() || !form.name.trim()}>Save Changes</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                {isExpanded && (
                  <tr key={`${store.id}-assign`} className="expand-row">
                    <td colSpan={14}>
                      <div style={{ padding: '10px 16px' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                          Promoters ประจำร้าน {store.code} (active only)
                        </div>
                        <div className="pref-grid">
                          {activePromoters.map(p => {
                            const assigned = storePreferences.some(
                              sp => sp.promoterId === p.id && sp.storeCode === store.code && sp.preference === 'must'
                            );
                            return (
                              <button
                                key={p.id}
                                className={`pref-chip ${assigned ? 'pref-must' : 'pref-none'}`}
                                onClick={() => togglePromoterForStore(p.id, store.code)}
                              >
                                <span className="pref-chip-code">{p.name.split(' ')[0]}</span>
                                <span className="pref-chip-label">{assigned ? 'Must' : '—'}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={14} className="cell-center text-muted" style={{ padding: '32px' }}>
                  No stores found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StoreSettingPage;
