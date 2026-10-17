import { fetchGameAccuracy, fetchOverviewStats, fetchItemStats, fetchBehaviorStats, fetchRunDetail, fetchStudents, adminPlayerAction } from '../net/scores.js';
import { donutChart, gaugeChart, areaChart, lineChart, barChart, icon, mountCharts, mountIcons, resetCharts } from './charts.js';

// ═══════════════════════════════════════════════════════════════════════════════
//  ADMIN DASHBOARD — clean, non-game analytics UI. Renders into #dash-root.
//  Pulls raw rows (RLS gives admins everything) and aggregates client-side.
// ═══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: 'overview', label: 'Overview',      icon: 'layout-dashboard' },
  { id: 'players',  label: 'Players',       icon: 'users' },
  { id: 'dailies',  label: 'Daily boards',  icon: 'calendar' },
  { id: 'items',    label: 'Item analysis', icon: 'clipboard-list' },
  { id: 'behavior', label: 'Behavior',      icon: 'brain' },
];

let _data = null;        // { plays, attempts, events }
let _tab = 'overview';
let _onBack = null;
let _loading = false;
let _drill = null;       // null | { player } | { player, playId } — drill-down view
let _keyBound = false;   // Escape handler bound once, guarded across remounts

// Daily boards tab: which calendar day (local) + which board to show.
const _daily = { date: new Date(), board: 'escape' };

// Per-table interactive state (search box text + sorted column).
const _query = { players: '', items: '' };
const _filter = { players: 'all' };   // all | active | never (never-played accounts)
const _sel = new Map();               // Players tab bulk selection: uid → username
const _sort  = {
  players: { key: 'lastMs',   dir: -1 },   // default: most recently active first
  items:   { key: 'firstAcc', dir:  1 },   // default: hardest (lowest first-try) first
};

// ── small helpers ──────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const fmtTime = s => s == null ? '—' : s < 60 ? Math.round(s) + 's' : Math.floor(s / 60) + 'm ' + String(Math.round(s) % 60).padStart(2, '0') + 's';
const fmtDateTime = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtDay = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
const accClass = v => v >= 75 ? 'good' : v >= 50 ? 'mid' : 'bad';
const accPill = v => `<span class="pill ${accClass(v)}">${v}%</span>`;
const OUTCOME = { won: ['good', 'Escaped'], lost: ['bad', 'Caught'], abandoned: ['mid', 'Quit'], in_progress: ['mid', 'In progress'] };
const outcomePill = o => { const [c, t] = OUTCOME[o] || ['mid', o]; return `<span class="pill ${c}">${t}</span>`; };

// drill-down data slicing
const gameByPlay = id => (_data.games || []).find(g => g.play_id === id);
const _runCache  = {};   // playId → { attempts, events }, fetched on demand

