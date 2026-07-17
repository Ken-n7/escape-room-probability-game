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
const SCARE_SOUNDS = ['randomScareWhisper', 'randomScream'];
const NOISE_SOUNDS = ['randomMoan', 'randomTone', 'randomRunning', 'randomScream'];
const WALK_DELAY   = 3.2;   // commit to movement before tension can pay off
const TURN_TRIGGER = 0.55;
const VISUAL_CHANCE = 0.32;

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

function _addDetailLights(root) {
  // Key light — warm, spills onto nearby walls/floor so the ghost feels grounded
  const key = new THREE.PointLight(0xffdcc4, 8.0, 10, 1.4);
  key.position.set(0, 1.35, 0.65);
  root.add(key);

  // Rim light — red backlight for silhouette drama
  const rim = new THREE.PointLight(0xff2d18, 3.0, 6, 1.6);
  rim.position.set(0, 1.65, -0.8);
  root.add(rim);
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

// ── Sprite lifecycle ──────────────────────────────────────────────────────────
export function clearScareSprite() {
  if (_state.fadeTimer) { clearTimeout(_state.fadeTimer); _state.fadeTimer = null; }
  if (_state.sprite)    { scene.remove(_state.sprite); _state.sprite = null; _restoreWorldLights(); }
  if (_state.mixer)     { _state.mixer.stopAllAction(); _state.mixer = null; }
}

function _spawnScare(turnDir) {
  if (_state.sprite) return;

  _loadModel(gltf => {
    if (_state.sprite) return;

    const sinY = Math.sin(look.yaw), cosY = Math.cos(look.yaw);
    const dist    = 3.2;
    const lateral = -turnDir * 1.0;
    const px = camera.position.x + (-sinY * dist) + (cosY  * lateral);
    const pz = camera.position.z + (-cosY * dist) + (-sinY * lateral);

    const clone = skeletonClone(gltf.scene);
    _tuneMaterials(clone, 0.2);
    _addDetailLights(clone);
    clone.visible = true;
    clone.scale.setScalar(SCALE);
    clone.position.set(px, Y_OFFSET, pz);
    clone.rotation.y = Math.atan2(camera.position.x - px, camera.position.z - pz);
    scene.add(clone);
    _dimWorldLights(); // kill scene lights so ghost's own lights own the moment

    _state.sprite = clone;
    _state.mixer  = new THREE.AnimationMixer(clone);
    if (gltf.animations.length) _state.mixer.clipAction(gltf.animations[0]).play();
    renderer.render(scene, camera); // force immediate frame

    AudioManager.play(SCARE_SOUNDS[Math.floor(Math.random() * SCARE_SOUNDS.length)]);

    const totalMs  = 900 + Math.random() * 650;
    const fadeOutMs = 250;
    const start    = performance.now();

    const tick = () => {
      if (!_state.sprite || _state.sprite !== clone) return;
      const elapsed = performance.now() - start;
      clone.visible = elapsed <= totalMs - fadeOutMs;
      if (elapsed < totalMs) {
        _state.fadeTimer = setTimeout(tick, 16);
      } else {
        clearScareSprite();
      }
    };
    _state.fadeTimer = setTimeout(tick, 16);
  });
}

function _playRandomNoise() {
  AudioManager.play(NOISE_SOUNDS[Math.floor(Math.random() * NOISE_SOUNDS.length)]);
}

function _resolveTensionTrigger(turnDir) {
  if (Math.random() < VISUAL_CHANCE) _spawnScare(turnDir);
  else _playRandomNoise();
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
  _state.prevYaw    = null;
  _state.turnAccum  = 0;
  _state.turnWindow = 0;
  _state.walkTime   = 0;
  _state.cooldown   = _initialCooldownRng();
  _state.noiseCooldown = _noiseCooldownRng();
}
