import { useState, useMemo, useRef } from 'react';
import html2canvas from 'html2canvas';
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

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function getDayName(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return DAY_NAMES[d.getDay()];
}

type ExportFormat = 'image' | 'text' | 'csv';

const ExportModal = ({ promoters, shifts, stores, dates, onClose }: ExportModalProps) => {
  const activePromoters = promoters.filter((p) => p.active);
  const cardContainerRef = useRef<HTMLDivElement>(null);

  const [startDate, setStartDate] = useState(dates[0] || '');
  const [endDate, setEndDate] = useState(dates[Math.min(13, dates.length - 1)] || '');
  const [selectedPromoterIds, setSelectedPromoterIds] = useState<Set<string>>(new Set());
  const [exportFormat, setExportFormat] = useState<ExportFormat>('image');
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  const storeMap = useMemo(() => {
    const m = new Map<string, Store>();
    stores.forEach((s) => m.set(s.code, s));
    return m;
  }, [stores]);

  const shiftMap = useMemo(() => {
    const m = new Map<string, Shift>();
    shifts.forEach((s) => m.set(`${s.promoterId}_${s.date}`, s));
    return m;
  }, [shifts]);

  const filteredDates = useMemo(
    () => dates.filter((d) => d >= startDate && d <= endDate),
    [dates, startDate, endDate]
  );

  const selectedPromoters = useMemo(
    () => activePromoters.filter((p) => selectedPromoterIds.has(p.id)),
    [activePromoters, selectedPromoterIds]
  );

  const togglePromoter = (id: string) => {
    setSelectedPromoterIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedPromoterIds(new Set(activePromoters.map((p) => p.id)));
  const selectNone = () => setSelectedPromoterIds(new Set());

  // Build shift info for a promoter on a date
  const getShiftInfo = (promoterId: string, date: string) => {
    const shift = shiftMap.get(`${promoterId}_${date}`);
    if (!shift) return { label: '-', type: 'none' as const };

    if (shift.type === 'Off') return { label: 'Off', type: 'off' as const };
    if (shift.type === 'LOP') return { label: 'LOP', type: 'lop' as const };
    if (shift.type === 'SL') return { label: 'Sick Leave', type: 'sl' as const };

    const store = storeMap.get(shift.type);
    const storeName = store ? store.name : shift.type;
    const time = shift.timeRange || (store ? `${store.openTime}-${store.closeTime}` : '');
    return {
      label: `${shift.type} - ${storeName}`,
      time,
      type: 'work' as const,
      note: shift.note,
    };
  };

  // --- Text/CSV export ---
  const exportText = useMemo(() => {
    if (selectedPromoters.length === 0 || filteredDates.length === 0) return '';
    if (exportFormat === 'image') return '';

    if (exportFormat === 'csv') {
      const header = ['Name', ...filteredDates.map(formatDateDisplay)].join(',');
      const rows = selectedPromoters.map((p) => {
        const cells = filteredDates.map((d) => {
          const shift = shiftMap.get(`${p.id}_${d}`);
          if (!shift) return '-';
          return shift.timeRange ? `${shift.type} ${shift.timeRange}` : shift.type;
        });
        return [p.name, ...cells].join(',');
      });
      return [header, ...rows].join('\n');
    }

    // Text format
    return selectedPromoters
      .map((p) => {
        const lines: string[] = [];
        lines.push(`📋 ${p.name}`);
        lines.push(`📅 ${formatDateFull(startDate)} - ${formatDateFull(endDate)}`);
        lines.push('─'.repeat(30));
        filteredDates.forEach((d) => {
          const info = getShiftInfo(p.id, d);
          const dateLabel = formatDateDisplay(d);
          if (info.type === 'none') lines.push(`${dateLabel}  :  -`);
          else if (info.type === 'off') lines.push(`${dateLabel}  :  🔴 Off`);
          else if (info.type === 'lop') lines.push(`${dateLabel}  :  ⚪ LOP`);
          else if (info.type === 'sl') lines.push(`${dateLabel}  :  🟡 Sick Leave`);
          else lines.push(`${dateLabel}  :  🟢 ${info.label} (${info.time})`);
        });
        lines.push('');
        return lines.join('\n');
      })
      .join('\n');
  }, [selectedPromoters, filteredDates, shiftMap, exportFormat, startDate, endDate]);

  // --- Image export ---
  // Clone card to off-screen container at full height to avoid clipping
  const handleExportImage = async (promoter?: Promoter) => {
    const container = cardContainerRef.current;
    if (!container) return;
    setExporting(true);

    try {
      const targets = promoter ? [promoter] : selectedPromoters;

      for (const p of targets) {
        const cardEl = container.querySelector(`[data-promoter-id="${p.id}"]`) as HTMLElement;
        if (!cardEl) continue;

        // Clone card to a temporary off-screen container (no overflow clipping)
        const offscreen = document.createElement('div');
        offscreen.style.position = 'fixed';
        offscreen.style.left = '-9999px';
        offscreen.style.top = '0';
        offscreen.style.width = '480px';
        offscreen.style.overflow = 'visible';
        offscreen.style.zIndex = '-1';

        const clone = cardEl.cloneNode(true) as HTMLElement;
        // Remove download button from clone
        const btnWrap = clone.querySelector('.card-download-btn-wrap');
        if (btnWrap) btnWrap.remove();

        offscreen.appendChild(clone);
        document.body.appendChild(offscreen);

        // Wait for rendering
        await new Promise((r) => setTimeout(r, 50));

        const canvas = await html2canvas(clone, {
          backgroundColor: '#ffffff',
          scale: 2,
          logging: false,
          useCORS: true,
          scrollY: 0,
          scrollX: 0,
          windowWidth: 520,
          windowHeight: clone.scrollHeight + 40,
        });

        document.body.removeChild(offscreen);

        const link = document.createElement('a');
        link.download = `schedule_${p.name.replace(/\s+/g, '_')}_${startDate}_${endDate}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

        if (targets.length > 1) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    } finally {
      setExporting(false);
    }
  };

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
      <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Export Shift Schedule</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Date Range + Format */}
          <div className="export-section">
            <h3>Date Range & Format</h3>
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
                  onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                >
                  <option value="image">Image Card (PNG)</option>
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

          {/* Image Card Preview */}
          {exportFormat === 'image' && selectedPromoters.length > 0 && filteredDates.length > 0 && (
            <div className="export-section">
              <div className="section-header-row">
                <h3>Preview</h3>
                <div className="section-actions">
                  <button
                    className="btn-link"
                    onClick={() => handleExportImage()}
                    disabled={exporting}
                  >
                    {exporting ? 'Exporting...' : `Download All (${selectedPromoters.length})`}
                  </button>
                </div>
              </div>

              <div className="card-preview-scroll" ref={cardContainerRef}>
                {selectedPromoters.map((p) => (
                  <div key={p.id} className="schedule-card" data-promoter-id={p.id}>
                    <div className="card-header">
                      <div className="card-name">{p.name}</div>
                      <div className="card-date-range">
                        {formatDateFull(startDate)} — {formatDateFull(endDate)}
                      </div>
                    </div>
                    <table className="card-table">
                      <thead>
                        <tr>
                          <th className="card-th-day">Day</th>
                          <th className="card-th-date">Date</th>
                          <th className="card-th-assignment">Assignment</th>
                          <th className="card-th-time">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDates.map((date) => {
                          const info = getShiftInfo(p.id, date);
                          const dayName = getDayName(date);
                          const isWeekend = dayName === 'Fri' || dayName === 'Sat';
                          return (
                            <tr
                              key={date}
                              className={`card-row card-row-${info.type}${isWeekend ? ' card-row-weekend' : ''}`}
                            >
                              <td className="card-td-day">{dayName}</td>
                              <td className="card-td-date">{formatDateShort(date)}</td>
                              <td className="card-td-assignment">
                                <span className={`card-dot card-dot-${info.type}`} />
                                {info.label}
                                {info.note && <span className="card-note"> — {info.note}</span>}
                              </td>
                              <td className="card-td-time">
                                {info.type === 'work' && info.time ? info.time : ''}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="card-footer">
                      <div className="card-legend">
                        <span className="card-legend-item"><span className="card-dot card-dot-work" /> Working</span>
                        <span className="card-legend-item"><span className="card-dot card-dot-off" /> Off</span>
                        <span className="card-legend-item"><span className="card-dot card-dot-lop" /> LOP</span>
                        <span className="card-legend-item"><span className="card-dot card-dot-sl" /> SL</span>
                      </div>
                      {(() => {
                        let work = 0, off = 0, lop = 0, sl = 0;
                        filteredDates.forEach((d) => {
                          const info = getShiftInfo(p.id, d);
                          if (info.type === 'work') work++;
                          else if (info.type === 'off') off++;
                          else if (info.type === 'lop') lop++;
                          else if (info.type === 'sl') sl++;
                        });
                        return (
                          <div className="card-summary">
                            {work} work · {off} off · {lop} LOP · {sl} SL
                          </div>
                        );
                      })()}
                    </div>
                    <div className="card-download-btn-wrap">
                      <button
                        className="btn btn-small btn-primary"
                        onClick={() => handleExportImage(p)}
                        disabled={exporting}
                      >
                        Download PNG
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Text/CSV Preview */}
          {exportFormat !== 'image' && exportText && (
            <div className="export-section">
              <h3>Preview</h3>
              <pre className="export-preview">{exportText}</pre>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {exportFormat === 'image' ? (
            <button
              className="btn btn-primary"
              onClick={() => handleExportImage()}
              disabled={!selectedPromoters.length || !filteredDates.length || exporting}
            >
              {exporting ? 'Exporting...' : `Download All Images (${selectedPromoters.length})`}
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExportModal;