// ── HTML/CSS mini-charts (funnel + per-room bars stay inline; the rest are Chart.js) ─
function funnelRows(steps) {
  const top = steps[0]?.value || 1;
  return steps.map(s => `
    <div class="funnel-row">
      <div class="bar-label">${esc(s.label)}</div>
      <div class="funnel-track"><div class="funnel-fill" style="width:${Math.max(4, Math.round(s.value / top * 100))}%">${s.value}</div></div>
      <div class="bar-val">${pct(s.value, top)}%</div>
    </div>`).join('');
}
const statCard = (value, label, sub = '', accent = '', ico = '') =>
  `<div class="stat-card${accent ? ' accent-' + accent : ''}">${ico ? `<div class="stat-icon">${icon(ico)}</div>` : ''}<div class="stat-value">${value}</div><div class="stat-label">${label}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
const emptyCard = (msg, emoji = '📊') => `<div class="dash-empty"><span class="emoji">${emoji}</span>${esc(msg)}</div>`;

// Status hues (won/lost/abandoned…) — semantic, always shipped with a labelled
// legend so identity never rests on colour alone.
const C_GOOD = '#16a34a', C_MID = '#d97706', C_BAD = '#dc2626', C_BLUE = '#2563eb', C_GREY = '#94a3b8';

// Donut / gauge / area / line / bar charts now come from ./charts.js (Chart.js).
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
  const st = tab === 'players' ? _filter.players : 'all';
  document.querySelectorAll('#dash-body .dash-table tbody tr[data-search]').forEach(tr => {
    const hide = (!!q && !(tr.dataset.search || '').includes(q)) || (st !== 'all' && tr.dataset.status !== st);
    tr.classList.toggle('filtered-out', hide);
    if (hide) { const cb = tr.querySelector('.sel'); if (cb) _sel.delete(cb.dataset.uid); }   // selection = what you see
  });
  if (tab === 'players') syncBulk();
}

// Reflect _sel in the checkboxes, the select-all box and the bulk bar (no re-render).
function syncBulk() {
  const bar = document.getElementById('bulk-bar');
  if (!bar) return;
  document.querySelectorAll('#dash-body .sel').forEach(cb => { cb.checked = _sel.has(cb.dataset.uid); });
  bar.hidden = !_sel.size;
  document.getElementById('bulk-count').textContent = `${_sel.size} selected`;
  const vis = [...document.querySelectorAll('#dash-body tbody tr:not(.filtered-out) .sel')];
  const all = document.getElementById('sel-all'), n = vis.filter(cb => cb.checked).length;
  all.checked = !!vis.length && n === vis.length;
  all.indeterminate = n > 0 && n < vis.length;
}

// ── shell ────────────────────────────────────────────────────────────────────
export async function mountDashboard({ onBack } = {}) {
  _onBack = onBack;
  const root = document.getElementById('dash-root');
  root.innerHTML = `
    <div class="dash-shell">
      <aside class="dash-sidebar">
        <div class="dash-brand">Dashboard</div>
        <nav class="dash-nav">
          ${TABS.map(t => `<button class="dash-navitem${t.id === _tab ? ' active' : ''}" data-tab="${t.id}" type="button"><span class="nav-ico">${icon(t.icon)}</span>${t.label}</button>`).join('')}
        </nav>
        <button class="dash-navitem dash-back" id="dash-back" type="button" aria-label="Back to game"><span class="nav-ico">${icon('arrow-left')}</span><span class="nav-label">Back to game</span></button>
      </aside>
      <main class="dash-main">
        <header class="dash-pagehead">
          <div>
            <h1 class="dash-h1" id="dash-heading" tabindex="-1">Overview</h1>
            <div class="dash-sub" id="dash-sub">Loading…</div>
          </div>
          <div class="dash-actions">
            <button class="dash-btn" id="dash-refresh" type="button"><span class="nav-ico">${icon('refresh-cw')}</span><span class="btn-txt">Refresh</span></button>
            <button class="dash-btn" id="dash-export" type="button"><span class="nav-ico">${icon('download')}</span>Export CSV</button>
          </div>
        </header>
        <div id="dash-body">${skeleton()}</div>
      </main>
      <div id="dash-toast" class="dash-toast" role="status" aria-live="polite"></div>
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
    const chip = e.target.closest('.dly-chip');
    if (chip) { _daily.board = chip.dataset.board; render(); return; }
    const sortTh = e.target.closest('[data-sort]');
    if (sortTh) {
      const tab = sortTh.dataset.sortTab, key = sortTh.dataset.sort, s = _sort[tab];
      if (s.key === key) s.dir = -s.dir;                       // toggle direction
      else { s.key = key; s.dir = (key === 'u' || key === 'diff' || key === 'qid') ? 1 : -1; }
      render(); return;
    }
    if (e.target.closest('.sel-cell')) return;           // checkboxes: handled on 'change', never drill in
    const chipP = e.target.closest('.pf-chip');
    if (chipP) { _filter.players = chipP.dataset.pf; render(); return; }
    const act = e.target.closest('[data-act]');
    if (act) { managePlayers(act.dataset.act, [{ uid: act.dataset.uid, name: act.dataset.name }]); return; }
    const bulk = e.target.closest('[data-bulk]');
    if (bulk) {
      if (bulk.dataset.bulk === 'clear') { _sel.clear(); syncBulk(); return; }
      managePlayers(bulk.dataset.bulk, [..._sel].map(([uid, name]) => ({ uid, name }))); return;
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

  // Daily boards date picker — rebuild that day's board on change.
  dashBody.addEventListener('change', e => {
    const cb = e.target.closest('.sel');
    if (cb) { cb.checked ? _sel.set(cb.dataset.uid, cb.dataset.name) : _sel.delete(cb.dataset.uid); syncBulk(); return; }
    if (e.target.id === 'sel-all') {
      document.querySelectorAll('#dash-body tbody tr:not(.filtered-out) .sel').forEach(c => {
        e.target.checked ? _sel.set(c.dataset.uid, c.dataset.name) : _sel.delete(c.dataset.uid);
      });
      syncBulk(); return;
    }
    const d = e.target.closest('#dly-date');
    if (!d || !d.value) return;
    const [y, m, day] = d.value.split('-').map(Number);
    _daily.date = new Date(y, m - 1, day);   // local midnight, immune to TZ drift
    render();
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

  mountIcons(root);                 // paint the sidebar/header Lucide glyphs
  if (_data) render(); else await refresh();
}

// Transient status message (role=status region lives in the shell, so it's announced).
let _toastT;
function toast(msg) {
  const t = document.getElementById('dash-toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => t.classList.remove('show'), 4500);
}

const ago = ms => { const d = (Date.now() - ms) / 864e5; return d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.floor(d)} days ago`; };

// Reset (wipe progress, keep accounts) or remove (delete accounts) for one or many
// players. A native <dialog> gives focus trap + Esc + aria-modal. The dialog spells
// out the cost, and removing (or any bulk action) needs a typed phrase.
function managePlayers(kind, targets) {
  if (!targets.length) return;
  const remove = kind === 'remove', one = targets.length === 1, n = targets.length;
  const games = targets.reduce((t, x) => t + gamesForUser(x.name).length, 0);
  const gTxt = `${games} game${games === 1 ? '' : 's'}`;
  const verb = remove ? 'Remove' : 'Reset';
  const label = one ? (remove ? 'Remove player' : 'Reset progress') : `${verb} ${n} players`;
  const names = targets.slice(0, 5).map(x => `<b>${esc(x.name)}</b>`).join(', ') + (n > 5 ? ` and ${n - 5} more` : '');
  const last = one ? Math.max(0, ...gamesForUser(targets[0].name).map(g => new Date(g.started_at).getTime())) : 0;
  const cost = one ? (games ? `Last played ${ago(last)} · ${gTxt}.` : 'No games recorded.') : `${gTxt} in total.`;
  const phrase = remove ? (one ? targets[0].name : `REMOVE ${n}`) : (one ? '' : `RESET ${n}`);
  const same = v => v.trim().toLowerCase() === phrase.toLowerCase();

  const dlg = document.createElement('dialog');
  dlg.className = 'dash-dlg';
  dlg.setAttribute('aria-labelledby', 'dlg-title');
  dlg.setAttribute('aria-describedby', 'dlg-desc');
  dlg.innerHTML = `
    <form>
      <h2 id="dlg-title">${label}?</h2>
      <p id="dlg-desc">${remove
        ? `${names}${one ? "'s account and all their data" : ' — accounts and all their data'} will be permanently deleted.`
        : `All data for ${names} will be wiped; ${one ? 'they keep their account' : 'they keep their accounts'} and can start fresh.`}
        <span class="dlg-cost">${cost}</span> This can't be undone.</p>
      ${phrase ? `<label for="dlg-type">Type <b>${esc(phrase)}</b> to confirm</label>
        <input id="dlg-type" autocomplete="off" autocapitalize="off" spellcheck="false">` : ''}
      <div class="dlg-err" role="alert"></div>
      <div class="dlg-actions">
        <button type="button" class="dash-btn" data-cancel>Cancel</button>
        <button type="submit" class="dash-btn danger-fill" ${phrase ? 'disabled' : ''}>${label}</button>
      </div>
    </form>`;
  document.getElementById('dash-root').appendChild(dlg);

  const form = dlg.querySelector('form'), ok = form.querySelector('[type=submit]');
  const input = dlg.querySelector('#dlg-type'), err = dlg.querySelector('.dlg-err');
  let busy = false;
  const close = () => { if (!busy) dlg.close(); };
  input?.addEventListener('input', () => { ok.disabled = !same(input.value); });
  dlg.querySelector('[data-cancel]').onclick = close;
  dlg.addEventListener('cancel', e => { if (busy) e.preventDefault(); });          // Esc is blocked mid-request
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });          // backdrop click
  dlg.addEventListener('close', () => dlg.remove());
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy || ok.disabled) return;
    busy = true; ok.disabled = true; ok.textContent = remove ? 'Removing…' : 'Resetting…'; err.textContent = '';
    const msg = await adminPlayerAction(remove ? 'admin_remove_players' : 'admin_reset_players', targets.map(x => x.uid));
    busy = false;
    if (msg) {
      err.textContent = `Couldn't ${label.toLowerCase()}: ${msg}. Nothing was changed.`;
      ok.textContent = label; ok.disabled = !!input && !same(input.value);
      return;
    }
    dlg.close();
    _sel.clear(); syncBulk();                               // hide the bulk bar now, not after the refetch
    _drill = null;
    toast(one ? (remove ? `${targets[0].name} was removed.` : `${targets[0].name}'s progress was reset.`)
              : `${n} players ${remove ? 'removed' : 'reset'}.`);
    await refresh(true);
    document.getElementById('dash-heading')?.focus();       // focus was on a now-gone control
  });

  dlg.showModal();
  (input || dlg.querySelector('[data-cancel]')).focus();   // safe default: never land on the destructive button
}

