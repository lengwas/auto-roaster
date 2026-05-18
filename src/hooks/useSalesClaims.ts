import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface SalesClaim {
  id: string;
  submissionId: string;
  uniqueId: string | null;
  date: string;
  time: string | null;
  promoterName: string;
  branch: string;
  customerGender: string | null;
  nationality: string | null;
  visaType: string | null;
  ageRange: string | null;
  groupType: string | null;
  numberOfLuggage: number;
  productList: string | null;
  duplicated: boolean;
  status: string;
}

function mapRow(row: Record<string, unknown>): SalesClaim {
  return {
    id: String(row.id),
    submissionId: String(row.submission_id),
    uniqueId: row.unique_id ? String(row.unique_id) : null,
    date: String(row.date).split('T')[0],
    time: row.time ? String(row.time).slice(0, 5) : null,
    promoterName: String(row.promoter_name || ''),
    branch: String(row.branch || ''),
    customerGender: row.customer_gender ? String(row.customer_gender) : null,
    nationality: row.nationality ? String(row.nationality) : null,
    visaType: row.visa_type ? String(row.visa_type) : null,
    ageRange: row.age_range ? String(row.age_range) : null,
    groupType: row.group_type ? String(row.group_type) : null,
    numberOfLuggage: Number(row.number_of_luggage || 0),
    productList: row.product_list ? String(row.product_list) : null,
    duplicated: Boolean(row.duplicated),
    status: String(row.status || 'pending'),
  };
}

export function useSalesClaims() {
  const [claims, setClaims] = useState<SalesClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const PAGE_SIZE = 1000;

    async function fetchAll() {
      const allRows: Record<string, unknown>[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error: err } = await supabase
          .from('sales_claims')
          .select('*')
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

      const mapped = allRows.map(mapRow);
      setClaims(mapped);
      setLoading(false);
    }

    fetchAll();
  }, []);

  return { claims, loading, error };
}
