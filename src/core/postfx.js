// ═══════════════════════════════════════════════════════════════════════════════
//  POST-PROCESSING (Tier 1) — the composed render path.
//
//  RenderPass → Bloom → SMAA → Film grain → OutputPass, each gated by the active
//  quality tier. Low tier skips the composer entirely (direct render) to stay
//  cheap on weak phones; Medium/High run the composer. ACES tone mapping is set
//  on the renderer itself (renderer.js), so every tier gets the filmic grade.
//
//  Call renderScene() wherever the main loop used to call renderer.render(...).
// ═══════════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { renderer, scene, camera } from './renderer.js';
import { getKnobs, onQualityChange, effectivePixelRatio } from './quality.js';

let composer = null, bloomPass = null, smaaPass = null, filmPass = null, gradePass = null;
let _active = false;   // true when the composer should drive the frame

// Cinematic grade: a faint cool tint, an edge vignette, and subtle chromatic
// aberration that grows toward the corners. One cheap fullscreen pass.
const GradeShader = {
  uniforms: {
    tDiffuse:    { value: null },
    uVignette:   { value: 0.55 },
    uAberration: { value: 0.0042 },
    uTint:       { value: new THREE.Vector3(0.95, 1.0, 1.06) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uAberration;
    uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float d = length(c);
      vec2 off = c * d * uAberration;
      vec3 col = vec3(
        texture2D(tDiffuse, vUv + off).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - off).b
      );
      col *= uTint;
      col *= 1.0 - smoothstep(0.32, 0.78, d) * uVignette;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

function size() {
  const v = new THREE.Vector2();
  renderer.getSize(v);           // CSS pixels; composer scales by pixel ratio
  return v;
}

function build() {
  const s = size();
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // Glow on bright emissives (fluorescents, exit sign, candle). Kept gentle so
  // the lights gleam rather than blind: low strength, high threshold so only the
  // very brightest pixels bloom. (strength, radius, threshold)
  bloomPass = new UnrealBloomPass(new THREE.Vector2(s.x, s.y), 0.28, 0.4, 0.9);
  composer.addPass(bloomPass);

  smaaPass = new SMAAPass(s.x, s.y);
  composer.addPass(smaaPass);

  // Subtle film grain — texture + unease, no scanlines.
  filmPass = new FilmPass(0.18);
  composer.addPass(filmPass);

  // Cinematic grade — cool tint, edge vignette, faint chromatic aberration.
  gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);

  composer.addPass(new OutputPass());   // tone mapping + sRGB, last
  applySize();
}

function applySize() {
  if (!composer) return;
  const s = size();
  composer.setPixelRatio(effectivePixelRatio());
  composer.setSize(s.x, s.y);
}

// Enable/disable passes for a tier; lazily builds the composer the first time a
// tier actually needs it. Low tier (no bloom, no AA) stays on the direct path.
export function configurePostFX(k = getKnobs()) {
  const wants = k.bloom || k.antialias;
  if (wants && !composer) build();
  if (composer) {
    bloomPass.enabled = k.bloom;
    smaaPass.enabled  = k.antialias;
    filmPass.enabled  = true;
    applySize();
  }
  _active = wants && !!composer;
}

export function renderScene() {
  if (_active && composer) composer.render();
  else renderer.render(scene, camera);
}

// Keep the composer in step with the renderer on resize + tier changes.
window.addEventListener('resize', applySize);
onQualityChange(configurePostFX);
configurePostFX();
