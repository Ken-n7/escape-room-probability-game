// ═══════════════════════════════════════════════════════════════════════════════
//  DUST MOTES — slow floating particles that catch the light (Med/High).
//  A single THREE.Points field that wraps around the camera, so motes always
//  drift near the player. Additive blending → they glow faintly in lit areas and
//  vanish in the dark, exactly like real dust in a light beam.
// ═══════════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { getKnobs, onQualityChange } from '../core/quality.js';

const COUNT = 110, SPAN = 14, Y0 = 0.2, Y1 = 3.0;
let _points = null, _phase = null;

// Soft radial sprite so each mote is a round glow, not a hard square.
function moteTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export function initDust(scene) {
  if (_points) return;
  const pos = new Float32Array(COUNT * 3);
  _phase = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3]     = (Math.random() * 2 - 1) * SPAN;
    pos[i * 3 + 1] = Y0 + Math.random() * (Y1 - Y0);
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * SPAN;
    _phase[i]      = Math.random() * 6.283;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xb8c4d4, size: 0.05, map: moteTexture(), transparent: true, opacity: 0.3,
    depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending,
  });
  _points = new THREE.Points(g, mat);
  _points.frustumCulled = false;
  _points.visible = getKnobs().pbr;                 // Med/High only
  scene.add(_points);
  onQualityChange(k => { if (_points) _points.visible = k.pbr; });
}

export function updateDust(dt, camera) {
  if (!_points || !_points.visible) return;
  const arr = _points.geometry.attributes.position.array;
  const cx = camera.position.x, cz = camera.position.z, t = performance.now() * 0.001;
  for (let i = 0; i < COUNT; i++) {
    const ix = i * 3;
    arr[ix]     += Math.sin(t * 0.30 + _phase[i]) * dt * 0.09;
    arr[ix + 1] += (Math.cos(t * 0.22 + _phase[i]) * 0.5 - 0.15) * dt * 0.12;   // gentle sink
    arr[ix + 2] += Math.cos(t * 0.27 + _phase[i]) * dt * 0.09;
    // wrap into a SPAN box centred on the camera so motes always surround us
    const dx = arr[ix] - cx;     if (dx >  SPAN) arr[ix]     -= 2 * SPAN; else if (dx < -SPAN) arr[ix]     += 2 * SPAN;
    const dz = arr[ix + 2] - cz; if (dz >  SPAN) arr[ix + 2] -= 2 * SPAN; else if (dz < -SPAN) arr[ix + 2] += 2 * SPAN;
    if (arr[ix + 1] > Y1) arr[ix + 1] = Y0; else if (arr[ix + 1] < Y0) arr[ix + 1] = Y1;
  }
  _points.geometry.attributes.position.needsUpdate = true;
}
