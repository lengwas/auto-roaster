import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { PromoterConflict } from '../types/types';

function mapRow(row: Record<string, unknown>): PromoterConflict {
  return {
    id: String(row.id),
    promoterAId: String(row.promoter_a_id),
    promoterBId: String(row.promoter_b_id),
    reason: row.reason ? String(row.reason) : undefined,
  };
}

export function useConflicts() {
  const [conflicts, setConflicts] = useState<PromoterConflict[]>([]);

  useEffect(() => {
    supabase
      .from('promoter_conflicts')
      .select('*')
      .then(({ data, error }) => {
        if (!error && data) setConflicts(data.map(mapRow));
      });
  }, []);

  async function saveConflict(c: PromoterConflict): Promise<string | null> {
    // Supabase has CHECK (promoter_a_id < promoter_b_id) — ensure order
    const [aId, bId] = c.promoterAId < c.promoterBId
      ? [c.promoterAId, c.promoterBId]
      : [c.promoterBId, c.promoterAId];

    const { error } = await supabase
      .from('promoter_conflicts')
      .insert({ promoter_a_id: aId, promoter_b_id: bId, reason: c.reason ?? null });
    if (error) {
      console.error('Failed to save conflict:', error);
      return error.message;
    }
    return null;
  }

  async function deleteConflict(id: string): Promise<void> {
    // Only delete if it's a real Supabase UUID (not a locally generated c_ id)
    if (id.startsWith('c_')) return;
    const { error } = await supabase
      .from('promoter_conflicts')
      .delete()
      .eq('id', id);
    if (error) console.error('Failed to delete conflict:', error);
  }

  return { conflicts, setConflicts, saveConflict, deleteConflict };
}
