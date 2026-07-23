import * as THREE from 'three';
import { makeGLTFLoader } from '../loaders/gltf-loader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { gState, look, keys, S } from '../core/game-state.js';
import { scene, camera, renderer } from '../core/renderer.js';
import { flickerLights } from '../world/world.js';
import { AudioManager } from '../audio/audio.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const MODEL_PATH   = '/assets/3D/the_unvermeidlich_ghost_darkness_of_eclipse.glb';
const SCALE        = 0.88;
const Y_OFFSET     = -0.08;
const SCARE_SOUNDS = ['randomScareWhisper', 'randomScream', 'randomWhisper2', 'randomLaughEvil'];
const NOISE_SOUNDS = [
  'randomMoan', 'randomTone', 'randomRunning', 'randomScream',
  'randomMoan2', 'randomWhisper2', 'randomKnock', 'randomCrying2',
  'randomLaughEvil', 'ambientSwell',
];
const WALK_DELAY   = 3.2;   // commit to movement before tension can pay off
const TURN_TRIGGER = 0.55;
const VISUAL_CHANCE   = 0.32;  // ghost apparition
const BLACKOUT_CHANCE = 0.22;  // total light failure (rest of the roll = noise)
const BLACKOUT_SOUNDS = ['randomKnock', 'randomWhisper2', 'randomCrying2', 'randomRunning'];
const BLACKOUT_GHOST_CHANCE = 0.25; // ghost standing there when the lights return

const _cooldownRng = () => 34 + Math.random() * 28;
const _initialCooldownRng = () => 18 + Math.random() * 14;
const _noiseCooldownRng = () => 8 + Math.random() * 13;

// ── State ─────────────────────────────────────────────────────────────────────
const _state = {
  cooldown:   _initialCooldownRng(),
  noiseCooldown: _noiseCooldownRng(),
  sprite:     null,
  mixer:      null,
  fadeTimer:  null,
  prevYaw:    null,
  turnAccum:  0,
  turnWindow: 0,
  walkTime:   0,
};

let _gltf   = null;
let _loader = null;

// Built once, reused for every scare (no per-spawn clone/material work).
let _ghost     = null;   // the ghost model group (kept in scene, visibility toggled)
let _lightRig  = null;   // persistent 2-light rig (intensity toggled, never removed)
let _keyLight  = null;
let _rimLight  = null;
let _warmedUp  = false;  // shaders/GPU upload done during loading, not mid-game

function _getLoader() {
  if (!_loader) _loader = makeGLTFLoader();
  return _loader;
}

function _loadModel(cb) {
  if (_gltf) { cb(_gltf); return; }
  _getLoader().load(MODEL_PATH, gltf => { _gltf = gltf; cb(gltf); });
}

// Called by preload.js to store the pre-fetched GLTF
export function setGltf(gltf) { _gltf = gltf; }

// ── Material / light helpers ──────────────────────────────────────────────────
function _tuneMaterials(root, emissiveIntensity = 0.18) {
  root.traverse(child => {
    if (!child.isMesh || !child.material) return;
    child.frustumCulled = false;
    const src = Array.isArray(child.material) ? child.material : [child.material];
    const tuned = src.map(mat => {
      const m = mat.clone();
      if (m.emissive) {
        m.emissive.setHex(0x1f120f);
        m.emissiveIntensity = Math.max(m.emissiveIntensity || 0, emissiveIntensity);
      }
      if ('roughness' in m) m.roughness = Math.min(m.roughness ?? 1, 0.82);
      return m;
    });
    child.material = Array.isArray(child.material) ? tuned : tuned[0];
  });
}

// Target intensities the rig ramps to when the ghost is on screen.
const KEY_INTENSITY = 8.0;
const RIM_INTENSITY = 3.0;

// The ghost's two lights live in a rig that stays in the scene PERMANENTLY at
// intensity 0. Because the light COUNT never changes, materials never need to
// recompile their shaders when the ghost appears/disappears (the old code added
// and removed these lights each spawn, forcing a recompile stall every time —
// especially painful on mobile GPUs). On spawn we just move the rig to the ghost
// and turn the intensities up; on clear we turn them back to 0.
function _buildLightRig() {
  const rig = new THREE.Group();
  // Key light — warm, spills onto nearby walls/floor so the ghost feels grounded
  _keyLight = new THREE.PointLight(0xffdcc4, 0, 10, 1.4);
  _keyLight.position.set(0, 1.35, 0.65);
  rig.add(_keyLight);
  // Rim light — red backlight for silhouette drama
  _rimLight = new THREE.PointLight(0xff2d18, 0, 6, 1.6);
  _rimLight.position.set(0, 1.65, -0.8);
  rig.add(_rimLight);
  return rig;
}

