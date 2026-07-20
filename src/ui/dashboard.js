import { fetchAllPlays, fetchAllAttempts, fetchAllEvents } from '../net/scores.js';

// ═══════════════════════════════════════════════════════════════════════════════
//  ADMIN DASHBOARD — clean, non-game analytics UI. Renders into #dash-root.
//  Pulls raw rows (RLS gives admins everything) and aggregates client-side.
// ═══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'items',    label: 'Item analysis' },
  { id: 'players',  label: 'Players' },
  { id: 'behavior', label: 'Behavior' },
];

let _data = null;        // { plays, attempts, events }
let _tab = 'overview';
let _onBack = null;
let _loading = false;

// ── small helpers ──────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const uname = r => r.profiles?.username || '—';
const fmtTime = s => s == null ? '—' : s < 60 ? Math.round(s) + 's' : Math.floor(s / 60) + 'm ' + String(Math.round(s) % 60).padStart(2, '0') + 's';
const accClass = v => v >= 75 ? 'good' : v >= 50 ? 'mid' : 'bad';
const accPill = v => `<span class="pill ${accClass(v)}">${v}%</span>`;

// ── chart builders (HTML/CSS, no external libs) ─────────────────────────────────
function barRows(items, { colorByValue = false } = {}) {
  const max = Math.max(1, ...items.map(i => i.value));
  return items.map(i => `
    <div class="bar-row">
      <div class="bar-label" title="${esc(i.label)}">${esc(i.label)}</div>
      <div class="bar-track"><div class="bar-fill ${colorByValue ? accClass(i.value) : ''}" style="width:${Math.round(i.value / max * 100)}%"></div></div>
      <div class="bar-val">${i.display ?? i.value}</div>
    </div>`).join('');
}
function funnelRows(steps) {
  const top = steps[0]?.value || 1;
  return steps.map(s => `
    <div class="funnel-row">
      <div class="bar-label">${esc(s.label)}</div>
      <div class="funnel-track"><div class="funnel-fill" style="width:${Math.max(4, Math.round(s.value / top * 100))}%">${s.value}</div></div>
      <div class="bar-val">${pct(s.value, top)}%</div>
    </div>`).join('');
}
function sparkChart(buckets) {
  const max = Math.max(1, ...buckets.map(b => b.value));
  return `<div class="spark">${buckets.map(b => `<div class="spark-bar" style="height:${Math.round(b.value / max * 100)}%" title="${b.label}: ${b.value} plays"></div>`).join('')}</div>
    <div class="spark-labels">${buckets.map(b => `<span>${b.label}</span>`).join('')}</div>`;
}
const statCard = (value, label, sub = '') =>
  `<div class="stat-card"><div class="stat-value">${value}</div><div class="stat-label">${label}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
const emptyCard = msg => `<div class="dash-empty">${esc(msg)}</div>`;

// ── shell ────────────────────────────────────────────────────────────────────
export async function mountDashboard({ onBack } = {}) {
  _onBack = onBack;
  const root = document.getElementById('dash-root');
  root.innerHTML = `
    <div class="dash-header">
      <div>
        <div class="dash-title">Class Dashboard</div>
        <div class="dash-sub" id="dash-sub">Loading…</div>
      </div>
      <div class="dash-actions">
        <button class="dash-btn" id="dash-refresh" type="button">↻ Refresh</button>
        <button class="dash-btn" id="dash-export" type="button">⬇ Export CSV</button>
        <button class="dash-btn primary" id="dash-back" type="button">← Back to game</button>
      </div>
    </div>
    <div class="dash-tabs">
      ${TABS.map(t => `<button class="dash-tab${t.id === _tab ? ' active' : ''}" data-tab="${t.id}" type="button">${t.label}</button>`).join('')}
    </div>
    <div id="dash-body"><div class="dash-loading">Loading data…</div></div>`;

  root.querySelector('#dash-back').onclick    = () => _onBack?.();
  root.querySelector('#dash-refresh').onclick = () => refresh();
  root.querySelector('#dash-export').onclick  = () => exportCsv();
  root.querySelectorAll('.dash-tab').forEach(btn => {
    btn.onclick = () => {
      _tab = btn.dataset.tab;
      root.querySelectorAll('.dash-tab').forEach(b => b.classList.toggle('active', b === btn));
      render();
    };
  });

  if (_data) render(); else await refresh();
}

async function refresh() {
  if (_loading) return;
  _loading = true;
  const body = document.getElementById('dash-body');
  if (body) body.innerHTML = '<div class="dash-loading">Loading data…</div>';
  const [plays, attempts, events] = await Promise.all([fetchAllPlays(), fetchAllAttempts(), fetchAllEvents()]);
  _data = { plays, attempts, events };
  _loading = false;
  render();
}

function render() {
  if (!_data) return;
  const sub = document.getElementById('dash-sub');
  if (sub) {
    const players = new Set(_data.plays.map(uname)).size;
    sub.textContent = `${players} player${players === 1 ? '' : 's'} · ${_data.plays.length} plays · ${_data.attempts.length} answers logged`;
  }
  const body = document.getElementById('dash-body');
  if (!body) return;
  body.innerHTML =
    _tab === 'overview' ? renderOverview()
    : _tab === 'items'  ? renderItems()
    : _tab === 'players' ? renderPlayers()
    : renderBehavior();
}

// ── OVERVIEW ─────────────────────────────────────────────────────────────────
function renderOverview() {
  const plays = _data.plays;
  if (!plays.length) return emptyCard('No plays recorded yet. Play a run (while signed in) to see data here.');

  const finished = plays.filter(p => p.outcome !== 'in_progress');
  const wins   = plays.filter(p => p.outcome === 'won').length;
  const losses = plays.filter(p => p.outcome === 'lost').length;
  const aband  = plays.filter(p => p.outcome === 'abandoned').length;
  const players = new Set(plays.map(uname)).size;
  const wonPlays = plays.filter(p => p.outcome === 'won');
  const avgDur = wonPlays.length ? Math.round(wonPlays.reduce((s, p) => s + (p.duration_sec || 0), 0) / wonPlays.length) : null;

  const funnel = [
    { label: 'Started',        value: plays.length },
    { label: 'Cleared Room 1', value: plays.filter(p => p.rooms_completed >= 1).length },
    { label: 'Cleared Room 2', value: plays.filter(p => p.rooms_completed >= 2).length },
    { label: 'Cleared Room 3', value: plays.filter(p => p.rooms_completed >= 3).length },
    { label: 'Escaped',        value: wins },
  ];
  const days = playsByDay(plays, 14);

  return `
    <div class="dash-grid">
      ${statCard(plays.length, 'Total plays', `${players} unique player${players === 1 ? '' : 's'}`)}
      ${statCard(pct(wins, finished.length) + '%', 'Win rate', `${wins} won of ${finished.length} finished`)}
      ${statCard(avgDur == null ? '—' : fmtTime(avgDur), 'Avg escape time', 'across winning runs')}
      ${statCard(losses, 'Caught by ghost', `${aband} abandoned`)}
    </div>
    <div class="dash-2col">
      <div class="card"><h3>Completion funnel</h3>${funnelRows(funnel)}
        <div class="card-note">How far players get before finishing, losing, or quitting.</div></div>
      <div class="card"><h3>Plays over the last 14 days</h3>${sparkChart(days)}</div>
    </div>`;
}

function playsByDay(plays, days = 14) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const keys = [], map = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    map.set(key, 0);
    keys.push({ key, label: i % 2 === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : '' });
  }
  for (const p of plays) { const k = (p.started_at || '').slice(0, 10); if (map.has(k)) map.set(k, map.get(k) + 1); }
  return keys.map(k => ({ label: k.label, value: map.get(k.key) || 0 }));
}

// ── ITEM ANALYSIS ──────────────────────────────────────────────────────────────
function itemStats() {
  const byQ = new Map();
  for (const a of _data.attempts) {
    if (!byQ.has(a.qid)) byQ.set(a.qid, { qid: a.qid, text: a.question_text, diff: a.difficulty, room: a.room_id, all: [], firsts: [], wrong: {} });
    const g = byQ.get(a.qid);
    g.all.push(a);
    if (a.attempt_no === 1) g.firsts.push(a);
    if (!a.is_correct && a.selected_text) g.wrong[a.selected_text] = (g.wrong[a.selected_text] || 0) + 1;
  }
  return [...byQ.values()].map(g => {
    const top = Object.entries(g.wrong).sort((a, b) => b[1] - a[1])[0];
    return {
      qid: g.qid, text: g.text || g.qid, diff: g.diff || '', room: g.room,
      n: g.all.length,
      firstAcc: pct(g.firsts.filter(a => a.is_correct).length, g.firsts.length),
      avgTime: g.all.length ? Math.round(g.all.reduce((s, a) => s + (a.time_ms || 0), 0) / g.all.length / 100) / 10 : 0,
      topWrong: top ? `${top[0]} (${top[1]}×)` : '—',
    };
  }).sort((a, b) => a.firstAcc - b.firstAcc);
}

function renderItems() {
  if (!_data.attempts.length) return emptyCard('No answers recorded yet.');
  const rows = itemStats();
  const hardest = rows.slice(0, 10).map(r => ({ label: `Q ${r.qid}`, value: r.firstAcc, display: r.firstAcc + '%' }));

  const table = `
    <div class="dash-table-wrap"><table class="dash-table">
      <thead><tr>
        <th>Q</th><th>Diff</th><th class="wide">Question</th>
        <th class="num">Attempts</th><th class="num">First-try</th><th class="num">Avg time</th><th>Most-picked wrong answer</th>
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td>${esc(r.qid)}</td><td>${esc(r.diff)}</td>
          <td class="wide">${esc(r.text)}</td>
          <td class="num">${r.n}</td>
          <td class="num">${accPill(r.firstAcc)}</td>
          <td class="num">${r.avgTime}s</td>
          <td>${esc(r.topWrong)}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;

  return `
    <div class="card"><h3>Hardest questions (lowest first-try accuracy)</h3>${barRows(hardest, { colorByValue: true })}
      <div class="card-note">First-try accuracy = % who got it right on their first attempt.</div></div>
    <div class="card"><h3>All questions · item analysis</h3>${table}
      <div class="card-note">The "most-picked wrong answer" column reveals the common misconception per item.</div></div>`;
}

