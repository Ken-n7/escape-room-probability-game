import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';

// ── Anonymous performance telemetry ───────────────────────────────────────────
// Samples FPS while the game is actually being played and writes ONE aggregated
// row per minute to public.perf_samples. Deliberately NOT tied to a player
// account — purely aggregate device/GPU/perf data so we can see which hardware
// struggles and tune graphics accordingly. Fire-and-forget; never throws, never
// blocks a frame. One row/player/minute keeps write volume trivial.

const FLUSH_MS    = 60_000;                    // one row per minute of real time
const KEY_SESSION = 'oddscape:perf-session';   // per-tab anonymous session bucket

let _session = null, _device = null;
let _minute = 0, _frames = 0, _samples = [];
let _lastFlush = 0, _enabled = false;

// Anonymous, per-tab. Persisted in sessionStorage so a reload continues the same
// session; a fresh tab starts a new one. Never linked to auth.
function sessionId() {
  try {
    let s = sessionStorage.getItem(KEY_SESSION);
    if (!s) { s = crypto.randomUUID(); sessionStorage.setItem(KEY_SESSION, s); }
    return s;
  } catch { return crypto.randomUUID(); }
}

// The real GPU string (e.g. "Apple A15 GPU", "Mali-G57") — the single most useful
// field for perf decisions. Gated behind WEBGL_debug_renderer_info.
function gpuString() {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
            || document.createElement('canvas').getContext('experimental-webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch { return null; }
}

// Captured once — a row repeats it so each row is self-describing for querying.
function deviceProfile() {
  const ua = navigator.userAgent || '';
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
  return {
    dpr:           +(window.devicePixelRatio || 1).toFixed(2),
    screen_w:      window.screen?.width ?? null,
    screen_h:      window.screen?.height ?? null,
    device_memory: navigator.deviceMemory ?? null,
    cpu_cores:     navigator.hardwareConcurrency ?? null,
    is_mobile:     /Android|iPhone|iPad|iPod|Mobile|Silk|Tablet/i.test(ua) || ((navigator.maxTouchPoints > 1) && coarse),
    platform:      navigator.platform || null,
    gpu:           gpuString(),
    ua,
    app_version:   import.meta.env.VITE_APP_VERSION || null,
  };
}

export function initPerf() {
  if (_enabled) return;
  _enabled   = true;
  _session   = sessionId();
  _device    = deviceProfile();
  _lastFlush = performance.now();
}

// Feed one gameplay frame. `dt` is the frame delta in seconds (already clamped by
// the caller). Flushes automatically once a real minute has elapsed.
export function samplePerf(dt) {
  if (!_enabled || dt <= 0) return;
  _samples.push(1 / dt);
  _frames++;
  if (performance.now() - _lastFlush >= FLUSH_MS) flushPerf();
}

function aggregate() {
  if (!_samples.length) return null;
  const sorted = [..._samples].sort((a, b) => a - b);
  const avg = _samples.reduce((x, y) => x + y, 0) / _samples.length;
  const p05 = sorted[Math.floor(sorted.length * 0.05)];      // worst sustained fps
  return {
    fps_avg: +avg.toFixed(1),
    fps_min: +sorted[0].toFixed(1),
    fps_p05: +p05.toFixed(1),
    frames:  _frames,
  };
}

function buildRow() {
  const agg = aggregate();
  return agg ? { session_id: _session, minute_index: _minute, ...agg, ..._device } : null;
}

// Write the current minute's aggregate and reset the window.
export function flushPerf() {
  const row = buildRow();
  _samples = []; _frames = 0; _lastFlush = performance.now();
  if (!row) return;
  _minute++;
  supabase.from('perf_samples').insert(row)
    .then(({ error }) => { if (error) console.warn('[perf] flush:', error.message); });
}

// Send the final partial minute during page teardown, using keepalive so it
// survives the unload (a normal request would be killed). Anon-keyed.
export function flushPerfBeacon() {
  const row = buildRow();
  if (!row) return;
  _samples = []; _frames = 0;
  try {
    fetch(`${SUPABASE_URL}/rest/v1/perf_samples`, {
      method: 'POST',
      keepalive: true,
      headers: {
        apikey:         SUPABASE_ANON_KEY,
        Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer:         'return=minimal',
      },
      body: JSON.stringify(row),
    }).catch(() => {});
  } catch { /* teardown — nothing we can do */ }
}
