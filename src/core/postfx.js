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
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { renderer, scene, camera } from './renderer.js';
import { getKnobs, onQualityChange, effectivePixelRatio } from './quality.js';

let composer = null, bloomPass = null, smaaPass = null, filmPass = null, gtaoPass = null;
let _active = false;   // true when the composer should drive the frame

function size() {
  const v = new THREE.Vector2();
  renderer.getSize(v);           // CSS pixels; composer scales by pixel ratio
  return v;
}

function build() {
  const s = size();
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // Ambient occlusion — soft contact darkening where geometry meets (under
  // desks/chairs/lockers, wall corners). Grounds objects; light-count-proof.
  // Modest radius/intensity so it deepens shadow crevices without going sooty.
  gtaoPass = new GTAOPass(scene, camera, s.x, s.y);
  gtaoPass.output = GTAOPass.OUTPUT.Default;
  gtaoPass.blendIntensity = 0.85;
  gtaoPass.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1, thickness: 1, scale: 1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
  composer.addPass(gtaoPass);

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
  const wants = k.bloom || k.antialias || k.ssao;
  if (wants && !composer) build();
  if (composer) {
    gtaoPass.enabled  = k.ssao;
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