// ── PLAYERS ──────────────────────────────────────────────────────────────────
function playerStats() {
  const byU = new Map();
  const get = u => { if (!byU.has(u)) byU.set(u, { u, plays: 0, wins: 0, best: null, bestTime: null, correct: 0, total: 0, atToCorrect: [] }); return byU.get(u); };
  for (const p of _data.plays) {
    const g = get(uname(p));
    g.plays++;
    if (p.outcome === 'won') { g.wins++; if (p.best_time != null && (g.bestTime == null || p.best_time < g.bestTime)) g.bestTime = p.best_time; }
    if (p.total_score != null && (g.best == null || p.total_score > g.best)) g.best = p.total_score;
  }
  for (const a of _data.attempts) {
    const g = get(uname(a));
    g.total++;
    if (a.is_correct) { g.correct++; g.atToCorrect.push(a.attempt_no || 1); }
  }
  return [...byU.values()].map(g => ({
    ...g,
    acc: pct(g.correct, g.total),
    avgAtt: g.atToCorrect.length ? Math.round(g.atToCorrect.reduce((s, n) => s + n, 0) / g.atToCorrect.length * 10) / 10 : null,
  })).sort((a, b) => b.wins - a.wins || (b.best ?? -1) - (a.best ?? -1));
}

function renderPlayers() {
  if (!_data.plays.length) return emptyCard('No players have played yet.');
  const rows = playerStats();
  return `
    <div class="card"><h3>Per-player report card</h3>
    <div class="dash-table-wrap"><table class="dash-table">
      <thead><tr>
        <th>Player</th><th class="num">Plays</th><th class="num">Wins</th>
        <th class="num">Best score</th><th class="num">Best time</th>
        <th class="num">Accuracy</th><th class="num">Avg tries→correct</th>
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td>${esc(r.u)}</td>
          <td class="num">${r.plays}</td>
          <td class="num">${r.wins}</td>
          <td class="num">${r.best == null ? '—' : r.best + '%'}</td>
          <td class="num">${fmtTime(r.bestTime)}</td>
          <td class="num">${r.total ? accPill(r.acc) : '—'}</td>
          <td class="num">${r.avgAtt ?? '—'}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">Accuracy = correct answers ÷ all answers. Avg tries→correct shows how many attempts a right answer takes on average.</div></div>`;
}

