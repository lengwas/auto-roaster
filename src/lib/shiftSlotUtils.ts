/**
 * Match a shift slot for a given date.
 *
 * Slot formats:
 *   "10:00-19:00"              → applies to all days
 *   "Mon-Thu 12:30-21:30"     → day range
 *   "Fri,Sat,Sun 13:00-22:00" → day list
 *
 * Day names: Sun, Mon, Tue, Wed, Thu, Fri, Sat (case-insensitive)
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_INDEX: Record<string, number> = {};
DAY_NAMES.forEach((d, i) => { DAY_INDEX[d.toLowerCase()] = i; });

function getDayIndex(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00').getDay();
}

function parseDayPrefix(slot: string): { days: number[] | null; time: string } {
  // Check for day prefix pattern: "Mon-Thu 12:30-21:30" or "Fri,Sat,Sun 13:00-22:00"
  const match = slot.match(/^([A-Za-z,\-]+)\s+(\d{1,2}:\d{2}-\d{1,2}:\d{2}.*)$/);
  if (!match) return { days: null, time: slot };

  const dayPart = match[1];
  const timePart = match[2];

  // Check for range: Mon-Thu
  const rangeMatch = dayPart.match(/^([A-Za-z]+)-([A-Za-z]+)$/);
  if (rangeMatch) {
    const startIdx = DAY_INDEX[rangeMatch[1].toLowerCase()];
    const endIdx = DAY_INDEX[rangeMatch[2].toLowerCase()];
    if (startIdx != null && endIdx != null) {
      const days: number[] = [];
      if (startIdx <= endIdx) {
        for (let i = startIdx; i <= endIdx; i++) days.push(i);
      } else {
        // Wrap around: e.g. Fri-Sun = 5,6,0
        for (let i = startIdx; i < 7; i++) days.push(i);
        for (let i = 0; i <= endIdx; i++) days.push(i);
      }
      return { days, time: timePart };
    }
  }

  // Check for comma list: Fri,Sat,Sun
  const parts = dayPart.split(',').map(d => d.trim().toLowerCase());
  const indices = parts.map(d => DAY_INDEX[d]).filter(d => d != null);
  if (indices.length > 0) {
    return { days: indices, time: timePart };
  }

  return { days: null, time: slot };
}

/**
 * Return ALL matching shift time ranges for a given date.
 * Day-specific slots are preferred; if none match, fall back to plain slots.
 */
export function matchAllShiftSlots(slots: string[], dateStr: string): string[] {
  if (slots.length === 0) return [];

  const dayIdx = getDayIndex(dateStr);

  // Collect day-specific matches
  const daySpecific: string[] = [];
  const plain: string[] = [];
  for (const slot of slots) {
    const { days, time } = parseDayPrefix(slot);
    if (days && days.includes(dayIdx)) {
      daySpecific.push(time);
    } else if (!days && time) {
      plain.push(time);
    }
  }

  if (daySpecific.length > 0) return daySpecific;
  if (plain.length > 0) return plain;
  return [parseDayPrefix(slots[0]).time];
}

/**
 * Find the best matching shift slot for a given date.
 * Returns the time portion (without day prefix) of the matched slot.
 */
export function matchShiftSlot(slots: string[], dateStr: string): string {
  if (slots.length === 0) return '';

  const dayIdx = getDayIndex(dateStr);

  // First try to find a day-specific slot that matches
  for (const slot of slots) {
    const { days, time } = parseDayPrefix(slot);
    if (days && days.includes(dayIdx)) {
      return time;
    }
  }

  // Fall back to a plain slot (no day prefix)
  for (const slot of slots) {
    const { days, time } = parseDayPrefix(slot);
    if (!days) return time;
  }

  // Last resort: first slot, strip any prefix
  return parseDayPrefix(slots[0]).time;
}
