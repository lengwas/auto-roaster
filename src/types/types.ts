export interface Store {
  id: string;
  code: string;
  name: string;
  active: boolean;
  extraAllowance?: string;
}

export interface Promoter {
  id: string;
  name: string;
  storesLabel: string;
  active: boolean;
  workingDays: string;
}

export type ShiftType = 'VDM' | 'VDH' | 'VME' | 'BDM' | 'JME' | 'AIR' | 'VAY' | 'LOP' | 'Off' | 'SL';

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
