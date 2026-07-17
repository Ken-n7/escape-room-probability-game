import * as THREE from 'three';
import { makeGLTFLoader } from '../loaders/gltf-loader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { gState, look, keys, S } from '../core/game-state.js';
import { scene, camera, renderer } from '../core/renderer.js';
import { AudioManager } from '../audio/audio.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const MODEL_PATH   = '/assets/3D/the_unvermeidlich_ghost_darkness_of_eclipse.glb';
const SCALE        = 0.88;
const Y_OFFSET     = -0.08;
const SOUNDS       = ['randomScareWhisper', 'randomScareHit'];
const WALK_DELAY   = 1.1;   // seconds of walking before triggering a scare

const _cooldownRng = () => 8 + Math.random() * 7;

// ── State ─────────────────────────────────────────────────────────────────────
const _state = {
  cooldown:   _cooldownRng(),
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
  const key = new THREE.PointLight(0xffdcc4, 6.4, 7, 1.45);
  key.position.set(0, 1.35, 0.65);
  root.add(key);

  const rim = new THREE.PointLight(0xff2d18, 1.8, 4.6, 1.7);
  rim.position.set(0, 1.65, -0.8);
  root.add(rim);
}

// ── Sprite lifecycle ──────────────────────────────────────────────────────────
export function clearScareSprite() {
  if (_state.fadeTimer) { clearTimeout(_state.fadeTimer); _state.fadeTimer = null; }
  if (_state.sprite)    { scene.remove(_state.sprite); _state.sprite = null; }
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

    _state.sprite = clone;
    _state.mixer  = new THREE.AnimationMixer(clone);
    if (gltf.animations.length) _state.mixer.clipAction(gltf.animations[0]).play();
    renderer.render(scene, camera); // force immediate frame

    AudioManager.play(SOUNDS[Math.floor(Math.random() * SOUNDS.length)]);

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

// ── Per-frame update ──────────────────────────────────────────────────────────
export function updateAmbientScares(dt) {
  if (gState.current !== S.PLAYING) return;

  _state.cooldown -= dt;

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

  if (Math.abs(_state.turnAccum) > 0.26 && _state.cooldown <= 0 && !_state.sprite) {
    _spawnScare(Math.sign(_state.turnAccum));
    _state.cooldown  = _cooldownRng();
    _state.turnAccum = 0;
    _state.walkTime  = 0;
  }

  if (_state.walkTime >= WALK_DELAY && _state.cooldown <= 0 && !_state.sprite) {
    _spawnScare(0);
    _state.cooldown  = _cooldownRng();
    _state.turnAccum = 0;
    _state.walkTime  = 0;
  }

  if (_state.sprite && _state.mixer) _state.mixer.update(dt);
}

export function resetAmbientScares() {
  clearScareSprite();
  _state.prevYaw    = null;
  _state.turnAccum  = 0;
  _state.turnWindow = 0;
  _state.walkTime   = 0;
  _state.cooldown   = _cooldownRng();
}
