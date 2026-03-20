import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Store } from '../types/types';
import { mockStores } from '../data/mockData';

function mapRow(row: Record<string, unknown>): Store {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    active: Boolean(row.active),
    openTime: String(row.open_time || '10:00'),
    closeTime: String(row.close_time || '22:00'),
    extraAllowance: row.extra_allowance ? String(row.extra_allowance) : undefined,
    maxCapacity: row.max_capacity ? Number(row.max_capacity) : undefined,
    platform: row.platform ? String(row.platform) : undefined,
    warehouse: row.warehouse ? String(row.warehouse) : undefined,
  };
}

export function useStores() {
  const [stores, setStores] = useState<Store[]>(mockStores);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('stores')
      .select('*')
      .order('code')
      .then(({ data, error }) => {
        if (!error && data && data.length > 0) {
          setStores(data.map(mapRow));
        }
        setLoading(false);
      });
  }, []);

  return { stores, setStores, loading };
}
