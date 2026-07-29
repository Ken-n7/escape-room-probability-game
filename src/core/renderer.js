import * as THREE from 'three';
import { CFG } from './config.js';
import { resolveKnobs, effectivePixelRatio } from './quality.js';

// Boot the renderer at whatever tier the player last chose (Auto by default).
// antialias is fixed at context creation, so it can only change on reload;
// pixel ratio + shadows are re-applied live from main.js on tier changes.
const _boot = resolveKnobs();
export const renderer = new THREE.WebGLRenderer({
  antialias: _boot.antialias,
  powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(effectivePixelRatio(_boot));
renderer.shadowMap.enabled = _boot.shadows;
// Filmic grade for every tier (near-free). OutputPass applies this in the
// composed path; the renderer applies it on the direct (Low) path. Exposure is
// nudged >1 so the already-dark horror scene doesn't lose its lifted brightness.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
document.body.appendChild(renderer.domElement);
renderer.domElement.tabIndex = 0;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030508);
scene.fog = new THREE.FogExp2(0x030508, CFG.fog.density);

export const camera = new THREE.PerspectiveCamera(
  75, window.innerWidth / window.innerHeight, 0.1, 60
);
camera.rotation.order = 'YXZ';
scene.add(camera);
