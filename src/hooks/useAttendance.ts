import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { t } from '../lib/tables';
import type { Country } from '../types/types';

export interface Attendance {
  id: string;
  promoterId: string | null;
  promoterName: string | null;
  storeCode: string | null;
  storeName: string | null;
  date: string;
  checkIn: string | null;   // "HH:MM:SS"
  checkOut: string | null;
  source: string;
  status: string;
  ocrConfidence: string | null;
  lineUserId: string | null;
  createdAt: string;
}

function mapRow(row: Record<string, unknown>): Attendance {
  return {
    id: String(row.id),
    promoterId: row.promoter_id ? String(row.promoter_id) : null,
    promoterName: row.promoter_name ? String(row.promoter_name) : null,
    storeCode: row.store_code ? String(row.store_code) : null,
    storeName: row.store_name ? String(row.store_name) : null,
    date: String(row.date).split('T')[0],
    checkIn: row.check_in ? String(row.check_in) : null,
    checkOut: row.check_out ? String(row.check_out) : null,
    source: String(row.source || 'line'),
    status: String(row.status || 'matched'),
    ocrConfidence: row.ocr_confidence ? String(row.ocr_confidence) : null,
    lineUserId: row.line_user_id ? String(row.line_user_id) : null,
    createdAt: String(row.created_at),
  };
}

export function useAttendance(country: Country = 'UAE') {
  const [records, setRecords] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setRecords([]);

    const PAGE_SIZE = 1000;

    async function fetchAll() {
      const allRows: Record<string, unknown>[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error: err } = await supabase
          .from(t('attendance', country))
          .select('*')
          .order('date', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);

        if (err) {
          setError(err.message);
          setLoading(false);
          return;
        }

        if (data && data.length > 0) {
          allRows.push(...(data as Record<string, unknown>[]));
        }

        hasMore = (data?.length ?? 0) === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      setRecords(allRows.map(r => mapRow(r)));
      setLoading(false);
    }

    fetchAll();
  }, [country]);

  /** Update an attendance record in Supabase and local state. */
  async function updateRecord(
    id: string,
    updates: {
      promoter_id?: string | null;
      promoter_name?: string | null;
      store_code?: string | null;
      store_name?: string | null;
      check_in?: string | null;
      check_out?: string | null;
      status?: string;
    },
  ) {
    const { data, error: err } = await supabase
      .from(t('attendance', country))
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (err) {
      console.error('[useAttendance] Update failed:', err);
      return;
    }

    if (data) {
      const updated = mapRow(data as Record<string, unknown>);
      setRecords(prev => prev.map(r => r.id === id ? updated : r));
    }
  }

  return { records, loading, error, updateRecord };
}
