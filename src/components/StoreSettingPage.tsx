import type { Store } from '../types/types';
import './SettingPage.css';

interface StoreSettingPageProps {
  stores: Store[];
}

const StoreSettingPage = ({ stores }: StoreSettingPageProps) => {
  return (
    <div className="setting-page">
      <div className="setting-header">
        <h2>Store Settings</h2>
        <p>Manage store locations, codes, operating hours, and extra allowances</p>
      </div>

      <div className="setting-toolbar">
        <div className="setting-search">
          <input type="text" placeholder="Search store..." className="search-input" />
        </div>
        <div className="setting-actions">
          <span className="badge">{stores.filter(s => s.active).length} Active</span>
          <button className="btn btn-primary">+ Add Store</button>
        </div>
      </div>

      <div className="setting-table-wrap">
        <table className="setting-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th style={{ width: 90 }}>Code</th>
              <th style={{ width: 220 }}>Store Name</th>
              <th style={{ width: 90 }}>Status</th>
              <th style={{ width: 100 }}>Open</th>
              <th style={{ width: 100 }}>Close</th>
              <th style={{ width: 100 }}>Hours</th>
              <th style={{ width: 130 }}>Extra Allowance</th>
              <th style={{ width: 90 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((store, idx) => {
              // Calculate total hours
              const [openH, openM] = store.openTime.split(':').map(Number);
              const [closeH, closeM] = store.closeTime.split(':').map(Number);
              const totalMinutes = (closeH * 60 + closeM) - (openH * 60 + openM);
              const hours = Math.floor(totalMinutes / 60);
              const mins = totalMinutes % 60;
              const hoursLabel = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;

              return (
                <tr key={store.id}>
                  <td className="cell-center">{idx + 1}</td>
                  <td>
                    <span className="store-code-badge">{store.code}</span>
                  </td>
                  <td className="cell-name">{store.name}</td>
                  <td className="cell-center">
                    <span className={`status-badge ${store.active ? 'status-active' : 'status-inactive'}`}>
                      {store.active ? 'Active' : 'Inactive'}
                    </span>
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
                    <button className="btn btn-small btn-ghost">Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StoreSettingPage;
