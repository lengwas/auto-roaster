import { useState, useCallback, useMemo } from 'react';
import ShiftTable from './components/ShiftTable';
import PCSettingPage from './components/PCSettingPage';
import StoreSettingPage from './components/StoreSettingPage';
import ExportModal from './components/ExportModal';
import DatabaseSchemaPage from './components/DatabaseSchemaPage';
import { mockShifts, shiftDates, generateStoreCounts, mockStorePreferences, mockPromoterConflicts } from './data/mockData';
import { useStores } from './hooks/useStores';
import { usePromoters } from './hooks/usePromoters';
import { useSpecialDates } from './hooks/useSpecialDates';
import type { StorePreference, PromoterConflict } from './types/types';
import './App.css';

type TabKey = 'shift' | 'pc-setting' | 'store-setting' | 'db-schema';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'shift', label: 'Shift Table' },
  { key: 'pc-setting', label: 'PC Setting' },
  { key: 'store-setting', label: 'Store Setting' },
  { key: 'db-schema', label: 'Database' },
];

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('shift');
  const { stores, setStores } = useStores();
  const { promoters, setPromoters } = usePromoters();
  const { specialDates, upsert: markDate, remove: unmarkDate } = useSpecialDates();
  const [shifts, setShifts] = useState(mockShifts);
  const [showExport, setShowExport] = useState(false);
  const [storePreferences, setStorePreferences] = useState<StorePreference[]>(mockStorePreferences);
  const [promoterConflicts, setPromoterConflicts] = useState<PromoterConflict[]>(mockPromoterConflicts);

  const storeCounts = useMemo(
    () => generateStoreCounts(stores, shiftDates, shifts),
    [stores, shifts]
  );

  const handleShiftChange = useCallback((promoterId: string, date: string, newType: string, timeRange?: string, note?: string) => {
    setShifts((prev) => {
      const key = `${promoterId}_${date}`;
      const existing = prev.find((s) => `${s.promoterId}_${s.date}` === key);
      const filtered = prev.filter((s) => `${s.promoterId}_${s.date}` !== key);
      if (!newType) return filtered;
      return [
        ...filtered,
        {
          id: `s_${promoterId}_${date}`,
          promoterId,
          date,
          type: newType,
          timeRange,
          note: note !== undefined ? note : existing?.note,
        },
      ];
    });
  }, []);

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
            promoterConflicts={promoterConflicts}
            onConflictsChange={setPromoterConflicts}
            onPromotersChange={setPromoters}
          />
        )}
        {activeTab === 'store-setting' && (
          <StoreSettingPage stores={stores} onStoresChange={setStores} />
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
