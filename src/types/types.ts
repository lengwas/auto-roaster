export interface Store {
  id: string;
  code: string;
  name: string;
  active: boolean;
  extraAllowance?: string;
  openTime: string;  // e.g. "10:00"
  closeTime: string; // e.g. "23:00"
}

export interface Promoter {
  id: string;
  name: string;
  storesLabel: string;
  active: boolean;
  workingDays: string;
}

export type ShiftType = string; // store code or 'LOP' | 'Off' | 'SL'

export interface Shift {
  id: string;
  promoterId: string;
  date: string; // YYYY-MM-DD
  type: ShiftType;
  timeRange?: string; // e.g. "16:00-23:00"
}

// Stores the aggregated counts for each store per day
export interface StoreCount {
  storeId: string;
  date: string;
  count: number;
}

// Special shift options that aren't stores
export const SPECIAL_SHIFTS = ['Off', 'LOP', 'SL'] as const;
