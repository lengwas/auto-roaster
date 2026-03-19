import { useState } from 'react';
import ShiftTable from './components/ShiftTable';
import PCSettingPage from './components/PCSettingPage';
import StoreSettingPage from './components/StoreSettingPage';
import { mockStores, mockPromoters, mockShifts, shiftDates, storeCounts } from './data/mockData';
import './App.css';

type TabKey = 'shift' | 'pc-setting' | 'store-setting';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'shift', label: 'Shift Table' },
  { key: 'pc-setting', label: 'PC Setting' },
  { key: 'store-setting', label: 'Store Setting' },
];

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('shift');

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">UAE PC Shift Table</h1>
          <p className="app-subtitle">Shift Assignment & Store Allocation</p>
        </div>
        <div className="header-right">
          <button className="btn-export">Export Data</button>
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
            stores={mockStores}
            promoters={mockPromoters}
            shifts={mockShifts}
            storeCounts={storeCounts}
            dates={shiftDates}
          />
        )}
        {activeTab === 'pc-setting' && (
          <PCSettingPage promoters={mockPromoters} />
        )}
        {activeTab === 'store-setting' && (
          <StoreSettingPage stores={mockStores} />
        )}
      </main>
    </div>
  );
}

export default App;