// ── World light control ───────────────────────────────────────────────────────
// Dims all scene lights so the ghost's own lights dominate, then restores them.
let _ambientLight = null;  // found lazily

function _findAmbient() {
  if (_ambientLight) return _ambientLight;
  scene.traverse(obj => { if (obj.isAmbientLight) _ambientLight = obj; });
  return _ambientLight;
}

function _dimWorldLights(fadeDuration = 0.18) {
  const ambient = _findAmbient();
  if (ambient) ambient.intensity *= 0.08;
  flickerLights.forEach(f => { f._savedBase = f.base; f.base *= 0.06; f.light.intensity *= 0.06; });
}

function _restoreWorldLights() {
  const ambient = _findAmbient();
  if (ambient) ambient.intensity /= 0.08;
  flickerLights.forEach(f => {
    if (f._savedBase !== undefined) { f.base = f._savedBase; f.light.intensity = f._savedBase; delete f._savedBase; }
  });
}

// ── Ghost singleton ─────────────────────────────────────────────────────────
// Build the ghost + light rig ONCE and leave them in the scene (ghost hidden,
// lights at 0). Every later scare just repositions and shows them, so there's no
// clone / material-clone / add-light work — and no shader recompile — mid-game.
function _buildGhost() {
  if (_ghost || !_gltf) return;
  const clone = skeletonClone(_gltf.scene);
  _tuneMaterials(clone, 0.2);
  clone.scale.setScalar(SCALE);
  clone.visible = false;
  scene.add(clone);
  _ghost = clone;

  _lightRig = _buildLightRig();
  _lightRig.visible = true;          // stays visible so its lights are always counted
  scene.add(_lightRig);

  _state.mixer = new THREE.AnimationMixer(_ghost);
  if (_gltf.animations.length) _state.mixer.clipAction(_gltf.animations[0]).play();
}

// Compile shaders + upload textures/geometry to the GPU during the loading
// screen (a stall there is expected and hidden), instead of on the first scare.
// Renders one throwaway frame with the ghost visible; the menu overlay covers
// the canvas so nothing is seen.
export function warmUpScare() {
  if (_warmedUp || !_gltf) return;
  _buildGhost();
  if (!_ghost) return;
  _ghost.position.set(camera.position.x, Y_OFFSET, camera.position.z);
  _ghost.visible = true;
  renderer.render(scene, camera);    // forces compile + GPU upload now
  _ghost.visible = false;
  _warmedUp = true;
}

// ── Sprite lifecycle ──────────────────────────────────────────────────────────
export function clearScareSprite() {
  if (_state.fadeTimer) { clearTimeout(_state.fadeTimer); _state.fadeTimer = null; }
  if (_state.sprite) {
    _ghost.visible = false;            // hide, don't remove — keeps it warm for next time
    if (_keyLight) _keyLight.intensity = 0;
    if (_rimLight) _rimLight.intensity = 0;
    _state.sprite = null;
    _restoreWorldLights();
    if (_state.mixer) _state.mixer.stopAllAction();
  }
}

// ── Blackout scare — every light in the school dies for a few seconds ────────
// Uses the same dim/restore pair as the ghost spawn, so the two are mutually
// exclusive (double-dimming would corrupt the saved light intensities).
const _blackout = { active: false, timers: [] };

export function clearBlackout() {
  _blackout.timers.forEach(clearTimeout);
  _blackout.timers = [];
  if (_blackout.active) {
    _restoreWorldLights();
    _blackout.active = false;
  }
}

export function triggerBlackout() {
  if (_blackout.active || _state.sprite) return;
  _blackout.active = true;
  const at = (ms, fn) => _blackout.timers.push(setTimeout(fn, ms));

  _dimWorldLights();                       // lights cut

  // something moves in the dark…
  at(650, () => AudioManager.play(
    BLACKOUT_SOUNDS[Math.floor(Math.random() * BLACKOUT_SOUNDS.length)]));

  // stutter back on: on → off → on (strictly alternating dim/restore pairs)
  const hold = 2400 + Math.random() * 1000;
  at(hold,       () => _restoreWorldLights());
  at(hold + 90,  () => _dimWorldLights());
  at(hold + 240, () => {
    _restoreWorldLights();
    _blackout.active = false;
    _blackout.timers = [];
    if (Math.random() < BLACKOUT_GHOST_CHANCE) _spawnScare(0);
  });
}

