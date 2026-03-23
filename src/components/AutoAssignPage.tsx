import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type {
  Store, Promoter, Shift, Order,
  StorePreference, PromoterConflict,
  StoreTierSetting, PromoterGradeOverride,
} from '../types/types';
import ShiftTable from './ShiftTable';
import { generateStoreCounts } from '../data/mockData';
import { useOrders } from '../hooks/useOrders';
import './AutoAssignPage.css';

// Warehouse text → store code (same as SalesPerformancePage + Python script)
const WAREHOUSE_CODE_MAP: Record<string, string> = {
  'vir - dbm': 'VDM', 'vir - moe': 'VME', 'vir - dbh': 'VDH',
  'vir - mrn': 'VMN', 'vir - mdf': 'VMF', 'vir - nkm': 'VNK',
  'vir - yas': 'VYM', 'vir - amy': 'VAY', 'vir - rem': 'VRM',
  'vir - adm': 'VAD', 'vir - arb': 'VAY', 'vir - azc': 'VNK',
  'jsm - moe': 'JME', 'jsm - dbm': 'JDM', 'jsm - dbh': 'JDH',
  'bdr - dbm': 'BDM', 'bdr - dbh': 'JDH',
  'hls - dbm': 'HDM', 'sdg - dbm': 'SDM',
  'air - 48': 'AIR', 'air - dcc': 'ADC', 'img - wld': 'IMG',
};

// Build {`${promoterId}_${storeCode}`: avgDailyRevenue} from historical orders
function buildPerfMatrix(
  orders: Order[],
  promoters: Promoter[],
  stores: Store[],
): Map<string, number> {
  const excluded = new Set(['cancelled', 'returned']);
  // name → promoterId
  const nameMap = new Map<string, string>();
  for (const p of promoters) {
    nameMap.set(p.name.toLowerCase(), p.id);
    const first = p.name.split(' ')[0].toLowerCase();
    if (!nameMap.has(first)) nameMap.set(first, p.id);
  }
  // warehouse/platform → storeCode
  const whMap = new Map<string, string>(
    Object.entries(WAREHOUSE_CODE_MAP)
  );
  for (const s of stores) {
    if (s.warehouse) whMap.set(s.warehouse.toLowerCase(), s.code);
    if (s.platform) whMap.set(s.platform.toLowerCase(), s.code);
  }

  // Accumulate daily revenue per (promoter, store, date)
  const daily = new Map<string, number>(); // key: `${pid}_${sc}_${date}`
  for (const o of orders) {
    if (excluded.has(o.status.toLowerCase())) continue;
    const amount = o.amountAed ?? 0;
    const raw = (o.salesperson ?? '').toLowerCase();
    const pid = nameMap.get(raw) ?? nameMap.get(raw.split(' ')[0]);
    if (!pid) continue;
    const wh = (o.warehouse ?? '').toLowerCase();
    const pl = (o.platform ?? '').toLowerCase();
    const sc = whMap.get(wh) ?? whMap.get(pl);
    if (!sc) continue;
    const k = `${pid}_${sc}_${o.date}`;
    daily.set(k, (daily.get(k) ?? 0) + amount);
  }

  // Average across days → {pid_sc: avgRevenue}
  const totals = new Map<string, number[]>();
  for (const [k, v] of daily) {
    const key = k.split('_').slice(0, 2).join('_'); // pid_sc
    const arr = totals.get(key) ?? [];
    arr.push(v);
    totals.set(key, arr);
  }
  const result = new Map<string, number>();
  for (const [k, v] of totals) {
    result.set(k, v.reduce((a, b) => a + b, 0) / v.length);
  }
  return result;
}

interface DraftAssignment {
  promoterId: string;
  date: string;
  store: string; // store code | 'Off' | 'LOP' | 'SL'
  timeRange?: string;
}

