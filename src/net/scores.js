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

// Read one leaderboard. `board` ∈ 'escape'|'speed'|'accuracy'; `window` ∈
// 'all'|'week'. Calls the matching SECURITY DEFINER function, which spans every
// player while exposing only a username + one metric. Returns raw rows; the
// caller sorts/limits per board.
const LB_FN = { escape: 'lb_escape', speed: 'lb_speed', accuracy: 'lb_accuracy' };
export async function fetchLeaderboard(board = 'escape', window = 'all') {
  const p_since = window === 'week' ? weekStartISO() : null;
  const { data, error } = await supabase.rpc(LB_FN[board] ?? 'lb_escape', { p_since });
  if (error) { console.warn(`[scores] ${board} board failed:`, error.message); return []; }
  return data ?? [];
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
