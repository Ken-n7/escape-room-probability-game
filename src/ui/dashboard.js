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
let _drill = null;       // null | { player } | { player, playId } — drill-down view
let _keyBound = false;   // Escape handler bound once, guarded across remounts

// Per-table interactive state (search box text + sorted column).
const _query = { players: '', items: '' };
const _sort  = {
  players: { key: 'wins',     dir: -1 },   // default: most wins first
  items:   { key: 'firstAcc', dir:  1 },   // default: hardest (lowest first-try) first
};

// ── small helpers ──────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const uname = r => r.profiles?.username || '—';
const fmtTime = s => s == null ? '—' : s < 60 ? Math.round(s) + 's' : Math.floor(s / 60) + 'm ' + String(Math.round(s) % 60).padStart(2, '0') + 's';
const fmtDateTime = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const accClass = v => v >= 75 ? 'good' : v >= 50 ? 'mid' : 'bad';
const accPill = v => `<span class="pill ${accClass(v)}">${v}%</span>`;
const OUTCOME = { won: ['good', 'Escaped'], lost: ['bad', 'Caught'], abandoned: ['mid', 'Quit'], in_progress: ['mid', 'In progress'] };
const outcomePill = o => { const [c, t] = OUTCOME[o] || ['mid', o]; return `<span class="pill ${c}">${t}</span>`; };

