/** OCR result from Gemini vision analysis of an attendance screenshot. */
export interface AttendanceOCR {
  promoter_name: string | null;
  employee_code: string | null; // e.g. "db007"
  store_name: string | null;
  store_code: string | null;    // e.g. "VDM"
  check_in: string | null;      // "HH:MM"
  check_out: string | null;     // "HH:MM" or null
  date: string | null;          // "YYYY-MM-DD" or null
  confidence: 'high' | 'medium' | 'low';
  raw_text: string;
}

const OCR_PROMPT = `You are analyzing a screenshot from a time-tracking / attendance system.
There are TWO possible image formats:

**Format 1: CheckIn App Screenshot**
A structured screen with fields like:
- "Attendance Date : 2026-04-08 09:51:00"
- "Employee Name : db007 - Arlene Antonio Shimizu (Len)"
- "Place : VDM - Virgin Dubai Mall" (or "Place : You are out of work area")
- "Far from VDH - Virgin Dubai Hills 149.81 m."
- A selfie photo and a map
- May show green checkmark (success) or red X (error/out of area)

**Format 2: GPS Map Camera Selfie**
A selfie photo with a GPS overlay at the bottom showing:
- City, address
- Lat/Long coordinates
- Date and time (e.g. "Saturday, 04/04/2026 12:52 PM GMT+04:00")
- "Captured by GPS Map Camera"

Extract the following information and return ONLY valid JSON (no markdown, no backticks):

{
  "promoter_name": "the person's full name without the employee code (e.g. 'Arlene Antonio Shimizu'), or null",
  "employee_code": "the employee code like 'db007' before the dash in Employee Name, or null",
  "store_name": "the full store name (e.g. 'Virgin Dubai Mall'), or null",
  "store_code": "the store code (e.g. 'VDM'), or null",
  "check_in": "time in HH:MM 24-hour format if this is a check-in, or null",
  "check_out": "time in HH:MM 24-hour format if this is a check-out, or null",
  "date": "date in YYYY-MM-DD format, or null",
  "confidence": "high/medium/low",
  "raw_text": "all visible text in the image concatenated"
}

Important rules:
- For Format 1: Employee Name format is "CODE - Full Name (nickname)". Extract just the full name for promoter_name.
- For Format 1: Place format is "CODE - Store Name". If Place says "You are out of work area", get store code/name from the "Far from CODE - Store Name" line instead.
- For Format 1: Attendance Date has both date and time. Extract date as YYYY-MM-DD and time as HH:MM.
- For Format 2: Extract date/time from the GPS overlay. Convert date from DD/MM/YYYY or MM/DD/YYYY to YYYY-MM-DD. Convert 12-hour time to 24-hour HH:MM.
- For Format 2: There is no employee name or store info, so set those to null.
- To determine check_in vs check_out: if the time is before 15:00, it's check_in. If 15:00 or later, it's check_out.
- Return ONLY the JSON object, nothing else`;

/** Send an image to Gemini 2.0 Flash for attendance OCR. */
export async function extractAttendance(imageBuffer: Buffer, mimeType: string): Promise<AttendanceOCR> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const base64 = imageBuffer.toString('base64');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: OCR_PROMPT },
            { inlineData: { mimeType, data: base64 } },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
        },
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();
  const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // Strip markdown code fences if present
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  try {
    return JSON.parse(cleaned) as AttendanceOCR;
  } catch {
    console.error('Failed to parse Gemini response:', text);
    return {
      promoter_name: null,
      employee_code: null,
      store_name: null,
      store_code: null,
      check_in: null,
      check_out: null,
      date: null,
      confidence: 'low',
      raw_text: text,
    };
  }
}
