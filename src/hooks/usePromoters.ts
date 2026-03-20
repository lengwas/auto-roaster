import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Promoter } from '../types/types';
import { mockPromoters } from '../data/mockData';

function mapRow(row: Record<string, unknown>): Promoter {
  return {
    id: String(row.id),
    name: String(row.name),
    storesLabel: row.stores_label ? String(row.stores_label) : '',
    active: Boolean(row.active),
    workingDays: row.day_off ? String(row.day_off) : '',
  };
}

export function usePromoters() {
  const [promoters, setPromoters] = useState<Promoter[]>(mockPromoters);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('promoters')
      .select('*')
      .order('name')
      .then(({ data, error }) => {
        if (!error && data && data.length > 0) {
          setPromoters(data.map(mapRow));
        }
        setLoading(false);
      });
  }, []);

  return { promoters, setPromoters, loading };
}
