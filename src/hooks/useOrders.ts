import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { t } from '../lib/tables';
import type { Order, Country } from '../types/types';

function mapRow(row: Record<string, unknown>, country: Country): Order {
  // For Qatar, use amount_qar as the revenue field (mapped to amountAed for calculation compatibility)
  const amount = country === 'QA'
    ? (row.amount_qar != null ? Number(row.amount_qar) : undefined)
    : (row.amount_aed != null ? Number(row.amount_aed) : undefined);
  return {
    id: String(row.id),
    date: String(row.date).split('T')[0],
    orderId: row.order_id ? String(row.order_id) : undefined,
    salesperson: row.salesperson ? String(row.salesperson) : undefined,
    warehouse: row.warehouse ? String(row.warehouse) : undefined,
    platform: row.platform ? String(row.platform) : undefined,
    amountAed: amount,
    paidAmountAed: row.paid_amount_aed != null ? Number(row.paid_amount_aed) : undefined,
    status: String(row.status || 'pending'),
  };
}

/** Fetch orders from Supabase going back `monthsBack` months from today. */
export function useOrders(monthsBack: number = 6, country: Country = 'UAE') {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const fromDt = new Date();
    fromDt.setMonth(fromDt.getMonth() - monthsBack);
    const fromStr = fromDt.toISOString().split('T')[0];

    const cols = country === 'QA'
      ? 'id, date, order_id, salesperson, warehouse, platform, amount_qar, paid_amount_aed, status'
      : 'id, date, order_id, salesperson, warehouse, platform, amount_aed, paid_amount_aed, status';

    // Supabase caps at 1000 rows per request – paginate to fetch all
    const PAGE_SIZE = 1000;

    async function fetchAll() {
      const allRows: Record<string, unknown>[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error: err } = await supabase
          .from(t('orders', country))
          .select(cols)
          .gte('date', fromStr)
          .order('date', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);

        if (err) {
          setError(err.message);
          setLoading(false);
          return;
        }

        if (data && data.length > 0) {
          allRows.push(...(data as Record<string, unknown>[]));
        }

        hasMore = (data?.length ?? 0) === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      console.log(`[useOrders] Loaded ${allRows.length} orders for ${country}.`);
      setOrders(allRows.map(r => mapRow(r as Record<string, unknown>, country)));
      setLoading(false);
    }

    fetchAll();
  }, [monthsBack, country]);

  return { orders, loading, error };
}
