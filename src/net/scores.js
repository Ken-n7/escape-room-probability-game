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

// Fastest time per player (ascending). Reads the owner-permission view, so it
// spans every player while exposing only username + best time.
export async function fetchSpeedLeaderboard(limit = 25) {
  const { data, error } = await supabase
    .from('speed_leaderboard').select('*')
    .order('best_time', { ascending: true }).limit(limit);
  if (error) { console.warn('[scores] speed board failed:', error.message); return []; }
  return data ?? [];
}

// Highest accuracy per player (descending).
export async function fetchAccuracyLeaderboard(limit = 25) {
  const { data, error } = await supabase
    .from('accuracy_leaderboard').select('*')
    .order('top_score', { ascending: false }).order('runs', { ascending: false }).limit(limit);
  if (error) { console.warn('[scores] accuracy board failed:', error.message); return []; }
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