const setBtnText = (btn, txt) => { const t = btn?.querySelector('.btn-txt'); if (t) t.textContent = txt; };

async function refresh(quiet = false) {
  if (_loading) return;
  _loading = true;
  const btn = document.getElementById('dash-refresh');
  if (btn) { btn.disabled = true; btn.classList.add('spinning'); setBtnText(btn, 'Refreshing…'); }
  const body = document.getElementById('dash-body');
  if (body && !quiet) { resetCharts(); body.innerHTML = skeleton(); }   // quiet = keep the table (and scroll) in place
  try {
    const [overview, items, behavior, games, students] = await Promise.all([
      fetchOverviewStats(), fetchItemStats(), fetchBehaviorStats(), fetchGameAccuracy(), fetchStudents(),
    ]);
    _data = { overview, items, behavior, games, students };
  } finally {
    _loading = false;
    if (btn) { btn.disabled = false; btn.classList.remove('spinning'); setBtnText(btn, 'Refresh'); }
  }
  render();
}

// Instantiate Chart.js canvases + Lucide glyphs for whatever was just written.
function afterRender(root) { mountIcons(root); mountCharts(); }

function render() {
  if (!_data) return;
  resetCharts();                    // tear down the previous view's live charts
  const heading = document.getElementById('dash-heading');
  if (heading) heading.textContent = _drill?.player || (TABS.find(t => t.id === _tab)?.label ?? 'Overview');
  const sub = document.getElementById('dash-sub');
  if (sub) {
    const o = _data.overview || {};
    sub.textContent = `${o.players || 0} player${o.players === 1 ? '' : 's'} · ${o.total_plays || 0} plays · ${o.total_answers || 0} answers logged`;
  }
  const body = document.getElementById('dash-body');
  if (!body) return;

  // Drill-down views take over the body; a tab click clears _drill.
  if (_drill?.playId) { renderRunDetailInto(body, _drill.player, _drill.playId); afterRender(body); return; }
  if (_drill?.player) { body.innerHTML = renderPlayerDetail(_drill.player); afterRender(body); return; }

  body.innerHTML =
    _tab === 'overview' ? renderOverview()
    : _tab === 'items'  ? renderItems()
    : _tab === 'players' ? renderPlayers()
    : _tab === 'dailies' ? renderDailyBoard()
    : renderBehavior();

  // Restore the active search filter after any full-body rebuild (e.g. re-sort).
  if (_tab === 'players' || _tab === 'items') applyFilter(_tab);
  afterRender(body);
}

