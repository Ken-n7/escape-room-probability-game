// E2E regression suite (headless Chromium via the `playwright` library).
//
//   npm run test:e2e
//
// Spins up its own Vite dev server on :5199 if none is already listening, then
// drives a real browser through the app. Leaderboard RPCs hit the LIVE Supabase
// project (integration check — needs network access to
// https://idhhdqbxtssiujuwopcq.supabase.co), while the Daily-boards assertions
// fabricate rows via route interception, so no admin login is needed.
//
// Exits nonzero if any check fails — safe to wire into CI.
import { chromium } from 'playwright';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = 'http://localhost:5199';
const watchdog = setTimeout(() => { console.error('WATCHDOG TIMEOUT'); process.exit(2); }, 420_000);
watchdog.unref();

const checks = [];
const pageErrors = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ping = url => new Promise(res => http.get(url, r => { r.resume(); res(true); }).on('error', () => res(false)));

// ── Dev server (reuse if present, otherwise boot one) ─────────────────────────
async function ensureServer() {
  if (await ping(BASE)) return null;
  console.log(`No server on ${BASE} — starting Vite…`);
  const proc = spawn('npx', ['vite', '--port', '5199', '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', d => process.stderr.write('[vite] ' + d));
  for (let i = 0; i < 80; i++) { if (await ping(BASE)) return proc; await sleep(500); }
  proc.kill();
  throw new Error('Vite did not start in time');
}

// ── Browser helpers ───────────────────────────────────────────────────────────
async function boot(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('#s-menu:not(.hidden)', { timeout: 60_000 });
  // The menu gates the leaderboard behind guest/login when signed out — unlock.
  await page.evaluate(() => {
    const guest = document.getElementById('btn-menu-guest');
    if (guest && !document.getElementById('btn-leaderboard').offsetParent) guest.click();
  });
  return page;
}

const navClick = (page, selector) => page.evaluate(s => document.querySelector(s).click(), selector);

// Real pointer path (mouse down + up at the element's center). Bypasses the
// locator actionability check, which times out while the ⟳ spin animation runs.
const realClick = async (page, selector) => {
  const b = await page.locator(selector).boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

// Snapshot every RPC body so tests can assert on the p_since argument.
const rpcSpy = page => page.evaluate(() => {
  window.__lbRpcs = 0;
  window.__lastBody = {};
  const orig = window.fetch;
  window.fetch = function (...a) {
    const u = String(a[0]);
    if (u.includes('/rpc/')) {
      const fn = (u.match(/rpc\/(\w+)/) || [])[1];
      let body = null;
      try { body = JSON.parse(a[1]?.body); } catch { /* ignore */ }
      window.__lastBody[fn] = body;
      if (fn.startsWith('lb_')) window.__lbRpcs++;
    }
    return orig.apply(this, a);
  };
});

// Local "YYYY-MM-DD" — NOT toISOString (UTC), because the app buckets days in
// local time and the two can disagree across the midnight boundary.
const pad = n => String(n).padStart(2, '0');
const localID = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ── 1. Leaderboard: all/window boards, empty states, p_since argument ─────────
async function sectionLeaderboard(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await boot(ctx);
  await navClick(page, '#btn-leaderboard');
  await page.waitForSelector('#s-leaderboard:not(.hidden)');
  await page.waitForFunction(() => document.getElementById('lb-list').children.length > 0, { timeout: 20_000 });

  const allRows = await page.locator('#lb-list .lb-row').count();
  const allEmpty = await page.locator('#lb-list .lb-empty').innerText().catch(() => '');
  check('1a  all-time shows rows or the valid empty message',
    allRows > 0 || allEmpty.includes('No scores yet. Be the first!'), `rows=${allRows}`);

  await rpcSpy(page);
  for (const [win, expectMsg] of [['week', 'No scores this week. Be the first!'], ['day', 'No scores today. Be the first!']]) {
    await page.evaluate(w => document.querySelector(`.lb-win[data-window="${w}"]`).click(), win);
    await page.waitForFunction(m =>
      document.getElementById('lb-list').textContent.includes(m) ||
      document.getElementById('lb-list').querySelectorAll('.lb-row').length, expectMsg, { timeout: 20_000 });
    const rows = await page.locator('#lb-list .lb-row').count();
    const empty = await page.locator('#lb-list .lb-empty').innerText().catch(() => '');
    check(`1b  "${win}" renders rows or its exact empty message`, rows > 0 || empty === expectMsg, `rows=${rows} empty="${empty.slice(0, 30)}"`);
  }

  const n = await page.evaluate(() => window.__lbRpcs);
  const since = await page.evaluate(() => Object.fromEntries(
    Object.entries(window.__lastBody).map(([fn, b]) => [fn, b && b.p_since != null])));
  check('1c  week/day RPCs sent with a non-null p_since',
    n >= 2 && Object.values(since).every(v => v), `${n} rpcs ${JSON.stringify(since)}`);
  await ctx.close();
}

// ── 2. Refresh ⟳: spin, 15s cooldown, active window preserved ─────────────────
async function sectionRefresh(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await boot(ctx);
  await navClick(page, '#btn-leaderboard');
  await page.waitForFunction(() => document.getElementById('lb-list').children.length > 0, { timeout: 20_000 });
  await page.evaluate(() => {
    window.__n = 0;
    const orig = window.fetch;
    window.fetch = function (...a) { if (String(a[0]).includes('rpc/lb_')) window.__n++; return orig.apply(this, a); };
  });
  await page.evaluate(() => document.querySelector('.lb-win[data-window="day"]').click());
  await page.waitForFunction(() => document.getElementById('lb-list').textContent.includes('No scores today') ||
    document.getElementById('lb-list').querySelectorAll('.lb-row').length, { timeout: 20_000 });
  // The window switch above already fetched once — reset the counter so it
  // measures only what the ⟳ button triggers.
  await page.evaluate(() => { window.__n = 0; });

  await realClick(page, '#btn-lb-refresh');
  await sleep(250);
  check('2a  real mouse click spins ⟳', await page.locator('#btn-lb-refresh.spinning').count() === 1);

  await realClick(page, '#btn-lb-refresh');            // within the 15s cooldown
  await sleep(1500);
  const after1 = await page.evaluate(() => window.__n);
  check('2b  two rapid clicks → exactly one fetch (cooldown)', after1 === 1, `fetches=${after1}`);

  await sleep(16_000);                                  // let the cooldown lapse
  await realClick(page, '#btn-lb-refresh');
  await sleep(1500);
  const after2 = await page.evaluate(() => window.__n);
  const active = await page.evaluate(() => document.querySelector('.lb-win.active')?.dataset.window);
  check('2c  post-cooldown click fires the next fetch, window stays "day"',
    after2 === 2 && active === 'day', `fetches=${after2} active=${active}`);
  await ctx.close();
}

// ── 3. Dashboard Daily boards with fabricated data ─────────────────────────────
// The server only returns rows to admins, so the rpc is stubbed with fixtures
// to exercise the full board logic (formulas, date switching, board switching).
async function sectionDailies(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', e => pageErrors.push(String(e)));

  const today = new Date(); today.setHours(10, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const threeAgo = new Date(today); threeAgo.setDate(threeAgo.getDate() - 3);
  const ldt = d => `${localID(d)}T${pad(d.getHours())}:00:00`;
  const mk = (u, started, total, best, dur, outcome = 'won', plearn = false) => ({
    user_id: 'u-' + u, username: u, play_id: 'p-' + u, started_at: ldt(started),
    outcome, total_score: total, best_time: best, rooms_completed: outcome === 'won' ? 3 : 1,
    duration_sec: dur, plearn,
  });
  const GAMES = [
    mk('Alice', today, 90, 150, 500),
    mk('Bob',   today, 90, 300, 400),
    mk('Carol', yesterday, 70, 200, 450),
    mk('Dave',  yesterday, 95, 120, 380),
    mk('Eve',   threeAgo, 60, 500, 600),
    mk('Fred',  today, 40, null, 120, 'lost'),
    mk('Grace', today, 88, 220, 300, 'won', true),
  ];
  await page.route('**/rpc/game_accuracy*', route => route.fulfill({ json: GAMES, headers: { 'content-type': 'application/json' } }));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('#s-menu:not(.hidden)', { timeout: 60_000 });
  await navClick(page, '#btn-menu-guest');
  await page.evaluate(() => window.__openDash && window.__openDash());
  await page.waitForFunction(() => document.querySelector('.dash-navitem[data-tab="dailies"]'), { timeout: 20_000 });
  await page.evaluate(() => document.querySelector('.dash-navitem[data-tab="dailies"]').click());
  await page.waitForFunction(() => document.getElementById('dash-body')?.textContent.includes('Alice'), { timeout: 20_000 });

  check('3a  dailies toolbar: date input + three board chips',
    (await page.locator('#dly-date').count()) === 1 && (await page.locator('.dly-chip').count()) === 3);

  let rows = await page.locator('#dash-body tbody tr').allInnerTexts();
  const todayOk = rows.length >= 2 && rows[0].includes('Alice') && rows[0].includes('93') && rows[1].includes('Bob') && rows[1].includes('81');
  check('3b  today: escape blend ranks Alice 93 then Bob 81', todayOk, JSON.stringify(rows));

  await page.evaluate(() => document.querySelector('.dly-chip[data-board="speed"]').click());
  await sleep(400);
  rows = await page.locator('#dash-body tbody tr').allInnerTexts();
  check('3c  today: speed board — Alice 2m 30s first', rows[0] && rows[0].includes('Alice') && rows[0].includes('2m 30s'), JSON.stringify(rows));

  await page.evaluate(() => document.querySelector('.dly-chip[data-board="accuracy"]').click());
  await sleep(400);
  rows = await page.locator('#dash-body tbody tr').allInnerTexts();
  check('3d  today: accuracy board — Alice 90% first', rows[0] && rows[0].includes('Alice') && rows[0].includes('90%'), JSON.stringify(rows));

  await page.evaluate(() => document.querySelector('.dly-chip[data-board="escape"]').click());
  await page.fill('#dly-date', localID(yesterday));          // LOCAL string, not UTC
  await sleep(600);
  const hdr = await page.locator('#dash-body .card h3').innerText();
  rows = await page.locator('#dash-body tbody tr').allInnerTexts();
  check('3e  yesterday: re-renders — Dave 97, Carol 76', hdr.includes('Sep') && rows[0] && rows[0].includes('Dave') && rows[0].includes('97') &&
    rows[1] && rows[1].includes('Carol') && rows[1].includes('76'), `hdr="${hdr}" ${JSON.stringify(rows)}`);

  await page.evaluate(() => document.querySelector('.dly-chip[data-board="speed"]').click());
  await sleep(400);
  rows = await page.locator('#dash-body tbody tr').allInnerTexts();
  check('3f  yesterday: speed — Dave 2m 00s first', rows[0] && rows[0].includes('Dave') && rows[0].includes('2m 00s'), JSON.stringify(rows));

  const future = new Date(today); future.setDate(future.getDate() + 2);
  await page.fill('#dly-date', localID(future));
  await sleep(600);
  const txt = await page.locator('#dash-body').innerText();
  check('3g  empty day: message + toolbar retained',
    txt.includes('No finished runs on') && (await page.locator('#dly-date').count()) === 1, txt.slice(0, 50));
  await ctx.close();
}

// ── 4. Mobile: landscape layout / portrait rotate prompt ──────────────────────
async function sectionMobile(browser) {
  const mctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const page = await boot(mctx);
  await navClick(page, '#btn-leaderboard');
  await page.waitForFunction(() => document.getElementById('lb-list').children.length > 0, { timeout: 20_000 });
  await page.evaluate(() => document.querySelector('.lb-win[data-window="day"]').click());
  await page.waitForFunction(() => document.getElementById('lb-list').textContent.includes('No scores today') ||
    document.getElementById('lb-list').querySelectorAll('.lb-row').length, { timeout: 20_000 });

  const geo = await page.evaluate(() => {
    const r = document.getElementById('btn-lb-refresh').getBoundingClientRect();
    const tabs = [...document.querySelectorAll('#lb-window .lb-win[data-window]')].map(b => b.getBoundingClientRect());
    return { refresh: { l: r.left, r: r.right }, tabs: tabs.map(t => ({ l: t.left, r: t.right })), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  });
  const clash = geo.tabs.some(t => t.l < geo.refresh.r && t.r > geo.refresh.l);
  check('4a  mobile landscape: ⟳ does not overlap window tabs', !clash, JSON.stringify(geo.tabs));
  check('4b  mobile landscape: no horizontal overflow', geo.sw <= geo.cw + 1, `scroll=${geo.sw} client=${geo.cw}`);

  await navClick(page, '#btn-leaderboard-back');
  await sleep(300);
  await navClick(page, '#btn-settings');
  await sleep(500);
  check('4c  mobile landscape: settings opens', (await page.locator('#s-settings:not(.hidden)').count()) === 1);
  await mctx.close();

  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await pctx.newPage();
  p.on('pageerror', e => pageErrors.push(String(e)));
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // Portrait mounts the rotate-phone overlay instead of the game root — wait for
  // the overlay directly (bounded), not for #game-root.
  const shown = await p.waitForFunction(() => {
    const r = document.getElementById('rotate-phone');
    return r && !r.classList.contains('hidden');
  }, null, { timeout: 15_000 }).then(() => true).catch(() => false);
  check('4d  portrait: rotate-phone prompt shown', shown);
  await pctx.close();
}

// ── 5. Timeout hardening: a hung RPC no longer strands the board ──────────────
// Routes lb_escape to a request that never completes, then clicks ⟳ (force
// fetch) and expects the "couldn't load" fallback instead of eternal "Loading…".
async function sectionTimeout(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.route('**/rpc/lb_escape*', route => { /* deliberately never respond */ });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('#s-menu:not(.hidden)', { timeout: 60_000 });
  await page.evaluate(() => {
    const guest = document.getElementById('btn-menu-guest');
    if (guest && !document.getElementById('btn-leaderboard').offsetParent) guest.click();
  });
  await page.evaluate(() => document.getElementById('btn-leaderboard').click());
  await page.waitForTimeout(250);
  await realClick(page, '#btn-lb-refresh');               // bypasses cache via force
  await page.waitForFunction(() => document.getElementById('lb-list').textContent.includes("Couldn't load"), null, { timeout: 20_000 });
  check('5a  hung RPC (no cache) shows the retry message, not eternal Loading',
    true, (await page.locator('#lb-list .lb-empty').innerText()).slice(0, 46));
  await ctx.close();
}

// ── Runner ────────────────────────────────────────────────────────────────────
// One section crash becomes a failed check instead of killing the whole run —
// the earlier sections' results are still reported.
async function runSection(name, fn) {
  const t0 = Date.now();
  try { await fn(browser); }
  catch (e) { check(`${name} section crashed`, false, String(e).split('\n')[0]); }
  console.log(`      (${name} took ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

const server = await ensureServer();
let browser;
try {
  browser = await chromium.launch();
  await runSection('1 leaderboard', sectionLeaderboard);
  await runSection('2 refresh', sectionRefresh);
  await runSection('3 dailies', sectionDailies);
  await runSection('4 mobile', sectionMobile);
  await runSection('5 timeout', sectionTimeout);

  check('no uncaught page errors across all scenarios', pageErrors.length === 0, pageErrors.slice(0, 3).join(' || ') || 'none');

  console.log('\n=== SUMMARY ===');
  const fails = checks.filter(c => !c.ok);
  for (const c of fails) console.log('FAIL:', c.name, '::', c.detail);
  console.log(`${checks.length - fails.length}/${checks.length} passed`);
  process.exitCode = fails.length > 0 ? 1 : 0;
} finally {
  await browser?.close();
  if (server) server.kill();
}
