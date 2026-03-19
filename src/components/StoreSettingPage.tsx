import { useState } from 'react';
import type { Store } from '../types/types';
import './SettingPage.css';

interface StoreSettingPageProps {
  stores: Store[];
  onStoresChange: (stores: Store[]) => void;
}

const EMPTY_STORE: Omit<Store, 'id'> = {
  code: '',
  name: '',
  active: true,
  openTime: '10:00',
  closeTime: '22:00',
  extraAllowance: '',
};

const StoreSettingPage = ({ stores, onStoresChange }: StoreSettingPageProps) => {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_STORE);
  const [search, setSearch] = useState('');

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
    });
    setEditingId(store.id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.code.trim() || !form.name.trim()) return;

    if (editingId) {
      // Update existing
      onStoresChange(
        stores.map((s) =>
          s.id === editingId
            ? { ...s, ...form, extraAllowance: form.extraAllowance || undefined }
            : s
        )
      );
    } else {
      // Add new
      const newStore: Store = {
        id: `store_${Date.now()}`,
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        active: form.active,
        openTime: form.openTime,
        closeTime: form.closeTime,
        extraAllowance: form.extraAllowance || undefined,
      };
      onStoresChange([...stores, newStore]);
    }
    setShowForm(false);
    setEditingId(null);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
  };

  const toggleActive = (storeId: string) => {
    onStoresChange(
      stores.map((s) => (s.id === storeId ? { ...s, active: !s.active } : s))
    );
  };

  const handleDelete = (storeId: string) => {
    onStoresChange(stores.filter((s) => s.id !== storeId));
  };

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
          <button className="btn btn-primary" onClick={openAddForm}>
            + Add Store
          </button>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="form-card">
          <h3 className="form-title">{editingId ? 'Edit Store' : 'Add New Store'}</h3>
          <div className="form-grid">
            <div className="form-field">
              <label>Store Code</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. VDM"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                maxLength={5}
              />
            </div>
            <div className="form-field">
              <label>Store Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Vox Deira Mall"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label>Open Time</label>
              <input
                type="time"
                className="form-input"
                value={form.openTime}
                onChange={(e) => setForm({ ...form, openTime: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label>Close Time</label>
              <input
                type="time"
                className="form-input"
                value={form.closeTime}
                onChange={(e) => setForm({ ...form, closeTime: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label>Extra Allowance</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. +10 AED"
                value={form.extraAllowance}
                onChange={(e) => setForm({ ...form, extraAllowance: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label>Visible in Shift Table</label>
              <button
                type="button"
                className={`toggle-btn ${form.active ? 'toggle-on' : 'toggle-off'}`}
                onClick={() => setForm({ ...form, active: !form.active })}
              >
                {form.active ? 'Active' : 'Hidden'}
              </button>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={handleCancel}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!form.code.trim() || !form.name.trim()}
            >
              {editingId ? 'Save Changes' : 'Add Store'}
            </button>
          </div>
        </div>
      )}

      <div className="setting-table-wrap">
        <table className="setting-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th style={{ width: 90 }}>Code</th>
              <th style={{ width: 200 }}>Store Name</th>
              <th style={{ width: 110 }}>Shift Table</th>
              <th style={{ width: 90 }}>Open</th>
              <th style={{ width: 90 }}>Close</th>
              <th style={{ width: 80 }}>Hours</th>
              <th style={{ width: 120 }}>Allowance</th>
              <th style={{ width: 140 }}>Actions</th>
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

              return (
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
                  <td className="cell-center">
                    {store.extraAllowance ? (
                      <span className="allowance-badge">{store.extraAllowance}</span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className="cell-center">
                    <button className="btn btn-small btn-ghost" onClick={() => openEditForm(store)}>
                      Edit
                    </button>
                    <button className="btn btn-small btn-danger-ghost" onClick={() => handleDelete(store.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="cell-center text-muted" style={{ padding: '32px' }}>
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
