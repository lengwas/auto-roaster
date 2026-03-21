import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type {
  Store, Promoter, Shift,
  StorePreference, PromoterConflict,
  StoreTierSetting, PromoterGradeOverride,
} from '../types/types';
import ShiftTable from './ShiftTable';
import { generateStoreCounts } from '../data/mockData';
import './AutoAssignPage.css';

interface DraftAssignment {
  promoterId: string;
  date: string;
  store: string; // store code | 'Off' | 'LOP' | 'SL'
  timeRange?: string;
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
  { id: 'gemini-2.0-flash',     label: 'Gemini 2.0 Flash (fast)' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite (lightest)' },
  { id: 'gemini-1.5-flash',     label: 'Gemini 1.5 Flash (stable)' },
  { id: 'gemini-1.5-flash-8b',  label: 'Gemini 1.5 Flash-8B (cheapest)' },
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
      (notes.trim() ? `\n## ADDITIONAL CONSTRAINTS\n${notes.trim()}\n` : '') +
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
          <div className="aa-field" style={{ marginBottom: 10 }}>
            <label className="aa-label">Additional Constraints</label>
            <textarea
              className="aa-notes"
              rows={4}
              placeholder={'e.g.\nKevin: Sunday morning shift only\nMaureen: Tuesday evening preferred\nVDM ต้องมีคน 2 คนทุกวัน'}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

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
          />
        )}
      </div>
    </div>
  );
}
