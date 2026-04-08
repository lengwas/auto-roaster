/** OCR result from Gemini vision analysis of an attendance screenshot. */
export interface AttendanceOCR {
  promoter_name: string | null;
  store_name: string | null;
  check_in: string | null;   // "HH:MM"
  check_out: string | null;  // "HH:MM" or null
  date: string | null;       // "YYYY-MM-DD" or null
  confidence: 'high' | 'medium' | 'low';
  raw_text: string;
}

const OCR_PROMPT = `You are analyzing a screenshot from a time-tracking / attendance app.
Extract the following information and return ONLY valid JSON (no markdown, no backticks):

{
  "promoter_name": "the person's name shown in the screenshot, or null if not visible",
  "store_name": "the store/branch/location name, or null if not visible",
  "check_in": "check-in time in HH:MM 24-hour format, or null",
  "check_out": "check-out time in HH:MM 24-hour format, or null",
  "date": "date in YYYY-MM-DD format, or null if not visible",
  "confidence": "high if all fields are clearly readable, medium if some are unclear, low if mostly guessing",
  "raw_text": "all visible text in the image concatenated"
}

Important:
- Times must be in 24-hour HH:MM format
- Date must be YYYY-MM-DD
- If you see both clock-in and clock-out, include both
- If you only see one timestamp, determine if it's check-in or check-out based on context
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
      store_name: null,
      check_in: null,
      check_out: null,
      date: null,
      confidence: 'low',
      raw_text: text,
    };
  }
}
