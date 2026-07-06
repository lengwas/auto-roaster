import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Country } from '../types/types';

const VENDORS = ['virgin', 'jashanmal', 'hamleys'] as const;
const FLAG: Record<string, string> = { UAE: '🇦🇪', QA: '🇶🇦', TH: '🇹🇭' };

/** Upload a monthly vendor report → Supabase Storage, then parse it into vendor_report_lines. */
const VendorReportUpload = ({ month, country }: { month: string; country: Country }) => {
  const [vendor, setVendor] = useState<string>('virgin');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function handleUpload() {
    if (!file) { setMsg('Choose a file first.'); setOk(false); return; }
    setBusy(true); setOk(false); setMsg('Uploading file…');
    try {
      const safeName = file.name.replace(/[^\w.\-]+/g, '_');
      const storagePath = `${vendor}/${country}/${month}/${Date.now()}_${safeName}`;

      const { error: upErr } = await supabase.storage
        .from('vendor-reports').upload(storagePath, file, { upsert: true });
      if (upErr) { setMsg(`Upload failed: ${upErr.message}`); setBusy(false); return; }

      setMsg('Parsing & importing…');
      const resp = await fetch('/api/import-vendor-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath, vendor, month, fileName: file.name, country }),
      });
      const data = await resp.json();
      if (!resp.ok) { setMsg(`Import failed: ${data.error || resp.status}`); setBusy(false); return; }

      let m = `✅ Imported ${data.rows} lines (sales ${data.sales}, returns ${data.returns}) for ${data.months?.join(', ') || month}.`;
      if (data.unmappedStores?.length) {
        m += `  ⚠ Unmapped stores → add to vendor_store_map: ${data.unmappedStores.join(', ')}`;
      }
      setMsg(m); setOk(true);
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, margin: '12px 0', background: '#fafafa' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>Upload monthly vendor report</strong>
        <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#eef2ff', color: '#4338ca' }}>
          {FLAG[country] || ''} {country}
        </span>
        <select value={vendor} onChange={e => setVendor(e.target.value)} style={{ padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db' }}>
          {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#6b7280' }}>month: {month}</span>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          style={{ fontSize: 12 }}
        />
        <button
          onClick={handleUpload}
          disabled={busy || !file}
          style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#0ea5e9', color: '#fff', cursor: busy ? 'default' : 'pointer', fontSize: 12, opacity: busy || !file ? 0.6 : 1 }}
        >
          {busy ? 'Working…' : 'Upload & Import'}
        </button>
      </div>
      {msg && (
        <div style={{ fontSize: 12, marginTop: 8, color: ok ? '#16a34a' : '#b45309', fontWeight: 500 }}>{msg}</div>
      )}
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
        Uploading for <strong>{country}</strong> — replaces existing rows for that vendor + month <em>in {country} only</em> (the other country's report is untouched). Selling price comes from the report.
      </div>
    </div>
  );
};

export default VendorReportUpload;
