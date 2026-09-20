import { supabase } from './supabase.js';
import { authState } from './auth.js';

// Save one finished run. Fire-and-forget from the win screen; never throws so a
// network hiccup can't break the celebration.
export async function submitRun({ roomScores, totalScore, bestTime }) {
  if (!authState.user) return { ok: false, reason: 'not-signed-in' };
  const { error } = await supabase.from('runs').insert({
    user_id:     authState.user.id,
    room_scores: roomScores,
    total_score: totalScore,
    best_time:   bestTime,
  });
  if (error) { console.warn('[scores] submitRun failed:', error.message); return { ok: false, error }; }
  return { ok: true };
}

// Start of the current ISO week (Monday 00:00, local) as an ISO string — the
// cutoff for the weekly board. null window means all-time.
function weekStartISO() {
  const d = new Date();
  const mondayOffset = (d.getDay() + 6) % 7; // Sun=6 … Mon=0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - mondayOffset);
  return d.toISOString();
}

// Start of today (local midnight) as an ISO string — the cutoff for the daily
// board, served by the SAME p_since param the weekly board already uses.
function dayStartISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// Read one leaderboard. `board` ∈ 'escape'|'speed'|'accuracy'; `window` ∈
// 'all'|'week'|'day'. Calls the matching SECURITY DEFINER function, which spans
// every player while exposing only a username + one metric. Returns raw rows;
// the caller sorts/limits per board.
const LB_FN = { escape: 'lb_escape', speed: 'lb_speed', accuracy: 'lb_accuracy' };

// Short client-side cache so flipping tabs / reopening the board doesn't hit the
// DB every time. Each board:window is fetched at most once per TTL; a new score
// submission clears the cache so the player sees their result immediately.
const _lbCache = new Map();          // 'board:window' -> { ts, data }
const LB_TTL   = 60_000;             // 60s
const LB_TIMEOUT_MS = 12_000;        // hung RPC must not strand the board on "Loading…"

export function invalidateLeaderboardCache() { _lbCache.clear(); }

export async function fetchLeaderboard(board = 'escape', window = 'all', { force = false } = {}) {
  const key = `${board}:${window}`;
  const hit = _lbCache.get(key);
  if (!force && hit && Date.now() - hit.ts < LB_TTL) return hit.data;

  const p_since = window === 'week' ? weekStartISO() : window === 'day' ? dayStartISO() : null;

  // Race the RPC against a hard timeout so a stalled connection can't leave the
  // board stuck on "Loading…". The timer resolves a sentinel that takes the same
  // error path; the abandoned request is just dropped (read-only, harmless).
  const TIMED_OUT = { error: true, message: 'request timed out' };
  const res = await Promise.race([
    supabase.rpc(LB_FN[board] ?? 'lb_escape', { p_since }),
    new Promise(resolve => setTimeout(() => resolve(TIMED_OUT), LB_TIMEOUT_MS)),
  ]);
  const timedOut = res === TIMED_OUT;                  // check identity BEFORE destructuring
  const { data, error } = res;
  if (data != null) {
    _lbCache.set(key, { ts: Date.now(), data });
    return data;
  }
  console.warn(`[scores] ${board} board failed:`, timedOut ? 'request timed out' : error?.message ?? error);
  if (timedOut && !hit?.data) {
    // No stale rows to fall back on — tag the result so the UI can say
    // "couldn't load" instead of the misleading "no scores yet".
    const empty = [];
    Object.defineProperty(empty, 'timedOut', { value: true });
    return empty;
  }
  return hit?.data ?? [];            // fall back to stale data on error
}

// ── Server-side dashboard aggregates (small results, correct at any scale) ─────
// Each tab reads a pre-aggregated summary instead of pulling raw rows, so the
// numbers are never truncated by the API row cap and the payload stays tiny.
export async function fetchGameAccuracy() {
  const { data, error } = await supabase.rpc('game_accuracy');
  if (error) { console.warn('[scores] game_accuracy failed:', error.message); return []; }
  return data ?? [];
}

export async function fetchOverviewStats() {
  const { data, error } = await supabase.rpc('overview_stats');
  if (error) { console.warn('[scores] overview_stats failed:', error.message); return null; }
  return data;
}

export async function fetchItemStats() {
  const { data, error } = await supabase.rpc('item_stats');
  if (error) { console.warn('[scores] item_stats failed:', error.message); return []; }
  return data ?? [];
}

export async function fetchBehaviorStats() {
  const { data, error } = await supabase.rpc('behavior_stats');
  if (error) { console.warn('[scores] behavior_stats failed:', error.message); return null; }
  return data;
}

// Full detail for ONE run — fetched on demand (a single play's rows are far
// under any cap), so drill-downs are always complete.
export async function fetchRunDetail(playId) {
  const [a, e] = await Promise.all([
    supabase.from('question_attempts')
      .select('room_id, difficulty, qid, question_text, is_correct, selected_index, selected_text, attempt_no, time_ms, hint_shown, mode, created_at')
      .eq('play_id', playId).order('created_at', { ascending: true }),
    supabase.from('events').select('type, data, at').eq('play_id', playId).order('at', { ascending: true }),
  ]);
  if (a.error) console.warn('[scores] run attempts failed:', a.error.message);
  if (e.error) console.warn('[scores] run events failed:', e.error.message);
  return { attempts: a.data ?? [], events: e.data ?? [] };
}
