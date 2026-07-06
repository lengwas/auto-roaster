import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Country } from '../types/types';

interface ReturnRow {
  lark_record_id: string;
  num: string | null;
  status: string | null;
  type: string | null;
  serial_number: string | null;
  model: string | null;
  store_code: string | null;
  staff_name: string | null;
  request_date: string | null;
  reason: string | null;
  note: string | null;
  condition: string | null;
  solution: string | null;
}

const cell = { padding: '6px 10px', border: '1px solid #e2e8f0', verticalAlign: 'top' } as const;

/** Return / Refund cases synced from the Lark Base, scoped to the current country. */
const ReturnsView = ({ country }: { country: Country }) => {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    supabase
      .from('returns')
      .select('lark_record_id, num, status, type, serial_number, model, store_code, staff_name, request_date, reason, note, condition, solution')
      .eq('country', country)
      .order('request_date', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setErr(error.message);
        else setRows((data ?? []) as ReturnRow[]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [country]);

  const pending = useMemo(() => rows.filter(r => (r.status ?? '').toLowerCase().includes('pending')).length, [rows]);

  if (loading) return <p style={{ padding: 16, color: '#6b7280' }}>Loading returns…</p>;

  if (err) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8 }}>
        <strong>Couldn't load returns:</strong> {err}
        <div style={{ color: '#7f1d1d', marginTop: 6 }}>
          If the table doesn't exist yet, run <code>scripts/supabase-returns.sql</code> in the Supabase SQL editor, then sync.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 10px', display: 'flex', gap: 14 }}>
        <span>{rows.length} returns · {country}</span>
        {pending > 0 && <span style={{ color: '#b45309', fontWeight: 600 }}>{pending} pending</span>}
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#eef2f6', textAlign: 'left' }}>
              {['#', 'Date', 'Store', 'Model', 'Serial', 'Staff', 'Type', 'Status', 'Reason / Note'].map(h => (
                <th key={h} style={{ ...cell, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const detail = [r.reason, r.note, r.condition, r.solution].filter(Boolean).join(' · ');
              return (
                <tr key={r.lark_record_id}>
                  <td style={cell}>{r.num ?? '—'}</td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>{r.request_date ?? '—'}</td>
                  <td style={cell}>{r.store_code ?? '—'}</td>
                  <td style={cell}>{r.model ?? '—'}</td>
                  <td style={{ ...cell, fontFamily: 'monospace' }}>{r.serial_number ?? '—'}</td>
                  <td style={cell}>{r.staff_name ?? '—'}</td>
                  <td style={cell}>{r.type ?? '—'}</td>
                  <td style={{ ...cell, whiteSpace: 'nowrap', color: (r.status ?? '').toLowerCase().includes('pending') ? '#b45309' : '#16a34a' }}>{r.status ?? '—'}</td>
                  <td style={{ ...cell, minWidth: 240, color: '#374151' }}>{detail || '—'}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 16, textAlign: 'center', color: '#9ca3af' }}>No returns for {country}. Sync from the Lark Base to populate.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ReturnsView;