// ── OVERVIEW ─────────────────────────────────────────────────────────────────
function renderOverview() {
  const o = _data.overview;
  if (!o || !o.total_plays) return emptyCard('No plays recorded yet. Play a run (while signed in) to see data here.', '👻');

  const wins = o.won, losses = o.lost, aband = o.abandoned, inProg = o.in_progress;
  const finished = o.finished, avgDur = o.avg_win_sec;
  const winRate = pct(wins, finished);
  const funnel = [
    { label: 'Started',        value: o.total_plays },
    { label: 'Cleared Room 1', value: o.reached1 },
    { label: 'Cleared Room 2', value: o.reached2 },
    { label: 'Cleared Room 3', value: o.reached3 },
    { label: 'Escaped',        value: wins },
  ];
  const days = daysTrend(o.by_day || [], 14);
  const outcomes = [
    { label: 'Escaped',     value: wins,   color: C_GOOD },
    { label: 'Caught',      value: losses, color: C_BAD },
    { label: 'Quit',        value: aband,  color: C_MID },
    { label: 'In progress', value: inProg, color: C_GREY },
  ];

  return `
    <div class="dash-grid">
      ${statCard(o.total_plays, 'Total plays', `${o.players} unique player${o.players === 1 ? '' : 's'}`, 'blue', 'gamepad-2')}
      ${statCard(winRate + '%', 'Win rate', `${wins} won of ${finished} finished`, 'green', 'trophy')}
      ${statCard(avgDur == null ? '—' : fmtTime(avgDur), 'Avg escape time', 'across winning runs', '', 'timer')}
      ${statCard(losses, 'Caught by ghost', `${aband} abandoned`, 'red', 'ghost')}
    </div>
    <div class="dash-2col">
      <div class="card"><h3>How runs end</h3>${donutChart(outcomes, { centerValue: o.total_plays, centerLabel: 'runs' })}
        <div class="card-note">Every run's final outcome. Center = total runs.</div></div>
      <div class="card"><h3>Win rate</h3>
        <div class="gauge-row">${gaugeChart(winRate, { label: 'escaped', color: C_GOOD })}
          <div class="gauge-side">
            <div class="gs-line"><b>${wins}</b> escaped</div>
            <div class="gs-line"><b>${losses}</b> caught</div>
            <div class="gs-line"><b>${aband}</b> quit</div>
            <div class="gs-line muted">of ${finished} finished runs</div>
          </div></div></div>
    </div>
    <div class="card"><h3>Completion funnel</h3>${funnelRows(funnel)}
      <div class="card-note">How far players get before finishing, losing, or quitting.</div></div>
    <div class="card"><h3>Plays over the last 14 days</h3>${areaChart(days, { unit: '' })}</div>`;
}

