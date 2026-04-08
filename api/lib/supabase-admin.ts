import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Return table name with country suffix: 'attendance' → 'attendance_qa' for Qatar. */
export function t(table: string, country: 'UAE' | 'QA'): string {
  return country === 'QA' ? `${table}_qa` : table;
}
