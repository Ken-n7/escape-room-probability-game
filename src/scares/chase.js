import * as THREE from 'three';
import { makeGLTFLoader } from '../loaders/gltf-loader.js';
import { gState, look, S } from '../core/game-state.js';
import { scene, camera } from '../core/renderer.js';
import { AudioManager } from '../audio/audio.js';
import { flushLookInput } from '../input/input.js';
import { elVignette, showScreen } from '../ui/hud.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const TURN_DURATION  = 1.8;   // seconds for forced 180° turn
const MONSTER_SPEED  = 8.5;   // units / second
const SPAWN_DIST     = 13;    // units ahead of player on spawn
const COLLISION_DIST = 1.1;   // caught threshold
const MONSTER_SCALE  = 1.8;
// The filename is misleading: in-game this is the dark ghost/eclipse model.
const MODEL_PATH     = '/assets/3D/horror-woman.glb';

// ── State ─────────────────────────────────────────────────────────────────────
let _phase      = 0;
let _elapsed    = 0;
let _startYaw   = 0;
let _caught     = false;
let _monster    = null;   // THREE.Group in scene
let _mixer      = null;
let _screamT    = 0;
let _gltf       = null;
let _loader     = null;

// Injected by initChase — called when the player is caught
let _onCaught = null;

export function initChase({ onCaught }) {
  _onCaught = onCaught;
}

// Called by preload.js to store the pre-fetched GLTF
export function setGltf(gltf) { _gltf = gltf; }

// ── Model loading ─────────────────────────────────────────────────────────────
function _getLoader() {
  if (!_loader) _loader = makeGLTFLoader();
  return _loader;
}

function _loadModel(cb) {
  if (_gltf) { cb(_gltf); return; }
  _getLoader().load(MODEL_PATH, gltf => { _gltf = gltf; cb(gltf); });
}

// ── Spawn ─────────────────────────────────────────────────────────────────────
function _spawn() {
  _loadModel(gltf => {
    if (gState.current !== S.CHASE) return; // chase ended while loading
    _doSpawn(gltf);
  });
}

function _doSpawn(gltf) {
  if (_monster) scene.remove(_monster);
  _monster = gltf.scene;

  const sinY = Math.sin(look.yaw), cosY = Math.cos(look.yaw);
  const px   = camera.position.x + (-sinY * SPAWN_DIST);
  const pz   = camera.position.z + (-cosY * SPAWN_DIST);
  _monster.position.set(Math.max(-2.2, Math.min(2.2, px)), 0, pz);
  _monster.scale.setScalar(MONSTER_SCALE);

  const dx = camera.position.x - _monster.position.x;
  const dz = camera.position.z - _monster.position.z;
  _monster.rotation.y = Math.atan2(dx, dz);
  scene.add(_monster);

  _mixer = new THREE.AnimationMixer(_monster);
  if (gltf.animations.length) _mixer.clipAction(gltf.animations[0]).play();

  AudioManager.play('ghostScream');
  AudioManager.setVolume('enemyNear', 0.25, 0.2);
  _screamT = 999; // disable periodic screams — ghostScream handles it
}

// ── Caught ────────────────────────────────────────────────────────────────────
function _triggerCaught() {
  if (_caught) return;
  _caught = true;
  AudioManager.stopAll();

  elVignette.style.transition = 'opacity 0.45s';
  elVignette.style.background = '#000';
  elVignette.style.opacity    = '1';

  setTimeout(() => {
    cleanup();
    gState.current = S.LOSE;
    showScreen('lose');
    _onCaught?.();
  }, 500);
}

// ── Public API ────────────────────────────────────────────────────────────────
export function triggerChase({ clearQuestionTimers, showHUD }) {
  clearQuestionTimers();
  showHUD();
  gState.current = S.CHASE;
  _phase         = 0;
  _elapsed       = 0;
  _caught        = false;
  _startYaw      = look.yaw;

  AudioManager.setVolume('ambient',   0, 0.08);
  AudioManager.setVolume('enemyNear', 0, 0.08);

  _loadModel(() => {}); // warm load so it's ready when the turn finishes
}

export function update(dt) {
  _elapsed += dt;

  if (_phase === 0) {
    // Phase 0 — forced 180° camera turn
    const t     = Math.min(1, _elapsed / TURN_DURATION);
    const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    look.yaw    = _startYaw + eased * Math.PI;
    look.pitch  = 0;
    camera.rotation.set(0, look.yaw, 0);

    if (t >= 1) {
      _phase   = 1;
      _elapsed = 0;
      _spawn();
    }
  } else {
    // Phase 1 — monster runs; player can look
    flushLookInput();

    if (_monster && !_caught) {
      const dx   = camera.position.x - _monster.position.x;
      const dz   = camera.position.z - _monster.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > 0.2) {
        const step = MONSTER_SPEED * dt;
        _monster.position.x += (dx / dist) * step;
        _monster.position.z += (dz / dist) * step;
        _monster.rotation.y  = Math.atan2(dx, dz);
      }

      const vol = Math.min(1, Math.max(0.1,
        1 - (dist - COLLISION_DIST) / (SPAWN_DIST - COLLISION_DIST)));
      AudioManager.setVolume('enemyNear', vol, 0.12);

      _screamT -= dt;
      if (_screamT <= 0) {
        AudioManager.playScream();
        _screamT = Math.max(0.8, 1.4 + (dist / SPAWN_DIST) * 2);
      }

      _mixer?.update(dt);

      if (dist < COLLISION_DIST) _triggerCaught();
    }
  }
}

export function cleanup() {
  if (_monster) { scene.remove(_monster); _monster = null; }
  if (_mixer)   { _mixer.stopAllAction(); _mixer = null; }
  _phase   = 0;
  _elapsed = 0;
  _caught  = false;
}