// Structured constraints (mirrors Python ExtraConstraints dataclass)
interface ParsedConstraints {
  store_min_people?: Record<string, number>;
  promoter_day_store?: { promoter: string; day: string; store: string }[];
  promoter_force_off?: { promoter: string; day: string }[];
  promoter_end_time?: { promoter: string; end_time: string }[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  isDraft?: boolean;
  count?: number;
  tokens?: TokenUsage;
}

interface GeminiTurn {
  role: 'user' | 'model';
  parts: { text: string }[];
}

interface TokenUsage {
  prompt: number;
  output: number;
  total: number;
}

interface GeminiResult {
  text: string;
  usage: TokenUsage;
}

interface Props {
  stores: Store[];
  promoters: Promoter[];
  storePreferences: StorePreference[];
  promoterConflicts: PromoterConflict[];
  storeTiers: StoreTierSetting[];
  gradeOverrides: PromoterGradeOverride[];
  onShiftsApply: (shifts: Shift[]) => void;
}

// ── available Gemini models ────────────────────────────────────────────────
const GEMINI_MODELS: { id: string; label: string }[] = [
  { id: 'gemini-2.5-flash-preview-04-17', label: 'Gemini 2.5 Flash Preview (smartest)' },
  { id: 'gemini-2.5-flash-lite-preview-06-17', label: 'Gemini 2.5 Flash Lite Preview (fast)' },
  { id: 'gemini-2.0-flash',     label: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite (lightest)' },
  { id: 'gemini-1.5-flash',     label: 'Gemini 1.5 Flash (stable)' },
  { id: 'gemini-1.5-pro',       label: 'Gemini 1.5 Pro (smart)' },
];
const DEFAULT_MODEL = 'gemini-2.0-flash';

// ── helpers ────────────────────────────────────────────────────────────────
function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}
function addDays(base: string, n: number): string {
  const d = new Date(base + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}
function genDates(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(start + 'T00:00:00');
  const fin = new Date(end + 'T00:00:00');
  while (cur <= fin) {
    out.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
function fmtNum(n: number): string {
  return n.toLocaleString();
}

function parseAssignments(text: string): DraftAssignment[] | null {
  const cleaned = text.replace(/```(?:json)?\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    // Gemini sometimes wraps in an object: { schedule: [...] } or { assignments: [...] }
    for (const key of ['schedule', 'assignments', 'shifts', 'data', 'result']) {
      const val = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(val)) return val as DraftAssignment[];
    }
  } catch { /* fall through */ }
  const m = text.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr)) return arr;
    } catch { /* fall through */ }
  }
  return null;
}

async function callGemini(turns: GeminiTurn[], model: string): Promise<GeminiResult> {
  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim();
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY is not set. Add it to your .env file.');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: turns,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 32768,
          responseMimeType: 'application/json',
        },
      }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Gemini error ${res.status}`);
  }
  const data = await res.json() as {
    candidates?: { content?: { parts?: { text: string }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };
  const candidate = data.candidates?.[0];
  const finishReason = candidate?.finishReason ?? '';
  const text = candidate?.content?.parts?.[0]?.text ?? '';
  console.log('[Gemini] finishReason:', finishReason, '| response preview:', text.slice(0, 300));
  if (finishReason === 'MAX_TOKENS') {
    throw new Error('Output was cut off (MAX_TOKENS). Try a shorter date range or fewer promoters.');
  }
  const usage: TokenUsage = {
    prompt: data.usageMetadata?.promptTokenCount ?? 0,
    output: data.usageMetadata?.candidatesTokenCount ?? 0,
    total: data.usageMetadata?.totalTokenCount ?? 0,
  };
  return { text, usage };
}

function buildContext(
  stores: Store[],
  promoters: Promoter[],
  storePreferences: StorePreference[],
  conflicts: PromoterConflict[],
  storeTiers: StoreTierSetting[],
  gradeOverrides: PromoterGradeOverride[],
): string {
  const aStores = stores.filter((s) => s.active);
  const aProms = promoters.filter((p) => p.active);

  let ctx = 'You are a retail shift scheduling assistant for UAE stores.\n\n';

  ctx += '## STORES (code | name | tier | max per day)\n';
  for (const s of aStores) {
    const tier = storeTiers.find((t) => t.storeCode === s.code)?.tier ?? 'C';
    ctx += `- ${s.code} | ${s.name} | Tier ${tier} | max ${s.maxCapacity ?? 2}\n`;
  }

  ctx += '\n## PROMOTERS (id | name | role | grade | days-off | constraints)\n';
  for (const p of aProms) {
    const grade = gradeOverrides.find((g) => g.promoterId === p.id)?.grade ?? 'C';
    const daysOff = p.workingDays ? p.workingDays : 'none';
    const prefs = storePreferences.filter((pf) => pf.promoterId === p.id);
    // Admin role: must go to AIR only
    const mustStores = p.role === 'admin'
      ? 'AIR'
      : prefs.filter((pf) => pf.preference === 'must').map((pf) => pf.storeCode).join(',');
    const preferred = p.role === 'admin'
      ? ''
      : prefs.filter((pf) => pf.preference === 'preferred').map((pf) => pf.storeCode).join(',');
    const banned = p.role === 'admin'
      ? ''
      : prefs.filter((pf) => pf.preference === 'banned').map((pf) => pf.storeCode).join(',');
    ctx += `- [${p.id}] ${p.name} | Role:${p.role} | Grade:${grade} | DaysOff:${daysOff}`;
    if (mustStores) ctx += ` | Must:${mustStores}`;
    if (preferred) ctx += ` | Preferred:${preferred}`;
    if (banned) ctx += ` | Banned:${banned}`;
    ctx += '\n';
  }

  if (conflicts.length > 0) {
    ctx += '\n## CONFLICTS (avoid same store + date)\n';
    for (const c of conflicts) {
      const a = promoters.find((p) => p.id === c.promoterAId)?.name;
      const b = promoters.find((p) => p.id === c.promoterBId)?.name;
      if (a && b) ctx += `- ${a} ↔ ${b}${c.reason ? ` (${c.reason})` : ''}\n`;
    }
  }

  ctx += '\n## GRADE-TIER FIT\n';
  ctx += '- Grade A → Tier A or B stores\n';
  ctx += '- Grade B → Tier A, B, or C stores\n';
  ctx += '- Grade C → Tier B, C, or D stores\n';
  ctx += '- Grade D → Tier C or D stores\n';

  return ctx;
}

// ── component ──────────────────────────────────────────────────────────────
export default function AutoAssignPage({
  stores, promoters, storePreferences, promoterConflicts,
  storeTiers, gradeOverrides, onShiftsApply,
}: Props) {
  const today = todayStr();
  const [startDate, setStartDate] = useState(addDays(today, 1));
  const [endDate, setEndDate] = useState(addDays(today, 7));
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [draft, setDraft] = useState<DraftAssignment[]>([]);
  const [geminiHistory, setGeminiHistory] = useState<GeminiTurn[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [notes, setNotes] = useState('');
  const [parsedConstraints, setParsedConstraints] = useState<ParsedConstraints | null>(null);
  const [constraintsParsing, setConstraintsParsing] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // cumulative token usage for this session
  const [sessionTokens, setSessionTokens] = useState<TokenUsage>({ prompt: 0, output: 0, total: 0 });
  const [callCount, setCallCount] = useState(0);

  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  const dates = genDates(startDate, endDate);
  const activePromoters = promoters.filter((p) => p.active);

  function addTokens(u: TokenUsage) {
    setSessionTokens((prev) => ({
      prompt: prev.prompt + u.prompt,
      output: prev.output + u.output,
      total: prev.total + u.total,
    }));
    setCallCount((c) => c + 1);
  }

  function resetSession() {
    setDraft([]);
    setGeminiHistory([]);
    setChat([]);
    setSessionTokens({ prompt: 0, output: 0, total: 0 });
    setCallCount(0);
    setError(null);
  }

  // ── parse constraints via Gemini ──────────────────────────────────────
  async function parseConstraintsText() {
    if (!notes.trim()) return;
    setConstraintsParsing(true);
    const storeCodes = stores.filter(s => s.active).map(s => s.code).join(', ');
    const promoterNames = promoters.filter(p => p.active).map(p => p.name).join(', ');
    const prompt =
      `You are a shift scheduling constraint parser. Convert the following natural language constraints into a structured JSON object.\n\n` +
      `Available store codes: ${storeCodes}\n` +
      `Available promoter first names (lowercase): ${promoters.filter(p => p.active).map(p => p.name.split(' ')[0].toLowerCase()).join(', ')}\n` +
      `Days: Mon, Tue, Wed, Thu, Fri, Sat, Sun\n\n` +
      `Constraints text:\n${notes.trim()}\n\n` +
      `Return ONLY a valid JSON object with these keys (omit empty arrays/objects):\n` +
      `{\n` +
      `  "store_min_people": { "STORE_CODE": min_number },\n` +
      `  "promoter_day_store": [ { "promoter": "firstname_lower", "day": "Mon", "store": "CODE" } ],\n` +
      `  "promoter_force_off": [ { "promoter": "firstname_lower", "day": "Mon" } ],\n` +
      `  "promoter_end_time": [ { "promoter": "firstname_lower", "end_time": "HH:MM" } ]\n` +
      `}\n\n` +
      `Use exact store codes from the list above. Use lowercase first name only for promoters.\n` +
      `IMPORTANT: Return ONLY raw JSON, no markdown, no explanation.\n` +
      `Available promoter names for reference: ${promoterNames}`;
    try {
      const { text } = await callGemini([{ role: 'user', parts: [{ text: prompt }] }], selectedModel);
      const cleaned = text.replace(/```(?:json)?\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned) as ParsedConstraints;
      setParsedConstraints(parsed);
    } catch (e) {
      setError(`Constraint parse failed: ${(e as Error).message}`);
    } finally {
      setConstraintsParsing(false);
    }
  }

  // ── generate draft ────────────────────────────────────────────────────
  async function generateDraft() {
    if (dates.length === 0) return;
    setLoading(true);
    setError(null);

    const ctx = buildContext(stores, promoters, storePreferences, promoterConflicts, storeTiers, gradeOverrides);
    const activeStoreCodes = stores.filter((s) => s.active).map((s) => s.code).join(', ');

    const userText =
      `${ctx}\n## TASK\n` +
      `Generate a shift schedule for: ${dates.join(', ')}\n\n` +
      `Available store codes: ${activeStoreCodes}\n\n` +
      'RULES:\n' +
      '1. Assign each active promoter to one store per working day.\n' +
      '2. Estimate rest days based on their work-days/week (e.g. 5d/wk → ~2 days off spread across the week).\n' +
      '3. Never exceed store max capacity per day.\n' +
      '4. Assign Must-stores first; never assign Banned stores.\n' +
      '5. Follow grade-tier fit rules.\n' +
      '6. Distribute workload fairly across promoters.\n' +
      (notes.trim() ? `\n## ADDITIONAL CONSTRAINTS (natural language)\n${notes.trim()}\n` : '') +
      (parsedConstraints && Object.keys(parsedConstraints).some(k => {
        const v = (parsedConstraints as Record<string, unknown>)[k];
        return Array.isArray(v) ? v.length > 0 : v && Object.keys(v as object).length > 0;
      }) ? `\n## PARSED CONSTRAINTS (structured, must follow exactly)\n${JSON.stringify(parsedConstraints, null, 2)}\n` : '') +
      '\nReturn ONLY a valid JSON array, no explanation, no markdown:\n' +
      '[{"promoterId":"ID","date":"YYYY-MM-DD","store":"CODE_or_Off"}]\n' +
      'Include every promoter for every date. Use exact IDs and codes from the lists above.';

    const turn: GeminiTurn = { role: 'user', parts: [{ text: userText }] };
    try {
      const { text: reply, usage } = await callGemini([turn], selectedModel);
      const assignments = parseAssignments(reply);
      if (!assignments) throw new Error(`Gemini returned invalid JSON. Response preview: ${reply.slice(0, 200)}`);

      setDraft(assignments);
      addTokens(usage);
      const newHistory: GeminiTurn[] = [
        turn,
        { role: 'model', parts: [{ text: reply }] },
      ];
      setGeminiHistory(newHistory);
      setChat([{
        role: 'assistant', isDraft: true, count: assignments.length, text: reply, tokens: usage,
      }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // ── feedback ──────────────────────────────────────────────────────────
  async function sendFeedback() {
    const msg = input.trim();
    if (!msg || draft.length === 0) return;
    setInput('');
    setLoading(true);
    setError(null);

    const userText =
      `## CURRENT DRAFT\n${JSON.stringify(draft)}\n\n` +
      `## USER FEEDBACK\n${msg}\n\n` +
      'Please update the schedule based on the feedback. ' +
      'Return ONLY the updated JSON array (same format), no explanation.';

    const newTurn: GeminiTurn = { role: 'user', parts: [{ text: userText }] };
    const turns = [...geminiHistory, newTurn];

    setChat((prev) => [...prev, { role: 'user', text: msg }]);

    try {
      const { text: reply, usage } = await callGemini(turns, selectedModel);
      const assignments = parseAssignments(reply);
      if (!assignments) throw new Error(`Gemini returned invalid JSON. Response preview: ${reply.slice(0, 200)}`);

      setDraft(assignments);
      addTokens(usage);
      setGeminiHistory([...turns, { role: 'model', parts: [{ text: reply }] }]);
      setChat((prev) => [
        ...prev,
        { role: 'assistant', isDraft: true, count: assignments.length, text: reply, tokens: usage },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // ── apply to main ─────────────────────────────────────────────────────
  function applyDraft() {
    const shifts: Shift[] = draft
      .filter((a) => a.store && a.store !== 'Off')
      .map((a) => ({
        id: `aa_${a.promoterId}_${a.date}`,
        promoterId: a.promoterId,
        date: a.date,
        type: a.store,
        timeRange: a.timeRange,
      }));
    onShiftsApply(shifts);
  }

  // ── draft ↔ Shift[] conversion ────────────────────────────────────────
  const draftShifts = useMemo<Shift[]>(() =>
    draft
      .filter((a) => a.store && a.store !== 'Off')
      .map((a) => ({
        id: `aa_${a.promoterId}_${a.date}`,
        promoterId: a.promoterId,
        date: a.date,
        type: a.store,
        timeRange: a.timeRange,
      })),
    [draft],
  );

  const draftStoreCounts = useMemo(
    () => generateStoreCounts(stores, dates, draftShifts),
    [stores, dates, draftShifts],
  );

  const handleDraftShiftChange = useCallback((
    promoterId: string, date: string, newType: string, timeRange?: string,
  ) => {
    setDraft((prev) => {
      const filtered = prev.filter((a) => !(a.promoterId === promoterId && a.date === date));
      if (!newType) return filtered;
      return [...filtered, { promoterId, date, store: newType, timeRange }];
    });
  }, []);

  const hasKey = !!(import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim();

  // ── Revenue forecast from historical performance ───────────────────────
  const { orders } = useOrders(3);
  const perfMatrix = useMemo(
    () => buildPerfMatrix(orders, promoters, stores),
    [orders, promoters, stores],
  );

  // For each day in draft, sum expected revenue of assigned (promoter, store) pairs
  const revenueForecast = useMemo(() => {
    if (draft.length === 0 || perfMatrix.size === 0) return [];
    const allVals = [...perfMatrix.values()];
    const globalMean = allVals.reduce((a, b) => a + b, 0) / allVals.length;
    const fallback = globalMean * 0.4;

    return dates.map((dateStr) => {
      const dayAssignments = draft.filter(a => a.date === dateStr && a.store && a.store !== 'Off');
      const dayTotal = dayAssignments.reduce((sum, a) => {
        const score = perfMatrix.get(`${a.promoterId}_${a.store}`) ?? fallback;
        return sum + score;
      }, 0);
      return { date: dateStr, expected: Math.round(dayTotal), count: dayAssignments.length };
    });
  }, [draft, dates, perfMatrix]);

  // ─────────────────────────────────────────────────────────────────────
  return (
    <div className="aa-layout">
      {/* ── LEFT PANEL ── */}
      <div className="aa-left">
        <div className="aa-controls">
          <div className="aa-title-row">
            <h2 className="aa-title">Auto Assign</h2>
            {callCount > 0 && (
              <button className="aa-btn-reset" onClick={resetSession} title="Reset session">↺</button>
            )}
          </div>

          {!hasKey && (
            <div className="aa-key-warning">
              ⚠️ <strong>VITE_GEMINI_API_KEY</strong> not set.<br />
              Add it to your <code>.env</code> file and restart.
            </div>
          )}

          {/* model selector */}
          <div className="aa-field" style={{ marginBottom: 10 }}>
            <label className="aa-label">Model</label>
            <select
              className="aa-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {GEMINI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* date range */}
          <div className="aa-date-row">
            <div className="aa-field">
              <label className="aa-label">From</label>
              <input
                type="date"
                className="aa-date-input"
                value={startDate}
                min={today}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="aa-field">
              <label className="aa-label">To</label>
              <input
                type="date"
                className="aa-date-input"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="aa-range-info">
            {dates.length} day{dates.length !== 1 ? 's' : ''} · {activePromoters.length} promoters
          </div>

          {/* additional constraints / notes */}
          <div className="aa-field" style={{ marginBottom: 6 }}>
            <div className="aa-constraint-label-row">
              <label className="aa-label">Additional Constraints</label>
              <button
                className="aa-btn-parse"
                onClick={parseConstraintsText}
                disabled={constraintsParsing || !notes.trim() || !hasKey}
                title="Let Gemini parse constraints into structured equations"
              >
                {constraintsParsing ? '⏳' : '⚙️ Parse →'}
              </button>
            </div>
            <textarea
              className="aa-notes"
              rows={4}
              placeholder={'e.g.\nKevin: Sunday morning shift only\nMaureen: Tuesday evening preferred\nVDM ต้องมีคน 2 คนทุกวัน'}
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setParsedConstraints(null); }}
            />
          </div>

          {/* parsed constraints panel */}
          {parsedConstraints && (
            <div className="aa-parsed-constraints">
              <div className="aa-parsed-title">Parsed Constraints</div>
              {parsedConstraints.store_min_people && Object.keys(parsedConstraints.store_min_people).length > 0 && (
                <div className="aa-parsed-group">
                  <span className="aa-parsed-group-label">Store min people</span>
                  {Object.entries(parsedConstraints.store_min_people).map(([code, n]) => (
                    <span key={code} className="aa-parsed-tag">{code} ≥ {n} คน</span>
                  ))}
                </div>
              )}
              {parsedConstraints.promoter_day_store && parsedConstraints.promoter_day_store.length > 0 && (
                <div className="aa-parsed-group">
                  <span className="aa-parsed-group-label">Force assignment</span>
                  {parsedConstraints.promoter_day_store.map((r, i) => (
                    <span key={i} className="aa-parsed-tag">{r.promoter} → {r.store} ({r.day})</span>
                  ))}
                </div>
              )}
              {parsedConstraints.promoter_force_off && parsedConstraints.promoter_force_off.length > 0 && (
                <div className="aa-parsed-group">
                  <span className="aa-parsed-group-label">Force off</span>
                  {parsedConstraints.promoter_force_off.map((r, i) => (
                    <span key={i} className="aa-parsed-tag">{r.promoter} off ({r.day})</span>
                  ))}
                </div>
              )}
              {parsedConstraints.promoter_end_time && parsedConstraints.promoter_end_time.length > 0 && (
                <div className="aa-parsed-group">
                  <span className="aa-parsed-group-label">End time</span>
                  {parsedConstraints.promoter_end_time.map((r, i) => (
                    <span key={i} className="aa-parsed-tag">{r.promoter} ends {r.end_time}</span>
                  ))}
                </div>
              )}
              <div className="aa-parsed-python">
                <div className="aa-parsed-python-label">Python optimizer command:</div>
                <code className="aa-parsed-python-cmd">
                  {`python scripts/assign_optimizer.py --start ${startDate} --end ${endDate} --constraints-json '${JSON.stringify(parsedConstraints)}'`}
                </code>
              </div>
            </div>
          )}

          <button
            className="aa-btn-generate"
            onClick={generateDraft}
            disabled={loading || dates.length === 0 || !hasKey}
          >
            {loading && draft.length === 0 ? '⏳ Generating…' : '✨ Generate Draft'}
          </button>

          {draft.length > 0 && (
            <button className="aa-btn-apply" onClick={applyDraft}>
              Apply to Shift Table →
            </button>
          )}
        </div>

        {/* ── TOKEN USAGE ── */}
        {callCount > 0 && (
          <div className="aa-tokens">
            <div className="aa-tokens-title">Token Usage · {callCount} call{callCount > 1 ? 's' : ''}</div>
            <div className="aa-tokens-grid">
              <div className="aa-token-stat">
                <span className="aa-token-label">Input</span>
                <span className="aa-token-value">{fmtNum(sessionTokens.prompt)}</span>
              </div>
              <div className="aa-token-stat">
                <span className="aa-token-label">Output</span>
                <span className="aa-token-value">{fmtNum(sessionTokens.output)}</span>
              </div>
              <div className="aa-token-stat aa-token-total">
                <span className="aa-token-label">Total</span>
                <span className="aa-token-value">{fmtNum(sessionTokens.total)}</span>
              </div>
            </div>
          </div>
        )}

        {/* ── CHAT ── */}
        <div className="aa-chat">
          <div className="aa-chat-label">Gemini Chat</div>

          <div className="aa-chat-history">
            {chat.length === 0 && (
              <p className="aa-chat-empty">Generate a draft first, then give feedback here.</p>
            )}
            {chat.map((m, i) => (
              <div key={i} className={`aa-msg aa-msg-${m.role}`}>
                {m.role === 'assistant' ? (
                  m.isDraft ? (
                    <div>
                      <span className="aa-msg-draft">✅ Draft updated — {m.count} assignments</span>
                      {m.tokens && (
                        <span className="aa-msg-tokens">
                          {fmtNum(m.tokens.prompt)}↑ {fmtNum(m.tokens.output)}↓ tokens
                        </span>
                      )}
                    </div>
                  ) : m.text
                ) : m.text}
              </div>
            ))}
            {loading && <div className="aa-msg aa-msg-assistant aa-msg-loading">⏳ Thinking…</div>}
            <div ref={chatEndRef} />
          </div>

          {error && <div className="aa-error">{error}</div>}

          <div className="aa-chat-input-row">
            <input
              className="aa-chat-input"
              placeholder={draft.length === 0 ? 'Generate a draft first…' : 'e.g. "ให้ Ben ไป VDM ทุกวัน"'}
              value={input}
              disabled={loading || draft.length === 0}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFeedback(); } }}
            />
            <button
              className="aa-btn-send"
              onClick={sendFeedback}
              disabled={loading || draft.length === 0 || !input.trim()}
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL: draft table ── */}
      <div className="aa-right">
        {draft.length === 0 ? (
          <div className="aa-empty-state">
            <div className="aa-empty-icon">🗓️</div>
            <p>Select a date range and click <strong>Generate Draft</strong></p>
            <p className="aa-empty-sub">Gemini will create an initial schedule based on store tiers, promoter grades, and preferences.</p>
          </div>
        ) : (
          <ShiftTable
            stores={stores}
            promoters={activePromoters}
            shifts={draftShifts}
            storeCounts={draftStoreCounts}
            dates={dates}
            onShiftChange={handleDraftShiftChange}
            revenueForecast={revenueForecast}
          />
        )}
      </div>
    </div>
  );
}