// Turn the server's sparse [{d,n}] day counts into a dense 14-day series.
function daysTrend(byDay, days = 14) {
  const counts = new Map(byDay.map(r => [String(r.d).slice(0, 10), r.n]));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const full = `${d.getMonth() + 1}/${d.getDate()}`;
    out.push({ label: i % 2 === 0 ? full : '', full, value: counts.get(key) || 0 });
  }
  return out;
}

// ── ITEM ANALYSIS ──────────────────────────────────────────────────────────────
// Server already aggregated per question (item_stats RPC) — just shape for display.
function itemStats() {
  return (_data.items || []).map(r => ({
    qid: r.qid, text: r.question_text || r.qid, diff: r.difficulty || '', room: r.room_id,
    n: r.n,
    firstAcc: pct(r.first_correct, r.first_n),
    avgTime: Math.round((r.avg_time_ms || 0) / 100) / 10,
    topWrong: r.top_wrong ? `${r.top_wrong} (${r.top_wrong_n}×)` : '—',
  })).sort((a, b) => a.firstAcc - b.firstAcc);
}

function renderItems() {
  if (!(_data.items || []).length) return emptyCard('No answers recorded yet.', '📝');
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
    <div class="card"><h3>Hardest questions (lowest first-try accuracy)</h3>${barChart(hardest, { colorByValue: true })}
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
  const blank = (u, uid) => ({ u, uid, games: 0, timed: 0, wins: 0, ftN: 0, ftC: 0, days: new Set(), lastMs: 0 });
  for (const s of (_data.students || [])) byU.set(s.username, blank(s.username, s.id));   // incl. never-played
  for (const g of (_data.games || [])) {
    if (!byU.has(g.username)) byU.set(g.username, blank(g.username, g.user_id));
    const r = byU.get(g.username);
    r.games++;
    r.lastMs = Math.max(r.lastMs, new Date(g.started_at).getTime());
    r.days.add((g.started_at || '').slice(0, 10));
    if (g.outcome === 'won') r.wins++;
    if (!g.plearn) { r.timed++; r.ftN += g.ft_n; r.ftC += g.ft_correct; }
  }
  return [...byU.values()].map(r => {
    const v = learningVerdict(r.u);
    return { ...r, days: r.days.size, ftAcc: accOf(r.ftC, r.ftN), trend: v, trendDiff: v.diff, never: r.games === 0 };
  });
}

