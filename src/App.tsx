import { useState, useCallback, useMemo, useEffect } from 'react';
import ShiftTable from './components/ShiftTable';
import PCSettingPage from './components/PCSettingPage';
import StoreSettingPage from './components/StoreSettingPage';
import ExportModal from './components/ExportModal';
import DatabaseSchemaPage from './components/DatabaseSchemaPage';
import SalesPerformancePage from './components/SalesPerformancePage';
import AutoAssignPage from './components/AutoAssignPage';
import AttendancePage from './components/AttendancePage';
import DashboardPage from './components/DashboardPage';
import UserGuidePage from './components/UserGuidePage';
import ChangelogPage from './components/ChangelogPage';
import CustomerDashboardPage from './components/CustomerDashboardPage';
import CommissionPage from './components/CommissionPage';
import InventorySettingPage from './components/InventorySettingPage';
import { NavBar, type TabKey, type CommissionView } from './components/NavBar';
import { useAttendance } from './hooks/useAttendance';
import { getDates, generateStoreCounts } from './data/mockData';
import { useStores } from './hooks/useStores';
import { usePromoters } from './hooks/usePromoters';
import { useSpecialDates } from './hooks/useSpecialDates';
import { useConflicts } from './hooks/useConflicts';
import { useStorePreferences } from './hooks/useStorePreferences';
import { useShifts } from './hooks/useShifts';
import { useOrders } from './hooks/useOrders';
import { validateShifts } from './lib/shiftValidator';
import type { StoreTierSetting, PromoterGradeOverride, Country } from './types/types';
import './App.css';

