import { useState, useCallback, useMemo } from 'react';
import ShiftTable from './components/ShiftTable';
import PCSettingPage from './components/PCSettingPage';
import StoreSettingPage from './components/StoreSettingPage';
import ExportModal from './components/ExportModal';
import DatabaseSchemaPage from './components/DatabaseSchemaPage';
import SalesPerformancePage from './components/SalesPerformancePage';
import AutoAssignPage from './components/AutoAssignPage';
import { getDates, generateStoreCounts } from './data/mockData';
import { useStores } from './hooks/useStores';
import { usePromoters } from './hooks/usePromoters';
import { useSpecialDates } from './hooks/useSpecialDates';
import { useConflicts } from './hooks/useConflicts';
import { useStorePreferences } from './hooks/useStorePreferences';
import { useShifts } from './hooks/useShifts';
import { useOrders } from './hooks/useOrders';
import type { StoreTierSetting, PromoterGradeOverride } from './types/types';
import './App.css';

type TabKey = 'shift' | 'pc-setting' | 'store-setting' | 'sales' | 'auto-assign' | 'db-schema';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'shift', label: 'Shift Table' },
  { key: 'pc-setting', label: 'PC Setting' },
  { key: 'store-setting', label: 'Store Setting' },
  { key: 'sales', label: 'Sales Performance' },
  { key: 'auto-assign', label: 'Auto Assign' },
  { key: 'db-schema', label: 'Database' },
];

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('shift');
  const { stores, setStores, saveStore, deleteStore } = useStores();
  const { promoters, setPromoters, savePromoter, insertPromoter } = usePromoters();
  const { specialDates, upsert: markDate, remove: unmarkDate } = useSpecialDates();
  const [showExport, setShowExport] = useState(false);
  const { shifts, saveShift, error: shiftsError, earliestDate } = useShifts();
  const { storePreferences, setStorePreferences, upsertPreference, deletePreference } = useStorePreferences(stores);
  const { conflicts: promoterConflicts, setConflicts: setPromoterConflicts, saveConflict, deleteConflict } = useConflicts();
  const { orders } = useOrders();
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

  const storeCounts = useMemo(
    () => generateStoreCounts(stores, shiftDates, shifts),
    [stores, shifts, shiftDates]
  );

  const handleShiftChange = useCallback((promoterId: string, date: string, newType: string, timeRange?: string, note?: string) => {
    saveShift(promoterId, date, newType, timeRange, note);
  }, [saveShift]);

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">UAE PC Shift Table</h1>
          <p className="app-subtitle">Shift Assignment & Store Allocation</p>
        </div>
        <div className="header-right">
          <button className="btn-export" onClick={() => setShowExport(true)}>
            Export Data
          </button>
        </div>
      </header>

      <nav className="tab-nav">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

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
          />
        )}
        {activeTab === 'auto-assign' && (
          <AutoAssignPage
            stores={stores}
            promoters={promoters}
            storePreferences={storePreferences}
            promoterConflicts={promoterConflicts}
            storeTiers={storeTiers}
            gradeOverrides={gradeOverrides}
            existingShifts={shifts}
            onShiftsApply={async (newShifts) => {
              await Promise.all(newShifts.map((s) => saveShift(s.promoterId, s.date, s.type, s.timeRange)));
              setActiveTab('shift');
            }}
          />
        )}
        {activeTab === 'db-schema' && (
          <DatabaseSchemaPage
            stores={stores}
            promoters={promoters}
            shifts={shifts}
          />
        )}
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
