import type { Country } from '../types/types';

/** Return the Supabase table name for a given country. Qatar uses `_qa` suffix. */
export function t(table: string, country: Country): string {
  return country === 'QA' ? `${table}_qa` : table;
}
