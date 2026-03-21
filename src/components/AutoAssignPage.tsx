import { useState, useRef, useEffect } from 'react';
import type {
  Store, Promoter, Shift,
  StorePreference, PromoterConflict,
  StoreTierSetting, PromoterGradeOverride,
} from '../types/types';
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
}

interface GeminiTurn {
  role: 'user' | 'model';
  parts: { text: string }[];
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

// ── colours ────────────────────────────────────────────────────────────────
const STORE_COLORS: Record<string, string> = {
  VDM: '#7c3aed', VDH: '#9333ea', VME: '#6d28d9',
  BDM: '#1d4ed8', JME: '#1e40af', AIR: '#0891b2',
  VAY: '#059669', VYM: '#16a34a', VRM: '#15803d',
  VMF: '#ca8a04', VMN: '#d97706', VNK: '#b45309',
  JDM: '#dc2626', JDH: '#b91c1c', SDM: '#be185d',
  HDM: '#0f766e',
};

const GRADE_BG: Record<string, string> = {
  A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#dc2626',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
function fmtHeader(d: string) {
  const dt = new Date(d + 'T00:00:00');
  const day = dt.getDay();
  return { dow: DAY_NAMES[day], date: `${dt.getDate()}/${dt.getMonth() + 1}`, isWeekend: day === 0 || day === 6 };
}
function storeBg(code: string): string {
  return STORE_COLORS[code] ?? '#4b5563';
}

function parseAssignments(text: string): DraftAssignment[] | null {
  const cleaned = text.replace(/```(?:json)?\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr)) return arr;
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

async function callGemini(turns: GeminiTurn[]): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY is not set in .env');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: turns,
        generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
      }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Gemini error ${res.status}`);
  }
  const data = await res.json() as { candidates?: { content?: { parts?: { text: string }[] } }[] };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
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

  ctx += '\n## PROMOTERS (id | name | grade | work-days/week | constraints)\n';
  for (const p of aProms) {
    const grade = gradeOverrides.find((g) => g.promoterId === p.id)?.grade ?? 'C';
    const prefs = storePreferences.filter((pf) => pf.promoterId === p.id);
    const must = prefs.filter((pf) => pf.preference === 'must').map((pf) => pf.storeCode).join(',');
    const preferred = prefs.filter((pf) => pf.preference === 'preferred').map((pf) => pf.storeCode).join(',');
    const banned = prefs.filter((pf) => pf.preference === 'banned').map((pf) => pf.storeCode).join(',');
    ctx += `- [${p.id}] ${p.name} | Grade:${grade} | ${p.workingDays}d/wk`;
    if (must) ctx += ` | Must:${must}`;
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
  const [draft, setDraft] = useState<DraftAssignment[]>([]);
  const [geminiHistory, setGeminiHistory] = useState<GeminiTurn[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  const dates = genDates(startDate, endDate);
  const activePromoters = promoters.filter((p) => p.active);

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
      '6. Distribute workload fairly across promoters.\n\n' +
      'Return ONLY a valid JSON array, no explanation, no markdown:\n' +
      '[{"promoterId":"ID","date":"YYYY-MM-DD","store":"CODE_or_Off"}]\n' +
      'Include every promoter for every date. Use exact IDs and codes from the lists above.';

    const turn: GeminiTurn = { role: 'user', parts: [{ text: userText }] };
    try {
      const reply = await callGemini([turn]);
      const assignments = parseAssignments(reply);
      if (!assignments) throw new Error('Gemini returned invalid JSON. Try again.');

      setDraft(assignments);
      const newHistory: GeminiTurn[] = [
        turn,
        { role: 'model', parts: [{ text: reply }] },
      ];
      setGeminiHistory(newHistory);
      setChat([
        { role: 'assistant', isDraft: true, count: assignments.length, text: reply },
      ]);
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
      const reply = await callGemini(turns);
      const assignments = parseAssignments(reply);
      if (!assignments) throw new Error('Gemini returned invalid JSON. Try rephrasing your request.');

      setDraft(assignments);
      setGeminiHistory([...turns, { role: 'model', parts: [{ text: reply }] }]);
      setChat((prev) => [
        ...prev,
        { role: 'assistant', isDraft: true, count: assignments.length, text: reply },
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

  // ── cell lookup ───────────────────────────────────────────────────────
  function getAssignment(promoterId: string, date: string): DraftAssignment | undefined {
    return draft.find((a) => a.promoterId === promoterId && a.date === date);
  }

  // ─────────────────────────────────────────────────────────────────────
  return (
    <div className="aa-layout">
      {/* ── LEFT PANEL ── */}
      <div className="aa-left">
        <div className="aa-controls">
          <h2 className="aa-title">Auto Assign</h2>

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

          <button
            className="aa-btn-generate"
            onClick={generateDraft}
            disabled={loading || dates.length === 0}
          >
            {loading && draft.length === 0 ? '⏳ Generating…' : '✨ Generate Draft'}
          </button>

          {draft.length > 0 && (
            <button className="aa-btn-apply" onClick={applyDraft}>
              Apply to Shift Table →
            </button>
          )}
        </div>

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
                    <span className="aa-msg-draft">
                      ✅ Draft updated — {m.count} assignments
                    </span>
                  ) : (
                    m.text
                  )
                ) : (
                  m.text
                )}
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
          <div className="aa-table-wrap">
            <div className="aa-table-header">
              <span className="aa-table-title">Draft Schedule</span>
              <span className="aa-table-meta">{draft.filter((a) => a.store !== 'Off').length} shifts assigned</span>
            </div>

            <div className="aa-scroll">
              <table className="aa-table">
                <thead>
                  <tr>
                    <th className="aa-th-name">Promoter</th>
                    {dates.map((d) => {
                      const { dow, date, isWeekend } = fmtHeader(d);
                      return (
                        <th key={d} className={`aa-th-date${isWeekend ? ' aa-weekend' : ''}`}>
                          <span className="aa-th-dow">{dow}</span>
                          <span className="aa-th-day">{date}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {activePromoters.map((p) => {
                    const grade = gradeOverrides.find((g) => g.promoterId === p.id)?.grade ?? 'C';
                    return (
                      <tr key={p.id} className="aa-tr">
                        <td className="aa-td-name">
                          <span
                            className="aa-grade-badge"
                            style={{ background: GRADE_BG[grade] }}
                          >
                            {grade}
                          </span>
                          <span className="aa-promoter-name">{p.name}</span>
                        </td>
                        {dates.map((d) => {
                          const { isWeekend } = fmtHeader(d);
                          const a = getAssignment(p.id, d);
                          const code = a?.store ?? '—';
                          const isOff = !a || code === 'Off' || code === '—';
                          return (
                            <td key={d} className={`aa-td-cell${isWeekend ? ' aa-weekend' : ''}`}>
                              {isOff ? (
                                <span className="aa-cell-off">Off</span>
                              ) : (
                                <span
                                  className="aa-cell-store"
                                  style={{ background: storeBg(code) }}
                                >
                                  {code}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* store legend */}
            <div className="aa-legend">
              {stores.filter((s) => s.active && draft.some((a) => a.store === s.code)).map((s) => (
                <span key={s.code} className="aa-legend-item">
                  <span className="aa-legend-dot" style={{ background: storeBg(s.code) }} />
                  {s.code} – {s.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
