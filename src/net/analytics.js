import { supabase } from './supabase.js';
import { authState } from './auth.js';

// ── Lightweight gameplay analytics ────────────────────────────────────────────
// All writes are fire-and-forget and never throw — telemetry must never be able
// to break the game. Rows are tied to the signed-in user; RLS keeps them private
// (only the player and admins can read them).

let _play = null;   // { id, startedAt } for the run in progress

const uid = () => authState.user?.id || null;
const newId = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function warn(where, error) { if (error) console.warn(`[analytics] ${where}:`, error.message); }

// Begin a run. Inserts a 'plays' row immediately so later attempts/events can
// reference it. Returns the play id (or null if not signed in).
export function startPlay({ plearn = false, device = null } = {}) {
  const u = uid();
  if (!u) return null;
  const id = newId();
  _play = { id, startedAt: Date.now() };
  supabase.from('plays')
    .insert({ id, user_id: u, outcome: 'in_progress', plearn, device })
    .then(({ error }) => warn('startPlay', error));
  return id;
}

// Finish the current run. `outcome` is 'won' | 'lost' | 'abandoned'. No-op if no
// run is active (so it's safe to call from multiple end paths).
export function endPlay({ outcome, roomsCompleted = 0, totalScore = null, bestTime = null } = {}) {
  if (!_play) return;
  const play = _play; _play = null;
  supabase.from('plays').update({
    outcome,
    ended_at: new Date().toISOString(),
    duration_sec: Math.round((Date.now() - play.startedAt) / 1000),
    rooms_completed: roomsCompleted,
    total_score: totalScore,
    best_time: bestTime,
  }).eq('id', play.id).then(({ error }) => warn('endPlay', error));
}

export const hasActivePlay = () => Boolean(_play);
export const currentPlayId = () => _play?.id ?? null;

// One answered question (right or wrong). See question_attempts columns.
export function logAttempt(a) {
  const u = uid();
  if (!u) return;
  supabase.from('question_attempts').insert({
    play_id:        _play?.id ?? null,
    user_id:        u,
    room_id:        a.roomId,
    difficulty:     a.difficulty ?? null,
    qid:            a.qid,
    question_text:  a.questionText ?? null,
    is_correct:     Boolean(a.isCorrect),
    selected_index: a.selectedIndex ?? null,
    selected_text:  a.selectedText ?? null,
    attempt_no:     a.attemptNo ?? 1,
    time_ms:        a.timeMs ?? null,
    hint_shown:     Boolean(a.hintShown),
    mode:           a.mode ?? 'play',
  }).then(({ error }) => warn('logAttempt', error));
}

// A notable moment: 'room_clear', 'question_timeout', 'caught', 'escaped',
// 'code_fail', … `data` is free-form and stored as jsonb.
export function logEvent(type, data = {}) {
  const u = uid();
  if (!u) return;
  supabase.from('events')
    .insert({ play_id: _play?.id ?? null, user_id: u, type, data })
    .then(({ error }) => warn('logEvent', error));
}
