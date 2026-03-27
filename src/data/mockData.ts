import type { Store, Promoter, Shift, StoreCount, StorePreference, PromoterConflict } from '../types/types';

export const mockStores: Store[] = [
  { id: 's1',  code: 'AIR', name: 'Airwheel Office',              active: false, openTime: '09:00', closeTime: '18:00' },
  { id: 's2',  code: 'VDM', name: 'Virgin Dubai Mall',            active: true,  openTime: '13:00', closeTime: '22:00', platform: 'Virgin - Dubai Mall' },
  { id: 's3',  code: 'VME', name: 'Virgin Mall of Emirates',      active: true,  openTime: '13:00', closeTime: '22:00', platform: 'Virgin - MOE' },
  { id: 's4',  code: 'VDH', name: 'Virgin Dubai Hills',           active: true,  openTime: '13:00', closeTime: '22:00', platform: 'Virgin - Dubai Hills' },
  { id: 's5',  code: 'VNK', name: 'Virgin Nakheel',               active: true,  openTime: '13:00', closeTime: '22:00' },
  { id: 's6',  code: 'VYM', name: 'Virgin Yas Mall',              active: true,  openTime: '13:00', closeTime: '22:00', platform: 'Virgin - Yas Mall' },
  { id: 's7',  code: 'VAY', name: 'Virgin Al Maryah Island',      active: true,  openTime: '13:00', closeTime: '22:00', platform: 'Virgin - Al Maryah Island Abudhabi' },
  { id: 's8',  code: 'VRM', name: 'Virgin Reem Mall',             active: true,  openTime: '13:00', closeTime: '22:00', platform: 'Virgin - Reem Mall Abudhabi' },
  { id: 's9',  code: 'VMF', name: 'Virgin Mirdif',                active: true,  openTime: '13:00', closeTime: '22:00', platform: 'Virgin - Mirdif' },
  { id: 's10', code: 'VMN', name: 'Virgin Dubai Marina',          active: true,  openTime: '13:00', closeTime: '22:00', platform: 'Virgin - Dubai Marina' },
  { id: 's11', code: 'JDM', name: 'Jashanmal Dubai Mall',         active: true,  openTime: '13:00', closeTime: '22:00', platform: 'Jashanmal - Dubai Mall' },
  { id: 's12', code: 'JME', name: 'Jashanmal MOE',                active: true,  openTime: '13:00', closeTime: '22:00', platform: 'Jashanmal - MOE' },
  { id: 's13', code: 'JDH', name: 'Jashanmal Dubai Hills',        active: true,  openTime: '13:00', closeTime: '22:00', platform: 'Jashanmal - Dubai Hills' },
  { id: 's14', code: 'ADC', name: 'Airwheel DCC',                 active: false, openTime: '10:00', closeTime: '19:00' },
  { id: 's15', code: 'IMG', name: 'IMG World',                    active: false, openTime: '10:00', closeTime: '19:00' },
  { id: 's16', code: 'VAD', name: 'Virgin Abu Dhabi Mall',        active: false, openTime: '13:00', closeTime: '22:00', platform: 'Virgin - Abu Dhabi Mall' },
  { id: 's17', code: 'SDM', name: 'Sharaf DG - Dubai Mall',       active: false, openTime: '10:00', closeTime: '22:00', platform: 'Sharaf DG - Dubai Mall' },
  { id: 's18', code: 'BDM', name: 'Borders - Dubai Mall',         active: true,  openTime: '13:00', closeTime: '22:00', platform: 'Borders - Dubai Mall' },
  { id: 's19', code: 'HDM', name: 'Hamleys - Dubai Mall',         active: true,  openTime: '13:00', closeTime: '22:00', platform: 'Hamleys - Dubai Mall' },
];

