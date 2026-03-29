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
    // Try with all columns, then progressively remove optional ones
    const payloads: Record<string, unknown>[] = [
      { active: p.active, name: p.name, stores_label: p.storesLabel, day_off: p.workingDays, role: p.role },
      { active: p.active, name: p.name, day_off: p.workingDays, role: p.role },
      { active: p.active, name: p.name, day_off: p.workingDays },
    ];
    for (let i = 0; i < payloads.length; i++) {
      const { error } = await supabase.from('promoters').update(payloads[i]).eq('id', p.id);
      if (!error) return null;
      console.warn(`Save attempt ${i + 1} failed:`, error.message);
      if (i === payloads.length - 1) {
        console.error('All save attempts failed for promoter:', p.id);
        return error.message;
      }
    }
    return null;
  }

  async function insertPromoter(name: string): Promise<string | null> {
    // Try with all columns first, then fallback without role/stores_label
    let result = await supabase
      .from('promoters')
      .insert({ name: name.trim(), active: true, day_off: '', role: 'promoter', stores_label: '' })
      .select('*')
      .single();
    if (result.error) {
      console.warn('Insert with role/stores_label failed, retrying minimal:', result.error.message);
      result = await supabase
        .from('promoters')
        .insert({ name: name.trim(), active: true, day_off: '' })
        .select('*')
        .single();
    }
    if (result.error) {
      console.error('Failed to insert promoter:', result.error);
      return result.error.message;
    }
    if (result.data) {
      setPromoters(prev => [...prev, mapRow(result.data as Record<string, unknown>)]);
    }
    return null;
  }

  return { promoters, setPromoters, savePromoter, insertPromoter, loading };
}
