import React from 'react';
import type { Store } from '../types/types';
import './SettingPage.css';

interface StoreSettingPageProps {
  stores: Store[];
}

const StoreSettingPage: React.FC<StoreSettingPageProps> = ({ stores }) => {
  return (
    <div className="setting-page">
      <div className="setting-header">
        <h2>Store Settings</h2>
        <p>Manage store locations, codes, and extra allowances</p>
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
              <th style={{ width: 100 }}>Code</th>
              <th style={{ width: 250 }}>Store Name</th>
              <th style={{ width: 100 }}>Status</th>
              <th style={{ width: 150 }}>Extra Allowance</th>
              <th style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((store, idx) => (
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StoreSettingPage;
