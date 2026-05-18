import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { t } from '../lib/tables';
import type { Shift, Country } from '../types/types';

function mapRow(row: Record<string, unknown>): Shift {
  return {
    id: String(row.id),
    promoterId: String(row.promoter_id),
    date: String(row.date).split('T')[0],
    type: String(row.shift_type),
    timeRange: row.time_range ? String(row.time_range) : undefined,
    note: row.note ? String(row.note) : undefined,
  };
}

export function useShifts(country: Country = 'UAE') {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [earliestDate, setEarliestDate] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    const PAGE_SIZE = 1000;
    const allRows: Record<string, unknown>[] = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error: err } = await supabase
        .from(t('shifts', country))
        .select('*')
        .order('date', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (err) {
        console.error('[useShifts] Failed to load shifts from Supabase:', err.message, err);
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

    console.log(`[useShifts] Loaded ${allRows.length} shifts for ${country} (${Math.ceil(from / PAGE_SIZE)} pages).`);
    if (allRows.length > 0) {
      const mapped = allRows.map(r => mapRow(r));
      setShifts(mapped);
      const minDate = mapped.reduce((min, s) => s.date < min ? s.date : min, mapped[0].date);
      setEarliestDate(minDate);
    } else {
      setShifts([]);
    }
    setLoading(false);
  }, [country]);

  useEffect(() => {
    setShifts([]);
    fetchAll();
  }, [fetchAll]);

  async function saveShift(
    promoterId: string,
    date: string,
    shiftType: string,
    timeRange?: string,
    note?: string,
  ) {
    console.log(`[saveShift] ${shiftType} ${timeRange} for ${promoterId} on ${date} → ${t('shifts', country)}`);

    if (!shiftType) {
      const { error: delErr } = await supabase
        .from(t('shifts', country))
        .delete()
        .eq('promoter_id', promoterId)
        .eq('date', date);
      if (delErr) console.error('[saveShift] Delete failed:', delErr);
      setShifts(prev => prev.filter(s => !(s.promoterId === promoterId && s.date === date)));
      return;
    }

    const payload = { promoter_id: promoterId, date, shift_type: shiftType, time_range: timeRange ?? null, note: note ?? null };
    console.log('[saveShift] Upserting:', payload);

    const { data, error } = await supabase
      .from(t('shifts', country))
      .upsert(payload, { onConflict: 'promoter_id,date' })
      .select('*')
      .single();

    console.log('[saveShift] Result:', { data, error: error?.message });

    if (!error && data) {
      const updated = mapRow(data as Record<string, unknown>);
      setShifts(prev => {
        const filtered = prev.filter(s => !(s.promoterId === promoterId && s.date === date));
        return [...filtered, updated];
      });
    } else if (error) {
      console.error('[saveShift] Failed:', error);
    }
  }

  return { shifts, setShifts, saveShift, reload: fetchAll, loading, error, earliestDate };
}
