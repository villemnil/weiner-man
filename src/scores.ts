// Best times. Uses a Supabase table when configured (see config.ts), otherwise localStorage.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export interface Score { name: string; ms: number }

export const online = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const LS_KEY = 'weinerman.scores';
const NAME_KEY = 'weinerman.name';
export const MAX_NAME = 14;

export const cleanName = (raw: string): string => raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
export const savedName = (): string => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };

function localScores(): Score[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((s) => typeof s?.name === 'string' && Number.isFinite(s?.ms)) : [];
  } catch { return []; }
}
function saveLocal(s: Score): void {
  try {
    const all = [...localScores(), s].sort((a, b) => a.ms - b.ms).slice(0, 50);
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch { /* private mode: nothing to do */ }
}

const headers = (): Record<string, string> => ({
  apikey: SUPABASE_ANON_KEY,
  // legacy anon keys are JWTs and also go in Authorization; new sb_publishable_ keys only need apikey
  ...(SUPABASE_ANON_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
  'Content-Type': 'application/json',
});

/** Fastest times first. Falls back to this device's list if the online board can't be reached. */
export async function topScores(n = 10): Promise<{ scores: Score[]; shared: boolean }> {
  if (online) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/scores?select=name,time_ms&order=time_ms.asc&limit=${n}`, { headers: headers() });
      if (r.ok) {
        const rows = (await r.json()) as { name: string; time_ms: number }[];
        return { scores: rows.map((x) => ({ name: x.name, ms: x.time_ms })), shared: true };
      }
    } catch { /* fall through */ }
  }
  return { scores: localScores().sort((a, b) => a.ms - b.ms).slice(0, n), shared: false };
}

/** Save a time. Always kept on this device; also sent to the shared board when there is one. */
export async function submitScore(rawName: string, ms: number): Promise<{ shared: boolean }> {
  const s: Score = { name: cleanName(rawName) || 'anonymous', ms: Math.round(ms) };
  try { localStorage.setItem(NAME_KEY, s.name); } catch { /* ignore */ }
  saveLocal(s);
  if (!online) return { shared: false };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/scores`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ name: s.name, time_ms: s.ms }),
    });
    return { shared: r.ok };
  } catch { return { shared: false }; }
}

/** 12.4 s, or 1:07.3 past a minute. */
export function formatTime(ms: number): string {
  const t = Math.max(0, ms) / 1000;
  if (t < 60) return `${t.toFixed(1)} s`;
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}
