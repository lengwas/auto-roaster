import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { t } from '../lib/tables';
import type { Promoter, Country } from '../types/types';
import { mockPromoters } from '../data/mockData';

function mapRow(row: Record<string, unknown>): Promoter {
  return {
    id: String(row.id),
    name: String(row.name),
    storesLabel: row.stores_label ? String(row.stores_label) : '',
    active: Boolean(row.active),
    workingDays: row.day_off ? String(row.day_off) : '',
    role: (row.role === 'admin' ? 'admin' : 'promoter'),
    commissionRate: row.commission_rate != null ? Number(row.commission_rate) : 0.5,
    dailySalary: row.daily_salary != null ? Number(row.daily_salary) : 0,
  };
}

export function usePromoters(country: Country = 'UAE') {
  const [promoters, setPromoters] = useState<Promoter[]>(mockPromoters);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    supabase
      .from(t('promoters', country))
      .select('*')
      .order('name')
      .then(({ data, error }) => {
        console.log(`[usePromoters] table=${t('promoters', country)} data=${data?.length ?? 'null'} error=${error?.message ?? 'none'}`);
        if (!error && data && data.length > 0) {
          setPromoters(data.map(mapRow));
        } else if (!error) {
          setPromoters([]);
        }
        setLoading(false);
      });
  }, [country]);

  async function savePromoter(p: Promoter): Promise<string | null> {
    // Try with all columns, then progressively remove optional ones
    const payloads: Record<string, unknown>[] = [
      { active: p.active, name: p.name, stores_label: p.storesLabel, day_off: p.workingDays, role: p.role, commission_rate: p.commissionRate ?? 0.5, daily_salary: p.dailySalary ?? 0 },
      { active: p.active, name: p.name, stores_label: p.storesLabel, day_off: p.workingDays, role: p.role },
      { active: p.active, name: p.name, day_off: p.workingDays, role: p.role },
      { active: p.active, name: p.name, day_off: p.workingDays },
    ];
    for (let i = 0; i < payloads.length; i++) {
      const { error, count } = await supabase
        .from(t('promoters', country))
        .update(payloads[i], { count: 'exact' })
        .eq('id', p.id);
      if (!error) {
        if (count === 0) {
          console.warn(`Save attempt ${i + 1}: 0 rows updated for id=${p.id} (RLS or id mismatch)`);
          const numericId = Number(p.id);
          if (!isNaN(numericId)) {
            const { error: e2 } = await supabase
              .from(t('promoters', country))
              .update(payloads[i])
              .eq('id', numericId);
            if (!e2) return null;
          }
          if (i === payloads.length - 1) return `No rows updated for ${p.name} (check RLS policies)`;
          continue;
        }
        return null;
      }
      console.warn(`Save attempt ${i + 1} failed:`, error.message, error.code, error.details);
      if (i === payloads.length - 1) {
        console.error('All save attempts failed for promoter:', p.id, p.name);
        return `${error.message} (${error.code})`;
      }
    }
    return null;
  }

  async function insertPromoter(name: string): Promise<string | null> {
    // Try with all columns first, then fallback without role/stores_label
    let result = await supabase
      .from(t('promoters', country))
      .insert({ name: name.trim(), active: true, day_off: '', role: 'promoter', stores_label: '' })
      .select('*')
      .single();
    if (result.error) {
      console.warn('Insert with role/stores_label failed, retrying minimal:', result.error.message);
      result = await supabase
        .from(t('promoters', country))
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