// drill-down data slicing
const playsForUser   = u => _data.plays.filter(p => uname(p) === u).sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
const findPlay       = id => _data.plays.find(p => p.id === id);
const attemptsForPlay = id => _data.attempts.filter(a => a.play_id === id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
const eventsForPlay  = id => _data.events.filter(e => e.play_id === id).sort((a, b) => new Date(a.at) - new Date(b.at));

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
const statCard = (value, label, sub = '', accent = '') =>
  `<div class="stat-card${accent ? ' accent-' + accent : ''}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
const emptyCard = (msg, emoji = '📊') => `<div class="dash-empty"><span class="emoji">${emoji}</span>${esc(msg)}</div>`;
const skeleton = () => `<div class="skel-grid">${'<div class="skel skel-card"></div>'.repeat(4)}</div><div class="skel skel-row"></div>`;

// ── sortable tables + search (client-side, shared by Players & Items) ───────────
const searchBox = (tab, ph) =>
  `<div class="dash-search"><input type="text" class="dash-search-input" data-search-tab="${tab}" placeholder="${esc(ph)}" value="${esc(_query[tab])}"></div>`;

// Render a sortable <th>. `num` right-aligns; the arrow reflects current sort.
function th(tab, key, label, cls = '') {
  const s = _sort[tab], on = s.key === key;
  const ind = on ? (s.dir === -1 ? '▾' : '▴') : '↕';
  return `<th class="sortable${cls ? ' ' + cls : ''}${on ? ' sorted' : ''}" data-sort="${key}" data-sort-tab="${tab}">${esc(label)}<span class="sort-ind">${ind}</span></th>`;
}
function applySort(rows, { key, dir }) {
  return rows.slice().sort((a, b) => {
    const x = a[key], y = b[key];
    if (typeof x === 'string' || typeof y === 'string') return String(x ?? '').localeCompare(String(y ?? '')) * dir;
    if (x == null && y == null) return 0;
    if (x == null) return 1;           // nulls always sink, regardless of direction
    if (y == null) return -1;
    return (x - y) * dir;
  });
}
// Hide table rows whose data-search text doesn't contain the query. No re-render.
function applyFilter(tab) {
  const q = (_query[tab] || '').trim().toLowerCase();
  document.querySelectorAll('#dash-body .dash-table tbody tr[data-search]').forEach(tr => {
    tr.classList.toggle('filtered-out', !!q && !(tr.dataset.search || '').includes(q));
  });
}

// ── shell ────────────────────────────────────────────────────────────────────
export async function mountDashboard({ onBack } = {}) {
  _onBack = onBack;
  const root = document.getElementById('dash-root');
  root.innerHTML = `
    <div class="dash-topbar">
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
    </div>
    <div id="dash-body">${skeleton()}</div>`;

  root.querySelector('#dash-back').onclick    = () => _onBack?.();
  root.querySelector('#dash-refresh').onclick = () => refresh();
  root.querySelector('#dash-export').onclick  = () => exportCsv();
  root.querySelectorAll('.dash-tab').forEach(btn => {
    btn.onclick = () => {
      _tab = btn.dataset.tab;
      _drill = null;                 // switching tabs leaves any drill-down
      root.querySelectorAll('.dash-tab').forEach(b => b.classList.toggle('active', b === btn));
      render();
    };
  });

  // Delegated clicks for sort headers + drill-down (rows + breadcrumbs).
  // #dash-body persists across renders, so one listener handles every rebuilt view.
  const dashBody = root.querySelector('#dash-body');
  dashBody.addEventListener('click', e => {
    const sortTh = e.target.closest('[data-sort]');
    if (sortTh) {
      const tab = sortTh.dataset.sortTab, key = sortTh.dataset.sort, s = _sort[tab];
      if (s.key === key) s.dir = -s.dir;                       // toggle direction
      else { s.key = key; s.dir = (key === 'u' || key === 'diff' || key === 'qid') ? 1 : -1; }
      render(); return;
    }
    const back = e.target.closest('[data-back]');
    if (back) { _drill = back.dataset.back === 'players' ? null : { player: _drill?.player }; render(); return; }
    const run = e.target.closest('[data-run]');
    if (run) { _drill = { player: run.dataset.player || _drill?.player, playId: run.dataset.run }; render(); return; }
    const pl = e.target.closest('[data-player]');
    if (pl) { _drill = { player: pl.dataset.player }; render(); return; }
  });

  // Live search — filters visible rows without a full re-render (keeps focus).
  dashBody.addEventListener('input', e => {
    const inp = e.target.closest('.dash-search-input');
    if (!inp) return;
    _query[inp.dataset.searchTab] = inp.value;
    applyFilter(inp.dataset.searchTab);
  });

  // Escape steps back out of a drill-down, then leaves the dashboard.
  if (!_keyBound) {
    _keyBound = true;
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const admin = document.getElementById('s-admin');
      if (!admin || admin.classList.contains('hidden')) return;   // only while dashboard is visible
      if (_drill?.playId)      { _drill = { player: _drill.player }; render(); }
      else if (_drill?.player) { _drill = null; render(); }
      else                     { _onBack?.(); }
    });
  }

  if (_data) render(); else await refresh();
}

async function refresh() {
  if (_loading) return;
  _loading = true;
  const btn = document.getElementById('dash-refresh');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin">↻</span> Refreshing…'; }
  const body = document.getElementById('dash-body');
  if (body) body.innerHTML = skeleton();
  try {
    const [plays, attempts, events] = await Promise.all([fetchAllPlays(), fetchAllAttempts(), fetchAllEvents()]);
    _data = { plays, attempts, events };
  } finally {
    _loading = false;
    if (btn) { btn.disabled = false; btn.innerHTML = '↻ Refresh'; }
  }
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

  // Drill-down views take over the body; a tab click clears _drill.
  if (_drill?.playId) { body.innerHTML = renderRunDetail(_drill.player, _drill.playId); return; }
  if (_drill?.player) { body.innerHTML = renderPlayerDetail(_drill.player); return; }

  body.innerHTML =
    _tab === 'overview' ? renderOverview()
    : _tab === 'items'  ? renderItems()
    : _tab === 'players' ? renderPlayers()
    : renderBehavior();

  // Restore the active search filter after any full-body rebuild (e.g. re-sort).
  if (_tab === 'players' || _tab === 'items') applyFilter(_tab);
}

// ── OVERVIEW ─────────────────────────────────────────────────────────────────
function renderOverview() {
  const plays = _data.plays;
  if (!plays.length) return emptyCard('No plays recorded yet. Play a run (while signed in) to see data here.', '👻');

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
      ${statCard(plays.length, 'Total plays', `${players} unique player${players === 1 ? '' : 's'}`, 'blue')}
      ${statCard(pct(wins, finished.length) + '%', 'Win rate', `${wins} won of ${finished.length} finished`, 'green')}
      ${statCard(avgDur == null ? '—' : fmtTime(avgDur), 'Avg escape time', 'across winning runs')}
      ${statCard(losses, 'Caught by ghost', `${aband} abandoned`, 'red')}
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
  if (!_data.attempts.length) return emptyCard('No answers recorded yet.', '📝');
  const all = itemStats();
  const rows = applySort(all, _sort.items);
  const hardest = all.slice().sort((a, b) => a.firstAcc - b.firstAcc)
    .slice(0, 10).map(r => ({ label: `Q ${r.qid}`, value: r.firstAcc, display: r.firstAcc + '%' }));

  const table = `
    <div class="dash-table-wrap"><table class="dash-table">
      <thead><tr>
        ${th('items', 'qid', 'Q')}${th('items', 'diff', 'Diff')}<th class="wide">Question</th>
        ${th('items', 'n', 'Attempts', 'num')}${th('items', 'firstAcc', 'First-try', 'num')}${th('items', 'avgTime', 'Avg time', 'num')}<th>Most-picked wrong answer</th>
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr data-search="${esc((r.qid + ' ' + r.text).toLowerCase())}">
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
    <div class="card">
      <div class="card-toolbar"><h3>All questions · item analysis</h3>${searchBox('items', 'Search questions…')}</div>${table}
      <div class="card-note">Click a column header to sort. The "most-picked wrong answer" column reveals the common misconception per item.</div></div>`;
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
  if (!_data.plays.length) return emptyCard('No players have played yet.', '🎮');
  const rows = applySort(playerStats(), _sort.players);
  return `
    <div class="card">
    <div class="card-toolbar"><h3>Per-player report card</h3>${searchBox('players', 'Search players…')}</div>
    <div class="dash-table-wrap"><table class="dash-table">
      <thead><tr>
        ${th('players', 'u', 'Player')}${th('players', 'plays', 'Plays', 'num')}${th('players', 'wins', 'Wins', 'num')}
        ${th('players', 'best', 'Best score', 'num')}${th('players', 'bestTime', 'Best time', 'num')}
        ${th('players', 'acc', 'Accuracy', 'num')}${th('players', 'avgAtt', 'Avg tries→correct', 'num')}
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr class="row-link" data-player="${esc(r.u)}" data-search="${esc(r.u.toLowerCase())}">
          <td>${esc(r.u)} <span class="chev">›</span></td>
          <td class="num">${r.plays}</td>
          <td class="num">${r.wins}</td>
          <td class="num">${r.best == null ? '—' : r.best + '%'}</td>
          <td class="num">${fmtTime(r.bestTime)}</td>
          <td class="num">${r.total ? accPill(r.acc) : '—'}</td>
          <td class="num">${r.avgAtt ?? '—'}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">Click a player to see their run history, or a column header to sort. Accuracy = correct ÷ all answers; avg tries→correct = attempts a right answer takes.</div></div>`;
}