const COUNTRIES: { code: Country; label: string; flag: string }[] = [
  { code: 'UAE', label: 'UAE', flag: '🇦🇪' },
  { code: 'QA', label: 'Qatar', flag: '🇶🇦' },
  { code: 'TH', label: 'Thailand', flag: '🇹🇭' },
];

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('shift');
  const [commissionView, setCommissionView] = useState<CommissionView>('upload');
  const [country, setCountry] = useState<Country>(() =>
    (localStorage.getItem('country') as Country) || 'UAE'
  );
  const handleCountryChange = (c: Country) => {
    setCountry(c);
    localStorage.setItem('country', c);
    setStoreTiers([]);
    setGradeOverrides([]);
  };

  const { stores, setStores, saveStore, deleteStore } = useStores(country);
  const { promoters, setPromoters, savePromoter, insertPromoter } = usePromoters(country);
  const { specialDates, upsert: markDate, remove: unmarkDate } = useSpecialDates(country);
  const [showExport, setShowExport] = useState(false);
  const { shifts, setShifts, saveShift, reload: reloadShifts, error: shiftsError, earliestDate } = useShifts(country);

  // ── Draft buffer: track unsaved shift changes ───────────────────────────
  // Key: `${promoterId}_${date}` → payload to save
  const [pendingChanges, setPendingChanges] = useState<Map<string, { promoterId: string; date: string; type: string; timeRange?: string; note?: string }>>(new Map());
  const [saving, setSaving] = useState(false);

  // Reset pending when country changes
  useEffect(() => { setPendingChanges(new Map()); }, [country]);
  const { storePreferences, setStorePreferences, upsertPreference, deletePreference } = useStorePreferences(stores, country);
  const { conflicts: promoterConflicts, setConflicts: setPromoterConflicts, saveConflict, deleteConflict } = useConflicts(country);
  const { orders } = useOrders(6, country);
  const { records: attendanceRecords, loading: attendanceLoading, updateRecord: updateAttendance, mergeDuplicates: mergeAttendanceDuplicates, syncNoteByPromoterDate: syncAttendanceNote } = useAttendance(country);
  const [storeTiers, setStoreTiers] = useState<StoreTierSetting[]>([]);
  const [gradeOverrides, setGradeOverrides] = useState<PromoterGradeOverride[]>([]);

  // Dynamic date range: from earliest shift (or 3 months ago) to 3 months forward
  const shiftDates = useMemo(() => {
    const today = new Date();
    const defaultStart = new Date(today.getFullYear(), today.getMonth() - 3, 1);
    const endDate = new Date(today.getFullYear(), today.getMonth() + 3, 0);
    const startDate = earliestDate
      ? new Date(Math.min(new Date(earliestDate + 'T00:00:00').getTime(), defaultStart.getTime()))
      : defaultStart;
    return getDates(startDate, endDate);
  }, [earliestDate]);

  const shiftAlerts = useMemo(
    () => validateShifts(shifts, promoters, stores, storePreferences, promoterConflicts),
    [shifts, promoters, stores, storePreferences, promoterConflicts],
  );

  const attendanceNotesMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of attendanceRecords) {
      if (a.promoterId && a.note) m.set(`${a.promoterId}_${a.date}`, a.note);
    }
    return m;
  }, [attendanceRecords]);

  const storeCounts = useMemo(
    () => generateStoreCounts(stores, shiftDates, shifts),
    [stores, shifts, shiftDates]
  );

  const handleShiftChange = useCallback((promoterId: string, date: string, newType: string, timeRange?: string, note?: string) => {
    // Buffer change locally (draft) — don't write to DB yet
    const key = `${promoterId}_${date}`;
    setPendingChanges(prev => {
      const next = new Map(prev);
      next.set(key, { promoterId, date, type: newType, timeRange, note });
      return next;
    });
    // Update local shifts state for immediate UI feedback
    setShifts(prev => {
      const filtered = prev.filter(s => !(s.promoterId === promoterId && s.date === date));
      if (!newType) return filtered;
      return [...filtered, { id: `draft_${key}`, promoterId, date, type: newType, timeRange, note }];
    });
  }, [setShifts]);

  const savePendingChanges = useCallback(async () => {
    if (pendingChanges.size === 0) return;
    setSaving(true);
    const entries = [...pendingChanges.values()];
    for (const e of entries) {
      await saveShift(e.promoterId, e.date, e.type, e.timeRange, e.note);
    }
    setPendingChanges(new Map());
    setSaving(false);
  }, [pendingChanges, saveShift]);

  const discardPendingChanges = useCallback(async () => {
    setPendingChanges(new Map());
    await reloadShifts();
  }, [reloadShifts]);

  /** Sync an attendance note edit back to the matching shift's note (same promoter+date). */
  const handleSyncAttendanceToShift = useCallback((promoterId: string, date: string, note: string) => {
    const cur = shifts.find(s => s.promoterId === promoterId && s.date === date);
    if (!cur) return;
    if ((cur.note ?? '') === (note ?? '')) return;
    saveShift(promoterId, date, cur.type, cur.timeRange, note || undefined);
  }, [shifts, saveShift]);

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 className="app-title">ShiftPro</h1>
            <div style={{ display: 'flex', gap: 4 }}>
              {COUNTRIES.map(c => (
                <button
                  key={c.code}
                  onClick={() => handleCountryChange(c.code)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 6,
                    border: country === c.code ? '2px solid #6366f1' : '1px solid #d1d5db',
                    background: country === c.code ? '#eef2ff' : 'white',
                    fontWeight: country === c.code ? 700 : 400,
                    fontSize: 13,
                    cursor: 'pointer',
                    color: country === c.code ? '#4338ca' : '#6b7280',
                  }}
                >
                  {c.flag} {c.label}
                </button>
              ))}
            </div>
          </div>
          <p className="app-subtitle">Shift Assignment & Store Allocation</p>
        </div>
        <div className="header-right">
          <button className="btn-export" onClick={() => setShowExport(true)}>
            Export Data
          </button>
        </div>
      </header>

      <NavBar
        activeTab={activeTab}
        commissionView={commissionView}
        onSelect={({ tab, commissionView: cv }) => {
          setActiveTab(tab);
          if (cv) setCommissionView(cv);
        }}
      />

      <main className="app-main">
        {shiftsError && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 16px', margin: '12px 16px 0', color: '#b91c1c', fontSize: 13 }}>
            <strong>Shifts failed to load from Supabase:</strong> {shiftsError}
            <br />
            <span style={{ color: '#7f1d1d' }}>
              Fix: Run <code>scripts/supabase-fix-anon-policies.sql</code> in your Supabase SQL Editor to allow anon-key access.
            </span>
          </div>
        )}
        {activeTab === 'shift' && pendingChanges.size > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: '#fefce8', border: '1px solid #facc15', borderRadius: 8,
            padding: '8px 16px', margin: '12px 16px 0', fontSize: 13,
          }}>
            <span style={{ color: '#a16207', fontWeight: 600 }}>
              Draft — {pendingChanges.size} unsaved change{pendingChanges.size > 1 ? 's' : ''}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button
                onClick={discardPendingChanges}
                style={{
                  padding: '4px 14px', borderRadius: 6, border: '1px solid #d1d5db',
                  background: '#fff', cursor: 'pointer', fontSize: 13,
                }}
              >
                Discard
              </button>
              <button
                onClick={savePendingChanges}
                disabled={saving}
                style={{
                  padding: '4px 14px', borderRadius: 6, border: 'none',
                  background: '#16a34a', color: '#fff', cursor: 'pointer', fontSize: 13,
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
        {activeTab === 'shift' && (
          <ShiftTable
            stores={stores}
            promoters={promoters}
            shifts={shifts}
            storeCounts={storeCounts}
            dates={shiftDates}
            orders={orders}
            onShiftChange={handleShiftChange}
            specialDates={specialDates}
            onMarkDate={(date, label, color) => markDate(date, label, color)}
            onUnmarkDate={(date) => unmarkDate(date)}
            storeTiers={storeTiers}
            gradeOverrides={gradeOverrides}
            storePreferences={storePreferences}
            promoterConflicts={promoterConflicts}
            alerts={shiftAlerts}
            attendanceNotes={attendanceNotesMap}
            onSyncNoteToAttendance={syncAttendanceNote}
          />
        )}
        {activeTab === 'pc-setting' && (
          <PCSettingPage
            promoters={promoters}
            stores={stores}
            storePreferences={storePreferences}
            onPreferencesChange={setStorePreferences}
            onSavePreference={upsertPreference}
            onDeletePreference={deletePreference}
            promoterConflicts={promoterConflicts}
            onConflictsChange={setPromoterConflicts}
            onSaveConflict={saveConflict}
            onDeleteConflict={deleteConflict}
            onPromotersChange={setPromoters}
            onSavePromoters={async (changed) => {
              const results = await Promise.all(changed.map(savePromoter));
              return results.filter((e): e is string => e !== null);
            }}
            onInsertPromoter={insertPromoter}
          />
        )}
        {activeTab === 'store-setting' && (
          <StoreSettingPage
            stores={stores}
            promoters={promoters}
            storePreferences={storePreferences}
            onStoresChange={setStores}
            onSaveStore={saveStore}
            onDeleteStore={deleteStore}
            onSavePreference={upsertPreference}
            onDeletePreference={deletePreference}
            onPreferencesChange={setStorePreferences}
          />
        )}
        {activeTab === 'sales' && (
          <SalesPerformancePage
            stores={stores}
            promoters={promoters}
            shifts={shifts}
            storeTiers={storeTiers}
            onStoreTiersChange={setStoreTiers}
            gradeOverrides={gradeOverrides}
            onGradeOverridesChange={setGradeOverrides}
            country={country}
          />
        )}
        {activeTab === 'customers' && <CustomerDashboardPage />}
        {activeTab === 'commission' && (
          <CommissionPage
            stores={stores}
            promoters={promoters}
            country={country}
            view={commissionView}
            onViewChange={setCommissionView}
          />
        )}
        {activeTab === 'inventory' && <InventorySettingPage />}
        {activeTab === 'auto-assign' && (
          <AutoAssignPage
            stores={stores}
            promoters={promoters}
            storePreferences={storePreferences}
            promoterConflicts={promoterConflicts}
            storeTiers={storeTiers}
            gradeOverrides={gradeOverrides}
            existingShifts={shifts}
            country={country}
            attendanceNotes={attendanceNotesMap}
            onShiftsApply={async (newShifts) => {
              await Promise.all(newShifts.map((s) => saveShift(s.promoterId, s.date, s.type, s.timeRange)));
              setActiveTab('shift');
            }}
          />
        )}
        {activeTab === 'attendance' && (
          <AttendancePage
            stores={stores}
            promoters={promoters}
            shifts={shifts}
            attendance={attendanceRecords}
            specialDates={specialDates}
            loading={attendanceLoading}
            onUpdate={updateAttendance}
            onMergeDuplicates={mergeAttendanceDuplicates}
            onSyncNoteToShift={handleSyncAttendanceToShift}
          />
        )}
        {activeTab === 'db-schema' && (
          <DatabaseSchemaPage
            stores={stores}
            promoters={promoters}
            shifts={shifts}
          />
        )}
        {activeTab === 'dashboard' && (
          <DashboardPage
            orders={orders}
            stores={stores}
            promoters={promoters}
            country={country}
          />
        )}
        {activeTab === 'guide' && <UserGuidePage />}
        {activeTab === 'changelog' && <ChangelogPage />}
      </main>

      {showExport && (
        <ExportModal
          promoters={promoters}
          shifts={shifts}
          stores={stores}
          dates={shiftDates}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}

export default App;
