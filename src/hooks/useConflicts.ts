import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { PromoterConflict, Country } from '../types/types';

function mapRow(row: Record<string, unknown>): PromoterConflict {
  return {
    id: String(row.id),
    promoterAId: String(row.promoter_a_id),
    promoterBId: String(row.promoter_b_id),
    reason: row.reason ? String(row.reason) : undefined,
  };
}

export function useConflicts(country: Country = 'UAE') {
  const [conflicts, setConflicts] = useState<PromoterConflict[]>([]);

  useEffect(() => {
    supabase
      .from('promoter_conflicts')
      .select('*')
      .eq('country', country)
      .then(({ data, error }) => {
        if (!error && data) setConflicts(data.map(mapRow));
        else setConflicts([]);
      });
  }, [country]);

  async function saveConflict(c: PromoterConflict): Promise<string | null> {
    const [aId, bId] = c.promoterAId < c.promoterBId
      ? [c.promoterAId, c.promoterBId]
      : [c.promoterBId, c.promoterAId];

    const { error } = await supabase
      .from('promoter_conflicts')
      .insert({ promoter_a_id: aId, promoter_b_id: bId, reason: c.reason ?? null, country });
    if (error) {
      console.error('Failed to save conflict:', error);
      return error.message;
    }
    return null;
  }

  async function deleteConflict(id: string): Promise<void> {
    if (id.startsWith('c_')) return;
    const { error } = await supabase
      .from('promoter_conflicts')
      .delete()
      .eq('id', id);
    if (error) console.error('Failed to delete conflict:', error);
  }

  return { conflicts, setConflicts, saveConflict, deleteConflict };
}
