import { useState, useMemo } from 'react';
import type { Promoter, Shift, Store } from '../types/types';
import './ExportModal.css';

interface ExportModalProps {
  promoters: Promoter[];
  shifts: Shift[];
  stores: Store[];
  dates: string[];
  onClose: () => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDateDisplay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = DAY_NAMES[d.getDay()];
  return `${day} ${d.getDate()}/${d.getMonth() + 1}`;
}

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

const ExportModal = ({ promoters, shifts, stores, dates, onClose }: ExportModalProps) => {
  const activePromoters = promoters.filter((p) => p.active);

  // Default date range: first and last of available dates
  const [startDate, setStartDate] = useState(dates[0] || '');
  const [endDate, setEndDate] = useState(dates[Math.min(13, dates.length - 1)] || '');
  const [selectedPromoterIds, setSelectedPromoterIds] = useState<Set<string>>(new Set());
  const [exportFormat, setExportFormat] = useState<'text' | 'csv'>('text');
  const [copied, setCopied] = useState(false);

  // Store lookup
  const storeMap = useMemo(() => {
    const m = new Map<string, Store>();
    stores.forEach((s) => m.set(s.code, s));
    return m;
  }, [stores]);

  // Shift lookup
  const shiftMap = useMemo(() => {
    const m = new Map<string, Shift>();
    shifts.forEach((s) => m.set(`${s.promoterId}_${s.date}`, s));
    return m;
  }, [shifts]);

  // Filtered dates
  const filteredDates = useMemo(
    () => dates.filter((d) => d >= startDate && d <= endDate),
    [dates, startDate, endDate]
  );

  const togglePromoter = (id: string) => {
    setSelectedPromoterIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedPromoterIds(new Set(activePromoters.map((p) => p.id)));
  };

  const selectNone = () => {
    setSelectedPromoterIds(new Set());
  };

  // Generate export text
  const exportText = useMemo(() => {
    const selected = activePromoters.filter((p) => selectedPromoterIds.has(p.id));
    if (selected.length === 0 || filteredDates.length === 0) return '';

    if (exportFormat === 'csv') {
      // CSV format
      const header = ['Name', ...filteredDates.map(formatDateDisplay)].join(',');
      const rows = selected.map((p) => {
        const cells = filteredDates.map((d) => {
          const shift = shiftMap.get(`${p.id}_${d}`);
          if (!shift) return '-';
          return shift.timeRange ? `${shift.type} ${shift.timeRange}` : shift.type;
        });
        return [p.name, ...cells].join(',');
      });
      return [header, ...rows].join('\n');
    }

    // Text format — per person, friendly for messaging
    return selected
      .map((p) => {
        const lines: string[] = [];
        lines.push(`📋 ${p.name}`);
        lines.push(`📅 ${formatDateFull(startDate)} - ${formatDateFull(endDate)}`);
        lines.push('─'.repeat(30));

        filteredDates.forEach((d) => {
          const shift = shiftMap.get(`${p.id}_${d}`);
          const dateLabel = formatDateDisplay(d);

          if (!shift || shift.type === '-') {
            lines.push(`${dateLabel}  :  -`);
            return;
          }

          const store = storeMap.get(shift.type);
          if (shift.type === 'Off') {
            lines.push(`${dateLabel}  :  🔴 Off`);
          } else if (shift.type === 'LOP') {
            lines.push(`${dateLabel}  :  ⚪ LOP`);
          } else if (shift.type === 'SL') {
            lines.push(`${dateLabel}  :  🟡 Sick Leave`);
          } else {
            const storeName = store ? store.name : shift.type;
            const time = shift.timeRange ? ` (${shift.timeRange})` : '';
            lines.push(`${dateLabel}  :  🟢 ${shift.type} - ${storeName}${time}`);
          }
        });

        lines.push('');
        return lines.join('\n');
      })
      .join('\n');
  }, [selectedPromoterIds, filteredDates, shiftMap, storeMap, exportFormat, activePromoters, startDate, endDate]);

  const handleCopy = () => {
    navigator.clipboard.writeText(exportText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    const ext = exportFormat === 'csv' ? 'csv' : 'txt';
    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shift-export.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Export Shift Schedule</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Date Range */}
          <div className="export-section">
            <h3>Date Range</h3>
            <div className="date-range-row">
              <div className="form-field">
                <label>From</label>
                <input
                  type="date"
                  className="form-input"
                  value={startDate}
                  min={dates[0]}
                  max={dates[dates.length - 1]}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>To</label>
                <input
                  type="date"
                  className="form-input"
                  value={endDate}
                  min={dates[0]}
                  max={dates[dates.length - 1]}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>Format</label>
                <select
                  className="form-input"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as 'text' | 'csv')}
                >
                  <option value="text">Text (for messaging)</option>
                  <option value="csv">CSV (spreadsheet)</option>
                </select>
              </div>
            </div>
            <p className="hint-text">{filteredDates.length} days selected</p>
          </div>

          {/* Promoter Selection */}
          <div className="export-section">
            <div className="section-header-row">
              <h3>Select Promoters</h3>
              <div className="section-actions">
                <button className="btn-link" onClick={selectAll}>Select All</button>
                <button className="btn-link" onClick={selectNone}>Clear</button>
              </div>
            </div>
            <div className="promoter-chips">
              {activePromoters.map((p) => (
                <button
                  key={p.id}
                  className={`promoter-chip ${selectedPromoterIds.has(p.id) ? 'chip-selected' : ''}`}
                  onClick={() => togglePromoter(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <p className="hint-text">{selectedPromoterIds.size} promoter(s) selected</p>
          </div>

          {/* Preview */}
          {exportText && (
            <div className="export-section">
              <h3>Preview</h3>
              <pre className="export-preview">{exportText}</pre>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-secondary"
            onClick={handleCopy}
            disabled={!exportText}
          >
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={!exportText}
          >
            Download File
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportModal;
