import React from 'react';
import type { Promoter } from '../types/types';
import './SettingPage.css';

interface PCSettingPageProps {
  promoters: Promoter[];
}

const PCSettingPage: React.FC<PCSettingPageProps> = ({ promoters }) => {
  return (
    <div className="setting-page">
      <div className="setting-header">
        <h2>PC (Promoter) Settings</h2>
        <p>Manage promoter profiles, store assignments, and day-off schedules</p>
      </div>

      <div className="setting-toolbar">
        <div className="setting-search">
          <input type="text" placeholder="Search promoter..." className="search-input" />
        </div>
        <div className="setting-actions">
          <span className="badge">{promoters.filter(p => p.active).length} Active</span>
          <button className="btn btn-primary">+ Add Promoter</button>
        </div>
      </div>

      <div className="setting-table-wrap">
        <table className="setting-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th style={{ width: 200 }}>Name</th>
              <th style={{ width: 100 }}>Status</th>
              <th style={{ width: 250 }}>Assigned Stores</th>
              <th style={{ width: 120 }}>Day Off</th>
              <th style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {promoters.map((p, idx) => (
              <tr key={p.id}>
                <td className="cell-center">{idx + 1}</td>
                <td className="cell-name">{p.name}</td>
                <td className="cell-center">
                  <span className={`status-badge ${p.active ? 'status-active' : 'status-inactive'}`}>
                    {p.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <div className="store-tags">
                    {p.storesLabel.split(',').filter(Boolean).map((s) => (
                      <span key={s.trim()} className="store-tag">{s.trim()}</span>
                    ))}
                    {!p.storesLabel && <span className="text-muted">No stores assigned</span>}
                  </div>
                </td>
                <td className="cell-center">{p.workingDays}</td>
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

export default PCSettingPage;
