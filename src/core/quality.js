// ═══════════════════════════════════════════════════════════════════════════════
//  GRAPHICS QUALITY — the single source of truth for render tiers.
//
//  The player picks a mode in Settings (Auto/Low/Medium/High); this module
//  resolves it to a concrete tier and a bag of "knobs". Today only a few knobs
//  are live (pixel ratio, anti-alias, shadows) — the rest (bloom, ssao, texRes,
//  normals) are placeholders that upcoming graphics effects will read via
//  getKnobs()/onQualityChange(). Build effects gated on these from day one.
//
//  This file imports nothing heavy (no THREE, no renderer) so it can be read at
//  boot before the renderer is constructed, and can't create an import cycle.
// ═══════════════════════════════════════════════════════════════════════════════

// pixelRatio here is a CAP — actual = min(devicePixelRatio, cap). Low forces 1.0
// (downsamples on retina → big perf win + softer edges); High allows up to 2×.
export const QUALITY_TIERS = {
  low:    { label: 'Low',    pixelRatio: 1.0,  antialias: false, shadows: false, bloom: false, ssao: false, texRes: 512,  normals: false },
  medium: { label: 'Medium', pixelRatio: 1.25, antialias: true,  shadows: false, bloom: true,  ssao: false, texRes: 1024, normals: false },
  high:   { label: 'High',   pixelRatio: 1.5,  antialias: true,  shadows: true,  bloom: true,  ssao: true,  texRes: 2048, normals: true },
};
export const QUALITY_MODES = ['auto', 'low', 'medium', 'high'];

const KEY = 'oddscape:quality';
const _listeners = new Set();
let _mode = load();
let _autoTier = null;     // cached device guess
let _bootKnobs = null;    // knobs captured when the renderer first read them

function load() {
  try { const v = localStorage.getItem(KEY); return QUALITY_MODES.includes(v) ? v : 'auto'; }
  catch { return 'auto'; }
}

// One-time device guess for Auto. Conservative: desktops get High, phones get
// Low unless they look reasonably capable (cores + memory), then Medium.
export function detectTier() {
  if (_autoTier) return _autoTier;
  const ua = navigator.userAgent || '';
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
  const mobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Tablet/i.test(ua) || ((navigator.maxTouchPoints > 1) && coarse);
  const cores  = navigator.hardwareConcurrency || 4;
  const mem    = navigator.deviceMemory || 4;
  _autoTier = !mobile ? 'high' : (cores >= 8 && mem >= 4 ? 'medium' : 'low');
  return _autoTier;
}

export const getMode = () => _mode;
export const getTier = () => (_mode === 'auto' ? detectTier() : _mode);
export const getKnobs = () => QUALITY_TIERS[getTier()];

// Effective device pixel ratio for the current (or given) knobs.
export const effectivePixelRatio = (knobs = getKnobs()) =>
  Math.min(window.devicePixelRatio || 1, knobs.pixelRatio);

// Called by renderer.js at construction; records what the GL context was built
// with so we can tell when a change needs a reload (anti-alias can't hot-swap).
export function resolveKnobs() {
  const k = getKnobs();
  if (!_bootKnobs) _bootKnobs = k;
  return k;
}

// True when the current tier differs from boot in a way that only a reload can
// apply (anti-alias is fixed at WebGL context creation).
export const needsReload = () => !!_bootKnobs && _bootKnobs.antialias !== getKnobs().antialias;

function emit() { const k = getKnobs(); _listeners.forEach(fn => { try { fn(k); } catch (e) { console.warn('[quality] listener failed', e); } }); }

export function setMode(mode) {
  if (!QUALITY_MODES.includes(mode) || mode === _mode) return;
  _mode = mode;
  try { localStorage.setItem(KEY, mode); } catch { /* private mode */ }
  emit();
}

// Dev convenience: auto → low → medium → high → auto.
export function cycleMode() {
  const i = QUALITY_MODES.indexOf(_mode);
  setMode(QUALITY_MODES[(i + 1) % QUALITY_MODES.length]);
  return _mode;
}

// Register an effect/renderer reaction. Returns an unsubscribe fn.
export function onQualityChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
