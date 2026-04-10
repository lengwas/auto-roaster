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

  /** Update an attendance record in Supabase and local state.
   *  If promoter was changed AND there's an original OCR name, save the alias for future auto-matching. */
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
    originalOcrName?: string | null,
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

    // Save alias: OCR name → promoter_id so future records auto-match
    if (updates.promoter_id && originalOcrName) {
      const ocrKey = originalOcrName.toLowerCase().trim();
      if (ocrKey && ocrKey !== (updates.promoter_name || '').toLowerCase().trim()) {
        await supabase
          .from(t('promoter_name_map', country))
          .upsert({ ocr_name: ocrKey, promoter_id: updates.promoter_id }, { onConflict: 'ocr_name' });
        console.log(`[useAttendance] Saved alias: "${ocrKey}" → ${updates.promoter_id}`);
      }
    }
  }

  /** Merge duplicate records: combine check-in and check-out for same promoter+date.
   *  Keeps the earliest record and merges check_in/check_out from duplicates, then deletes extras. */
  async function mergeDuplicates() {
    // Group by promoter_id + date
    const groups = new Map<string, Attendance[]>();
    for (const r of records) {
      if (!r.promoterId) continue;
      const key = `${r.promoterId}_${r.date}`;
      const arr = groups.get(key) || [];
      arr.push(r);
      groups.set(key, arr);
    }

    let mergedCount = 0;
    for (const [, group] of groups) {
      if (group.length < 2) continue;

      // Sort by createdAt ascending — keep the first one
      group.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const keep = group[0];
      const rest = group.slice(1);

      // Collect best check_in and check_out from all records
      let bestCheckIn = keep.checkIn;
      let bestCheckOut = keep.checkOut;
      let bestStoreCode = keep.storeCode;
      let bestStoreName = keep.storeName;

      for (const dup of rest) {
        if (!bestCheckIn && dup.checkIn) bestCheckIn = dup.checkIn;
        if (!bestCheckOut && dup.checkOut) bestCheckOut = dup.checkOut;
        if (!bestStoreCode && dup.storeCode) {
          bestStoreCode = dup.storeCode;
          bestStoreName = dup.storeName;
        }
      }

      // Update the kept record with merged data
      const updates: Record<string, unknown> = {};
      if (bestCheckIn !== keep.checkIn) updates.check_in = bestCheckIn;
      if (bestCheckOut !== keep.checkOut) updates.check_out = bestCheckOut;
      if (bestStoreCode !== keep.storeCode) {
        updates.store_code = bestStoreCode;
        updates.store_name = bestStoreName;
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from(t('attendance', country))
          .update(updates)
          .eq('id', keep.id);
      }

      // Delete duplicate records
      const deleteIds = rest.map(r => r.id);
      await supabase
        .from(t('attendance', country))
        .delete()
        .in('id', deleteIds);

      mergedCount += rest.length;
    }

    if (mergedCount > 0) {
      // Refresh data
      setLoading(true);
      const { data } = await supabase
        .from(t('attendance', country))
        .select('*')
        .order('date', { ascending: false });
      if (data) {
        setRecords((data as Record<string, unknown>[]).map(r => mapRow(r)));
      }
      setLoading(false);
    }

    return mergedCount;
  }

  return { records, loading, error, updateRecord, mergeDuplicates };
}
