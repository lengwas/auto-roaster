import type { Store, Promoter, Shift, StoreCount } from '../types/types';

export const mockStores: Store[] = [
  { id: '1', code: 'AIR', name: 'Airport City', active: true },
  { id: '2', code: 'VDM', name: 'Vox Deira Mall', active: true },
  { id: '3', code: 'VME', name: 'Vox Mall of Emirates', active: true },
  { id: '4', code: 'VDH', name: 'Vox Dubai Hills', active: true, extraAllowance: '+10 AED' },
  { id: '5', code: 'VNK', name: 'Vox Nakheel', active: true, extraAllowance: '+15 AED' },
  { id: '6', code: 'VYM', name: 'Vox Yas Mall', active: true },
  { id: '7', code: 'VAY', name: 'Vox Al Ain', active: true },
  { id: '8', code: 'VRM', name: 'Vox Reel Mall', active: true },
  { id: '9', code: 'VMF', name: 'Vox Mirdif', active: true },
  { id: '10', code: 'VMN', name: 'Vox Marina', active: true },
  { id: '11', code: 'JDM', name: 'Jumbo Deira', active: true },
  { id: '12', code: 'JME', name: 'Jumbo MOE', active: true },
  { id: '13', code: 'JDH', name: 'Jumbo Dubai Hills', active: true, extraAllowance: '+10 AED' },
  { id: '14', code: 'SDM', name: 'Sharaf DG Mall', active: true },
  { id: '15', code: 'BDM', name: 'Best Al Barsha', active: true },
  { id: '16', code: 'HDM', name: 'Home Deira', active: true },
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

// Shift types and their store associations
const SHIFT_TYPES: Array<{ type: Shift['type']; timeRange?: string }> = [
  { type: 'VDM', timeRange: '16:00-23:00' },
  { type: 'VDH', timeRange: '15:00-22:00' },
  { type: 'VME', timeRange: '14:00-22:00' },
  { type: 'BDM', timeRange: '16:00-23:00' },
  { type: 'JME', timeRange: '13:00-21:00' },
  { type: 'AIR', timeRange: '10:00-18:00' },
  { type: 'VAY', timeRange: '13:00-20:00' },
  { type: 'LOP' },
  { type: 'Off' },
  { type: 'SL' },
];

// Seeded pseudo-random for consistent data
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Generate realistic shifts for all promoters across all dates
function generateShifts(promoters: Promoter[], dates: string[]): Shift[] {
  const shifts: Shift[] = [];
  let id = 1;
  const rand = seededRandom(42);

  const dayOffMap: Record<string, number> = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6,
  };

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
        // Pick from their assigned stores
        const storeCode = storeLabels[Math.floor(rand() * storeLabels.length)];
        const shiftDef = SHIFT_TYPES.find(st => st.type === storeCode);
        if (shiftDef) {
          shifts.push({
            id: `s${id++}`,
            promoterId: promoter.id,
            date: dateStr,
            type: shiftDef.type,
            timeRange: shiftDef.timeRange,
          });
          return;
        }
      }

      // Fallback: pick a random working shift
      const workingShifts = SHIFT_TYPES.filter(s => s.type !== 'Off' && s.type !== 'LOP' && s.type !== 'SL');
      const pick = workingShifts[Math.floor(rand() * workingShifts.length)];
      shifts.push({
        id: `s${id++}`,
        promoterId: promoter.id,
        date: dateStr,
        type: pick.type,
        timeRange: pick.timeRange,
      });
    });
  });

  return shifts;
}

export const mockShifts = generateShifts(mockPromoters, shiftDates);

// Generate store counts from actual shift assignments
export const generateStoreCounts = (stores: Store[], dates: string[], shifts: Shift[]): StoreCount[] => {
  const counts: StoreCount[] = [];

  // Count how many promoters are assigned to each store code per date
  const shiftCountMap = new Map<string, number>();
  shifts.forEach((shift) => {
    if (shift.type !== 'Off' && shift.type !== 'LOP' && shift.type !== 'SL') {
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
