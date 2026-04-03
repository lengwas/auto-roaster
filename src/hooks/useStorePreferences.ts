import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { t } from '../lib/tables';
import type { Store, StorePreference, PreferenceLevel, Country } from '../types/types';

export function useStorePreferences(stores: Store[], country: Country = 'UAE') {
  const [storePreferences, setStorePreferences] = useState<StorePreference[]>([]);

  useEffect(() => {
    if (stores.length === 0) return;
    // Skip while stores still have mock IDs (real Supabase IDs are UUIDs)
    if (stores.some(s => s.id.length < 10)) return;
    supabase
      .from(t('promoter_store_preferences', country))
      .select('*')
      .then(({ data, error }) => {
        if (!error && data) {
          const idToCode = new Map(stores.map(s => [s.id, s.code]));
          const prefs = data
            .map(row => ({
              promoterId: String(row.promoter_id),
              storeCode: idToCode.get(String(row.store_id)) ?? '',
              preference: String(row.preference) as PreferenceLevel,
            }))
            .filter(p => p.storeCode);
          setStorePreferences(prefs);
        }
      });
  }, [stores]); // re-fetch when stores reference changes (mock → real UUIDs)

  async function upsertPreference(promoterId: string, storeCode: string, preference: PreferenceLevel) {
    const storeId = stores.find(s => s.code === storeCode)?.id;
    if (!storeId) return;
    const { error } = await supabase
      .from(t('promoter_store_preferences', country))
      .upsert(
        { promoter_id: promoterId, store_id: storeId, preference },
        { onConflict: 'promoter_id,store_id' }
      );
    if (error) console.error('Failed to upsert preference:', error);
  }

  async function deletePreference(promoterId: string, storeCode: string) {
    const storeId = stores.find(s => s.code === storeCode)?.id;
    if (!storeId) return;
    const { error } = await supabase
      .from(t('promoter_store_preferences', country))
      .delete()
      .eq('promoter_id', promoterId)
      .eq('store_id', storeId);
    if (error) console.error('Failed to delete preference:', error);
  }

  return { storePreferences, setStorePreferences, upsertPreference, deletePreference };
}