function renderPlayers() {
  const all = rosterStats();
  if (!all.length) return emptyCard('No players yet.', '🎮');
  const rows = applySort(all, _sort.players);
  const nNever = all.filter(r => r.never).length;
  const chips = [['all', 'All', all.length], ['active', 'Active', all.length - nNever], ['never', 'Never played', nNever]]
    .map(([k, t, n]) => `<button type="button" class="pf-chip${_filter.players === k ? ' active' : ''}" data-pf="${k}" aria-pressed="${_filter.players === k}">${t} <span class="pf-n">${n}</span></button>`).join('');
  return `
    <div class="card">
    <div class="card-toolbar"><h3>Class progress — who's learning</h3>${searchBox('players', 'Search players…')}</div>
    <div class="pf-chips" role="group" aria-label="Filter players">${chips}</div>
    <div class="bulk-bar" id="bulk-bar" hidden>
      <span class="bulk-count" id="bulk-count" role="status"></span>
      <button type="button" class="dash-btn danger" data-bulk="reset"><span class="nav-ico">${icon('rotate-ccw')}</span>Reset selected</button>
      <button type="button" class="dash-btn danger" data-bulk="remove"><span class="nav-ico">${icon('trash-2')}</span>Remove selected</button>
      <button type="button" class="dash-btn" data-bulk="clear">Clear</button>
    </div>
    <div class="dash-table-wrap"><table class="dash-table">
      <thead><tr>
        <th class="sel-cell"><label class="sel-hit"><input type="checkbox" id="sel-all" aria-label="Select all shown players"></label></th>
        ${th('players', 'u', 'Player')}${th('players', 'trendDiff', 'Trend')}
        ${th('players', 'ftAcc', 'First-try acc', 'num')}${th('players', 'games', 'Games', 'num')}
        ${th('players', 'timed', 'Timed', 'num')}${th('players', 'days', 'Days', 'num')}
        ${th('players', 'wins', 'Wins', 'num')}${th('players', 'lastMs', 'Last played', 'num')}
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr class="row-link" data-player="${esc(r.u)}" data-search="${esc(r.u.toLowerCase())}" data-status="${r.never ? 'never' : 'active'}">
          <td class="sel-cell"><label class="sel-hit"><input type="checkbox" class="sel" data-uid="${esc(r.uid)}" data-name="${esc(r.u)}" aria-label="Select ${esc(r.u)}"${_sel.has(r.uid) ? ' checked' : ''}></label></td>
          <td>${esc(r.u)}${r.never ? ' <span class="pill mid">No games yet</span>' : ''} <span class="chev">›</span></td>
          <td>${trendPill(r.trend)}</td>
          <td class="num">${r.ftAcc == null ? '—' : accPill(r.ftAcc)}</td>
          <td class="num">${r.games}</td>
          <td class="num">${r.timed}</td>
          <td class="num">${r.days}</td>
          <td class="num">${r.wins}</td>
          <td class="num">${r.lastMs ? fmtDateTime(new Date(r.lastMs).toISOString()) : '—'}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">Click a player for their learning curve; tick boxes to reset or remove several at once. Trend = recent vs early first-try accuracy on timed runs (P-Learn practice excluded — its hints inflate accuracy). Sort by Trend to surface who's slipping.</div></div>`;
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
  const uid = gs[0]?.user_id || (_data.students || []).find(s => s.username === username)?.id;
  const manage = uid ? `<div class="card danger-zone"><h3>Manage player</h3>
    <div class="card-note">Reset clears their games but keeps the account. Remove deletes the account and all its data. Neither can be undone.</div>
    <div class="manage-bar">${[['reset', 'rotate-ccw', 'Reset progress'], ['remove', 'trash-2', 'Remove player']].map(([k, ico, txt]) =>
    `<button type="button" class="dash-btn danger" data-act="${k}" data-uid="${esc(uid)}" data-name="${esc(username)}"><span class="nav-ico">${icon(ico)}</span>${txt}</button>`).join('')}</div></div>` : '';
  if (!gs.length) return `${crumb}${emptyCard('No games recorded for this player yet.', '🎮')}${manage}`;

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
      ${statCard(gs.length, 'Games played', `${timed.length} timed · ${gs.length - timed.length} practice`, '', 'gamepad-2')}
      ${statCard(days, 'Days active', `last ${fmtDateTime(gs[gs.length - 1].started_at)}`, '', 'calendar')}
      ${statCard(ftN ? accOf(ftC, ftN) + '%' : '—', 'First-try accuracy', 'across timed runs', 'blue', 'target')}
      ${statCard(bestScore < 0 ? '—' : bestScore + '%', 'Best score', bestTime != null ? 'best time ' + fmtTime(bestTime) : `${wins} escaped`, 'green', 'trophy')}
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

  // Per-level totals across every timed run (same first-try data as the chart).
  const levelTotal = (name, nk, ck, accent) => {
    const n = timed.reduce((s, g) => s + (g[nk] || 0), 0);
    const c = timed.reduce((s, g) => s + (g[ck] || 0), 0);
    return statCard(n ? accOf(c, n) + '%' : '—', name, n ? `${c}/${n} right first try` : 'no timed answers', accent);
  };
  const answered = timed.filter(g => g.ft_n > 0).length;
  const totals = `
    <div class="card"><h3>Totals by level (all timed games)</h3>
    <div class="dash-grid lvl-grid">
      ${levelTotal('Easy',     'easy_n', 'easy_correct', 'green')}
      ${levelTotal('Moderate', 'mod_n',  'mod_correct',  'amber')}
      ${levelTotal('Hard',     'hard_n', 'hard_correct', 'red')}
    </div>
    <div class="card-note">First-try accuracy per level over ${answered} timed game${answered === 1 ? '' : 's'} with answers — any outcome (escaped, caught or quit); P-Learn practice excluded.</div></div>`;

  const runRows = [...gs].reverse().map(g => {
    const ftAcc = accOf(g.ft_correct, g.ft_n);
    return `
      <tr class="row-link" data-run="${esc(g.play_id)}" data-player="${esc(username)}">
        <td>${fmtDateTime(g.started_at)} <span class="chev">›</span></td>
        <td>${outcomePill(g.outcome)}</td>
        <td class="num">${g.rooms_completed == null ? '—' : g.rooms_completed + '/3'}</td>
        <td class="num">${g.total_score == null ? '—' : g.total_score + '%'}</td>
        <td class="num">${ftAcc == null ? '—' : ftAcc + '%'}</td>
        <td>${g.plearn ? '<span class="pill mid">P-Learn</span>' : '<span class="pill good">Timed</span>'}</td>
      </tr>`;
  }).join('');

  return `${crumb}${banner}${cards}
    <div class="card"><h3>First-try accuracy across games</h3>${chart}</div>
    ${totals}
    <div class="card"><h3>Every game (newest first)</h3>
    <div class="dash-table-wrap"><table class="dash-table">
      <thead><tr><th>When</th><th>Outcome</th><th class="num">Reached</th><th class="num">Score</th><th class="num">First-try</th><th>Mode</th></tr></thead>
      <tbody>${runRows || '<tr><td colspan="6" class="dash-empty">No games.</td></tr>'}</tbody>
    </table></div>
    <div class="card-note">Click a game to see every answer and event from it.</div></div>${manage}`;
}