// ── PLAYER DETAIL (drill-down: one player's run history) ────────────────────────
function renderPlayerDetail(username) {
  const plays = playsForUser(username);
  const atts = _data.attempts.filter(a => uname(a) === username);
  const wins = plays.filter(p => p.outcome === 'won').length;
  const losses = plays.filter(p => p.outcome === 'lost').length;
  const aband = plays.filter(p => p.outcome === 'abandoned').length;
  const correct = atts.filter(a => a.is_correct).length;
  const bestScore = plays.reduce((m, p) => Math.max(m, p.total_score ?? -1), -1);
  const bestTime = plays.filter(p => p.outcome === 'won').reduce((m, p) => m == null || p.best_time < m ? p.best_time : m, null);

  const crumb = `<div class="crumb"><span class="link" data-back="players">Players</span> <span class="crumb-sep">/</span> <b>${esc(username)}</b></div>`;
  const cards = `
    <div class="dash-grid">
      ${statCard(plays.length, 'Runs', `${wins} won · ${losses} caught · ${aband} quit`)}
      ${statCard(pct(wins, plays.length) + '%', 'Win rate')}
      ${statCard(bestScore < 0 ? '—' : bestScore + '%', 'Best score', bestTime != null ? 'Best time ' + fmtTime(bestTime) : '')}
      ${statCard(pct(correct, atts.length) + '%', 'Answer accuracy', `${correct}/${atts.length} correct`)}
    </div>`;

  const runRows = plays.map(p => {
    const n = attemptsForPlay(p.id).length;
    return `
      <tr class="row-link" data-run="${esc(p.id)}" data-player="${esc(username)}">
        <td>${fmtDateTime(p.started_at)} <span class="chev">›</span></td>
        <td>${outcomePill(p.outcome)}</td>
        <td class="num">${p.rooms_completed}/3</td>
        <td class="num">${p.total_score == null ? '—' : p.total_score + '%'}</td>
        <td class="num">${fmtTime(p.duration_sec)}</td>
        <td class="num">${n}</td>
        <td>${p.plearn ? '<span class="pill mid">P-Learn</span>' : ''} ${p.device === 'mobile' ? '📱' : '🖥'}</td>
      </tr>`;
  }).join('');

  return `${crumb}${cards}
    <div class="card"><h3>Run history</h3>
    <div class="dash-table-wrap"><table class="dash-table">
      <thead><tr><th>When</th><th>Outcome</th><th class="num">Reached</th><th class="num">Score</th><th class="num">Duration</th><th class="num">Answers</th><th>Mode</th></tr></thead>
      <tbody>${runRows || '<tr><td colspan="7" class="dash-empty">No runs.</td></tr>'}</tbody>
    </table></div>
    <div class="card-note">Click a run to see every answer and event from it.</div></div>`;
}

