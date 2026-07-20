// ─────────────────────────────────────────────────────────────────────────────
//  Seed 20 realistic players with varied gameplay data (plays, question
//  attempts, events) into Supabase, for demoing the admin dashboard.
//
//  Run once:  node scripts/seed-players.mjs
//  Safe-ish to re-run: emails carry a run tag so they won't collide, but each
//  run creates 20 NEW accounts. Delete unwanted ones via Authentication → Users.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js';
import { ROOMS, QUESTIONS_PER_ROOM } from '../src/data/questions.js';

const URL = 'https://idhhdqbxtssiujuwopcq.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkaGhkcWJ4dHNzaXVqdXdvcGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NDE0MzAsImV4cCI6MjEwMDExNzQzMH0.mDM7RGoLZ2MmcegPJ46PBeetV0gOAg6xRHOqMqOoSdM';

const RUN = Date.now().toString(36).slice(-4);   // unique-ish email tag per run
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const chance = p => Math.random() < p;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = irand(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// 20 natural-looking display names (≤20 chars, valid charset)
const NAMES = [
  'Diego_R', 'Hannah_T', 'crimsonOwl', 'p_santos', 'NovaByte', 'Grace L', 'shadowMint',
  'Leo_V', 'Zara-K', 'mikey7', 'Ivy_C', 'AaronMercado', 'cloudRunner', 'Kiko42',
  'Faye_D', 'SwiftHeron', 'jollyMoose', 'Rae_08', 'CarloReyes', 'emberWolf',
];

const DIFF_PENALTY = { EASY: 0.00, MODERATE: 0.14, HARD: 0.24 };
const WRONG_CAP = 5;                    // wrong answers in a room before the ghost catches you
const ROOM_TIME = { EASY: [2500, 7000], MODERATE: [5000, 13000], HARD: [6000, 16000] };

// Assign qid the same way the game does at runtime.
ROOMS.forEach(r => r.questions.forEach((q, i) => { q.qid = `${r.id}.${i}`; }));

// Simulate one full playthrough for a player of a given skill. Returns
// { play, attempts, events } payloads (without user_id, added by caller).
function simulatePlay(skill, startedAt) {
  const playId = crypto.randomUUID();
  const attempts = [], events = [];
  const plearn = chance(0.15);
  const device = chance(0.22) ? 'mobile' : 'desktop';
  let clockMs = startedAt.getTime();
  const advance = ms => { clockMs += ms; };

  let roomsCompleted = 0, outcome = 'won', roomScores = [];

  outer:
  for (const room of ROOMS) {
    const qs = shuffle(room.questions).slice(0, QUESTIONS_PER_ROOM);
    let roomWrong = 0;
    advance(irand(3000, 12000));   // wandering / finding the first note

    for (const q of qs) {
      events.push({ id: crypto.randomUUID(), type: 'note_found', at: new Date(clockMs).toISOString(),
        data: { room: room.id, qid: q.qid, difficulty: room.label } });

      // A skilled player occasionally times out on the hard room too.
      if (!plearn && chance(room.label === 'HARD' ? 0.05 : 0.02)) {
        advance(15000);
        events.push({ id: crypto.randomUUID(), type: 'question_timeout', at: new Date(clockMs).toISOString(),
          data: { room: room.id, qid: q.qid, difficulty: room.label } });
      }

      const commonWrong = (q.correct + 1) % q.choices.length;   // a sticky misconception
      let tries = 0, solved = false;
      while (true) {
        tries++;
        const p = clamp(skill - DIFF_PENALTY[room.label] + (tries - 1) * 0.22 + rand(-0.08, 0.08), 0.03, 0.98);
        const t = irand(...ROOM_TIME[room.label]) - (tries > 1 ? 800 : 0);
        advance(t);
        const isCorrect = chance(p);

        // Build the answer payload (MCQ vs moderate scaffold).
        let selectedIndex = null, selectedText = null;
        if (room.steps || q.steps) {                       // moderate → scaffold fill-in
          selectedText = isCorrect ? q.steps[q.steps.length - 1] : pick(q.choices.filter((_, i) => i !== q.correct));
        } else {                                           // MCQ
          const idx = isCorrect ? q.correct : (chance(0.55) ? commonWrong : pick([...q.choices.keys()].filter(i => i !== q.correct)));
          selectedIndex = idx; selectedText = q.choices[idx];
        }
        attempts.push({
          id: undefined, play_id: playId, room_id: room.id, difficulty: room.label, qid: q.qid,
          question_text: q.text, is_correct: isCorrect, selected_index: selectedIndex, selected_text: selectedText,
          attempt_no: tries, time_ms: t, hint_shown: plearn && Boolean(q.hint), mode: plearn ? 'plearn' : 'play',
          created_at: new Date(clockMs).toISOString(),
        });

        if (isCorrect) { solved = true; break; }
        roomWrong++;
        if (roomWrong >= WRONG_CAP) { outcome = 'lost'; break; }
      }
      if (!solved && outcome === 'lost') break outer;
    }

    roomsCompleted++;
    const score = clamp(100 - roomWrong * 14, 35, 100);
    roomScores.push(score);
    events.push({ id: crypto.randomUUID(), type: 'room_clear', at: new Date(clockMs).toISOString(),
      data: { room: room.id, difficulty: room.label, score, wrong: roomWrong } });

    // Sometimes a player quits after clearing a room (lower skill → quits more).
    if (room.id < 3 && chance(0.06 + (1 - skill) * 0.12)) { outcome = 'abandoned'; break; }
  }

  // Exit code + escape (only if all three rooms cleared and not lost/abandoned).
  if (outcome === 'won' && roomsCompleted === 3) {
    if (chance(0.35)) { advance(irand(4000, 12000)); events.push({ id: crypto.randomUUID(), type: 'code_fail', at: new Date(clockMs).toISOString(), data: { entered: pick(['0000', '1234', '4 5 7']) } }); }
    advance(irand(3000, 9000));
  } else if (outcome === 'lost') {
    events.push({ id: crypto.randomUUID(), type: 'caught', at: new Date(clockMs).toISOString(), data: { rooms_completed: roomsCompleted } });
  }

  const durationSec = Math.max(20, Math.round((clockMs - startedAt.getTime()) / 1000));
  const totalScore = roomScores.length ? Math.round(roomScores.reduce((s, v) => s + v, 0) / roomScores.length) : 0;
  if (outcome === 'won') {
    events.push({ id: crypto.randomUUID(), type: 'escaped', at: new Date(clockMs).toISOString(), data: { time: durationSec, total: totalScore } });
  }

  const play = {
    id: playId, started_at: startedAt.toISOString(), ended_at: new Date(clockMs).toISOString(),
    outcome, duration_sec: durationSec, rooms_completed: roomsCompleted,
    total_score: outcome === 'won' ? totalScore : (roomScores.length ? totalScore : null),
    best_time: outcome === 'won' ? durationSec : null, plearn, device,
  };
  return { play, attempts, events };
}

// A random start time within the last N days, biased toward school hours.
function randomStart() {
  const d = new Date();
  d.setDate(d.getDate() - irand(0, 20));
  d.setHours(irand(8, 20), irand(0, 59), irand(0, 59), 0);
  return d;
}

async function seedPlayer(name, i) {
  const skill = clamp([0.9, 0.86][i] ?? rand(0.42, 0.9), 0.35, 0.96);   // a couple of stars, rest spread
  const email = `seed.${RUN}.${i}@gmail.com`;
  const sb = createClient(URL, ANON);
  const { data, error } = await sb.auth.signUp({ email, password: 'seed_pw_123', options: { data: { username: name } } });
  if (error) { console.log(`✗ ${name}: signup — ${error.message}`); return null; }
  if (!data.session) { console.log(`✗ ${name}: no session (email confirm on?)`); return null; }
  const userId = data.user.id;

  const nPlays = pick([1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 8]);   // most play a few times, some grind
  const plays = [], attempts = [], events = [];
  for (let p = 0; p < nPlays; p++) {
    const sim = simulatePlay(clamp(skill + rand(-0.06, 0.06), 0.3, 0.97), randomStart());
    plays.push({ ...sim.play, user_id: userId });
    sim.attempts.forEach(a => { delete a.id; attempts.push({ ...a, user_id: userId }); });
    sim.events.forEach(e => { delete e.id; events.push({ ...e, play_id: sim.play.id, user_id: userId }); });
  }

  const e1 = (await sb.from('plays').insert(plays)).error;
  if (e1) { console.log(`✗ ${name}: plays — ${e1.message}`); return null; }
  // Insert attempts/events in chunks to stay under payload limits.
  for (const [tbl, rows] of [['question_attempts', attempts], ['events', events]]) {
    for (let k = 0; k < rows.length; k += 500) {
      const err = (await sb.from(tbl).insert(rows.slice(k, k + 500))).error;
      if (err) { console.log(`✗ ${name}: ${tbl} — ${err.message}`); return null; }
    }
  }
  const wins = plays.filter(p => p.outcome === 'won').length;
  console.log(`✓ ${name.padEnd(14)} skill ${skill.toFixed(2)} · ${nPlays} plays (${wins}W) · ${attempts.length} answers · ${events.length} events`);
  return { plays: plays.length, attempts: attempts.length, events: events.length };
}

console.log(`Seeding 20 players (run tag ${RUN})…\n`);
const totals = { players: 0, plays: 0, attempts: 0, events: 0 };
for (let i = 0; i < NAMES.length; i++) {
  const r = await seedPlayer(NAMES[i], i);
  if (r) { totals.players++; totals.plays += r.plays; totals.attempts += r.attempts; totals.events += r.events; }
  await new Promise(res => setTimeout(res, 250));   // gentle pacing for signup limits
}
console.log(`\n✅ Done: ${totals.players} players · ${totals.plays} plays · ${totals.attempts} answers · ${totals.events} events`);
process.exit(0);
