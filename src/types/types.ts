export type Country = 'UAE' | 'QA' | 'TH';

export interface Store {
  id: string;
  code: string;
  name: string;
  active: boolean;
  extraAllowance?: string;
  openTime: string;  // e.g. "10:00"
  closeTime: string; // e.g. "23:00"
  maxCapacity?: number;
  /** Shift time slots, e.g. ["10:00-19:00","13:30-22:30"] */
  shiftSlots?: string[];
  platform?: string;  // e.g. "Virgin - Dubai Mall"
  warehouse?: string; // e.g. "VIR - DBM"
}

export type PromoterRole = 'admin' | 'promoter';

export interface Promoter {
  id: string;
  name: string;
  storesLabel: string;
  active: boolean;
  /** Comma-separated day names that are days off, e.g. "Fri,Sat" */
  workingDays: string;
  role: PromoterRole;
  /** Commission rate as a percent of selling price, e.g. 0.5 = 0.5%, 1 = 1% */
  commissionRate?: number;
  /** Daily salary (per working day), in local currency */
  dailySalary?: number;
  // ── HR / staff-master fields ──
  nickname?: string;
  contact?: string;
  email?: string;
  nationality?: string;
  trainer?: string;
  /** Active | Resign | Failed | Office */
  status?: string;
  startDate?: string;   // YYYY-MM-DD
  lastDate?: string;    // YYYY-MM-DD (last working day, if left)
  uniformSize?: string;
  lastShirtDate?: string;
  reasonForLeaving?: string;
  removedFromChatgroups?: boolean;
  additionalComments?: string;
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

// ============================================================
// Sales / Orders
// ============================================================
export interface Order {
  id: string;
  date: string;         // YYYY-MM-DD
  orderId?: string;
  salesperson?: string; // free-text name; matched to Promoter.name
  warehouse?: string;   // matched to Store.warehouse
  platform?: string;
  sku?: string;
  serialNumber?: string; // admin-recorded serial number
  name?: string;        // product name, e.g. "Airwheel-SE3S-Black"
  amountAed?: number;
  paidAmountAed?: number;
  status: string;       // 'completed' | 'pending' | 'cancelled' | 'returned'
}

// Store performance tier (set manually per store)
export type StoreTier = 'A' | 'B' | 'C' | 'D';

// Promoter performance grade
export type PromoterGrade = 'A' | 'B' | 'C' | 'D';

export interface StoreTierSetting {
  storeCode: string;
  tier: StoreTier;
}

export interface PromoterGradeOverride {
  promoterId: string;
  grade: PromoterGrade;
}