function _spawnScare(turnDir) {
  if (_state.sprite || _blackout.active) return;
  if (!_gltf) { _loadModel(() => {}); return; }   // not preloaded yet — skip this one
  _buildGhost();
  if (!_ghost) return;

  const sinY = Math.sin(look.yaw), cosY = Math.cos(look.yaw);
  const dist    = 3.2;
  const lateral = -turnDir * 1.0;
  const px = camera.position.x + (-sinY * dist) + (cosY  * lateral);
  const pz = camera.position.z + (-cosY * dist) + (-sinY * lateral);

  _ghost.position.set(px, Y_OFFSET, pz);
  _ghost.rotation.y = Math.atan2(camera.position.x - px, camera.position.z - pz);
  _ghost.visible = true;

  // Bring the persistent light rig onto the ghost and turn it up.
  _lightRig.position.copy(_ghost.position);
  _lightRig.rotation.y = _ghost.rotation.y;
  _keyLight.intensity = KEY_INTENSITY;
  _rimLight.intensity = RIM_INTENSITY;

  _dimWorldLights(); // dim scene lights so the ghost's own lights own the moment
  _state.sprite = _ghost;

  if (_state.mixer && _gltf.animations.length) {
    _state.mixer.clipAction(_gltf.animations[0]).reset().play();
  }
  renderer.render(scene, camera); // immediate frame — cheap now (already warm)

  AudioManager.play(SCARE_SOUNDS[Math.floor(Math.random() * SCARE_SOUNDS.length)]);

  const totalMs   = 900 + Math.random() * 650;
  const fadeOutMs = 250;
  const start     = performance.now();

  const tick = () => {
    if (_state.sprite !== _ghost) return;
    const elapsed = performance.now() - start;
    _ghost.visible = elapsed <= totalMs - fadeOutMs;
    if (elapsed < totalMs) {
      _state.fadeTimer = setTimeout(tick, 16);
    } else {
      clearScareSprite();
    }
  };
  _state.fadeTimer = setTimeout(tick, 16);
}

function _playRandomNoise() {
  AudioManager.play(NOISE_SOUNDS[Math.floor(Math.random() * NOISE_SOUNDS.length)]);
}

function _resolveTensionTrigger(turnDir) {
  const roll = Math.random();
  if (roll < VISUAL_CHANCE)                         _spawnScare(turnDir);
  else if (roll < VISUAL_CHANCE + BLACKOUT_CHANCE)  triggerBlackout();
  else                                              _playRandomNoise();
  _state.cooldown  = _cooldownRng();
  _state.turnAccum = 0;
  _state.walkTime  = 0;
}

// ── Per-frame update ──────────────────────────────────────────────────────────
export function updateAmbientScares(dt) {
  if (gState.current !== S.PLAYING) return;

  _state.cooldown -= dt;
  _state.noiseCooldown -= dt;

  if (_state.noiseCooldown <= 0 && !_state.sprite) {
    _playRandomNoise();
    _state.noiseCooldown = _noiseCooldownRng();
  }

  if (_state.prevYaw === null) { _state.prevYaw = look.yaw; return; }
  const dyaw = look.yaw - _state.prevYaw;
  _state.prevYaw = look.yaw;

  _state.turnAccum  += dyaw;
  _state.turnWindow += dt;
  if (_state.turnWindow > 0.28) {
    _state.turnAccum  = dyaw;
    _state.turnWindow = 0;
  }

  const isWalking = keys['KeyW'] || keys['ArrowUp']  ||
                    keys['KeyS'] || keys['ArrowDown'] ||
                    keys['KeyA'] || keys['ArrowLeft'] ||
                    keys['KeyD'] || keys['ArrowRight'];

  _state.walkTime = isWalking ? _state.walkTime + dt : 0;

  if (Math.abs(_state.turnAccum) > TURN_TRIGGER && _state.cooldown <= 0 && !_state.sprite) {
    _resolveTensionTrigger(Math.sign(_state.turnAccum));
  }

  if (_state.walkTime >= WALK_DELAY && _state.cooldown <= 0 && !_state.sprite) {
    _resolveTensionTrigger(0);
  }

  if (_state.sprite && _state.mixer) _state.mixer.update(dt);
}

export function resetAmbientScares() {
  clearScareSprite();
  clearBlackout();
  _state.prevYaw    = null;
  _state.turnAccum  = 0;
  _state.turnWindow = 0;
  _state.walkTime   = 0;
  _state.cooldown   = _initialCooldownRng();
  _state.noiseCooldown = _noiseCooldownRng();
}