// ── RUN DETAIL (drill-down: everything from one run) ───────────────────────────
// Fetched on demand (fetchRunDetail) so the answer/event log is always complete;
// results are cached per play id. Renders a loading state, then the full view.
function renderRunDetailInto(body, username, playId) {
  const cached = _runCache[playId];
  if (cached) { body.innerHTML = renderRunDetail(username, playId, cached); return; }
  body.innerHTML = `<div class="crumb"><span class="link" data-back="players">Players</span> <span class="crumb-sep">/</span>
    <span class="link" data-back="player">${esc(username)}</span></div><div class="dash-empty"><span class="emoji">⏳</span>Loading run…</div>`;
  fetchRunDetail(playId).then(detail => {
    _runCache[playId] = detail;
    if (_drill?.playId === playId) render();   // re-render only if still on this run
  });
}

function renderRunDetail(username, playId, detail) {
  const g = gameByPlay(playId);
  const player = username || (g && g.username);
  const crumbHead = `<div class="crumb">
    <span class="link" data-back="players">Players</span> <span class="crumb-sep">/</span>
    <span class="link" data-back="player">${esc(player)}</span> <span class="crumb-sep">/</span>`;
  if (!g) return `${crumbHead}<b>Run</b></div>${emptyCard('Run not found.')}`;
  const atts = detail.attempts, evs = detail.events;

  const crumb = `${crumbHead}<b>Run · ${fmtDateTime(g.started_at)}</b></div>`;

  const cards = `
    <div class="dash-grid">
      ${statCard(outcomePill(g.outcome), 'Outcome')}
      ${statCard(fmtTime(g.duration_sec), 'Duration')}
      ${statCard((g.rooms_completed ?? 0) + '/3', 'Rooms cleared')}
      ${statCard(g.total_score == null ? '—' : g.total_score + '%', 'Score', g.plearn ? 'P-Learn' : 'Timed')}
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
  const b = _data.behavior;
  if (!b || !b.attempts) return emptyCard('No answers recorded yet.', '📝');

  const diffs = ['EASY', 'MODERATE', 'HARD'];
  const byDiff = new Map((b.by_diff || []).map(d => [d.difficulty, d]));
  const accByDiff = diffs.map(d => {
    const r = byDiff.get(d) || {};
    const v = pct(r.first_correct || 0, r.first_n || 0);
    return { label: d, value: v, display: v + '%' };
  });
  const triesByDiff = diffs.map(d => {
    const r = byDiff.get(d) || {};
    const avg = r.correct_n ? Math.round((r.attempt_sum / r.correct_n) * 10) / 10 : 0;
    return { label: d, value: avg, display: avg || '—' };
  });

  const hintShown = b.hint_shown, plearnPlays = b.plearn, timeouts = b.timeouts, deaths = b.deaths;
  const mobile = b.mobile, desktop = b.total_plays - b.mobile;
  const devices = [
    { label: 'Desktop', value: desktop, color: C_BLUE },
    { label: 'Mobile',  value: mobile,  color: C_MID },
  ];

  return `
    <div class="dash-grid">
      ${statCard(pct(hintShown, b.attempts) + '%', 'Answers with a hint shown', `${plearnPlays} P-Learn runs`, 'amber', 'lightbulb')}
      ${statCard(timeouts, 'Question timeouts', 'ran out of time', '', 'hourglass')}
      ${statCard(deaths, 'Deaths (caught)', 'too many wrong answers', 'red', 'skull')}
      ${statCard(pct(mobile, b.total_plays) + '%', 'Plays on mobile', `${desktop} on desktop`, 'blue', 'smartphone')}
    </div>
    <div class="dash-2col">
      <div class="card"><h3>First-try accuracy by difficulty</h3>${barChart(accByDiff, { colorByValue: true })}
        <div class="card-note">% who nailed it on the first attempt — the cleanest signal of mastery.</div></div>
      <div class="card"><h3>Avg attempts to get it right</h3>${barChart(triesByDiff, { color: C_BLUE })}
        <div class="card-note">Higher = players needed more tries before answering correctly.</div></div>
    </div>
    <div class="dash-2col">
      <div class="card"><h3>Device split</h3>${donutChart(devices, { centerValue: b.total_plays, centerLabel: 'plays' })}</div>
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

// ── DAILY BOARDS (admin-only, from the already-loaded games) ──────────────────
// Rebuilds a past day's leaderboard client-side from game_accuracy rows — RLS
// gives admins the full set, so no extra fetch and no server changes. Mirrors
// the player leaderboard formulas exactly (escape blends accuracy + speed).
const DLY_LIMIT  = 25;
const DLY_BOARDS = {
  escape:   { label: 'Escape Score', value: r => r.escape,       sort: (a, b) => b.escape - a.escape || b.n - a.n },
  speed:    { label: 'Fastest Time', value: r => isFinite(r.best) ? fmtTime(Math.round(r.best)) : '—', sort: (a, b) => a.best - b.best },
  accuracy: { label: 'Top Accuracy', value: r => r.top + '%',     sort: (a, b) => b.top - a.top || b.n - a.n },
};
const dlyPad = n => String(n).padStart(2, '0');
const dlyInputValue = d => `${d.getFullYear()}-${dlyPad(d.getMonth() + 1)}-${dlyPad(d.getDate())}`;

// start (inclusive) → start+1 day (exclusive) in LOCAL time.
function dailyRows(date) {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end = new Date(start);  end.setDate(end.getDate() + 1);
  const map = new Map();
  for (const g of _data.games || []) {
    if (g.outcome !== 'won' || g.plearn) continue;      // runs table only holds timed wins
    const fin = new Date(new Date(g.started_at).getTime() + (Number(g.duration_sec) || 0) * 1000);
    if (fin < start || fin >= end) continue;
    const best  = Number(g.best_time) || 0;
    const speed = Math.min(100, Math.round(180 / Math.max(best, 1) * 100));
    const r = map.get(g.username) || { username: g.username, best: Infinity, top: -1, n: 0, escape: -1 };
    r.best   = Math.min(r.best,   best || Infinity);
    r.top    = Math.max(r.top,    g.total_score);
    r.n     += 1;
    r.escape = Math.max(r.escape, Math.round(0.7 * g.total_score + 0.3 * speed));
    map.set(g.username, r);
  }
  return [...map.values()];
}

function renderDailyBoard() {
  const games = _data.games || [];
  if (!games.length) return emptyCard('No plays recorded yet. Play a run (while signed in) to see data here.', '👻');
  const dateFmt = _daily.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const chips = Object.keys(DLY_BOARDS).map(k =>
    `<button type="button" class="dly-chip${k === _daily.board ? ' active' : ''}" data-board="${k}">${DLY_BOARDS[k].label}</button>`).join('');
  const toolbar = `
    <div class="dly-toolbar">
      <label class="dly-label" for="dly-date">Board for</label>
      <input type="date" id="dly-date" value="${dlyInputValue(_daily.date)}">
      <div class="dly-chips">${chips}</div>
    </div>`;

  const rows = dailyRows(_daily.date);
  if (!rows.length) return `${toolbar}${emptyCard(`No finished runs on ${dateFmt}.`)}`;

  const cfg  = DLY_BOARDS[_daily.board];
  const show = rows.sort(cfg.sort).slice(0, DLY_LIMIT);
  const bodyRows = show.map((r, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${esc(r.username)}</td>
      <td class="num">${cfg.value(r)}</td>
      <td class="num">${r.n}</td>
    </tr>`).join('');
  return `${toolbar}
    <div class="card"><h3>${cfg.label} · ${dateFmt}</h3>
      <div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th class="num">Rank</th><th>Player</th><th class="num">${cfg.label}</th><th class="num">Runs</th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table></div>
      <div class="card-note">Runs finished on the chosen day (top ${DLY_LIMIT}). Press Refresh to pull newer plays.</div>
    </div>`;
}

// ── CSV export (per-question item analysis — complete, from the server) ─────────
function exportCsv() {
  if (!_data?.items?.length) return;
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const header = ['QID', 'Difficulty', 'Room', 'Question', 'Attempts', 'FirstTryN', 'FirstTryCorrect', 'FirstTryPct', 'AvgTimeMs', 'TopWrong', 'TopWrongN'];
  const lines = [header.join(',')].concat(_data.items.map(r => [
    q(r.qid), q(r.difficulty), r.room_id, q(r.question_text), r.n,
    r.first_n, r.first_correct, pct(r.first_correct, r.first_n),
    r.avg_time_ms ?? '', q(r.top_wrong), r.top_wrong_n ?? '',
  ].join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'escape-room-item-analysis.csv'; a.click();
  URL.revokeObjectURL(url);
}
