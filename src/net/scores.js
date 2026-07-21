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

// Admin only: every run with its player's name (RLS blocks non-admins).
export async function fetchAllRuns(limit = 500) {
  const { data, error } = await supabase
    .from('runs')
    .select('room_scores, total_score, best_time, finished_at, profiles(username)')
    .order('finished_at', { ascending: false }).limit(limit);
  if (error) { console.warn('[scores] admin fetch failed:', error.message); return []; }
  return data ?? [];
}

// ── Admin analytics reads (RLS: admins get all rows, students only their own) ──
export async function fetchAllPlays(limit = 5000) {
  const { data, error } = await supabase.from('plays')
    .select('id, outcome, duration_sec, rooms_completed, total_score, best_time, plearn, device, started_at, ended_at, profiles(username)')
    .order('started_at', { ascending: false }).limit(limit);
  if (error) { console.warn('[scores] plays fetch failed:', error.message); return []; }
  return data ?? [];
}

export async function fetchAllAttempts(limit = 10000) {
  const { data, error } = await supabase.from('question_attempts')
    .select('play_id, room_id, difficulty, qid, question_text, is_correct, selected_index, selected_text, attempt_no, time_ms, hint_shown, mode, created_at, profiles(username)')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) { console.warn('[scores] attempts fetch failed:', error.message); return []; }
  return data ?? [];
}

export async function fetchAllEvents(limit = 10000) {
  const { data, error } = await supabase.from('events')
    .select('play_id, type, data, at, profiles(username)')
    .order('at', { ascending: false }).limit(limit);
  if (error) { console.warn('[scores] events fetch failed:', error.message); return []; }
  return data ?? [];
}
