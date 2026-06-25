import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/** Load the set of genuine serial numbers from serial_registry (uppercased). */
export function useSerialRegistry() {
  const [serials, setSerials] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const PAGE = 1000;
      const set = new Set<string>();
      let from = 0, hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase
          .from('serial_registry')
          .select('serial_number')
          .range(from, from + PAGE - 1);
        if (error) { console.warn('[useSerialRegistry]', error.message); break; }
        (data ?? []).forEach(r => { if (r.serial_number) set.add(String(r.serial_number).trim().toUpperCase()); });
        hasMore = (data?.length ?? 0) === PAGE;
        from += PAGE;
      }
      if (!cancelled) setSerials(set);
    })();
    return () => { cancelled = true; };
  }, []);

  return serials;
}
