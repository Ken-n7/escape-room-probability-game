import { GameDevice, unlockPointer, resetMouseDelta } from '../input/input.js';
import { renderer } from '../core/renderer.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

export const screens = {
  loading:  $('s-loading'),
  title:    $('s-title'),
  menu:     $('s-menu'),
  story:    $('s-story'),
  plearn:   $('s-plearn'),
  ready:    $('s-ready'),
  question: $('s-question'),
  code:     $('s-code'),
  settings: $('s-settings'),
  about:    $('s-about'),
  win:      $('s-win'),
  lose:     $('s-lose'),
  options:  $('s-options'),
  pause:    $('s-pause'),
};

export const elHud             = $('hud');
export const elPrompt          = $('interact-prompt');
export const elVignette        = $('vignette');
export const elCodeTracker     = $('code-tracker');
export const elHudPlayer       = $('hud-player');
export const elOptionsConfirm  = $('options-confirm');
export const elOptionsConfirmText = $('options-confirm-text');
export const elPersistentFsBtn = $('persistent-fs-btn');
export const elFsIconEnter     = $('fs-icon-enter');
export const elFsIconExit      = $('fs-icon-exit');

// ── Screen management ─────────────────────────────────────────────────────────
export function setCanInteract(canInteract) {
  document.body.dataset.canInteract = canInteract ? 'true' : 'false';
}

export function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  elHud.style.display = 'none';
  document.body.dataset.hudVisible = 'false';
  setCanInteract(false);
  renderer.domElement.style.cursor = 'auto';
  unlockPointer();
  if (name) screens[name].classList.remove('hidden');
}

export function showHUD() {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  elHud.style.display = 'block';
  document.body.dataset.hudVisible = 'true';
  renderer.domElement.style.cursor = GameDevice.usePointerLock ? 'none' : 'auto';
  resetMouseDelta(); // prevent camera-jump when mouse re-enters the game area
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
export function hideOptionsConfirm() {
  elOptionsConfirm.classList.add('hidden');
  elOptionsConfirmText.textContent = '';
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
export function updateFullscreenLabel() {
  const isFull = Boolean(document.fullscreenElement);
  if (!elPersistentFsBtn) return;
  if (!document.fullscreenEnabled) { elPersistentFsBtn.style.display = 'none'; return; }
  elPersistentFsBtn.style.display = '';
  const label = isFull ? 'Exit Fullscreen' : 'Enter Fullscreen';
  elPersistentFsBtn.title = label;
  elPersistentFsBtn.setAttribute('aria-label', label);
  if (elFsIconEnter) elFsIconEnter.style.display = isFull ? 'none' : '';
  if (elFsIconExit)  elFsIconExit.style.display  = isFull ? '' : 'none';
}

export async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {}
  updateFullscreenLabel();
}

document.addEventListener('fullscreenchange', updateFullscreenLabel);
