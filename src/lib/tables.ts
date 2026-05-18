import type { Country } from '../types/types';

const SUFFIX: Record<Country, string> = { UAE: '', QA: '_qa', TH: '_th' };

/** Return the Supabase table name for a given country. Qatar uses `_qa`, Thailand uses `_th`. */
export function t(table: string, country: Country): string {
  return `${table}${SUFFIX[country]}`;
}
