import type { Store, Promoter, Shift, StoreCount, StorePreference, PromoterConflict } from '../types/types';

export const mockStores: Store[] = [
  { id: '1', code: 'AIR', name: 'Airport City', active: true, openTime: '10:00', closeTime: '22:00' },
  { id: '2', code: 'VDM', name: 'Vox Deira Mall', active: true, openTime: '16:00', closeTime: '23:00', maxCapacity: 4 },
  { id: '3', code: 'VME', name: 'Vox Mall of Emirates', active: true, openTime: '14:00', closeTime: '23:00', maxCapacity: 2 },
  { id: '4', code: 'VDH', name: 'Vox Dubai Hills', active: true, extraAllowance: '+10 AED', openTime: '15:00', closeTime: '23:00' },
  { id: '5', code: 'VNK', name: 'Vox Nakheel', active: true, extraAllowance: '+15 AED', openTime: '14:00', closeTime: '22:00' },
  { id: '6', code: 'VYM', name: 'Vox Yas Mall', active: true, openTime: '13:00', closeTime: '22:00' },
  { id: '7', code: 'VAY', name: 'Vox Al Ain', active: true, openTime: '13:00', closeTime: '21:00' },
  { id: '8', code: 'VRM', name: 'Vox Reel Mall', active: true, openTime: '14:00', closeTime: '22:00' },
  { id: '9', code: 'VMF', name: 'Vox Mirdif', active: true, openTime: '15:00', closeTime: '23:00' },
  { id: '10', code: 'VMN', name: 'Vox Marina', active: true, openTime: '14:00', closeTime: '23:00' },
  { id: '11', code: 'JDM', name: 'Jumbo Deira', active: true, openTime: '10:00', closeTime: '22:00' },
  { id: '12', code: 'JME', name: 'Jumbo MOE', active: true, openTime: '10:00', closeTime: '22:00' },
  { id: '13', code: 'JDH', name: 'Jumbo Dubai Hills', active: true, extraAllowance: '+10 AED', openTime: '10:00', closeTime: '22:00' },
  { id: '14', code: 'SDM', name: 'Sharaf DG Mall', active: true, openTime: '10:00', closeTime: '22:00' },
  { id: '15', code: 'BDM', name: 'Best Al Barsha', active: true, openTime: '10:00', closeTime: '23:00' },
  { id: '16', code: 'HDM', name: 'Home Deira', active: true, openTime: '10:00', closeTime: '22:00' },
];

export const mockPromoters: Promoter[] = [
  { id: 'p1', name: 'Kevin Ka', storesLabel: 'VDM, JDM, JME', active: true, workingDays: 'Thu' },
  { id: 'p2', name: 'Maureen Wa', storesLabel: 'VME, JDM', active: true, workingDays: 'Mon' },
  { id: 'p3', name: 'Alexandre Ju', storesLabel: 'AIR, VRM', active: true, workingDays: 'Sat' },
  { id: 'p4', name: 'Jerby Pe', storesLabel: 'VDH, VMN', active: true, workingDays: 'Tue' },
  { id: 'p5', name: 'Ahmed No', storesLabel: 'VME, VNK', active: true, workingDays: 'Tue' },
  { id: 'p6', name: 'Angela Uj', storesLabel: 'SDM, HDM', active: true, workingDays: 'Wed' },
  { id: 'p7', name: 'Mufti Ja', storesLabel: 'VYM, VAY', active: true, workingDays: 'Tue' },
  { id: 'p8', name: 'Lynda Dj', storesLabel: 'VDM, VMF', active: true, workingDays: 'Wed' },
  { id: 'p9', name: 'Arlene Le', storesLabel: 'BDM, JDH', active: true, workingDays: 'Tue' },
  { id: 'p10', name: 'Ben Mu', storesLabel: 'VDM, JME', active: true, workingDays: 'Wed' },
  { id: 'p11', name: 'Sarah Al', storesLabel: 'VME, VNK', active: true, workingDays: 'Thu' },
  { id: 'p12', name: 'Omar Ha', storesLabel: 'VDH, VMN', active: true, workingDays: 'Fri' },
  { id: 'p13', name: 'Diana Co', storesLabel: 'AIR, SDM', active: true, workingDays: 'Mon' },
  { id: 'p14', name: 'Rashid Kh', storesLabel: 'JDM, JME', active: true, workingDays: 'Sun' },
  { id: 'p15', name: 'Maria Fe', storesLabel: 'BDM, HDM', active: true, workingDays: 'Thu' },
  { id: 'p16', name: 'James Wy', storesLabel: 'VRM, VMF', active: true, workingDays: 'Sat' },
  { id: 'p17', name: 'Fatima Za', storesLabel: 'VYM, VAY', active: true, workingDays: 'Mon' },
  { id: 'p18', name: 'Carlos De', storesLabel: 'VDM, VME', active: true, workingDays: 'Wed' },
  { id: 'p19', name: 'Priya Sh', storesLabel: 'SDM, JDH', active: true, workingDays: 'Fri' },
  { id: 'p20', name: 'Hassan Ab', storesLabel: 'AIR, VNK', active: true, workingDays: 'Tue' },
];

