// ═══════════════════════════════════════════════════════════════════════════════
//  AUDIO MANAGER
//
//  Sound file paths live in audio-assets.js.
//  To change a sound, replace the file in public/assets/audio or edit that
//  manifest entry.
//
//  Accepted formats: MP3, OGG, WAV.
//  Loop sounds use startLoop()/init(), and their volume is controlled via
//  setVolume(). One-shot sounds use play().
// ═══════════════════════════════════════════════════════════════════════════════

import { AUDIO_ASSETS } from './audio-assets.js';

const SOUNDS = AUDIO_ASSETS;

// ── Internals ──────────────────────────────────────────────────────────────────
let _ctx = null;
const _bufs  = {};   // decoded AudioBuffers
const _gains = {};   // persistent GainNodes for loop sounds
const _srcs  = {};   // persistent BufferSourceNodes for loop sounds
let _loadPromise = null;
let _master = null;
let _unlocked = false;

function ctx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

function masterGain() {
  if (!_master) {
    _master = ctx().createGain();
    _master.gain.value = 1;
    _master.connect(ctx().destination);
  }
  return _master;
}

async function _unlock() {
  const ac = ctx();
  masterGain();
  if (ac.state === 'suspended') await ac.resume().catch(() => {});
  _unlocked = ac.state === 'running';
  return _unlocked;
}

async function _load(name) {
  const s = SOUNDS[name];
  if (!s?.src) return;

  try {
    const res = await fetch(s.src);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

    const raw = await res.arrayBuffer();
    _bufs[name] = await ctx().decodeAudioData(raw);
  } catch (err) {
    console.warn(`Audio "${name}" could not be loaded from ${s.src}.`, err);
  }
}

function _startLoop(name) {
  if (_srcs[name]) return;
  const buf = _bufs[name];
  if (!buf) return;
  const ac  = ctx();
  const src = ac.createBufferSource();
  const g   = ac.createGain();
  src.buffer     = buf;
  src.loop       = true;
  g.gain.value   = SOUNDS[name].vol;
  src.connect(g).connect(masterGain());
  src.start();
  _gains[name] = g;
  _srcs[name]  = src;
}

// ── Public API ─────────────────────────────────────────────────────────────────
export const AudioManager = {

  /**
   * Call once after the first user gesture.
   * Loads all files that have a src and starts loop tracks.
   */
  async preload() {
    await _unlock();
    _loadPromise ??= Promise.all(Object.keys(SOUNDS).map(_load));
    await _loadPromise;
  },

  async init() {
    await this.preload();

    Object.keys(SOUNDS).forEach(name => {
      if (SOUNDS[name].loop) _startLoop(name);
    });
  },

  async startLoop(name) {
    await this.preload();
    _startLoop(name);
  },

  /** Fire-and-forget one-shot sound. */
  play(name) {
    const buf = _bufs[name];
    const ac  = ctx();
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    if (!buf) {
      if (SOUNDS[name]?.src) {
        this.preload()
          .then(() => { if (_bufs[name]) this.play(name); })
          .catch(err => console.warn(`Audio "${name}" could not be played.`, err));
      }
      return;
    }

    const src = ac.createBufferSource();
    const g   = ac.createGain();
    src.buffer   = buf;
    g.gain.value = SOUNDS[name]?.vol ?? 1;
    src.connect(g).connect(masterGain());
    src.start();
  },

  /**
   * Smoothly ramp the volume of a looping sound.
   * Used for tension fade-in / fade-out.
   * @param {string} name
   * @param {number} vol   target volume 0–1
   * @param {number} ramp  ramp duration in seconds (default 0.3)
   */
  setVolume(name, vol, ramp = 0.3) {
    const g = _gains[name];
    if (!g) return;
    const ac = ctx();
    g.gain.cancelScheduledValues(ac.currentTime);
    g.gain.setValueAtTime(g.gain.value, ac.currentTime);
    g.gain.linearRampToValueAtTime(
      Math.max(0, Math.min(1, vol)),
      ac.currentTime + ramp
    );
  },

  /** Stop a looping sound cleanly. */
  stop(name) {
    try { _srcs[name]?.stop(); } catch {}
    delete _srcs[name];
    delete _gains[name];
  },

  stopAll() {
    Object.keys(_srcs).forEach(name => this.stop(name));
  },

  debug() {
    return {
      contextState: _ctx?.state ?? 'not-created',
      unlocked: _unlocked,
      loaded: Object.keys(_bufs),
      loops: Object.keys(_srcs),
    };
  },
};
