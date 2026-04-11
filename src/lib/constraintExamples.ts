/**
 * Canonical DSL reference for the "Additional Constraints" editor on Auto Assign.
 * The parser lives in src/lib/optimizer.ts → parseDSLConstraints().
 *
 * Only the statements below are supported; anything else is ignored silently.
 * Comments start with `#` and are ignored. Names must be the lowercase first name.
 * Days must be one of: Mon, Tue, Wed, Thu, Fri, Sat, Sun.
 */

export interface ConstraintExample {
  title: string;
  description: string;
  snippet: string;
}

export const CONSTRAINT_GROUPS: { heading: string; items: ConstraintExample[] }[] = [
  {
    heading: 'Store minimum staffing',
    items: [
      {
        title: 'Single store',
        description: 'VDM ต้องมีพนักงานอย่างน้อย 2 คนทุกวัน',
        snippet: 'store_min_people["VDM"] = 2',
      },
      {
        title: 'Multiple stores',
        description: 'กำหนด minimum หลายร้านในครั้งเดียว',
        snippet: `store_min_people["VDM"] = 2
store_min_people["AIR"] = 3
store_min_people["VME"] = 1`,
      },
    ],
  },
  {
    heading: 'Force assignment (pin a promoter to a store on a day)',
    items: [
      {
        title: 'Single day',
        description: 'บังคับให้ kevin ไปประจำ VDM เฉพาะวันจันทร์',
        snippet: 'assign("kevin", "Mon", "VDM")',
      },
      {
        title: 'Multiple days (same promoter)',
        description: 'ล็อก kevin ให้อยู่ VDM ทั้งจันทร์และอังคาร',
        snippet: `assign("kevin", "Mon", "VDM")
assign("kevin", "Tue", "VDM")`,
      },
      {
        title: 'Multiple promoters',
        description: 'ล็อกหลายคนพร้อมกัน — optimizer จะห้ามสลับ',
        snippet: `assign("kevin", "Fri", "AIR")
assign("sarah", "Fri", "HDM")
assign("angela", "Sun", "HDM")`,
      },
    ],
  },
  {
    heading: 'Force day off',
    items: [
      {
        title: 'Single day',
        description: 'บังคับวันหยุดเพิ่มเติม (นอกเหนือจาก workingDays ของคน)',
        snippet: 'day_off("maureen", "Tue")',
      },
      {
        title: 'Multiple days',
        description: 'หลายคน หลายวัน',
        snippet: `day_off("maureen", "Tue")
day_off("kevin", "Sun")
day_off("angela", "Wed")`,
      },
    ],
  },
  {
    heading: 'Override end time',
    items: [
      {
        title: 'Single promoter',
        description: 'kevin เลิกงาน 22:00 แทน default ของร้าน',
        snippet: 'end_time("kevin", "22:00")',
      },
      {
        title: 'Multiple promoters',
        description: 'หลายคน pricing ที่แตกต่างกัน',
        snippet: `end_time("kevin", "22:00")
end_time("maureen", "21:30")`,
      },
    ],
  },
  {
    heading: 'Pin time range on a day (any store)',
    items: [
      {
        title: 'Morning shift on Sunday',
        description: 'kevin เข้ากะเช้า 10:00-19:00 วันอาทิตย์ โดยไม่จำกัดร้าน — optimizer จะเลือกร้านที่มี slot นี้ให้',
        snippet: 'shift_time("kevin", "Sun", "10:00-19:00")',
      },
      {
        title: 'Multi-day morning rotation',
        description: 'บังคับเข้ากะเช้าทั้งอาทิตย์',
        snippet: `shift_time("kevin", "Mon", "10:00-19:00")
shift_time("kevin", "Tue", "10:00-19:00")
shift_time("kevin", "Wed", "10:00-19:00")`,
      },
      {
        title: 'Combined: pin store + time',
        description: 'ใช้คู่กับ assign() ได้ — ล็อกทั้งร้านและเวลา',
        snippet: `assign("kevin", "Sun", "VDM")
shift_time("kevin", "Sun", "10:00-19:00")`,
      },
    ],
  },
  {
    heading: 'Comments',
    items: [
      {
        title: 'Comment lines',
        description: 'บรรทัดที่ขึ้นด้วย # จะถูก parser ข้าม — ใช้เขียนอธิบายได้',
        snippet: `# Ramadan week — reduce AIR to 1 person
store_min_people["AIR"] = 1
# Kevin requested short shifts this week
end_time("kevin", "20:00")`,
      },
    ],
  },
  {
    heading: 'Full example',
    items: [
      {
        title: 'Combined',
        description: 'ทุกประเภทใช้รวมกันได้ในไฟล์เดียว',
        snippet: `# Weekly base constraints
store_min_people["VDM"] = 2
store_min_people["AIR"] = 3

# Kevin in VDM on Mon/Tue
assign("kevin", "Mon", "VDM")
assign("kevin", "Tue", "VDM")

# Maureen off Tuesday (personal)
day_off("maureen", "Tue")

# Kevin ends at 22:00 this week
end_time("kevin", "22:00")`,
      },
    ],
  },
];

export const CONSTRAINT_SYNTAX_LINES: string[] = [
  'store_min_people["STORE"] = N',
  'assign("name", "Day", "STORE")',
  'day_off("name", "Day")',
  'end_time("name", "HH:MM")',
  'shift_time("name", "Day", "HH:MM-HH:MM")',
  '# comment',
];

export const CONSTRAINT_NOTES: string[] = [
  'name = lowercase first name (e.g. "kevin", "maureen", "angela")',
  'Day = one of Mon, Tue, Wed, Thu, Fri, Sat, Sun',
  'STORE = store code in uppercase (e.g. VDM, AIR, HDM)',
  'shift_time picks any store whose shift slots include that exact time range',
  'Lines starting with # are ignored',
  'Invalid / unrecognized lines are silently skipped',
];
