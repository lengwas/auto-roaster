import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { t } from '../lib/tables';
import type { Store, Country } from '../types/types';
import { mockStores } from '../data/mockData';

// Strip seconds from Supabase TIME columns: "13:00:00" → "13:00"
function fmtTime(t: unknown): string {
  const s = String(t || '');
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function mapRow(row: Record<string, unknown>): Store {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    active: Boolean(row.active),
    openTime: fmtTime(row.open_time || '10:00'),
    closeTime: fmtTime(row.close_time || '22:00'),
    extraAllowance: row.extra_allowance ? String(row.extra_allowance) : undefined,
    maxCapacity: row.max_capacity ? Number(row.max_capacity) : undefined,
    shiftSlots: Array.isArray(row.shift_slots) ? (row.shift_slots as string[]) : undefined,
    platform: row.platform ? String(row.platform) : undefined,
    warehouse: row.warehouse ? String(row.warehouse) : undefined,
  };
}

export function useStores(country: Country = 'UAE') {
  const [stores, setStores] = useState<Store[]>(mockStores);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    supabase
      .from(t('stores', country))
      .select('*')
      .order('code')
      .then(({ data, error }) => {
        console.log(`[useStores] table=${t('stores', country)} data=${data?.length ?? 'null'} error=${error?.message ?? 'none'}`);
        if (!error && data && data.length > 0) {
          setStores(data.map(mapRow));
        } else if (!error) {
          setStores([]);
        }
        setLoading(false);
      });
  }, [country]);

  async function saveStore(s: Store) {
    const payload: Record<string, unknown> = {
      code: s.code, name: s.name, active: s.active,
      open_time: s.openTime, close_time: s.closeTime,
      extra_allowance: s.extraAllowance ?? null,
      max_capacity: s.maxCapacity ?? null,
      shift_slots: s.shiftSlots?.filter(sl => sl.trim()).length ? s.shiftSlots.filter(sl => sl.trim()) : null,
      platform: s.platform ?? null,
      warehouse: s.warehouse ?? null,
    };
    // IDs from Supabase are UUIDs; locally-generated IDs start with "store_"
    const isNew = s.id.startsWith('store_');
    const op = isNew
      ? supabase.from(t('stores', country)).insert(payload)
      : supabase.from(t('stores', country)).update(payload).eq('id', s.id);
    const { error } = await op;
    if (error) {
      // Retry without shift_slots/platform/warehouse if column doesn't exist
      if (error.message?.includes('shift_slots') || error.message?.includes('column')) {
        console.warn('Retrying save without shift_slots (column may not exist yet):', error.message);
        delete payload.shift_slots;
        delete payload.platform;
        delete payload.warehouse;
        const op2 = isNew
          ? supabase.from(t('stores', country)).insert(payload)
          : supabase.from(t('stores', country)).update(payload).eq('id', s.id);
        const { error: e2 } = await op2;
        if (e2) console.error('Failed to save store:', e2);
      } else {
        console.error('Failed to save store:', error);
      }
    }
  }

  function deleteStore(id: string) {
    if (!id.startsWith('store_')) {
      supabase.from(t('stores', country)).delete().eq('id', id)
        .then(({ error }) => { if (error) console.error('Failed to delete store:', error); });
    }
  }

  return { stores, setStores, saveStore, deleteStore, loading };
}