// ── RUN DETAIL (drill-down: everything from one run) ───────────────────────────
function renderRunDetail(username, playId) {
  const play = findPlay(playId);
  if (!play) return `<div class="crumb"><span class="link" data-back="players">Players</span></div>${emptyCard('Run not found.')}`;
  const player = uname(play);
  const atts = attemptsForPlay(playId);
  const evs = eventsForPlay(playId);

  const crumb = `<div class="crumb">
    <span class="link" data-back="players">Players</span> <span class="crumb-sep">/</span>
    <span class="link" data-back="player">${esc(player)}</span> <span class="crumb-sep">/</span>
    <b>Run · ${fmtDateTime(play.started_at)}</b></div>`;

  const cards = `
    <div class="dash-grid">
      ${statCard(outcomePill(play.outcome), 'Outcome')}
      ${statCard(fmtTime(play.duration_sec), 'Duration')}
      ${statCard(play.rooms_completed + '/3', 'Rooms cleared')}
      ${statCard(play.total_score == null ? '—' : play.total_score + '%', 'Score', (play.plearn ? 'P-Learn · ' : '') + (play.device || ''))}
    </div>`;

  // per-room breakdown
  const rooms = [1, 2, 3].map(rid => {
    const ra = atts.filter(a => a.room_id === rid);
    if (!ra.length) return '';
    const c = ra.filter(a => a.is_correct).length;
    const clear = evs.find(e => e.type === 'room_clear' && e.data?.room === rid);
    return `<div class="bar-row">
      <div class="bar-label">Room ${rid} · ${esc(ra[0].difficulty)}</div>
      <div class="bar-track"><div class="bar-fill ${accClass(pct(c, ra.length))}" style="width:${pct(c, ra.length)}%"></div></div>
      <div class="bar-val">${c}/${ra.length}${clear ? ' · ' + clear.data.score + '%' : ''}</div>
    </div>`;
  }).join('');

  const attRows = atts.map((a, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${a.room_id} · ${esc(a.difficulty || '')}</td>
      <td class="wide">${esc(a.question_text || a.qid)}</td>
      <td>${esc(a.selected_text ?? '—')}</td>
      <td>${a.is_correct ? '<span class="pill good">✓</span>' : '<span class="pill bad">✗</span>'}</td>
      <td class="num">${a.attempt_no}</td>
      <td class="num">${a.time_ms == null ? '—' : (a.time_ms / 1000).toFixed(1) + 's'}</td>
    </tr>`).join('');

  const evRows = evs.map(e => `
    <div class="evt"><span class="evt-time">${fmtDateTime(e.at)}</span>
      <span class="evt-type">${esc(e.type)}</span>
      <span class="evt-data">${esc(JSON.stringify(e.data))}</span></div>`).join('');

  return `${crumb}${cards}
    <div class="card"><h3>Per-room result</h3>${rooms || '<div class="dash-empty">No rooms reached.</div>'}</div>
    <div class="card"><h3>Every answer (${atts.length})</h3>
      <div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th class="num">#</th><th>Room</th><th class="wide">Question</th><th>Answered</th><th>Result</th><th class="num">Try</th><th class="num">Time</th></tr></thead>
        <tbody>${attRows || '<tr><td colspan="7" class="dash-empty">No answers.</td></tr>'}</tbody>
      </table></div></div>
    <div class="card"><h3>Event timeline (${evs.length})</h3>${evRows || '<div class="dash-empty">No events.</div>'}</div>`;
}

// ── BEHAVIOR ─────────────────────────────────────────────────────────────────
function renderBehavior() {
  const A = _data.attempts;
  if (!A.length) return emptyCard('No answers recorded yet.', '📝');

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
      ${statCard(pct(hintShown, A.length) + '%', 'Answers with a hint shown', `${plearnPlays} P-Learn runs`, 'amber')}
      ${statCard(timeouts, 'Question timeouts', 'ran out of time')}
      ${statCard(deaths, 'Deaths (caught)', 'too many wrong answers', 'red')}
      ${statCard(pct(mobile, _data.plays.length) + '%', 'Plays on mobile', `${_data.plays.length - mobile} on desktop`, 'blue')}
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
