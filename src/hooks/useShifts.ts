import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Shift } from '../types/types';

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

export function useShifts() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [earliestDate, setEarliestDate] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    // Fetch ALL shifts (no date filter), override default 1000 row limit
    supabase
      .from('shifts')
      .select('*')
      .limit(50000)
      .then(({ data, error }) => {
        if (error) {
          console.error('[useShifts] Failed to load shifts from Supabase:', error.message, error);
          setError(error.message);
        } else {
          console.log(`[useShifts] Loaded ${data?.length ?? 0} shifts.`);
          if (data && data.length > 0) {
            const mapped = data.map(r => mapRow(r as Record<string, unknown>));
            setShifts(mapped);
            // Find earliest date
            const minDate = mapped.reduce((min, s) => s.date < min ? s.date : min, mapped[0].date);
            setEarliestDate(minDate);
          }
        }
        setLoading(false);
      });
  }, []);

  async function saveShift(
    promoterId: string,
    date: string,
    shiftType: string,
    timeRange?: string,
    note?: string,
  ) {
    if (!shiftType) {
      // Delete
      await supabase
        .from('shifts')
        .delete()
        .eq('promoter_id', promoterId)
        .eq('date', date);
      setShifts(prev => prev.filter(s => !(s.promoterId === promoterId && s.date === date)));
      return;
    }

    const { data, error } = await supabase
      .from('shifts')
      .upsert(
        { promoter_id: promoterId, date, shift_type: shiftType, time_range: timeRange ?? null, note: note ?? null },
        { onConflict: 'promoter_id,date' },
      )
      .select('*')
      .single();

    if (!error && data) {
      const updated = mapRow(data as Record<string, unknown>);
      setShifts(prev => {
        const filtered = prev.filter(s => !(s.promoterId === promoterId && s.date === date));
        return [...filtered, updated];
      });
    } else if (error) {
      console.error('Failed to save shift:', error);
    }
  }

  return { shifts, setShifts, saveShift, loading, error, earliestDate };
}
