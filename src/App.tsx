import { useState, useCallback, useMemo } from 'react';
import ShiftTable from './components/ShiftTable';
import PCSettingPage from './components/PCSettingPage';
import StoreSettingPage from './components/StoreSettingPage';
import ExportModal from './components/ExportModal';
import DatabaseSchemaPage from './components/DatabaseSchemaPage';
import { mockStores, mockPromoters, mockShifts, shiftDates, generateStoreCounts } from './data/mockData';
import type { Store } from './types/types';
import './App.css';

type TabKey = 'shift' | 'pc-setting' | 'store-setting' | 'db-schema';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'shift', label: 'Shift Table' },
  { key: 'pc-setting', label: 'PC Setting' },
  { key: 'store-setting', label: 'Store Setting' },
  { key: 'db-schema', label: 'Database Schema' },
];

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('shift');
  const [stores, setStores] = useState<Store[]>(mockStores);
  const [shifts, setShifts] = useState(mockShifts);
  const [showExport, setShowExport] = useState(false);

  const storeCounts = useMemo(
    () => generateStoreCounts(stores, shiftDates, shifts),
    [stores, shifts]
  );

  const handleShiftChange = useCallback((promoterId: string, date: string, newType: string, timeRange?: string) => {
    setShifts((prev) => {
      const key = `${promoterId}_${date}`;
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
            promoters={mockPromoters}
            shifts={shifts}
            storeCounts={storeCounts}
            dates={shiftDates}
            onShiftChange={handleShiftChange}
          />
        )}
        {activeTab === 'pc-setting' && (
          <PCSettingPage promoters={mockPromoters} />
        )}
        {activeTab === 'store-setting' && (
          <StoreSettingPage stores={stores} onStoresChange={setStores} />
        )}
        {activeTab === 'db-schema' && (
          <DatabaseSchemaPage />
        )}
      </main>

      {showExport && (
        <ExportModal
          promoters={mockPromoters}
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
