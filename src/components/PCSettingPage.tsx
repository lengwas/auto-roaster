import { useState, useMemo } from 'react';
import type { Promoter, Store, StorePreference, PromoterConflict, PreferenceLevel } from '../types/types';
import './SettingPage.css';
import './PCSettingPage.css';

const DAY_OFF_OPTIONS = ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface PCSettingPageProps {
  promoters: Promoter[];
  stores: Store[];
  storePreferences: StorePreference[];
  onPreferencesChange: (prefs: StorePreference[]) => void;
  promoterConflicts: PromoterConflict[];
  onConflictsChange: (conflicts: PromoterConflict[]) => void;
  onPromotersChange?: (promoters: Promoter[]) => void;
}

const PREF_OPTIONS: { value: PreferenceLevel; label: string; cls: string }[] = [
  { value: 'must', label: 'Must', cls: 'pref-must' },
  { value: 'preferred', label: 'Preferred', cls: 'pref-preferred' },
  { value: 'banned', label: 'Banned', cls: 'pref-banned' },
];

const PCSettingPage = ({ promoters, stores, storePreferences, onPreferencesChange, promoterConflicts, onConflictsChange, onPromotersChange }: PCSettingPageProps) => {
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [conflictA, setConflictA] = useState('');
  const [conflictB, setConflictB] = useState('');
  const [conflictReason, setConflictReason] = useState('');

  const activeStores = stores.filter(s => s.active);
  const activePromoters = promoters.filter(p => p.active);

  const promoterMap = useMemo(() => {
    const m = new Map<string, Promoter>();
    promoters.forEach(p => m.set(p.id, p));
    return m;
  }, [promoters]);

  // Build preference lookup: promoterId -> storeCode -> preference
  const prefMap = useMemo(() => {
    const m = new Map<string, Map<string, PreferenceLevel>>();
    storePreferences.forEach(sp => {
      if (!m.has(sp.promoterId)) m.set(sp.promoterId, new Map());
      m.get(sp.promoterId)!.set(sp.storeCode, sp.preference);
    });
    return m;
  }, [storePreferences]);

  const filteredPromoters = promoters.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const getPref = (promoterId: string, storeCode: string): PreferenceLevel | null => {
    return prefMap.get(promoterId)?.get(storeCode) ?? null;
  };

  const setPref = (promoterId: string, storeCode: string, pref: PreferenceLevel | null) => {
    const updated = storePreferences.filter(
      sp => !(sp.promoterId === promoterId && sp.storeCode === storeCode)
    );
    if (pref) {
      updated.push({ promoterId, storeCode, preference: pref });
    }
    onPreferencesChange(updated);
  };

  const cyclePref = (promoterId: string, storeCode: string) => {
    const current = getPref(promoterId, storeCode);
    const order: (PreferenceLevel | null)[] = [null, 'must', 'preferred', 'banned'];
    const idx = order.indexOf(current);
    const next = order[(idx + 1) % order.length];
    setPref(promoterId, storeCode, next);
  };

  const updatePromoter = (id: string, changes: Partial<Promoter>) => {
    if (!onPromotersChange) return;
    onPromotersChange(promoters.map(p => p.id === id ? { ...p, ...changes } : p));
  };

  const getPrefsForPromoter = (promoterId: string) => {
    return storePreferences.filter(sp => sp.promoterId === promoterId);
  };

  const prefSummary = (promoterId: string) => {
    const prefs = getPrefsForPromoter(promoterId);
    const must = prefs.filter(p => p.preference === 'must').length;
    const preferred = prefs.filter(p => p.preference === 'preferred').length;
    const banned = prefs.filter(p => p.preference === 'banned').length;
    if (must + preferred + banned === 0) return null;
    const parts: string[] = [];
    if (must) parts.push(`${must} must`);
    if (preferred) parts.push(`${preferred} pref`);
    if (banned) parts.push(`${banned} ban`);
    return parts.join(', ');
  };

  const addConflict = () => {
    if (!conflictA || !conflictB || conflictA === conflictB) return;
    // Check duplicate
    const exists = promoterConflicts.some(
      c => (c.promoterAId === conflictA && c.promoterBId === conflictB) ||
           (c.promoterAId === conflictB && c.promoterBId === conflictA)
    );
    if (exists) return;
    const newConflict: PromoterConflict = {
      id: `c_${Date.now()}`,
      promoterAId: conflictA,
      promoterBId: conflictB,
      reason: conflictReason || undefined,
    };
    onConflictsChange([...promoterConflicts, newConflict]);
    setConflictA('');
    setConflictB('');
    setConflictReason('');
  };

  const removeConflict = (id: string) => {
    onConflictsChange(promoterConflicts.filter(c => c.id !== id));
  };

  return (
    <div className="setting-page">
      <div className="setting-header">
        <h2>PC (Promoter) Settings</h2>
        <p>Manage store preferences, conflicts, and promoter profiles</p>
      </div>

      {/* Store Preferences Section */}
      <div className="pc-section">
        <h3 className="pc-section-title">Store Preferences</h3>
        <p className="pc-section-desc">Click store badges to cycle: none → Must → Preferred → Banned</p>

        <div className="setting-toolbar">
          <div className="setting-search">
            <input
              type="text"
              placeholder="Search promoter..."
              className="search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="setting-actions">
            <span className="badge">{activePromoters.length} Active</span>
          </div>
        </div>

        <div className="setting-table-wrap">
          <table className="setting-table">
            <thead>
              <tr>
                <th style={{ width: 50 }}>#</th>
                <th style={{ width: 180 }}>Name</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 120 }}>Day Off</th>
                <th>Conditions</th>
                <th style={{ width: 80 }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {filteredPromoters.map((p, idx) => {
                const summary = prefSummary(p.id);
                const isExpanded = expandedId === p.id;
                return (
                  <>
                    <tr key={p.id}>
                      <td className="cell-center">{idx + 1}</td>
                      <td className="cell-name">{p.name}</td>
                      <td className="cell-center">
                        <button
                          className={`status-badge status-badge-btn ${p.active ? 'status-active' : 'status-inactive'}`}
                          onClick={() => updatePromoter(p.id, { active: !p.active })}
                          title="Click to toggle"
                        >
                          {p.active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="cell-center">
                        <select
                          className="dayoff-select"
                          value={p.workingDays}
                          onChange={e => updatePromoter(p.id, { workingDays: e.target.value })}
                        >
                          {DAY_OFF_OPTIONS.map(d => (
                            <option key={d} value={d}>{d || '—'}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {summary ? (
                          <span className="pref-summary">{summary}</span>
                        ) : (
                          <span className="text-muted">No conditions</span>
                        )}
                      </td>
                      <td className="cell-center">
                        <button
                          className={`btn btn-small ${isExpanded ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => setExpandedId(isExpanded ? null : p.id)}
                        >
                          {isExpanded ? 'Close' : 'Edit'}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${p.id}-expand`} className="expand-row">
                        <td colSpan={6}>
                          <div className="pref-grid">
                            {activeStores.map(store => {
                              const pref = getPref(p.id, store.code);
                              const prefInfo = pref ? PREF_OPTIONS.find(o => o.value === pref) : null;
                              return (
                                <button
                                  key={store.code}
                                  className={`pref-chip ${prefInfo?.cls || 'pref-none'}`}
                                  onClick={() => cyclePref(p.id, store.code)}
                                  title={`${store.name} (${store.openTime}-${store.closeTime})`}
                                >
                                  <span className="pref-chip-code">{store.code}</span>
                                  <span className="pref-chip-label">{prefInfo?.label || '—'}</span>
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Promoter Conflicts Section */}
      <div className="pc-section">
        <h3 className="pc-section-title">Promoter Conflicts</h3>
        <p className="pc-section-desc">Pairs that should not be assigned to the same store on the same day</p>

        <div className="conflict-form">
          <select className="form-input conflict-select" value={conflictA} onChange={e => setConflictA(e.target.value)}>
            <option value="">Promoter A</option>
            {activePromoters.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="conflict-vs">vs</span>
          <select className="form-input conflict-select" value={conflictB} onChange={e => setConflictB(e.target.value)}>
            <option value="">Promoter B</option>
            {activePromoters.filter(p => p.id !== conflictA).map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            className="form-input conflict-reason"
            placeholder="Reason (optional)"
            value={conflictReason}
            onChange={e => setConflictReason(e.target.value)}
          />
          <button
            className="btn btn-primary btn-small"
            onClick={addConflict}
            disabled={!conflictA || !conflictB || conflictA === conflictB}
          >
            + Add
          </button>
        </div>

        {promoterConflicts.length === 0 ? (
          <p className="text-muted" style={{ marginTop: 12 }}>No conflicts defined</p>
        ) : (
          <div className="conflict-list">
            {promoterConflicts.map(c => {
              const a = promoterMap.get(c.promoterAId);
              const b = promoterMap.get(c.promoterBId);
              return (
                <div key={c.id} className="conflict-card">
                  <div className="conflict-pair">
                    <span className="conflict-name">{a?.name || c.promoterAId}</span>
                    <span className="conflict-vs">vs</span>
                    <span className="conflict-name">{b?.name || c.promoterBId}</span>
                  </div>
                  {c.reason && <span className="conflict-reason-text">{c.reason}</span>}
                  <button className="btn btn-small btn-danger-ghost" onClick={() => removeConflict(c.id)}>Remove</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PCSettingPage;
