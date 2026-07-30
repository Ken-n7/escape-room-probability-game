import * as THREE from 'three';
import { CFG } from './config.js';

export const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
renderer.shadowMap.enabled = false;
// ACES filmic tone mapping — richer contrast and gentler highlight rolloff than
// the default linear clamp, so the fluorescents and candles don't blow out to
// flat white. Free on every device (a shader constant, no extra passes).
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
