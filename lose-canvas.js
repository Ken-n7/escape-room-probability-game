import * as THREE from 'three';
import { makeGLTFLoader } from './gltf-loader.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _renderer = null;
let _scene    = null;
let _camera   = null;
let _mixer    = null;
let _gltf     = null;
const _clock  = new THREE.Clock(false);

const MODEL_PATH = '/assets/3D/smily_horror_monster.glb';

// Called by preload.js to store the pre-fetched GLTF
export function setGltf(gltf) { _gltf = gltf; }

// ── Init (called lazily on first LOSE frame) ──────────────────────────────────
export function initLoseCanvas() {
  if (_renderer) return;
  const canvas = document.getElementById('lose-canvas');
  if (!canvas) return;

  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  _renderer.setSize(400, 400, false);
  _renderer.setClearColor(0x000000, 0);

  _scene  = new THREE.Scene();
  _camera = new THREE.PerspectiveCamera(50, 1, 0.001, 500);

  _scene.add(new THREE.AmbientLight(0xffffff, 2.5));
  const dl1 = new THREE.DirectionalLight(0xff3311, 4);   dl1.position.set(0, 1, 1);  _scene.add(dl1);
  const dl2 = new THREE.DirectionalLight(0xffffff, 1.5); dl2.position.set(0, 1, -1); _scene.add(dl2);

  if (_gltf) {
    _setup(_gltf);
  } else {
    makeGLTFLoader().load(MODEL_PATH, _setup);
  }
}

function _setup(gltf) {
  const m = gltf.scene;
  _scene.add(m);

  const box1 = new THREE.Box3().setFromObject(m);
  const sz   = new THREE.Vector3(); box1.getSize(sz);
  m.scale.setScalar(2 / Math.max(sz.x, sz.y, sz.z));

  const box2   = new THREE.Box3().setFromObject(m);
  const centre = new THREE.Vector3(); box2.getCenter(centre);
  const sz2    = new THREE.Vector3(); box2.getSize(sz2);
  m.position.sub(centre);

  _camera.position.set(0, 0.1, Math.max(sz2.x, sz2.y) * 1.75);
  _camera.lookAt(0, 0.1, 0);

  _mixer = new THREE.AnimationMixer(m);
  if (gltf.animations.length) _mixer.clipAction(gltf.animations[0]).play();
  _clock.start();
}

// ── Per-frame update ──────────────────────────────────────────────────────────
export function updateLoseCanvas() {
  if (!_renderer || !_scene || !_camera) return;
  _mixer?.update(_clock.getDelta());
  _renderer.render(_scene, _camera);
}
