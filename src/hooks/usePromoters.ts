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
    role: (row.role === 'admin' ? 'admin' : 'promoter'),
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

  async function savePromoter(p: Promoter): Promise<string | null> {
    const { error } = await supabase
      .from('promoters')
      .update({ active: p.active, name: p.name, stores_label: p.storesLabel, day_off: p.workingDays, role: p.role })
      .eq('id', p.id);
    if (error) {
      console.warn('Save with role failed, retrying without role:', error.message);
      // Fallback: save without role column (in case the column doesn't exist yet)
      const { error: error2 } = await supabase
        .from('promoters')
        .update({ active: p.active, name: p.name, stores_label: p.storesLabel, day_off: p.workingDays })
        .eq('id', p.id);
      if (error2) {
        console.error('Failed to save promoter:', error2);
        return error2.message;
      }
    }
    return null;
  }

  return { promoters, setPromoters, savePromoter, loading };
}
