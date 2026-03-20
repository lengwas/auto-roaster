export interface Store {
  id: string;
  code: string;
  name: string;
  active: boolean;
  extraAllowance?: string;
  openTime: string;  // e.g. "10:00"
  closeTime: string; // e.g. "23:00"
  maxCapacity?: number;
  platform?: string;  // e.g. "Virgin - Dubai Mall"
  warehouse?: string; // e.g. "VIR - DBM"
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
  note?: string;
}

// Stores the aggregated counts for each store per day
export interface StoreCount {
  storeId: string;
  date: string;
  count: number;
}

// Special shift options that aren't stores
export const SPECIAL_SHIFTS = ['Off', 'LOP', 'SL'] as const;

// Store preference per promoter
export type PreferenceLevel = 'must' | 'preferred' | 'banned';

export interface StorePreference {
  promoterId: string;
  storeCode: string;
  preference: PreferenceLevel;
}

// Special / important date mark
export interface SpecialDate {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
  color: string; // hex e.g. "#f59e0b"
}

// Promoter conflict pair
export interface PromoterConflict {
  id: string;
  promoterAId: string;
  promoterBId: string;
  reason?: string;
}