export const mockPromoters: Promoter[] = [
  { id: 'p1',  name: 'Tammy Bo',      storesLabel: 'VME, JME',      active: true, workingDays: '', role: 'promoter' },
  { id: 'p2',  name: 'Mint Ch',       storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p3',  name: 'Shimul',        storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p4',  name: 'Artharva',      storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p5',  name: 'Tiwter',        storesLabel: 'VMN',           active: true, workingDays: '', role: 'promoter' },
  { id: 'p6',  name: 'Punpun',        storesLabel: 'VME, JME',      active: true, workingDays: '', role: 'promoter' },
  { id: 'p7',  name: 'Mostafa MO',    storesLabel: 'VAY, VRM',      active: true, workingDays: '', role: 'promoter' },
  { id: 'p8',  name: 'Akimu Ss',      storesLabel: 'VAY, VRM',      active: true, workingDays: '', role: 'promoter' },
  { id: 'p9',  name: 'Eric Ba',       storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p10', name: 'Olaide Us',     storesLabel: 'JDM',           active: true, workingDays: '', role: 'promoter' },
  { id: 'p11', name: 'Danny Th',      storesLabel: 'VMN',           active: true, workingDays: '', role: 'promoter' },
  { id: 'p12', name: 'Kevin Ka',      storesLabel: 'JDM',           active: true, workingDays: '', role: 'promoter' },
  { id: 'p13', name: 'Natasha Ng',    storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p14', name: 'Maureen Wa',    storesLabel: 'VME',           active: true, workingDays: '', role: 'promoter' },
  { id: 'p15', name: 'Juan Fe',       storesLabel: 'VMN',           active: true, workingDays: '', role: 'promoter' },
  { id: 'p16', name: 'Nabeel Na',     storesLabel: 'VME',           active: true, workingDays: '', role: 'promoter' },
  { id: 'p17', name: 'Sandun Ma',     storesLabel: 'VAY, VRM',      active: true, workingDays: '', role: 'promoter' },
  { id: 'p18', name: 'Alexandre Ju',  storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p19', name: 'Mohid Kh',      storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p20', name: 'Khaled Al',     storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p21', name: 'Apple Ma',      storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p22', name: 'Sakib Ha',      storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p23', name: 'Mint Su',       storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p24', name: 'Hajar Sa',      storesLabel: 'VYM',           active: true, workingDays: '', role: 'promoter' },
  { id: 'p25', name: 'Jerby Pe',      storesLabel: 'VAY, VRM',      active: true, workingDays: '', role: 'promoter' },
  { id: 'p26', name: 'Amine Ch',      storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p27', name: 'Ahmed No',      storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p28', name: 'Angela Uj',     storesLabel: 'VDM',           active: true, workingDays: '', role: 'promoter' },
  { id: 'p29', name: 'Mohamed Ta',    storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p30', name: 'Mufti Ja',      storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p31', name: 'Milk Kh',       storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p32', name: 'Muhammad Ja',   storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p33', name: 'Soufiane Le',   storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p34', name: 'Emmanuel Fr',   storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p35', name: 'Timothy Ak',    storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p36', name: 'Lynda Dj',      storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p37', name: 'Pokuah Do',     storesLabel: 'VMN',           active: true, workingDays: '', role: 'promoter' },
  { id: 'p38', name: 'Arlene Le',     storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p39', name: 'Aamir An',      storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p40', name: 'Ben Mu',        storesLabel: 'JDM',           active: true, workingDays: '', role: 'promoter' },
  { id: 'p41', name: 'Sahil Ka',      storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p42', name: 'Lucky Ap',      storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p43', name: 'Ramya Sh',      storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p44', name: 'Mina Ta',       storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p45', name: 'Nadeem Si',     storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p46', name: 'Shuhaib Pu',    storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
  { id: 'p47', name: 'Romnick Co',    storesLabel: '',              active: true, workingDays: '', role: 'promoter' },
];

export function getDates(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  const d = new Date(startDate);
  while (d <= endDate) {
    dates.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// Default fallback: 3 months back → 3 months forward
const today = new Date();
const defaultStart = new Date(today.getFullYear(), today.getMonth() - 3, 1);
const defaultEnd = new Date(today.getFullYear(), today.getMonth() + 3, 0);
export const shiftDates = getDates(defaultStart, defaultEnd);

// Generate store counts from actual shift assignments
export const generateStoreCounts = (stores: Store[], dates: string[], shifts: Shift[]): StoreCount[] => {
  const counts: StoreCount[] = [];
  const specialShifts = new Set(['Off', 'LOP', 'SL', 'AL']);

  const shiftCountMap = new Map<string, number>();
  shifts.forEach((shift) => {
    if (!specialShifts.has(shift.type)) {
      const key = `${shift.type}_${shift.date}`;
      shiftCountMap.set(key, (shiftCountMap.get(key) || 0) + 1);
    }
  });

  stores.forEach((store) => {
    dates.forEach((date) => {
      const count = shiftCountMap.get(`${store.code}_${date}`) || 0;
      counts.push({ storeId: store.id, date, count });
    });
  });

  return counts;
};

export const mockShifts: Shift[] = [];

export const mockStorePreferences: StorePreference[] = [];

export const mockPromoterConflicts: PromoterConflict[] = [];
