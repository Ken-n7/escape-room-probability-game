import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { setGltf as setChaseGltf  } from './chase.js';
import { setGltf as setScareGltf  } from './scare.js';
import { setGltf as setLoseGltf   } from './lose-canvas.js';
import { showScreen } from './hud.js';

const MODELS = [
  { path: '/assets/3D/horror-woman.glb',                              store: setChaseGltf },
  { path: '/assets/3D/the_unvermeidlich_ghost_darkness_of_eclipse.glb', store: setScareGltf },
  { path: '/assets/3D/smily_horror_monster.glb',                      store: setLoseGltf  },
];

function loadGLTF(path) {
  return new Promise((resolve, reject) => new GLTFLoader().load(path, resolve, undefined, reject));
}

export async function preloadAssets() {
  const bar   = document.getElementById('loading-bar');
  const label = document.getElementById('loading-label');

  let done = 0;
  const setProgress = n => {
    bar.style.width = `${Math.round((n / MODELS.length) * 100)}%`;
  };

  await Promise.all(MODELS.map(async ({ path, store }) => {
    try {
      store(await loadGLTF(path));
    } catch (err) {
      console.warn(`Failed to preload ${path}`, err);
    }
    setProgress(++done);
  }));

  label.textContent = 'READY';
  await new Promise(r => setTimeout(r, 120));
  showScreen('title');
}
