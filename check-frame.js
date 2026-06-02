import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5173;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-gpu', '--use-gl=egl', '--disable-web-security'],
});
const ctx  = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on('console', () => {});
page.on('pageerror', () => {});

await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => {
  const s = document.getElementById('s-title');
  return s && !s.classList.contains('hidden');
}, { timeout: 30000 });

await page.evaluate(() => {
  window.__devPlay?.();
  HTMLElement.prototype.requestPointerLock = () => {};
  document.exitPointerLock = () => {};
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  ['hud', 'dev-scare-btn', 'vignette', 'persistent-fs-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  // Lift fog so the hall reads on screen (gameplay fog is intentionally oppressive)
  if (window.__scene) window.__scene.fog.density = 0.028;
  window.__escapeRoomDebug?.setPose({ x: -2.1, y: 1.7, z: 2, yaw: Math.PI, pitch: -0.04 });
});
await page.waitForTimeout(500);

await page.screenshot({ path: path.join(__dirname, 'hallway-preview.png') });
console.log('Screenshot saved → hallway-preview.png');
await browser.close();
