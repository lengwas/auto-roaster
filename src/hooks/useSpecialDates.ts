import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { t } from '../lib/tables';
import type { SpecialDate, Country } from '../types/types';

function mapRow(row: Record<string, unknown>): SpecialDate {
  return {
    id: String(row.id),
    date: String(row.date),
    label: String(row.label),
    color: String(row.color || '#f59e0b'),
  };
}

export function useSpecialDates(country: Country = 'UAE') {
  const [specialDates, setSpecialDates] = useState<SpecialDate[]>([]);

  useEffect(() => {
    supabase
      .from(t('special_dates', country))
      .select('*')
      .order('date')
      .then(({ data, error }) => {
        if (!error && data) setSpecialDates(data.map(mapRow));
        else setSpecialDates([]);
      });
  }, [country]);

  const upsert = async (date: string, label: string, color: string) => {
    const { data, error } = await supabase
      .from(t('special_dates', country))
      .upsert({ date, label, color }, { onConflict: 'date' })
      .select()
      .single();
    if (!error && data) {
      setSpecialDates(prev => {
        const filtered = prev.filter(d => d.date !== date);
        return [...filtered, mapRow(data as Record<string, unknown>)].sort((a, b) => a.date.localeCompare(b.date));
      });
    }
    return { error };
  };

  const remove = async (date: string) => {
    const { error } = await supabase
      .from(t('special_dates', country))
      .delete()
      .eq('date', date);
    if (!error) {
      setSpecialDates(prev => prev.filter(d => d.date !== date));
    }
    return { error };
  };

  return { specialDates, upsert, remove };
}
