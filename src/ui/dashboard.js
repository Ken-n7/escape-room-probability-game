import { fetchAllPlays, fetchAllAttempts, fetchAllEvents, fetchGameAccuracy } from '../net/scores.js';

// ═══════════════════════════════════════════════════════════════════════════════
//  ADMIN DASHBOARD — clean, non-game analytics UI. Renders into #dash-root.
//  Pulls raw rows (RLS gives admins everything) and aggregates client-side.
// ═══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: 'overview', label: 'Overview',      icon: '📊' },
  { id: 'players',  label: 'Players',       icon: '👥' },
  { id: 'items',    label: 'Item analysis', icon: '📝' },
  { id: 'behavior', label: 'Behavior',      icon: '🧠' },
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
  players: { key: 'lastMs',   dir: -1 },   // default: most recently active first
  items:   { key: 'firstAcc', dir:  1 },   // default: hardest (lowest first-try) first
};

// ── small helpers ──────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const uname = r => r.profiles?.username || '—';
const fmtTime = s => s == null ? '—' : s < 60 ? Math.round(s) + 's' : Math.floor(s / 60) + 'm ' + String(Math.round(s) % 60).padStart(2, '0') + 's';
const fmtDateTime = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtDay = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
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
const statCard = (value, label, sub = '', accent = '', icon = '') =>
  `<div class="stat-card${accent ? ' accent-' + accent : ''}">${icon ? `<div class="stat-icon">${icon}</div>` : ''}<div class="stat-value">${value}</div><div class="stat-label">${label}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
const emptyCard = (msg, emoji = '📊') => `<div class="dash-empty"><span class="emoji">${emoji}</span>${esc(msg)}</div>`;

// Status hues (won/lost/abandoned…) — semantic, always shipped with a labelled
// legend so identity never rests on colour alone.
const C_GOOD = '#16a34a', C_MID = '#d97706', C_BAD = '#dc2626', C_BLUE = '#2563eb', C_GREY = '#94a3b8';

// ── SVG charts (inline, CSP-safe, no libs) ──────────────────────────────────────
// Donut with a labelled legend + 2px gaps between segments. Center shows a headline.
function donutChart(segments, { centerValue = '', centerLabel = '' } = {}) {
  const live = segments.filter(s => s.value > 0);
  const total = live.reduce((s, x) => s + x.value, 0) || 1;
  const GAP = 1.4;                                  // circumference units → ~2px gap
  let cum = 0;
  const arcs = live.map(s => {
    const p = (s.value / total) * 100;
    const seg = Math.max(0.001, p - GAP);
    const c = `<circle class="donut-seg" cx="21" cy="21" r="15.9155" fill="none" stroke="${s.color}" stroke-width="5"
      stroke-dasharray="${seg.toFixed(3)} ${(100 - seg).toFixed(3)}" stroke-dashoffset="${(25 - cum).toFixed(3)}">
      <title>${esc(s.label)}: ${s.value} (${pct(s.value, total)}%)</title></circle>`;
    cum += p;
    return c;
  }).join('');
  const legend = segments.map(s => `
    <div class="lg-item"><span class="lg-dot" style="background:${s.color}"></span>
      <span class="lg-label">${esc(s.label)}</span>
      <span class="lg-val">${s.value} · ${pct(s.value, total)}%</span></div>`).join('');
  return `<div class="donut-wrap">
    <div class="donut">
      <svg viewBox="0 0 42 42" class="donut-svg" role="img">
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--line2)" stroke-width="5"></circle>
        ${arcs}
      </svg>
      <div class="donut-center"><div class="donut-value">${centerValue}</div><div class="donut-label">${esc(centerLabel)}</div></div>
    </div>
    <div class="chart-legend">${legend}</div>
  </div>`;
}

// Radial gauge for a single 0–100 metric.
function gaugeChart(value, { label = '', color = C_BLUE } = {}) {
  const p = Math.max(0, Math.min(100, value));
  return `<div class="donut gauge">
    <svg viewBox="0 0 42 42" class="donut-svg" role="img">
      <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--line2)" stroke-width="4.5"></circle>
      <circle cx="21" cy="21" r="15.9155" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round"
        stroke-dasharray="${p.toFixed(2)} ${(100 - p).toFixed(2)}" stroke-dashoffset="25"><title>${label}: ${value}%</title></circle>
    </svg>
    <div class="donut-center"><div class="donut-value">${value}%</div><div class="donut-label">${esc(label)}</div></div>
  </div>`;
}

// Area + line trend. Single blue series; native <title> tooltips on each point.
function areaChart(points, { unit = '' } = {}) {
  const W = 640, H = 150, padT = 10, padB = 8, padX = 6;
  const max = Math.max(1, ...points.map(p => p.value));
  const n = Math.max(1, points.length - 1);
  const X = i => padX + (i / n) * (W - padX * 2);
  const Y = v => padT + (1 - v / max) * (H - padT - padB);
  const pts = points.map((p, i) => `${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const area = `${padX},${(H - padB).toFixed(1)} ${pts} ${(W - padX).toFixed(1)},${(H - padB).toFixed(1)}`;
  const grid = [0.25, 0.5, 0.75].map(f => `<line class="ac-grid" x1="${padX}" x2="${W - padX}" y1="${(padT + f * (H - padT - padB)).toFixed(1)}" y2="${(padT + f * (H - padT - padB)).toFixed(1)}"></line>`).join('');
  const dots = points.map((p, i) => `<circle class="ac-dot" cx="${X(i).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="3"><title>${esc(p.full || p.label)}: ${p.value}${unit}</title></circle>`).join('');
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="area-chart" preserveAspectRatio="xMidYMid meet" role="img">
    <defs><linearGradient id="ac-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C_BLUE}" stop-opacity="0.26"/><stop offset="1" stop-color="${C_BLUE}" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <polygon class="ac-area" points="${area}" fill="url(#ac-grad)"></polygon>
    <polyline class="ac-line" points="${pts}" fill="none" stroke="${C_BLUE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
    ${dots}
  </svg>`;
  const labels = `<div class="ac-labels">${points.map(p => `<span>${esc(p.label)}</span>`).join('')}</div>`;
  return `<div class="ac-peak">Peak: ${max}${unit}</div>${svg}${labels}`;
}
const skeleton = () => `<div class="skel-grid">${'<div class="skel skel-card"></div>'.repeat(4)}</div><div class="skel skel-row"></div>`;

// ── learning-over-time (per player, from game_accuracy rows) ────────────────────
const accOf = (correct, n) => (n ? Math.round(correct / n * 100) : null);
// A player's runs, oldest→newest (game_accuracy is already ordered by started_at).
const gamesForUser = u => (_data.games || []).filter(g => g.username === u);

// Verdict from a player's timed (non-P-Learn) runs: compare recent-half first-try
// accuracy against early-half. P-Learn is excluded — its hints inflate accuracy,
// so it isn't an honest mastery signal.
function learningVerdict(username) {
  const pts = gamesForUser(username).filter(g => !g.plearn && g.ft_n > 0)
    .map(g => g.ft_correct / g.ft_n * 100);
  if (pts.length < 2) return { key: 'new', label: 'New', diff: null, n: pts.length };
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const half = Math.max(1, Math.floor(pts.length / 2));
  const diff = Math.round(mean(pts.slice(-half)) - mean(pts.slice(0, half)));
  const key = diff >= 8 ? 'up' : diff <= -8 ? 'down' : 'flat';
  return { key, label: { up: 'Improving', down: 'Declining', flat: 'Steady' }[key], diff, n: pts.length };
}
const TREND = { up: ['good', '↗'], down: ['bad', '↘'], flat: ['mid', '→'], new: ['', '–'] };
function trendPill(v) {
  const [cls, arrow] = TREND[v.key];
  const d = v.diff == null ? '' : ` ${v.diff > 0 ? '+' : ''}${v.diff}pt`;
  return `<span class="pill ${cls || 'flat-pill'}" title="Recent vs early first-try accuracy">${arrow} ${v.label}${d}</span>`;
}

// Multi-line chart on a fixed 0–100 accuracy scale. `series` = [{name,color,vals}]
// where vals may contain nulls (skipped). Native <title> tooltips on points.
function lineChart(labels, series) {
  const W = 660, H = 190, padT = 12, padB = 22, padL = 30, padR = 8;
  const n = Math.max(1, labels.length - 1);
  const X = i => padL + (i / n) * (W - padL - padR);
  const Y = v => padT + (1 - v / 100) * (H - padT - padB);
  const grid = [0, 25, 50, 75, 100].map(v => `
    <line class="ac-grid" x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"></line>
    <text class="lc-ylabel" x="${padL - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${v}</text>`).join('');
  const body = series.map(s => {
    const pline = s.vals.map((v, i) => v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).filter(Boolean).join(' ');
    const dots = s.vals.map((v, i) => v == null ? '' :
      `<circle class="lc-dot" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3" style="stroke:${s.color}">
        <title>${esc(s.name)} · ${esc(labels[i].tip)}: ${v}%</title></circle>`).join('');
    return `<polyline points="${pline}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>${dots}`;
  }).join('');
  // Thin the date labels when there are many games so they don't overlap.
  const step = labels.length > 9 ? Math.ceil(labels.length / 8) : 1;
  const xlabels = labels.map((l, i) => (i % step === 0 || i === labels.length - 1)
    ? `<text class="lc-xlabel" x="${X(i).toFixed(1)}" y="${H - 7}" text-anchor="middle">${esc(l.axis)}</text>` : '').join('');
  const legend = series.map(s => `<span class="lc-lg"><span class="lc-swatch" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('');
  return `<div class="lc-legend">${legend}</div>
    <svg viewBox="0 0 ${W} ${H}" class="line-chart" preserveAspectRatio="xMidYMid meet" role="img">${grid}${body}${xlabels}</svg>`;
}

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
    <div class="dash-shell">
      <aside class="dash-sidebar">
        <div class="dash-brand">Class Dashboard</div>
        <nav class="dash-nav">
          ${TABS.map(t => `<button class="dash-navitem${t.id === _tab ? ' active' : ''}" data-tab="${t.id}" type="button"><span class="nav-ico">${t.icon}</span>${t.label}</button>`).join('')}
        </nav>
        <button class="dash-navitem dash-back" id="dash-back" type="button"><span class="nav-ico">←</span>Back to game</button>
      </aside>
      <main class="dash-main">
        <header class="dash-pagehead">
          <div>
            <h1 class="dash-h1" id="dash-heading">Overview</h1>
            <div class="dash-sub" id="dash-sub">Loading…</div>
          </div>
          <div class="dash-actions">
            <button class="dash-btn" id="dash-refresh" type="button">↻ Refresh</button>
            <button class="dash-btn" id="dash-export" type="button">⬇ Export CSV</button>
          </div>
        </header>
        <div id="dash-body">${skeleton()}</div>
      </main>
    </div>`;

  root.querySelector('#dash-back').onclick    = () => _onBack?.();
  root.querySelector('#dash-refresh').onclick = () => refresh();
  root.querySelector('#dash-export').onclick  = () => exportCsv();
  root.querySelectorAll('.dash-navitem[data-tab]').forEach(btn => {
    btn.onclick = () => {
      _tab = btn.dataset.tab;
      _drill = null;                 // switching tabs leaves any drill-down
      root.querySelectorAll('.dash-navitem[data-tab]').forEach(b => b.classList.toggle('active', b === btn));
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
    const [plays, attempts, events, games] = await Promise.all([fetchAllPlays(), fetchAllAttempts(), fetchAllEvents(), fetchGameAccuracy()]);
    _data = { plays, attempts, events, games };
  } finally {
    _loading = false;
    if (btn) { btn.disabled = false; btn.innerHTML = '↻ Refresh'; }
  }
  render();
}

function render() {
  if (!_data) return;
  const heading = document.getElementById('dash-heading');
  if (heading) heading.textContent = _drill?.player || (TABS.find(t => t.id === _tab)?.label ?? 'Overview');
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
  const inProg = plays.filter(p => p.outcome === 'in_progress').length;
  const outcomes = [
    { label: 'Escaped',     value: wins,   color: C_GOOD },
    { label: 'Caught',      value: losses, color: C_BAD },
    { label: 'Quit',        value: aband,  color: C_MID },
    { label: 'In progress', value: inProg, color: C_GREY },
  ];
  const winRate = pct(wins, finished.length);

  return `
    <div class="dash-grid">
      ${statCard(plays.length, 'Total plays', `${players} unique player${players === 1 ? '' : 's'}`, 'blue', '🎮')}
      ${statCard(winRate + '%', 'Win rate', `${wins} won of ${finished.length} finished`, 'green', '🏆')}
      ${statCard(avgDur == null ? '—' : fmtTime(avgDur), 'Avg escape time', 'across winning runs', '', '⏱')}
      ${statCard(losses, 'Caught by ghost', `${aband} abandoned`, 'red', '👻')}
    </div>
    <div class="dash-2col">
      <div class="card"><h3>How runs end</h3>${donutChart(outcomes, { centerValue: plays.length, centerLabel: 'runs' })}
        <div class="card-note">Every run's final outcome. Center = total runs.</div></div>
      <div class="card"><h3>Win rate</h3>
        <div class="gauge-row">${gaugeChart(winRate, { label: 'escaped', color: C_GOOD })}
          <div class="gauge-side">
            <div class="gs-line"><b>${wins}</b> escaped</div>
            <div class="gs-line"><b>${losses}</b> caught</div>
            <div class="gs-line"><b>${aband}</b> quit</div>
            <div class="gs-line muted">of ${finished.length} finished runs</div>
          </div></div></div>
    </div>
    <div class="card"><h3>Completion funnel</h3>${funnelRows(funnel)}
      <div class="card-note">How far players get before finishing, losing, or quitting.</div></div>
    <div class="card"><h3>Plays over the last 14 days</h3>${areaChart(days, { unit: '' })}</div>`;
}

function playsByDay(plays, days = 14) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const keys = [], map = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    map.set(key, 0);
    keys.push({ key, label: i % 2 === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : '', full: `${d.getMonth() + 1}/${d.getDate()}` });
  }
  for (const p of plays) { const k = (p.started_at || '').slice(0, 10); if (map.has(k)) map.set(k, map.get(k) + 1); }
  return keys.map(k => ({ label: k.label, full: k.full, value: map.get(k.key) || 0 }));
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
// Per-player roster row, built from the per-game rows (server-aggregated, so
// first-try accuracy here is correct — not truncated by the API row cap).
function rosterStats() {
  const byU = new Map();
  for (const g of (_data.games || [])) {
    if (!byU.has(g.username)) byU.set(g.username, { u: g.username, games: 0, timed: 0, wins: 0, ftN: 0, ftC: 0, days: new Set(), lastMs: 0 });
    const r = byU.get(g.username);
    r.games++;
    r.lastMs = Math.max(r.lastMs, new Date(g.started_at).getTime());
    r.days.add((g.started_at || '').slice(0, 10));
    if (g.outcome === 'won') r.wins++;
    if (!g.plearn) { r.timed++; r.ftN += g.ft_n; r.ftC += g.ft_correct; }
  }
  return [...byU.values()].map(r => {
    const v = learningVerdict(r.u);
    return { ...r, days: r.days.size, ftAcc: accOf(r.ftC, r.ftN), trend: v, trendDiff: v.diff };
  });
}

function renderPlayers() {
  if (!(_data.games || []).length) return emptyCard('No players have played yet.', '🎮');
  const rows = applySort(rosterStats(), _sort.players);
  return `
    <div class="card">
    <div class="card-toolbar"><h3>Class progress — who's learning</h3>${searchBox('players', 'Search players…')}</div>
    <div class="dash-table-wrap"><table class="dash-table">
      <thead><tr>
        ${th('players', 'u', 'Player')}${th('players', 'trendDiff', 'Trend')}
        ${th('players', 'ftAcc', 'First-try acc', 'num')}${th('players', 'games', 'Games', 'num')}
        ${th('players', 'timed', 'Timed', 'num')}${th('players', 'days', 'Days', 'num')}
        ${th('players', 'wins', 'Wins', 'num')}${th('players', 'lastMs', 'Last played', 'num')}
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr class="row-link" data-player="${esc(r.u)}" data-search="${esc(r.u.toLowerCase())}">
          <td>${esc(r.u)} <span class="chev">›</span></td>
          <td>${trendPill(r.trend)}</td>
          <td class="num">${r.ftAcc == null ? '—' : accPill(r.ftAcc)}</td>
          <td class="num">${r.games}</td>
          <td class="num">${r.timed}</td>
          <td class="num">${r.days}</td>
          <td class="num">${r.wins}</td>
          <td class="num">${r.lastMs ? fmtDateTime(new Date(r.lastMs).toISOString()) : '—'}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">Click a player for their learning curve. Trend = recent vs early first-try accuracy on timed runs (P-Learn practice excluded — its hints inflate accuracy). Sort by Trend to surface who's slipping.</div></div>`;
}

// ── PLAYER DETAIL (drill-down: one player's learning over their games) ──────────
function verdictText(v) {
  if (v.key === 'new') return v.n === 0 ? 'No timed runs yet — only P-Learn practice.' : 'Needs a few timed runs before a trend shows.';
  const d = Math.abs(v.diff);
  if (v.key === 'up')   return `First-try accuracy is up ${d} points vs their early games — they're learning.`;
  if (v.key === 'down') return `First-try accuracy is down ${d} points vs their early games — they're slipping.`;
  return `Holding steady (${v.diff >= 0 ? '+' : ''}${v.diff} points vs early games).`;
}

function renderPlayerDetail(username) {
  const crumb = `<div class="crumb"><span class="link" data-back="players">Players</span> <span class="crumb-sep">/</span> <b>${esc(username)}</b></div>`;
  const gs = gamesForUser(username);
  if (!gs.length) return `${crumb}${emptyCard('No games recorded for this player yet.', '🎮')}`;

  const timed = gs.filter(g => !g.plearn);
  const v = learningVerdict(username);
  const wins = gs.filter(g => g.outcome === 'won').length;
  const days = new Set(gs.map(g => (g.started_at || '').slice(0, 10))).size;
  const bestScore = gs.reduce((m, g) => Math.max(m, g.total_score ?? -1), -1);
  const bestTime = gs.filter(g => g.outcome === 'won' && g.best_time != null).reduce((m, g) => (m == null || g.best_time < m ? g.best_time : m), null);
  const ftN = timed.reduce((s, g) => s + g.ft_n, 0), ftC = timed.reduce((s, g) => s + g.ft_correct, 0);

  const banner = `<div class="verdict v-${v.key}">${trendPill(v)}<span class="v-text">${verdictText(v)}</span></div>`;

  const cards = `
    <div class="dash-grid">
      ${statCard(gs.length, 'Games played', `${timed.length} timed · ${gs.length - timed.length} practice`, '', '🎮')}
      ${statCard(days, 'Days active', `last ${fmtDateTime(gs[gs.length - 1].started_at)}`, '', '📅')}
      ${statCard(ftN ? accOf(ftC, ftN) + '%' : '—', 'First-try accuracy', 'across timed runs', 'blue', '🎯')}
      ${statCard(bestScore < 0 ? '—' : bestScore + '%', 'Best score', bestTime != null ? 'best time ' + fmtTime(bestTime) : `${wins} escaped`, 'green', '🏆')}
    </div>`;

  const mk = (nk, ck) => timed.map(g => accOf(g[ck], g[nk]));
  const labels = timed.map((g, i) => ({ axis: fmtDay(g.started_at), tip: `G${i + 1} · ${fmtDay(g.started_at)}` }));
  const chart = timed.length
    ? `${lineChart(labels, [
        { name: 'Overall',  color: '#0f172a', vals: timed.map(g => accOf(g.ft_correct, g.ft_n)) },
        { name: 'Easy',     color: C_GOOD,    vals: mk('easy_n', 'easy_correct') },
        { name: 'Moderate', color: C_MID,     vals: mk('mod_n', 'mod_correct') },
        { name: 'Hard',     color: C_BAD,     vals: mk('hard_n', 'hard_correct') },
      ])}
      <div class="card-note">Each point is one timed run, oldest → newest — hover for the date. Rising line = learning; flat = stuck; falling = slipping.</div>`
    : emptyCard('No timed runs yet — the learning curve needs real (non-P-Learn) games.', '📈');

  const runRows = [...gs].reverse().map(g => {
    const p = findPlay(g.play_id);
    const ftAcc = accOf(g.ft_correct, g.ft_n);
    return `
      <tr class="row-link" data-run="${esc(g.play_id)}" data-player="${esc(username)}">
        <td>${fmtDateTime(g.started_at)} <span class="chev">›</span></td>
        <td>${outcomePill(g.outcome)}</td>
        <td class="num">${p ? p.rooms_completed + '/3' : '—'}</td>
        <td class="num">${g.total_score == null ? '—' : g.total_score + '%'}</td>
        <td class="num">${ftAcc == null ? '—' : ftAcc + '%'}</td>
        <td>${g.plearn ? '<span class="pill mid">P-Learn</span>' : '<span class="pill good">Timed</span>'}</td>
      </tr>`;
  }).join('');

  return `${crumb}${banner}${cards}
    <div class="card"><h3>First-try accuracy across games</h3>${chart}</div>
    <div class="card"><h3>Every game (newest first)</h3>
    <div class="dash-table-wrap"><table class="dash-table">
      <thead><tr><th>When</th><th>Outcome</th><th class="num">Reached</th><th class="num">Score</th><th class="num">First-try</th><th>Mode</th></tr></thead>
      <tbody>${runRows || '<tr><td colspan="6" class="dash-empty">No games.</td></tr>'}</tbody>
    </table></div>
    <div class="card-note">Click a game to see every answer and event from it.</div></div>`;
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
  const desktop = _data.plays.filter(p => p.device !== 'mobile').length;
  const devices = [
    { label: 'Desktop', value: desktop, color: C_BLUE },
    { label: 'Mobile',  value: mobile,  color: C_MID },
  ];

  return `
    <div class="dash-grid">
      ${statCard(pct(hintShown, A.length) + '%', 'Answers with a hint shown', `${plearnPlays} P-Learn runs`, 'amber', '💡')}
      ${statCard(timeouts, 'Question timeouts', 'ran out of time', '', '⏳')}
      ${statCard(deaths, 'Deaths (caught)', 'too many wrong answers', 'red', '💀')}
      ${statCard(pct(mobile, _data.plays.length) + '%', 'Plays on mobile', `${desktop} on desktop`, 'blue', '📱')}
    </div>
    <div class="dash-2col">
      <div class="card"><h3>First-try accuracy by difficulty</h3>${barRows(accByDiff, { colorByValue: true })}
        <div class="card-note">% who nailed it on the first attempt — the cleanest signal of mastery.</div></div>
      <div class="card"><h3>Avg attempts to get it right</h3>${barRows(triesByDiff)}
        <div class="card-note">Higher = players needed more tries before answering correctly.</div></div>
    </div>
    <div class="dash-2col">
      <div class="card"><h3>Device split</h3>${donutChart(devices, { centerValue: _data.plays.length, centerLabel: 'plays' })}</div>
      <div class="card"><h3>Where players struggle</h3>
        <div class="mini-stats">
          <div class="ms-row"><span>Ran out of time</span><b>${timeouts}×</b></div>
          <div class="ms-row"><span>Caught by the ghost</span><b>${deaths}×</b></div>
          <div class="ms-row"><span>Needed a hint</span><b>${hintShown}×</b></div>
          <div class="ms-row"><span>Practiced in P-Learn</span><b>${plearnPlays} runs</b></div>
        </div>
        <div class="card-note">Signals of friction — high timeouts or deaths flag content that's too hard or unclear.</div></div>
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