// Generate 3 months of dates (~90 days)
const getDates = (startDate: Date, days: number) => {
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
};

export const shiftDates = getDates(new Date('2024-03-01'), 92); // Mar 1 - May 31

// Seeded pseudo-random for consistent data
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Generate realistic shifts for all promoters across all dates
function generateShifts(promoters: Promoter[], stores: Store[], dates: string[]): Shift[] {
  const shifts: Shift[] = [];
  let id = 1;
  const rand = seededRandom(42);

  const dayOffMap: Record<string, number> = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6,
  };

  // Build store lookup for time ranges
  const storeMap = new Map<string, Store>();
  stores.forEach(s => storeMap.set(s.code, s));

  promoters.forEach((promoter) => {
    const dayOff = dayOffMap[promoter.workingDays] ?? -1;

    dates.forEach((dateStr) => {
      const d = new Date(dateStr + 'T00:00:00');
      const dow = d.getDay();

      // Day off
      if (dow === dayOff) {
        shifts.push({ id: `s${id++}`, promoterId: promoter.id, date: dateStr, type: 'Off' });
        return;
      }

      // ~5% chance of sick leave
      if (rand() < 0.05) {
        shifts.push({ id: `s${id++}`, promoterId: promoter.id, date: dateStr, type: 'SL' });
        return;
      }

      // ~8% chance of LOP
      if (rand() < 0.08) {
        shifts.push({ id: `s${id++}`, promoterId: promoter.id, date: dateStr, type: 'LOP' });
        return;
      }

      // Assign a store shift based on the promoter's stores
      const storeLabels = promoter.storesLabel.split(',').map(s => s.trim()).filter(Boolean);
      if (storeLabels.length > 0) {
        const storeCode = storeLabels[Math.floor(rand() * storeLabels.length)];
        const store = storeMap.get(storeCode);
        if (store) {
          shifts.push({
            id: `s${id++}`,
            promoterId: promoter.id,
            date: dateStr,
            type: store.code,
            timeRange: `${store.openTime}-${store.closeTime}`,
          });
          return;
        }
      }

      // Fallback: pick a random active store
      const activeStores = stores.filter(s => s.active);
      const pick = activeStores[Math.floor(rand() * activeStores.length)];
      shifts.push({
        id: `s${id++}`,
        promoterId: promoter.id,
        date: dateStr,
        type: pick.code,
        timeRange: `${pick.openTime}-${pick.closeTime}`,
      });
    });
  });

  return shifts;
}

export const mockShifts = generateShifts(mockPromoters, mockStores, shiftDates);

// Generate store counts from actual shift assignments
export const generateStoreCounts = (stores: Store[], dates: string[], shifts: Shift[]): StoreCount[] => {
  const counts: StoreCount[] = [];
  const specialShifts = new Set(['Off', 'LOP', 'SL']);

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

export const storeCounts = generateStoreCounts(mockStores, shiftDates, mockShifts);

// Mock store preferences
export const mockStorePreferences: StorePreference[] = [
  { promoterId: 'p1', storeCode: 'VDM', preference: 'must' },
  { promoterId: 'p1', storeCode: 'JDM', preference: 'preferred' },
  { promoterId: 'p1', storeCode: 'VNK', preference: 'banned' },
  { promoterId: 'p2', storeCode: 'VME', preference: 'must' },
  { promoterId: 'p2', storeCode: 'AIR', preference: 'banned' },
  { promoterId: 'p3', storeCode: 'AIR', preference: 'must' },
  { promoterId: 'p3', storeCode: 'VRM', preference: 'preferred' },
  { promoterId: 'p4', storeCode: 'VDH', preference: 'must' },
  { promoterId: 'p5', storeCode: 'VME', preference: 'preferred' },
  { promoterId: 'p5', storeCode: 'VDM', preference: 'banned' },
  { promoterId: 'p6', storeCode: 'SDM', preference: 'must' },
  { promoterId: 'p7', storeCode: 'VYM', preference: 'must' },
  { promoterId: 'p7', storeCode: 'VAY', preference: 'preferred' },
];

// Mock promoter conflicts
export const mockPromoterConflicts: PromoterConflict[] = [
  { id: 'c1', promoterAId: 'p1', promoterBId: 'p10', reason: 'Personal conflict' },
  { id: 'c2', promoterAId: 'p5', promoterBId: 'p11', reason: 'Same skill set — avoid overlap' },
  { id: 'c3', promoterAId: 'p3', promoterBId: 'p16', reason: 'Schedule clash history' },
];