// ── BEHAVIOR ─────────────────────────────────────────────────────────────────
function renderBehavior() {
  const A = _data.attempts;
  if (!A.length) return emptyCard('No answers recorded yet.');

  const diffs = ['EASY', 'MODERATE', 'HARD'];
  const accByDiff = diffs.map(d => {
    const firsts = A.filter(a => a.difficulty === d && a.attempt_no === 1);
    return { label: d, value: pct(firsts.filter(a => a.is_correct).length, firsts.length), display: pct(firsts.filter(a => a.is_correct).length, firsts.length) + '%' };
  });
  const triesByDiff = diffs.map(d => {
    const correct = A.filter(a => a.difficulty === d && a.is_correct);
    const avg = correct.length ? correct.reduce((s, a) => s + (a.attempt_no || 1), 0) / correct.length : 0;
    return { label: d, value: Math.round(avg * 10) / 10, display: (Math.round(avg * 10) / 10) || '—' };
  });

  const hintShown = A.filter(a => a.hint_shown).length;
  const plearnPlays = _data.plays.filter(p => p.plearn).length;
  const timeouts = _data.events.filter(e => e.type === 'question_timeout').length;
  const deaths = _data.plays.filter(p => p.outcome === 'lost').length;
  const mobile = _data.plays.filter(p => p.device === 'mobile').length;

  return `
    <div class="dash-grid">
      ${statCard(pct(hintShown, A.length) + '%', 'Answers with a hint shown', `${plearnPlays} P-Learn runs`)}
      ${statCard(timeouts, 'Question timeouts', 'ran out of time')}
      ${statCard(deaths, 'Deaths (caught)', 'too many wrong answers')}
      ${statCard(pct(mobile, _data.plays.length) + '%', 'Plays on mobile', `${_data.plays.length - mobile} on desktop`)}
    </div>
    <div class="dash-2col">
      <div class="card"><h3>First-try accuracy by difficulty</h3>${barRows(accByDiff, { colorByValue: true })}</div>
      <div class="card"><h3>Avg attempts to get it right</h3>${barRows(triesByDiff)}
        <div class="card-note">Higher = players needed more tries before answering correctly.</div></div>
    </div>`;
}

// ── CSV export (raw answer log — the richest single table) ──────────────────────
function exportCsv() {
  if (!_data?.attempts?.length) return;
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const header = ['Player', 'Room', 'Difficulty', 'QID', 'Question', 'Correct', 'SelectedText', 'AttemptNo', 'TimeMs', 'HintShown', 'Mode', 'When'];
  const lines = [header.join(',')].concat(_data.attempts.map(a => [
    q(uname(a)), a.room_id, q(a.difficulty), q(a.qid), q(a.question_text),
    a.is_correct, q(a.selected_text), a.attempt_no, a.time_ms ?? '', a.hint_shown, q(a.mode), a.created_at,
  ].join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'escape-room-answers.csv'; a.click();
  URL.revokeObjectURL(url);
}
