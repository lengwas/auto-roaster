import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { CommissionBonus } from '../lib/orderCommission';

/** Load active additive commission bonuses (SKU/vendor/month → fixed or % bonus). */
export function useCommissionBonuses() {
  const [bonuses, setBonuses] = useState<CommissionBonus[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('commission_bonuses')
        .select('name, sku_pattern, vendor, valid_from, valid_to, bonus_type, bonus_value, active')
        .eq('active', true);
      if (error) { console.warn('[useCommissionBonuses]', error.message); return; }
      if (cancelled) return;
      setBonuses((data ?? []).map(b => ({
        name: b.name ? String(b.name) : null,
        skuPattern: b.sku_pattern ? String(b.sku_pattern) : null,
        vendor: b.vendor ? String(b.vendor) : null,
        validFrom: b.valid_from ? String(b.valid_from).split('T')[0] : null,
        validTo: b.valid_to ? String(b.valid_to).split('T')[0] : null,
        bonusType: b.bonus_type === 'percentage' ? 'percentage' : 'fixed',
        bonusValue: b.bonus_value != null ? Number(b.bonus_value) : 0,
      })));
    })();
    return () => { cancelled = true; };
  }, []);

  return bonuses;
}
