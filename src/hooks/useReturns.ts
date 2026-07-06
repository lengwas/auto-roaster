import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Country } from '../types/types';

export interface ReturnUnit {
  serialNumber: string | null;
  returnedDate: string | null;
}

/** Return/Refund units (from the Lark-synced `returns` table) for a country,
 *  used to claw back commission from the most recent sale of each serial. */
export function useReturns(country: Country): ReturnUnit[] {
  const [returns, setReturns] = useState<ReturnUnit[]>([]);
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('returns')
      .select('serial_number, request_date')
      .eq('country', country)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.warn('[useReturns]', error.message); setReturns([]); return; }
        setReturns((data ?? []).map(r => ({
          serialNumber: r.serial_number ? String(r.serial_number) : null,
          returnedDate: r.request_date ? String(r.request_date).split('T')[0] : null,
        })));
      });
    return () => { cancelled = true; };
  }, [country]);
  return returns;
}
