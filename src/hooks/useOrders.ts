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

    const from = new Date();
    from.setMonth(from.getMonth() - monthsBack);
    const fromStr = from.toISOString().split('T')[0];

    supabase
      .from(t('orders', country))
      .select('id, date, order_id, salesperson, warehouse, platform, amount_aed, amount_qar, paid_amount_aed, status')
      .gte('date', fromStr)
      .order('date', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message);
        } else if (data) {
          setOrders(data.map(r => mapRow(r, country)));
        }
        setLoading(false);
      });
  }, [monthsBack, country]);

  return { orders, loading, error };
}
