import { useState, useCallback, useMemo } from 'react';
import ShiftTable from './components/ShiftTable';
import PCSettingPage from './components/PCSettingPage';
import StoreSettingPage from './components/StoreSettingPage';
import ExportModal from './components/ExportModal';
import DatabaseSchemaPage from './components/DatabaseSchemaPage';
import SalesPerformancePage from './components/SalesPerformancePage';
import AutoAssignPage from './components/AutoAssignPage';
import { shiftDates, generateStoreCounts } from './data/mockData';
import { useStores } from './hooks/useStores';
import { usePromoters } from './hooks/usePromoters';
import { useSpecialDates } from './hooks/useSpecialDates';
import { useConflicts } from './hooks/useConflicts';
import { useStorePreferences } from './hooks/useStorePreferences';
import { useShifts } from './hooks/useShifts';
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
  const { shifts, setShifts, saveShift } = useShifts(shiftDates[0], shiftDates[shiftDates.length - 1]);
  const { storePreferences, setStorePreferences, upsertPreference, deletePreference } = useStorePreferences(stores);
  const { conflicts: promoterConflicts, setConflicts: setPromoterConflicts, saveConflict, deleteConflict } = useConflicts();
  const [storeTiers, setStoreTiers] = useState<StoreTierSetting[]>([]);
  const [gradeOverrides, setGradeOverrides] = useState<PromoterGradeOverride[]>([]);

  const storeCounts = useMemo(
    () => generateStoreCounts(stores, shiftDates, shifts),
    [stores, shifts]
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
        {activeTab === 'shift' && (
          <ShiftTable
            stores={stores}
            promoters={promoters}
            shifts={shifts}
            storeCounts={storeCounts}
            dates={shiftDates}
            onShiftChange={handleShiftChange}
            specialDates={specialDates}
            onMarkDate={(date, label, color) => markDate(date, label, color)}
            onUnmarkDate={(date) => unmarkDate(date)}
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
            onShiftsApply={(newShifts) => {
              newShifts.forEach((s) => saveShift(s.promoterId, s.date, s.type, s.timeRange));
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
