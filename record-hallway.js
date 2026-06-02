/**
 * Captures a hallway walkthrough video from the game's starting position.
 * Output: public/assets/hallway_video.webm
 *
 * Run: node record-hallway.js
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH  = path.join(__dirname, 'public/assets/hallway_video.webm');
const PORT      = 5173;
const URL       = `http://localhost:${PORT}`;

const RECORD_DURATION_MS = 18000;  // how long to walk/record

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-gpu',
    '--use-gl=egl',
    '--disable-web-security',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: {
    dir: path.join(__dirname, 'public/assets/'),
    size: { width: 1280, height: 720 },
  },
});

const page = await ctx.newPage();

// Silence console noise
page.on('console', () => {});
page.on('pageerror', () => {});

console.log('Opening game…');
await page.goto(URL, { waitUntil: 'networkidle' });

// Wait for the loading screen to finish (preload completes → title shows)
console.log('Waiting for preload to finish…');
await page.waitForFunction(() => {
  const s = document.getElementById('s-title');
  return s && !s.classList.contains('hidden');
}, { timeout: 30000 });

console.log('Loading done. Starting game via devPlay…');
await page.evaluate(() => {
  window.__devPlay?.();
  // Suppress pointer-lock request so headless doesn't error
  HTMLElement.prototype.requestPointerLock = () => {};
  document.exitPointerLock = () => {};
});

// Give the world one frame to settle
await page.waitForTimeout(200);

// Hide all UI chrome — clean world-only footage
await page.evaluate(() => {
  ['hud', 'dev-scare-btn', 'vignette', 'persistent-fs-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  // Lift fog from gameplay density to cinematic density
  if (window.__scene) window.__scene.fog.density = 0.028;
});

// Left-wall corner at start, facing +Z down the hall (yaw=Math.PI = facing +Z in Three.js YXZ)
await page.evaluate(() => {
  window.__escapeRoomDebug?.setPose({
    x: -2.1, y: 1.7, z: 2,
    yaw: Math.PI,
    pitch: -0.04,
  });
});

console.log(`Recording ${RECORD_DURATION_MS / 1000}s of hallway…`);

// Slow forward walk
await page.keyboard.down('KeyW');

// Let flickering lights and fog animate for the full duration
await page.waitForTimeout(RECORD_DURATION_MS);

await page.keyboard.up('KeyW');

console.log('Stopping recording…');
const video = await page.video();
await ctx.close();
await browser.close();

// Playwright saves to a temp name; rename to our target
const tmpPath = await video.path();
import { renameSync } from 'fs';
renameSync(tmpPath, OUT_PATH);

console.log(`Saved → ${OUT_PATH}`);
