import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { setGltf as setChaseGltf  } from './chase.js';
import { setGltf as setScareGltf  } from './scare.js';
import { setGltf as setLoseGltf   } from './lose-canvas.js';
import { showScreen } from './hud.js';

const MODELS = [
  { path: '/assets/3D/horror-woman.glb',                               store: setChaseGltf, label: 'Loading entity data...'          },
  { path: '/assets/3D/the_unvermeidlich_ghost_darkness_of_eclipse.glb', store: setScareGltf, label: 'Do not look behind you...'        },
  { path: '/assets/3D/smily_horror_monster.glb',                       store: setLoseGltf,  label: 'Retrieving incident records...'   },
];

const FLAVOR_TEXTS = [
  'Scanning encrypted case files...',
  'The ghost student was last seen in Room 308...',
  'Something is already inside.',
  'Initializing probability engine...',
  'Entity detected in east corridor.',
  'WARNING: Unauthorized presence detected.',
  'Cross-referencing supernatural database...',
  'Case files partially corrupted... reconstructing.',
  'The air grows colder.',
  'Reviewing incident reports...',
  'Do not make a sound.',
];

function loadGLTF(path) {
  return new Promise((resolve, reject) => new GLTFLoader().load(path, resolve, undefined, reject));
}

export async function preloadAssets() {
  const screen  = document.getElementById('s-loading');
  const bar     = document.getElementById('loading-bar');
  const status  = document.getElementById('loading-status');
  const flavor  = document.getElementById('loading-flavor');

  // ── Flavor text rotator ───────────────────────────────────────────────────
  let flavorIdx   = 0;
  let flavorTimer = null;

  function rotateFlavor() {
    flavor.classList.add('fade');
    flavorTimer = setTimeout(() => {
      flavorIdx = (flavorIdx + 1) % FLAVOR_TEXTS.length;
      flavor.textContent = FLAVOR_TEXTS[flavorIdx];
      flavor.classList.remove('fade');
      flavorTimer = setTimeout(rotateFlavor, 2200);
    }, 350);
  }
  flavorTimer = setTimeout(rotateFlavor, 2200);

  // ── Load all models in parallel, update bar + status per completion ───────
  let done = 0;

  await Promise.all(MODELS.map(async ({ path, store, label }) => {
    status.textContent = label;
    try {
      store(await loadGLTF(path));
    } catch (err) {
      console.warn(`Failed to preload ${path}`, err);
    }
    done++;
    bar.style.width = `${Math.round((done / MODELS.length) * 100)}%`;
  }));

  // ── All done ──────────────────────────────────────────────────────────────
  clearTimeout(flavorTimer);

  flavor.classList.add('fade');
  setTimeout(() => {
    flavor.textContent = 'All systems ready.';
    flavor.classList.remove('fade');
  }, 350);

  screen.classList.add('ready');
  status.textContent = 'READY';

  await new Promise(r => setTimeout(r, 900));

  // Fade out loading screen, then switch to title
  screen.style.opacity = '0';
  await new Promise(r => setTimeout(r, 580));
  showScreen('title');
}
