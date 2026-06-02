import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { CFG }    from './config.js';
import { ROOMS, EXIT_CODE }    from './questions.js';
import { buildWorld, flickerLights } from './world.js';
import { AudioManager }        from './audio.js';

// ═══════════════════════════════════════════════════════════════════════════════
//  RENDERER / SCENE / CAMERA
// ═══════════════════════════════════════════════════════════════════════════════
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);
renderer.domElement.tabIndex = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030508);
scene.fog = new THREE.FogExp2(0x030508, CFG.fog.density);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 60);
camera.rotation.order = 'YXZ';   // Euler order for proper FPS-style look
scene.add(camera);

const { wallBoxes, interactiveObjects } = buildWorld(scene);

// ═══════════════════════════════════════════════════════════════════════════════
//  CONTROLS & INPUT  — pointer lock (unbounded movementX/Y) + WASD
// ═══════════════════════════════════════════════════════════════════════════════
let yaw   = 0;   // camera horizontal angle (radians)
let pitch = 0;   // camera vertical angle   (radians)
let _prevX = null, _prevY = null;   // delta fallback when lock not yet active
let suppressPointerUnlockPause = false;
let queuedLookDX = 0;
let queuedLookDY = 0;
let lastRawLookAt = 0;
let lookSensitivity = 1;

const BASE_LOOK_SENS = 0.0022;
const MIN_LOOK_SENSITIVITY = 0.45;
const MAX_LOOK_SENSITIVITY = 1.8;
const INTERACT_FACING_DOT = 0.72;
const DEVICE_QUERIES = {
  primaryCoarse: window.matchMedia('(pointer: coarse)'),
  primaryFine: window.matchMedia('(pointer: fine)'),
  anyCoarse: window.matchMedia('(any-pointer: coarse)'),
  narrow: window.matchMedia('(max-width: 760px)'),
  landscape: window.matchMedia('(orientation: landscape)'),
};
const GameDevice = {};

function applyDeviceProfile() {
  const touchControls = DEVICE_QUERIES.primaryCoarse.matches || DEVICE_QUERIES.narrow.matches;
  Object.assign(GameDevice, {
    mode: touchControls ? 'mobile' : 'desktop',
    controls: touchControls ? 'touch' : 'keyboardMouse',
    hasTouch: DEVICE_QUERIES.anyCoarse.matches || navigator.maxTouchPoints > 0,
    hasFinePointer: DEVICE_QUERIES.primaryFine.matches,
    orientation: DEVICE_QUERIES.landscape.matches ? 'landscape' : 'portrait',
    usePointerLock: !touchControls && DEVICE_QUERIES.primaryFine.matches,
  });
  GameDevice.mustRotate = GameDevice.hasTouch && GameDevice.controls === 'touch' && GameDevice.orientation === 'portrait';

  document.body.dataset.device = GameDevice.mode;
  document.body.dataset.controls = GameDevice.controls;
  document.body.dataset.orientation = GameDevice.orientation;
  document.body.dataset.touch = GameDevice.hasTouch ? 'true' : 'false';
  document.body.dataset.mustRotate = GameDevice.mustRotate ? 'true' : 'false';
  window.GameDevice = GameDevice;

  if (!GameDevice.usePointerLock && document.pointerLockElement === renderer.domElement) {
    suppressPointerUnlockPause = true;
    unlockPointer();
  }

  if (document.getElementById('hud')?.style.display === 'block') {
    renderer.domElement.style.cursor = GameDevice.usePointerLock ? 'none' : 'auto';
  }
}

Object.values(DEVICE_QUERIES).forEach(query => {
  if (query.addEventListener) query.addEventListener('change', applyDeviceProfile);
  else query.addListener?.(applyDeviceProfile);
});
applyDeviceProfile();

// ── Pointer lock helpers ──────────────────────────────────────────────────────
function lockPointer() {
  if (!GameDevice.usePointerLock) return;
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.focus({ preventScroll: true });
    try {
      const request = renderer.domElement.requestPointerLock();
      request?.catch?.(() => {});
    } catch {}
  }
}
function unlockPointer() {
  if (document.pointerLockElement) document.exitPointerLock();
}

function capturePointer(el, pointerId) {
  try { el.setPointerCapture?.(pointerId); } catch {}
}

function applyLookDelta(dx, dy, multiplier = 1) {
  yaw   -= dx * BASE_LOOK_SENS * lookSensitivity * multiplier;
  pitch -= dy * BASE_LOOK_SENS * lookSensitivity * multiplier;
  pitch  = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, pitch));
  camera.rotation.set(pitch, yaw, 0);
}

function queueLookDelta(dx, dy, multiplier = 1) {
  queuedLookDX += dx * multiplier;
  queuedLookDY += dy * multiplier;
}

function flushLookInput() {
  if (!queuedLookDX && !queuedLookDY) return;
  applyLookDelta(queuedLookDX, queuedLookDY);
  queuedLookDX = 0;
  queuedLookDY = 0;
}

function queueMouseLook(e) {
  if (state !== S.PLAYING && state !== S.CHASE) return;
  let dx, dy;
  if (document.pointerLockElement === renderer.domElement) {
    dx = e.movementX || 0;
    dy = e.movementY || 0;
  } else {
    if (_prevX === null) { _prevX = e.clientX; _prevY = e.clientY; return; }
    dx = e.clientX - _prevX; dy = e.clientY - _prevY;
    _prevX = e.clientX; _prevY = e.clientY;
  }
  queueLookDelta(dx, dy);
}

// When the browser grants or releases the lock (including on ESC)
document.addEventListener('pointerlockchange', () => {
  _prevX = null; _prevY = null;
  if (suppressPointerUnlockPause) {
    suppressPointerUnlockPause = false;
    return;
  }
  if (!document.pointerLockElement && state === S.PLAYING) {
    // Lock released while playing (browser ESC or programmatic exit) → pause
    openOptions(false);
  }
});
document.addEventListener('pointerlockerror', () => { _prevX = null; _prevY = null; });

// Click on the canvas at any time while PLAYING to (re-)capture the pointer
renderer.domElement.addEventListener('click', () => {
  if (state === S.PLAYING) lockPointer();
});
renderer.domElement.addEventListener('mousedown', () => {
  if (state === S.PLAYING) lockPointer();
});

// ── Mouse / trackpad look ─────────────────────────────────────────────────────
// When locked: movementX/Y are raw, unbounded → no screen-edge limit.
// When not yet locked: fall back to clientX/Y delta until the user clicks.
document.addEventListener('pointerrawupdate', e => {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  lastRawLookAt = performance.now();
  queueMouseLook(e);
}, { capture: true });
document.addEventListener('mousemove', e => {
  if (performance.now() - lastRawLookAt < 8) return;
  queueMouseLook(e);
}, { capture: true });

renderer.domElement.addEventListener('mouseleave', () => { _prevX = null; _prevY = null; });

let touchLookId = null;
let touchLookX = 0;
let touchLookY = 0;
renderer.domElement.addEventListener('pointerdown', e => {
  if (state !== S.PLAYING) return;
  renderer.domElement.focus({ preventScroll: true });
  if (e.pointerType === 'mouse') {
    lockPointer();
    _prevX = e.clientX;
    _prevY = e.clientY;
    return;
  }
  if (GameDevice.usePointerLock) return;
  touchLookId = e.pointerId;
  touchLookX = e.clientX;
  touchLookY = e.clientY;
  capturePointer(renderer.domElement, e.pointerId);
});
renderer.domElement.addEventListener('pointermove', e => {
  if (GameDevice.usePointerLock || state !== S.PLAYING || e.pointerId !== touchLookId) return;
  const dx = e.clientX - touchLookX;
  const dy = e.clientY - touchLookY;
  touchLookX = e.clientX;
  touchLookY = e.clientY;
  queueLookDelta(dx, dy, 1.35);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
  renderer.domElement.addEventListener(type, e => {
    if (e.pointerId === touchLookId) touchLookId = null;
  });
});

const MOVE_KEYS = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
const LOOK_KEYS = new Set(['KeyI','KeyJ','KeyK','KeyL']);
const keys = {};
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (MOVE_KEYS.has(e.code) || LOOK_KEYS.has(e.code)) {
    e.preventDefault();
  }
  if (e.code === 'KeyE') tryInteract();
  if (e.code === 'KeyR' && (state === S.WIN || state === S.LOSE)) {
    e.preventDefault();
    if (state === S.WIN) $('btn-win-restart').click();
    else $('btn-lose-retry').click();
  }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    if (state === S.PLAYING) openOptions();
    else if (state === S.PAUSED) {
      if (!screens.options.classList.contains('hidden')) resumeGame();
      else if (!screens.settings.classList.contains('hidden') && settingsFrom === 'options') openOptions(false);
    }
  }
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

document.querySelectorAll('[data-move]').forEach(btn => {
  const code = btn.dataset.move;
  const set = value => { keys[code] = value; };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    capturePointer(btn, e.pointerId);
    set(true);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
    btn.addEventListener(type, () => set(false));
  });
});
function isEditableTarget(target) {
  return Boolean(target?.closest?.('input, textarea, [contenteditable="true"]'));
}

document.addEventListener('selectstart', e => {
  if (!isEditableTarget(e.target)) e.preventDefault();
});

document.addEventListener('contextmenu', e => {
  if (GameDevice.hasTouch && !isEditableTarget(e.target)) e.preventDefault();
});

// ═══════════════════════════════════════════════════════════════════════════════
//  LOCAL STORAGE — persistent profile & scores
// ═══════════════════════════════════════════════════════════════════════════════
const SAVE_KEY = 'escape_room_v1';

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; }
}
function writeSave(data) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

function normalizeLookSensitivity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_LOOK_SENSITIVITY, Math.max(MIN_LOOK_SENSITIVITY, n));
}

let _save       = loadSave();
let playerName  = _save.playerName  || 'Student';
let bestScores  = _save.bestScores  || [null, null, null]; // null = not yet completed
let bestTime    = _save.bestTime    || null;               // null = never finished
lookSensitivity = normalizeLookSensitivity(_save.lookSensitivity);

function persistSave() {
  writeSave({ playerName, bestScores, bestTime, lookSensitivity });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DOM REFS
// ═══════════════════════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const screens = {
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

const elHud         = $('hud');
const elPrompt      = $('interact-prompt');
const elVignette    = $('vignette');
const elCodeTracker = $('code-tracker');
const elHudPlayer   = $('hud-player');
const elOptionsConfirm = $('options-confirm');
const elOptionsConfirmText = $('options-confirm-text');
const elSensitivity = $('settings-sensitivity');
const elSensitivityValue = $('settings-sensitivity-value');
const elPersistentFsBtn = $('persistent-fs-btn');
const elFsIconEnter = $('fs-icon-enter');
const elFsIconExit = $('fs-icon-exit');

function setCanInteract(canInteract) {
  document.body.dataset.canInteract = canInteract ? 'true' : 'false';
}

elPrompt.addEventListener('pointerdown', e => {
  e.preventDefault();
  tryInteract();
});

function primeAudio() {
  AudioManager.startLoop('ambient').catch(err => console.warn('Audio preload failed.', err));
}

document.addEventListener('pointerdown', primeAudio, { once: true });
document.addEventListener('keydown', primeAudio, { once: true });
window.AudioManager = AudioManager;

const PRE_GAME_SCREENS = ['title', 'menu', 'story', 'plearn', 'ready', 'settings', 'about'];
const PRE_GAME_CONTROLS = [
  'button',
  '.nav-back',
  '.nav-fwd',
  '.nav-home',
  '#title-arrow',
  '#icon-settings',
  '#icon-about',
].join(',');

function isPreGameScreenVisible() {
  return PRE_GAME_SCREENS.some(name => !screens[name].classList.contains('hidden'));
}

document.addEventListener('click', e => {
  if (!isPreGameScreenVisible()) return;
  const control = e.target.closest(PRE_GAME_CONTROLS);
  if (!control) return;
  if (
    (control.classList.contains('nav-back') || control.classList.contains('nav-fwd')) &&
    (!screens.story.classList.contains('hidden') || !screens.plearn.classList.contains('hidden'))
  ) return;
  AudioManager.play('uiClick');
});

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  elHud.style.display = 'none';
  document.body.dataset.hudVisible = 'false';
  setCanInteract(false);
  renderer.domElement.style.cursor = 'auto';   // restore cursor for UI
  unlockPointer();                              // release pointer lock for any UI
  if (name) screens[name].classList.remove('hidden');
}

function showHUD() {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  elHud.style.display = 'block';
  document.body.dataset.hudVisible = 'true';
  renderer.domElement.style.cursor = GameDevice.usePointerLock ? 'none' : 'auto';
  _prevX = null; _prevY = null;                // prevent delta-mode jump
  // Note: pointer is (re-)locked by lockPointer() called separately
}

function clearMovementInput() {
  Object.keys(keys).forEach(code => { keys[code] = false; });
  footstepTimer = 0;
}

function hideOptionsConfirm() {
  elOptionsConfirm.classList.add('hidden');
  elOptionsConfirmText.textContent = '';
}

function updateFullscreenLabel() {
  const isFull = Boolean(document.fullscreenElement);
  const available = Boolean(document.fullscreenEnabled);

  if (!elPersistentFsBtn) return;
  if (!available) {
    elPersistentFsBtn.style.display = 'none';
    return;
  }
  elPersistentFsBtn.style.display = '';
  const label = isFull ? 'Exit Fullscreen' : 'Enter Fullscreen';
  elPersistentFsBtn.title = label;
  elPersistentFsBtn.setAttribute('aria-label', label);
  if (elFsIconEnter) elFsIconEnter.style.display = isFull ? 'none' : '';
  if (elFsIconExit)  elFsIconExit.style.display  = isFull ? '' : 'none';
}

function updateSensitivityUI() {
  if (!elSensitivity || !elSensitivityValue) return;
  const percent = Math.round(lookSensitivity * 100);
  elSensitivity.value = String(percent);
  elSensitivityValue.textContent = percent + '%';
}

function setLookSensitivity(value, shouldPersist = false) {
  lookSensitivity = normalizeLookSensitivity(Number(value) / 100);
  updateSensitivityUI();
  if (shouldPersist) persistSave();
}

function openOptions(playSound = true) {
  if (state !== S.PLAYING && state !== S.PAUSED) return;
  clearMovementInput();
  hideOptionsConfirm();
  updateFullscreenLabel();
  state = S.PAUSED;
  AudioManager.setVolume('enemyNear', 0, 0.45);
  if (playSound) AudioManager.play('uiClick');
  showScreen('options');
}

function resumeGame() {
  if (state !== S.PAUSED) return;
  hideOptionsConfirm();
  showHUD();
  state = S.PLAYING;
  prevTime = performance.now();
  AudioManager.play('uiClick');
  lockPointer();
}

let pendingOptionsAction = null;
function requestOptionsConfirm(message, action) {
  pendingOptionsAction = action;
  elOptionsConfirmText.textContent = message;
  elOptionsConfirm.classList.remove('hidden');
}

function returnHomeFromOptions() {
  hideOptionsConfirm();
  clearMovementInput();
  resetProgress();
  CFG.gameplay.pLearnMode = false;
  storyIdx = 0;
  plearnIdx = 0;
  state = S.MENU;
  elVignette.style.cssText = 'opacity:0';
  AudioManager.setVolume('enemyNear', 0, 0.25);
  showScreen('title');
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {}
  updateFullscreenLabel();
}

document.addEventListener('fullscreenchange', updateFullscreenLabel);
elPersistentFsBtn?.addEventListener('click', () => {
  toggleFullscreen();
  AudioManager.play('uiClick');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  STORY SLIDES
// ═══════════════════════════════════════════════════════════════════════════════
const STORY_SLIDES = [
  'A ghost student is trapped in this classroom, condemned to wander until you solve all the problems involving probability. To help you escape, you must first overcome every test and obtain the code needed to unlock the main exit door.',
  'The room feels colder with every second, as if the air itself is being drained away. Shadows stretch and shift where there should be none, lingering a little too long before disappearing.',
  'Something unseen lingers here… and it is not alone. Explore the classrooms… but be careful. The longer you stay, the more it feels like the rooms are remembering you.',
  'Time is limited. The ghost is watching. Solve each challenge correctly, or risk being trapped here forever.',
  'Because in this place, nothing is certain — except that your escape depends on the choices you make.',
];
let storyIdx = 0;

function renderStory() {
  $('story-text').textContent = STORY_SLIDES[storyIdx];
  const nav = $('story-nav');
  nav.innerHTML = '';
  STORY_SLIDES.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'story-dot' + (i === storyIdx ? ' active' : '');
    nav.appendChild(d);
  });
}

window.storyStep = function(dir) {
  AudioManager.play('pageTurn');
  storyIdx = Math.max(0, Math.min(STORY_SLIDES.length - 1, storyIdx + dir));
  if (storyIdx >= STORY_SLIDES.length - 1 && dir > 0) { showScreen('ready'); return; }
  renderStory();
};

window.goHome = function() { showScreen('title'); storyIdx = 0; plearnIdx = 0; };

function goToStory() {
  storyIdx = 0;
  renderStory();
  showScreen('story');
  screens.story.onclick = e => {
    if (e.target === screens.story) storyStep(1);
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  P-LEARN LESSON SLIDES
// ═══════════════════════════════════════════════════════════════════════════════
const PLEARN_SLIDES = [
  {
    label: 'LESSON 1 / 6 — INTRODUCTION',
    title: 'What is Probability?',
    body: `Probability tells us how <em>likely</em> an event is to happen.<br><br>
           It is always a number between <strong>0</strong> and <strong>1</strong>:<br><br>
           &nbsp;&nbsp;• <strong>0</strong> = Impossible — will <em>never</em> happen<br>
           &nbsp;&nbsp;• <strong>0.5</strong> = Equal chance — could go either way<br>
           &nbsp;&nbsp;• <strong>1</strong> = Certain — will <em>always</em> happen`,
    note: null,
  },
  {
    label: 'LESSON 2 / 6 — KEY TERMS',
    title: 'Important Terms',
    body: `<strong>Experiment</strong> — any activity that produces outcomes<br>
           <em style="color:#8899bb">e.g. flipping a coin, rolling a die</em><br><br>
           <strong>Sample Space (S)</strong> — the set of ALL possible outcomes<br>
           <em style="color:#8899bb">e.g. {Heads, Tails} for a coin flip</em><br><br>
           <strong>Event (E)</strong> — the specific outcome(s) we want<br><br>
           <strong>Favorable Outcomes</strong> — outcomes that match our event`,
    note: null,
  },
  {
    label: 'LESSON 3 / 6 — THE FORMULA',
    title: 'How to Calculate Probability',
    body: `To find the probability of an event, always use this formula:`,
    note: 'P(Event) = Favorable Outcomes ÷ Total Possible Outcomes',
  },
  {
    label: 'LESSON 4 / 6 — EASY EXAMPLE',
    title: 'Example: Rolling a Die',
    body: `<strong>Problem:</strong> A fair die is rolled. What is P(rolling a 3)?<br><br>
           → Sample Space = {1, 2, 3, 4, 5, 6} &nbsp;→&nbsp; Total = <strong>6</strong><br>
           → Favorable outcomes = {3} &nbsp;→&nbsp; Count = <strong>1</strong><br><br>
           Apply the formula:`,
    note: 'P(3) = 1 ÷ 6 = 1/6 ≈ 0.17',
  },
  {
    label: 'LESSON 5 / 6 — MODERATE EXAMPLE',
    title: 'Example: Marbles in a Bag',
    body: `<strong>Problem:</strong> A bag has 4 red and 6 blue marbles. What is P(red)?<br><br>
           → Total marbles = 4 + 6 = <strong>10</strong><br>
           → Favorable (red) = <strong>4</strong><br><br>
           Apply the formula:`,
    note: 'P(red) = 4 ÷ 10 = 2/5 = 0.4',
  },
  {
    label: 'LESSON 6 / 6 — HARD EXAMPLE',
    title: 'Real-Life Word Problem',
    body: `<strong>Problem:</strong> A class of 30 students has 18 girls. A student is picked at random. What is P(girl)?<br><br>
           → Step 1: Identify total → <strong>30</strong> students<br>
           → Step 2: Identify favorable → <strong>18</strong> girls<br>
           → Step 3: Apply the formula:`,
    note: 'P(girl) = 18 ÷ 30 = 3/5 = 0.6',
  },
];

let plearnIdx = 0;

function renderPlearn() {
  const slide = PLEARN_SLIDES[plearnIdx];
  $('plearn-slide-label').textContent = slide.label;
  $('plearn-title').textContent = slide.title;
  $('plearn-body').innerHTML = slide.body;

  const noteEl = $('plearn-note');
  if (slide.note) { noteEl.style.display = 'block'; noteEl.textContent = slide.note; }
  else            { noteEl.style.display = 'none'; }

  const readyBtn = $('btn-plearn-ready');
  readyBtn.style.display = (plearnIdx === PLEARN_SLIDES.length - 1) ? 'inline-block' : 'none';

  $('btn-plearn-prev').disabled = plearnIdx === 0;
  $('btn-plearn-next').disabled = plearnIdx === PLEARN_SLIDES.length - 1;

  const nav = $('plearn-nav');
  nav.innerHTML = '';
  PLEARN_SLIDES.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'plearn-dot' + (i === plearnIdx ? ' active' : '');
    nav.appendChild(d);
  });

  screens.plearn.scrollLeft = 0;
  requestAnimationFrame(() => { screens.plearn.scrollLeft = 0; });
}

window.plearnStep = function(dir) {
  AudioManager.play('pageTurn');
  plearnIdx = Math.max(0, Math.min(PLEARN_SLIDES.length - 1, plearnIdx + dir));
  renderPlearn();
};

window.startGameFromLesson = function() { showScreen('ready'); };

function goToPlearn() {
  CFG.gameplay.pLearnMode = true;
  plearnIdx = 0;
  renderPlearn();
  showScreen('plearn');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════
let settingsFrom = 'menu';

function openSettings(from = 'menu') {
  settingsFrom = from;
  $('settings-name').value = playerName;
  $('settings-saved').textContent = '';
  updateSensitivityUI();
  updateFullscreenLabel();
  updateSettingsScores();
  $('btn-settings-back').textContent = from === 'options' ? '← BACK TO GAME' : '← BACK TO MENU';
  showScreen('settings');
}

function updateSettingsScores() {
  bestScores.forEach((score, i) => {
    const el = $('score-room-' + i);
    if (score === null) {
      el.textContent = '—';
      el.className = 'score-val';
    } else {
      el.textContent = score + '%';
      el.className = 'score-val' + (score === 100 ? ' perfect' : '');
    }
  });
  const btEl = $('score-best-time');
  if (btEl) btEl.textContent = bestTime !== null ? formatTime(bestTime) : '—';
}

function updateMenuName() {
  const el = $('menu-player-name') || $('menu-name-display');
  if (el) el.textContent = 'Player: ' + playerName;
}

$('btn-save-name').onclick = () => {
  const n = $('settings-name').value.trim();
  if (n) {
    playerName = n;
    persistSave();
    updateMenuName();
    elHudPlayer.textContent = playerName;
    $('settings-saved').textContent = '✓ Saved';
    setTimeout(() => { $('settings-saved').textContent = ''; }, 1800);
  }
};

$('btn-reset-progress').onclick = () => {
  if (!confirm('Reset all progress and scores?')) return;
  bestScores = [null, null, null];
  bestTime   = null;
  persistSave();
  updateSettingsScores();
  resetProgress();
  $('settings-saved').textContent = '✓ Progress reset';
  setTimeout(() => { $('settings-saved').textContent = ''; }, 2000);
};

elSensitivity.addEventListener('input', e => {
  setLookSensitivity(e.target.value, true);
});

$('btn-settings-back').onclick = () => {
  if (settingsFrom === 'options') openOptions(false);
  else showScreen('menu');
};
// ── Settings and About icons on the menu ──────────────────────────────────────
$('icon-settings').onclick = () => openSettings('menu');
$('icon-about').onclick    = () => showScreen('about');
$('btn-about-back').onclick = () => showScreen('menu');

// ═══════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════════════════════════════════════
const S = { MENU:0, PLAYING:1, PAUSED:2, QUESTION:3, CODE:4, WIN:5, LOSE:6, CHASE:7 };
let state = S.MENU;

let roomProgress      = [0, 0, 0];
let roomDone          = [false, false, false];
let codeDigits        = ['_', '_', '_'];
let roomWrong         = [0, 0, 0];   // wrong answers accumulated per room this run
let correctStreak     = 0;
let gameStartTime     = 0;
let shuffledQuestions = ROOMS.map(r => [...r.questions]);

function shuffleRooms() {
  shuffledQuestions = ROOMS.map(r => {
    const a = [...r.questions];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  });
}

// Fear stages indexed by per-room wrong count (0 = calm, 1 = uneasy, 2 = frightened)
// Hitting maxWrongAnswers triggers the jump scare instead of a stage lookup
const FEAR_STAGES = [
  { enemyVol: 0,    fogDensity: CFG.fog.density, vigOpacity: 0,    vigBg: '' },
  { enemyVol: 0.30, fogDensity: 0.095,           vigOpacity: 0.16, vigBg: 'radial-gradient(ellipse at center, transparent 36%, rgba(48,0,8,0.62) 100%)' },
  { enemyVol: 0.70, fogDensity: 0.16,            vigOpacity: 0.30, vigBg: 'radial-gradient(ellipse at center, transparent 24%, rgba(62,0,5,0.72) 100%)' },
];

function applyFear(level) {
  const stageIdx = Math.min(level, FEAR_STAGES.length - 1);
  const stage = FEAR_STAGES[stageIdx];
  AudioManager.setVolume('enemyNear', stage.enemyVol, 1.2);
  scene.fog.density = stage.fogDensity;
  elVignette.style.transition = 'opacity 1.5s, background 1.5s';
  elVignette.style.background = stage.vigBg;
  elVignette.style.opacity    = String(stage.vigOpacity);
}

function resetFear() {
  AudioManager.setVolume('enemyNear', 0, 2.0);
  scene.fog.density = CFG.fog.density;
  elVignette.style.transition = 'opacity 2s, background 2s';
  elVignette.style.background = '';
  elVignette.style.opacity    = '0';
}

function flashWrongVignette(fearLevel) {
  const stage = FEAR_STAGES[Math.min(fearLevel, FEAR_STAGES.length - 1)];
  if (wrongFeedbackTimer) { clearTimeout(wrongFeedbackTimer); wrongFeedbackTimer = null; }
  elVignette.style.transition = 'none';
  elVignette.style.background = 'radial-gradient(ellipse at center, transparent 18%, rgba(84,0,0,0.72) 100%)';
  elVignette.style.opacity    = '0.58';
  wrongFeedbackTimer = setTimeout(() => {
    elVignette.style.transition = 'opacity 0.6s, background 0.6s';
    elVignette.style.background = stage.vigBg;
    elVignette.style.opacity    = String(stage.vigOpacity);
    wrongFeedbackTimer = null;
  }, 350);
}

function triggerJumpScare() {
  document.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);
  clearQuestionTimers();

  // Phase 1 — brief silence (the contrast is what triggers the startle reflex)
  AudioManager.setVolume('ambient',    0, 0.05);
  AudioManager.setVolume('enemyNear',  0, 0.05);
  scene.fog.density = 0.48; // near-blindness in the 3D world

  setTimeout(() => {
    // Phase 2 — THE SLAM
    const overlay = document.getElementById('jumpscare-overlay');
    overlay.classList.add('active');
    overlay.style.opacity = '1';

    document.body.classList.add('screenshake');
    renderer.domElement.style.filter = 'blur(2px) saturate(2.5) brightness(1.4)';

    elVignette.style.transition = 'none';
    elVignette.style.background = 'rgba(255,228,215,1)';
    elVignette.style.opacity    = '1';

    AudioManager.play('jumpscare');
    AudioManager.playScream();

    // Phase 3 — flash cuts to near-black (130ms after slam)
    setTimeout(() => {
      document.body.classList.remove('screenshake');
      renderer.domElement.style.filter = '';
      elVignette.style.transition = 'background 0.35s, opacity 0.35s';
      elVignette.style.background = 'rgba(4,0,0,1)';
    }, 130);

    // Phase 4 — ghost face fades out (700ms after slam)
    setTimeout(() => {
      overlay.style.transition = 'opacity 0.9s';
      overlay.style.opacity    = '0';
    }, 700);

    // Phase 5 — clean up + lose screen (1700ms after slam)
    setTimeout(() => {
      overlay.classList.remove('active');
      overlay.style.transition = '';
      overlay.style.opacity    = '';
      triggerLose();
    }, 1700);

  }, 220); // 220ms silence before the scare hits
}

function calcScore(roomIdx) {
  const totalQ = ROOMS[roomIdx].questions.length;
  // Each wrong answer costs a third of one question's score; floor at 0
  return Math.max(0, Math.round((1 - roomWrong[roomIdx] / (totalQ * 2)) * 100));
}

function getElapsedSeconds() {
  return Math.floor((Date.now() - gameStartTime) / 1000);
}

function formatTime(s) {
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
}

function updateHUD() {
  elCodeTracker.textContent = 'CODE: ' + codeDigits.join(' ');
  elCodeTracker.classList.toggle('complete', roomDone.every(Boolean));
  roomDone.forEach((done, i) => {
    $('pip-' + i).className = 'room-pip' + (done ? ' done' : '');
  });
  const qEl = $('hud-q-progress');
  if (qEl) {
    const ri = state === S.QUESTION
      ? activeRoomIdx
      : roomDone.findIndex((done, i) => !done && roomProgress[i] > 0);
    qEl.textContent = ri >= 0 && !roomDone[ri]
      ? 'Q ' + (roomProgress[ri] + 1) + '/' + ROOMS[ri].questions.length
      : '';
  }
  const sEl = $('hud-streak');
  if (sEl) sEl.textContent = correctStreak >= 2 ? '+ ' + correctStreak + ' streak' : '';
}

function resetProgress() {
  roomProgress  = [0, 0, 0];
  roomDone      = [false, false, false];
  codeDigits    = ['_', '_', '_'];
  roomWrong     = [0, 0, 0];
  correctStreak = 0;
  shuffleRooms();
  resetAmbientScares();
  _cleanupChase();
  updateHUD();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  QUESTION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
let activeRoomIdx = -1;
let activeQIdx    = 0;
let wrongCount    = 0;
let questionAdvanceTimer = null;
let wrongFeedbackTimer = null;
let wrongResetTimer = null;

function clearQuestionTimers() {
  if (questionAdvanceTimer) clearTimeout(questionAdvanceTimer);
  if (wrongFeedbackTimer) clearTimeout(wrongFeedbackTimer);
  if (wrongResetTimer) clearTimeout(wrongResetTimer);
  questionAdvanceTimer = null;
  wrongFeedbackTimer = null;
  wrongResetTimer = null;
}

function openQuestion(roomIdx) {
  if (roomDone[roomIdx]) return;
  _clearScareSprite();
  clearQuestionTimers();
  activeRoomIdx = roomIdx;
  activeQIdx    = roomProgress[roomIdx];
  wrongCount    = 0;
  state = S.QUESTION;   // set BEFORE showScreen so pointerlockchange doesn't trigger pause
  applyFear(roomWrong[roomIdx]);
  showQuestionUI();
}

function showQuestionUI() {
  const room = ROOMS[activeRoomIdx];
  const q    = shuffledQuestions[activeRoomIdx][activeQIdx];
  updateHUD();

  $('question-room-label').textContent =
    room.name + ' · ' + room.label + '  —  ' + (activeQIdx+1) + ' / ' + room.questions.length;
  $('question-text').textContent = q.text;
  $('question-wrong-count').textContent = '';

  const hintBox = $('hint-box');
  if (CFG.gameplay.pLearnMode && q.hint) {
    hintBox.style.display = 'block';
    hintBox.textContent   = '💡 ' + q.hint;
  } else {
    hintBox.style.display = 'none';
  }

  document.querySelectorAll('.choice-btn').forEach((btn, i) => {
    btn.textContent = q.choices[i];
    btn.className   = 'choice-btn';
    btn.disabled    = false;
    btn.onclick     = () => handleAnswer(i);
  });

  showScreen('question');
}

function handleAnswer(choiceIdx) {
  const q = shuffledQuestions[activeRoomIdx][activeQIdx];
  clearQuestionTimers();
  document.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);

  if (choiceIdx === q.correct) {
    document.querySelectorAll('.choice-btn')[choiceIdx].classList.add('correct');
    AudioManager.play('pickup');
    correctStreak++;
    if (correctStreak === 3) AudioManager.play('pickup');
    if (correctStreak === 5 && import.meta.env.DEV) console.log('[streak] 5 correct in a row!');

    const answeredRoomIdx = activeRoomIdx;
    activeQIdx++;
    roomProgress[answeredRoomIdx] = activeQIdx;

    if (activeQIdx >= ROOMS[answeredRoomIdx].questions.length) {
      // Room complete
      roomDone[answeredRoomIdx]   = true;
      codeDigits[answeredRoomIdx] = ROOMS[answeredRoomIdx].codeDigit;

      // Calculate and save score
      const score = calcScore(answeredRoomIdx);
      if (bestScores[answeredRoomIdx] === null || score > bestScores[answeredRoomIdx]) {
        bestScores[answeredRoomIdx] = score;
        persistSave();
      }

      resetFear();
      updateHUD();
      const flashEl = $('room-clear-flash');
      if (flashEl) { flashEl.classList.remove('active'); void flashEl.offsetWidth; flashEl.classList.add('active'); }
      questionAdvanceTimer = setTimeout(() => {
        if (state === S.QUESTION && activeRoomIdx === answeredRoomIdx) {
          closeQuestion();
        }
      }, 900);
    } else {
      questionAdvanceTimer = setTimeout(() => {
        if (state === S.QUESTION && activeRoomIdx === answeredRoomIdx) {
          showQuestionUI();
        }
      }, 900);
    }

  } else {
    document.querySelectorAll('.choice-btn')[choiceIdx].classList.add('wrong');
    correctStreak = 0;
    updateHUD();
    wrongCount++;
    roomWrong[activeRoomIdx]++;
    const roomWrongNow = roomWrong[activeRoomIdx];
    const max = CFG.gameplay.maxWrongAnswers;

    if (roomWrongNow >= max) {
      triggerChase();
      return;
    }

    applyFear(roomWrongNow);
    // Brief ghost-breath spike — builds dread without burning the jump scare sound
    const fearStageVol = FEAR_STAGES[roomWrongNow].enemyVol;
    AudioManager.setVolume('enemyNear', Math.min(1, fearStageVol + 0.42), 0.02);
    setTimeout(() => AudioManager.setVolume('enemyNear', fearStageVol, 0.7), 380);
    flashWrongVignette(roomWrongNow);

    const msgs = [
      '',
      '⚠ The ghost stirs…',
      '⚠ The ghost grows stronger…',
    ];
    $('question-wrong-count').textContent =
      `${msgs[Math.min(roomWrongNow, msgs.length - 1)]}  (${roomWrongNow}/${max})`;

    wrongResetTimer = setTimeout(() => {
      if (state === S.QUESTION) {
        document.querySelectorAll('.choice-btn').forEach(b => {
          b.disabled = false; b.classList.remove('wrong');
        });
      }
      wrongResetTimer = null;
    }, 700);
  }
}

function leaveQuestion() {
  if (state !== S.QUESTION) return;
  AudioManager.play('uiClick');
  closeQuestion();
}

function closeQuestion() {
  clearQuestionTimers();
  showHUD();
  activeRoomIdx = -1;
  state = S.PLAYING;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  KEYPAD / CODE
// ═══════════════════════════════════════════════════════════════════════════════
function openKeypad() {
  if (!roomDone.every(Boolean)) {
    elPrompt.textContent = '⚠ Solve all rooms first';
    elPrompt.style.opacity = '1';
    setTimeout(() => { elPrompt.style.opacity = '0'; elPrompt.textContent = '[ E ] Examine'; }, 2000);
    return;
  }
  state = S.CODE;
  $('code-input').value = '';
  $('code-error').textContent = '';
  showScreen('code');
  setTimeout(() => $('code-input').focus(), 100);
}

$('btn-code-submit').onclick = () => {
  const val = $('code-input').value.trim();
  if (val === EXIT_CODE) { triggerWin(); }
  else { $('code-error').textContent = '✗ Incorrect code. Try again.'; AudioManager.play('jumpscare'); }
};

$('btn-code-cancel').onclick = () => { showHUD(); state = S.PLAYING; };

$('code-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-code-submit').click(); });

// ═══════════════════════════════════════════════════════════════════════════════
//  WIN / LOSE
// ═══════════════════════════════════════════════════════════════════════════════
function buildWinScores() {
  const container = $('win-scores');
  container.innerHTML = bestScores.map((s, i) =>
    `<div>${ROOMS[i].name} · ${ROOMS[i].label}: <strong>${s !== null ? s+'%' : '—'}</strong></div>`
  ).join('');
}

function triggerWin() {
  state = S.WIN;
  buildWinScores();
  const elapsed = getElapsedSeconds();
  const isNewBest = bestTime === null || elapsed < bestTime;
  if (isNewBest) { bestTime = elapsed; persistSave(); }
  const bestLabel = bestTime !== null ? '  Best: ' + formatTime(bestTime) + (isNewBest ? ' (new!)' : '') : '';
  $('win-time').textContent = 'Time: ' + formatTime(elapsed) + bestLabel;
  const isPerfect = bestScores.every(s => s === 100);
  $('s-win').classList.toggle('perfect', isPerfect);
  showScreen('win');
  AudioManager.stopAll();
  AudioManager.play('win');
}

function triggerLose() {
  state = S.LOSE;
  elVignette.style.background = 'rgba(14,0,0,0.55)';
  elVignette.style.opacity    = '0.7';
  showScreen('lose');
  AudioManager.stopAll();
  AudioManager.play('jumpscare');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GAME START / RESTART
// ═══════════════════════════════════════════════════════════════════════════════
function startGame() {
  resetProgress();
  camera.position.set(0, CFG.player.eyeH, 2);
  yaw = Math.PI; pitch = 0;
  camera.rotation.set(0, Math.PI, 0);
  scene.fog.density = CFG.fog.density;
  AudioManager.setVolume('enemyNear', 0, 0.1);
  elVignette.style.cssText = 'opacity:0';
  elHudPlayer.textContent = playerName;
  showHUD();
  gameStartTime = Date.now();
  state = S.PLAYING;
  lockPointer();   // called from btn-yes click = valid user gesture
  AudioManager.init().catch(err => console.warn('Audio init failed.', err));
}

// ── Menu wiring ───────────────────────────────────────────────────────────────
$('btn-play').onclick = () => {
  CFG.gameplay.pLearnMode = false;
  goToStory();
};
$('btn-plearn').onclick = goToPlearn;
$('btn-yes').onclick    = startGame;
$('btn-no').onclick     = () => showScreen('menu');
$('btn-win-restart').onclick  = () => { CFG.gameplay.pLearnMode = false; showScreen('menu'); };
$('btn-lose-retry').onclick   = () => { showScreen('ready'); };
$('hud-options-btn').onclick = () => openOptions();
$('btn-options-resume').onclick = resumeGame;
$('btn-options-restart').onclick = () => {
  requestOptionsConfirm('Restart this run? Current room progress will be cleared.', () => startGame());
};
$('btn-options-home').onclick = () => {
  requestOptionsConfirm('Return to the home screen? Current run progress will be cleared.', returnHomeFromOptions);
};
$('btn-options-settings').onclick = () => openSettings('options');
$('btn-options-confirm-no').onclick = hideOptionsConfirm;
$('btn-options-confirm-yes').onclick = () => {
  const action = pendingOptionsAction;
  pendingOptionsAction = null;
  if (action) action();
};
$('btn-question-exit').onclick = leaveQuestion;

// ── Pause screen: click to resume + re-lock ───────────────────────────────────
screens.pause.addEventListener('click', () => {
  if (state === S.PAUSED) {
    showHUD();
    state = S.PLAYING;
    lockPointer();   // click = user gesture, safe to request lock here
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  INTERACTION
// ═══════════════════════════════════════════════════════════════════════════════
let nearObject = null;
const interactLookDir = new THREE.Vector3();
const interactToObject = new THREE.Vector3();

function readDebugState() {
  return {
    state,
    position: {
      x: Number(camera.position.x.toFixed(2)),
      y: Number(camera.position.y.toFixed(2)),
      z: Number(camera.position.z.toFixed(2)),
    },
    yaw: Number(yaw.toFixed(2)),
    pitch: Number(pitch.toFixed(2)),
    lookSensitivity: Number(lookSensitivity.toFixed(2)),
    canInteract: Boolean(nearObject),
    target: nearObject?.userData || null,
  };
}

if (import.meta.env.DEV) {
  window.__escapeRoomDebug = {
    getState: readDebugState,
    setPose(nextPose = {}) {
      const nextYaw = nextPose.yaw ?? yaw;
      const nextPitch = nextPose.pitch ?? pitch;
      yaw = nextYaw;
      pitch = nextPitch;
      camera.position.set(
        nextPose.x ?? camera.position.x,
        nextPose.y ?? camera.position.y,
        nextPose.z ?? camera.position.z
      );
      camera.rotation.set(pitch, yaw, 0);
      nearObject = findNearObject();
      setCanInteract(Boolean(nearObject));
      return readDebugState();
    },
  };
}

function findNearObject() {
  let best = null, bestScore = -Infinity;
  camera.getWorldDirection(interactLookDir);
  interactiveObjects.forEach(obj => {
    interactToObject.subVectors(obj.position, camera.position);
    const d = interactToObject.length();
    if (d > CFG.player.interactR) return;

    const facing = interactToObject.normalize().dot(interactLookDir);
    if (facing < INTERACT_FACING_DOT) return;

    const score = facing - d / (CFG.player.interactR * 4);
    if (score > bestScore) { bestScore = score; best = obj; }
  });
  return best;
}

function tryInteract() {
  if (state !== S.PLAYING || !nearObject) return;
  if (nearObject.userData.isKeypad)                openKeypad();
  else if (nearObject.userData.roomIndex !== undefined) openQuestion(nearObject.userData.roomIndex);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COLLISION
// ═══════════════════════════════════════════════════════════════════════════════
function resolveCollision(pos) {
  const R = CFG.player.radius;
  for (const b of wallBoxes) {
    const x0=b.minX-R, x1=b.maxX+R, z0=b.minZ-R, z1=b.maxZ+R;
    if (pos.x>x0 && pos.x<x1 && pos.z>z0 && pos.z<z1) {
      const d0=x1-pos.x, d1=pos.x-x0, d2=z1-pos.z, d3=pos.z-z0;
      const m = Math.min(d0,d1,d2,d3);
      if      (m===d0) pos.x=x1;
      else if (m===d1) pos.x=x0;
      else if (m===d2) pos.z=z1;
      else             pos.z=z0;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESIZE
// ═══════════════════════════════════════════════════════════════════════════════
window.addEventListener('resize', () => {
  applyDeviceProfile();
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('orientationchange', () => setTimeout(applyDeviceProfile, 80));

// ═══════════════════════════════════════════════════════════════════════════════
//  GAME LOOP
// ═══════════════════════════════════════════════════════════════════════════════
let prevTime = performance.now();
let footstepTimer = 0;
let tensionTimer = 0;
const STEP_INTERVAL = 0.42;
const KEY_LOOK_SPEED = 560;

function updateThreatAudio(dt) {
  tensionTimer -= dt;
  if (tensionTimer > 0) return;
  tensionTimer = 0.45;

  if (state !== S.PLAYING) {
    AudioManager.setVolume('enemyNear', 0, 0.6);
    return;
  }

  // World fear = worst mistake count in any incomplete room
  const maxWrong = roomWrong.reduce((m, w, i) => roomDone[i] ? m : Math.max(m, w), 0);
  const stage = FEAR_STAGES[Math.min(maxWrong, FEAR_STAGES.length - 1)];
  AudioManager.setVolume('enemyNear', stage.enemyVol, 0.8);
  scene.fog.density = stage.fogDensity;
}

// Skip GPU work when tab is hidden
let _tabHidden = false;
document.addEventListener('visibilitychange', () => { _tabHidden = document.hidden; });

function animate() {
  requestAnimationFrame(animate);

  // No GPU work during tab-switch or fullscreen opaque menus
  if (_tabHidden) return;
  if (state === S.LOSE) { _initLoseCanvas(); _updateLoseCanvas(); return; }
  if (state === S.MENU || state === S.WIN) return;

  const now = performance.now();
  const dt  = Math.min((now - prevTime) / 1000, 0.05);
  prevTime  = now;
  const t   = now * 0.001;

  // ── Flickering lights (hall fluorescents + room candles) ──────────────────
  flickerLights.forEach(flicker => {
    const { light, base, speed, amp, type } = flicker;
    let intensity;

    if (type === 'candle') {
      intensity = base + Math.sin(t * speed) * amp * 0.5 + Math.random() * amp * 0.5;
    } else {
      // Broken fluorescent: slow wave + short blackout pulses.
      flicker.cutTimer = Math.max(0, (flicker.cutTimer || 0) - dt);
      if (flicker.cutTimer <= 0 && Math.random() < 0.012) {
        flicker.cutTimer = 0.05 + Math.random() * 0.14;
      }
      const cut = flicker.cutTimer > 0 ? 0.08 : 1;
      intensity = (base + Math.sin(t * speed) * amp * 0.25) * cut;
    }

    light.intensity = Math.max(0.02, intensity);
    const sync = Math.max(0.02, light.intensity / base);

    if (flicker.emissiveMaterials?.length) {
      flicker.emissiveMaterials.forEach(mat => { mat.emissiveIntensity = flicker.emissiveBase * sync; });
    }
    if (flicker.glowMaterials?.length) {
      flicker.glowMaterials.forEach(mat => { mat.opacity = Math.min(0.34, 0.035 + sync * 0.24); });
    }
  });

  updateThreatAudio(dt);
  updateAmbientScares(dt);

  // ── Chase state ───────────────────────────────────────────────────────────
  if (state === S.CHASE) { _updateChase(dt); renderer.render(scene, camera); return; }

  // ── Movement only while actively playing ──────────────────────────────────
  if (state !== S.PLAYING) { renderer.render(scene, camera); return; }
  const keyLookX = ((keys['KeyL']) ? 1 : 0) - ((keys['KeyJ']) ? 1 : 0);
  const keyLookY = ((keys['KeyK']) ? 1 : 0) - ((keys['KeyI']) ? 1 : 0);
  if (keyLookX || keyLookY) queueLookDelta(keyLookX * KEY_LOOK_SPEED * dt, keyLookY * KEY_LOOK_SPEED * dt);
  flushLookInput();

  const fwd = ((keys['KeyW']||keys['ArrowUp']   )?1:0) - ((keys['KeyS']||keys['ArrowDown'] )?1:0);
  const rgt = ((keys['KeyD']||keys['ArrowRight'] )?1:0) - ((keys['KeyA']||keys['ArrowLeft'] )?1:0);

  if (fwd || rgt) {
    // Derive forward/right vectors from current yaw (ignore pitch for movement)
    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    const spd  = CFG.player.speed * dt;
    if (fwd) {
      camera.position.x -= sinY * fwd * spd;
      camera.position.z -= cosY * fwd * spd;
      resolveCollision(camera.position);
    }
    if (rgt) {
      camera.position.x += cosY * rgt * spd;
      camera.position.z -= sinY * rgt * spd;
      resolveCollision(camera.position);
    }
    camera.position.y = CFG.player.eyeH;

    footstepTimer -= dt;
    if (footstepTimer <= 0) {
      AudioManager.play('footstep');
      footstepTimer = STEP_INTERVAL;
    }
  } else {
    footstepTimer = 0;
  }

  // ── Interaction prompt ────────────────────────────────────────────────────
  nearObject = findNearObject();
  setCanInteract(Boolean(nearObject));
  if (nearObject) {
    const actionLabel = GameDevice.controls === 'touch' ? 'Tap !' : '[ E ]';
    elPrompt.textContent = nearObject.userData.isKeypad
      ? `${actionLabel} Enter Code`
      : `${actionLabel} Examine`;
    elPrompt.style.opacity = '1';
  } else {
    elPrompt.style.opacity = '0';
  }

  if (!nearObject && GameDevice.controls === 'keyboardMouse' && document.pointerLockElement !== renderer.domElement) {
    elPrompt.textContent = 'Click Game Area To Look';
    elPrompt.style.opacity = '1';
  }

  renderer.render(scene, camera);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AMBIENT SCARE SYSTEM
//  Watches player turn velocity and steady forward walking. When triggered,
//  briefly spawns a creepy entity near where the player is looking.
//  Cooldown is short because the playable map is compact.
// ═══════════════════════════════════════════════════════════════════════════════

const randomScareCooldown = () => 8 + Math.random() * 7;
const WALK_SCARE_DELAY = 1.1;
// The filenames are misleading: this is the pale horror-woman model in-game.
const RANDOM_SCARE_MODEL_PATH = '/assets/3D/the_unvermeidlich_ghost_darkness_of_eclipse.glb';
const RANDOM_SCARE_SCALE = 0.88;
const RANDOM_SCARE_Y_OFFSET = -0.08;
const RANDOM_SCARE_SOUNDS = ['randomScareWhisper', 'randomScareHit'];

const _scare = {
  cooldown:    randomScareCooldown(),
  sprite:      null,
  mixer:       null,
  fadeTimer:   null,
  prevYaw:     null,
  turnAccum:   0,
  turnWindow:  0,
  walkTime:    0,
};

let _randomScareGltf = null;
let _randomScareLoader = null;

function _getRandomScareLoader() {
  if (!_randomScareLoader) _randomScareLoader = new GLTFLoader();
  return _randomScareLoader;
}

function _loadRandomScareModel(cb) {
  if (_randomScareGltf) { cb(_randomScareGltf); return; }
  _getRandomScareLoader().load(RANDOM_SCARE_MODEL_PATH, gltf => { _randomScareGltf = gltf; cb(gltf); });
}

function _clearScareSprite() {
  if (_scare.fadeTimer) { clearTimeout(_scare.fadeTimer); _scare.fadeTimer = null; }
  if (_scare.sprite)    { scene.remove(_scare.sprite); _scare.sprite = null; }
  if (_scare.mixer)     { _scare.mixer.stopAllAction(); _scare.mixer = null; }
}

function playRandomScareAudio() {
  const sound = RANDOM_SCARE_SOUNDS[Math.floor(Math.random() * RANDOM_SCARE_SOUNDS.length)];
  AudioManager.play(sound);
}

function tuneScareMaterials(root, emissiveIntensity = 0.18) {
  root.traverse(child => {
    if (!child.isMesh || !child.material) return;
    child.frustumCulled = false;
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    const tunedMaterials = sourceMaterials.map(mat => {
      const tuned = mat.clone();
      if (tuned.emissive) {
        tuned.emissive.setHex(0x1f120f);
        tuned.emissiveIntensity = Math.max(tuned.emissiveIntensity || 0, emissiveIntensity);
      }
      if ('roughness' in tuned) tuned.roughness = Math.min(tuned.roughness ?? 1, 0.82);
      return tuned;
    });
    child.material = Array.isArray(child.material) ? tunedMaterials : tunedMaterials[0];
  });
}

function addScareDetailLights(root, keyIntensity = 6.4, rimIntensity = 1.8) {
  const keyLight = new THREE.PointLight(0xffdcc4, keyIntensity, 7, 1.45);
  keyLight.position.set(0, 1.35, 0.65);
  root.add(keyLight);

  const rimLight = new THREE.PointLight(0xff2d18, rimIntensity, 4.6, 1.7);
  rimLight.position.set(0, 1.65, -0.8);
  root.add(rimLight);
}

function _spawnScare(turnDir) {
  if (_scare.sprite) return;

  _loadRandomScareModel(gltf => {
    if (_scare.sprite) return;

    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    const dist    = 3.2;
    const lateral = -turnDir * 1.0;
    const px = camera.position.x + (-sinY * dist) + (cosY  * lateral);
    const pz = camera.position.z + (-cosY * dist) + (-sinY * lateral);

    const clone = skeletonClone(gltf.scene);
    tuneScareMaterials(clone, 0.2);
    addScareDetailLights(clone, 6.6, 2.1);
    clone.visible = true;
    clone.scale.setScalar(RANDOM_SCARE_SCALE);
    clone.position.set(px, RANDOM_SCARE_Y_OFFSET, pz);
    clone.rotation.y = Math.atan2(camera.position.x - px, camera.position.z - pz);
    scene.add(clone);
    _scare.sprite = clone;
    _scare.mixer  = new THREE.AnimationMixer(clone);
    if (gltf.animations.length) _scare.mixer.clipAction(gltf.animations[0]).play();
    renderer.render(scene, camera); // force immediate frame
    playRandomScareAudio();

    const totalDuration = 900 + Math.random() * 650;
    const fadeInTime    = 120;
    const fadeOutTime   = 250;
    const start = performance.now();

    const tick = () => {
      if (!_scare.sprite || _scare.sprite !== clone) return;
      const elapsed = performance.now() - start;
      if (elapsed < fadeInTime) {
        clone.visible = true; // show immediately on first tick
      } else if (elapsed > totalDuration - fadeOutTime) {
        clone.visible = false; // hide before removal
      }
      if (elapsed < totalDuration) {
        _scare.fadeTimer = setTimeout(tick, 16);
      } else {
        _clearScareSprite();
      }
    };
    _scare.fadeTimer = setTimeout(tick, 16);
  });
}

function updateAmbientScares(dt) {
  if (state !== S.PLAYING) return;

  _scare.cooldown -= dt;

  if (_scare.prevYaw === null) { _scare.prevYaw = yaw; return; }
  const dyaw = yaw - _scare.prevYaw;
  _scare.prevYaw = yaw;

  // Rolling 0.28s window — accumulate turn delta
  _scare.turnAccum  += dyaw;
  _scare.turnWindow += dt;
  if (_scare.turnWindow > 0.28) {
    _scare.turnAccum  = dyaw;
    _scare.turnWindow = 0;
  }

  const isWalking =
    keys['KeyW'] || keys['ArrowUp'] ||
    keys['KeyS'] || keys['ArrowDown'] ||
    keys['KeyA'] || keys['ArrowLeft'] ||
    keys['KeyD'] || keys['ArrowRight'];

  if (isWalking) {
    _scare.walkTime += dt;
  } else {
    _scare.walkTime = 0;
  }

  // Trigger when turning fast enough + cooldown expired + no sprite active.
  if (Math.abs(_scare.turnAccum) > 0.26 && _scare.cooldown <= 0 && !_scare.sprite) {
    _spawnScare(Math.sign(_scare.turnAccum));
    _scare.cooldown  = randomScareCooldown();
    _scare.turnAccum = 0;
    _scare.walkTime  = 0;
  }

  // Also trigger during general walking after the same cooldown.
  if (_scare.walkTime >= WALK_SCARE_DELAY && _scare.cooldown <= 0 && !_scare.sprite) {
    _spawnScare(0);
    _scare.cooldown  = randomScareCooldown();
    _scare.turnAccum = 0;
    _scare.walkTime  = 0;
  }

  // Tick the run animation while scare is active
  if (_scare.sprite && _scare.mixer) _scare.mixer.update(dt);
}

function resetAmbientScares() {
  _clearScareSprite();
  _scare.prevYaw    = null;
  _scare.turnAccum  = 0;
  _scare.turnWindow = 0;
  _scare.walkTime   = 0;
  _scare.cooldown   = randomScareCooldown();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOSE-SCREEN MONSTER CANVAS
//  Renders smily_horror_monster.glb in a mini Three.js scene on #lose-canvas.
// ═══════════════════════════════════════════════════════════════════════════════

let _loseRenderer = null;
let _loseScene    = null;
let _loseCamera   = null;
let _loseMixer    = null;
const _loseClock  = new THREE.Clock(false);
let _loseGltf     = null;  // pre-cached during loading screen

function _initLoseCanvas() {
  if (_loseRenderer) return; // already initialised
  const canvas = document.getElementById('lose-canvas');
  if (!canvas) return;

  _loseRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  _loseRenderer.setSize(400, 400, false); // false = don't override CSS sizing
  _loseRenderer.setClearColor(0x000000, 0);

  _loseScene  = new THREE.Scene();
  _loseCamera = new THREE.PerspectiveCamera(50, 1, 0.001, 500);

  _loseScene.add(new THREE.AmbientLight(0xffffff, 2.5));
  const dl1 = new THREE.DirectionalLight(0xff3311, 4); dl1.position.set(0, 1, 1); _loseScene.add(dl1);
  const dl2 = new THREE.DirectionalLight(0xffffff, 1.5); dl2.position.set(0, 1, -1); _loseScene.add(dl2);

  function _setupLoseModel(gltf) {
    const m = gltf.scene;
    _loseScene.add(m);

    // Auto-fit: scale so largest dimension = 2 units, then centre
    const box1 = new THREE.Box3().setFromObject(m);
    const sz   = new THREE.Vector3(); box1.getSize(sz);
    m.scale.setScalar(2 / Math.max(sz.x, sz.y, sz.z));

    const box2   = new THREE.Box3().setFromObject(m);
    const centre = new THREE.Vector3(); box2.getCenter(centre);
    const sz2    = new THREE.Vector3(); box2.getSize(sz2);
    m.position.sub(centre);

    _loseCamera.position.set(0, 0.1, Math.max(sz2.x, sz2.y) * 1.75);
    _loseCamera.lookAt(0, 0.1, 0);

    _loseMixer = new THREE.AnimationMixer(m);
    if (gltf.animations.length) _loseMixer.clipAction(gltf.animations[0]).play();
    _loseClock.start();
  }

  if (_loseGltf) {
    _setupLoseModel(_loseGltf);
  } else {
    _getMonsterLoader().load('/assets/3D/smily_horror_monster.glb', _setupLoseModel);
  }
}

function _updateLoseCanvas() {
  if (!_loseRenderer || !_loseScene || !_loseCamera) return;
  const dt = _loseClock.getDelta();
  _loseMixer?.update(dt);
  _loseRenderer.render(_loseScene, _loseCamera);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MONSTER CHASE SYSTEM
//  Triggered when player exhausts wrong answers on a question.
//  Phase 0 — forced 180° camera turn (1.8s eased).
//  Phase 1 — monster runs toward player; scream volume rises with proximity.
//  Caught   — screen fades black → lose screen.
// ═══════════════════════════════════════════════════════════════════════════════

const CHASE_TURN_DURATION  = 1.8;   // seconds for forced turn
const CHASE_MONSTER_SPEED  = 8.5;   // units / second
const CHASE_SPAWN_DIST     = 13;    // units ahead when monster appears
const CHASE_COLLISION_DIST = 1.1;   // units — caught threshold
const CHASE_MONSTER_SCALE  = 1.8;   // multiplier on top of baked 0.01 scale
// The filenames are misleading: this is the dark ghost/darkness model in-game.
const CHASE_MONSTER_PATH   = '/assets/3D/horror-woman.glb';

let _chasePhase      = 0;     // 0 = turning, 1 = monster running
let _chaseElapsed    = 0;
let _chaseStartYaw   = 0;
let _chaseCaught     = false;
let _chaseMonster    = null;  // THREE.Group in scene
let _chaseMixer      = null;  // AnimationMixer
let _chaseScreamT    = 0;     // countdown to next periodic scream
let _monsterGltf     = null;  // cached loaded GLTF
let _monsterLoader   = null;  // GLTFLoader instance

function _getMonsterLoader() {
  if (!_monsterLoader) _monsterLoader = new GLTFLoader();
  return _monsterLoader;
}

function _loadMonster(cb) {
  if (_monsterGltf) { cb(_monsterGltf); return; }
  _getMonsterLoader().load(CHASE_MONSTER_PATH, gltf => { _monsterGltf = gltf; cb(gltf); });
}

function _spawnMonster() {
  _loadMonster(gltf => {
    if (state !== S.CHASE) return; // chase ended while model was still loading
    _doSpawnMonster(gltf);
  });
}

function _doSpawnMonster(gltf) {
  // Re-use cached scene (remove first if already in scene)
  if (_chaseMonster) scene.remove(_chaseMonster);
  _chaseMonster = gltf.scene;

  // Position: straight ahead of player's current facing, at spawn distance
  const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
  const px   = camera.position.x + (-sinY * CHASE_SPAWN_DIST);
  const pz   = camera.position.z + (-cosY * CHASE_SPAWN_DIST);
  // Clamp X to hallway centre (avoid spawning inside room walls)
  _chaseMonster.position.set(Math.max(-2.2, Math.min(2.2, px)), 0, pz);
  _chaseMonster.scale.setScalar(CHASE_MONSTER_SCALE); // baked 0.01 still applies

  // Face toward player on Y axis only (model faces +Z by default in this GLB)
  const dx = camera.position.x - _chaseMonster.position.x;
  const dz = camera.position.z - _chaseMonster.position.z;
  _chaseMonster.rotation.y = Math.atan2(dx, dz);

  scene.add(_chaseMonster);

  // Start run animation
  _chaseMixer = new THREE.AnimationMixer(_chaseMonster);
  if (gltf.animations.length) _chaseMixer.clipAction(gltf.animations[0]).play();

  // Start ghost-scream clip — first 3s plays over the chase, rest carries into trapped screen
  AudioManager.play('ghostScream');
  AudioManager.setVolume('enemyNear', 0.25, 0.2);
  _chaseScreamT = 999; // disable periodic synth screams — ghostScream handles it
}

function triggerChase() {
  // Disable question UI cleanly
  clearQuestionTimers();
  showHUD();
  state         = S.CHASE;
  _chasePhase   = 0;
  _chaseElapsed = 0;
  _chaseCaught  = false;
  _chaseStartYaw = yaw;

  // Subtle pre-scare — brief silence
  AudioManager.setVolume('ambient',   0, 0.08);
  AudioManager.setVolume('enemyNear', 0, 0.08);

  // Pre-load monster so it's ready the moment the turn finishes
  _loadMonster(() => {/* ready */});
}

function _triggerCaught() {
  if (_chaseCaught) return;
  _chaseCaught = true;
  AudioManager.stopAll(); // stops loops (ambient, enemyNear) — ghostScream is one-shot so keeps playing

  // Fade to black
  elVignette.style.transition = 'opacity 0.45s';
  elVignette.style.background = '#000';
  elVignette.style.opacity    = '1';

  setTimeout(() => {
    _cleanupChase();
    state = S.LOSE;
    showScreen('lose');
  }, 500);
}

function _cleanupChase() {
  if (_chaseMonster) { scene.remove(_chaseMonster); _chaseMonster = null; }
  if (_chaseMixer)   { _chaseMixer.stopAllAction(); _chaseMixer = null; }
  _chasePhase   = 0;
  _chaseElapsed = 0;
  _chaseCaught  = false;
}

function _updateChase(dt) {
  _chaseElapsed += dt;

  if (_chasePhase === 0) {
    // ── Phase 0: Forced 180° camera turn ─────────────────────────────────────
    const t      = Math.min(1, _chaseElapsed / CHASE_TURN_DURATION);
    const eased  = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease-in-out
    yaw   = _chaseStartYaw + eased * Math.PI;
    pitch = 0;
    camera.rotation.set(0, yaw, 0);

    if (t >= 1) {
      _chasePhase   = 1;
      _chaseElapsed = 0;
      _spawnMonster();
    }

  } else {
    // ── Phase 1: Monster runs — player can look but not move ──────────────────
    flushLookInput();   // allow mouse look so player can watch

    if (_chaseMonster && !_chaseCaught) {
      // Move monster toward player on XZ plane
      const dx   = camera.position.x - _chaseMonster.position.x;
      const dz   = camera.position.z - _chaseMonster.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > 0.2) {
        const step = CHASE_MONSTER_SPEED * dt;
        _chaseMonster.position.x += (dx / dist) * step;
        _chaseMonster.position.z += (dz / dist) * step;
        _chaseMonster.rotation.y  = Math.atan2(dx, dz);
      }

      // Scale enemy audio with proximity (0.1 far → 1.0 at collision)
      const vol = Math.min(1, Math.max(0.1, 1 - (dist - CHASE_COLLISION_DIST) / (CHASE_SPAWN_DIST - CHASE_COLLISION_DIST)));
      AudioManager.setVolume('enemyNear', vol, 0.12);

      // Periodic screams — more frequent as it closes in
      _chaseScreamT -= dt;
      if (_chaseScreamT <= 0) {
        AudioManager.playScream();
        _chaseScreamT = Math.max(0.8, 1.4 + (dist / CHASE_SPAWN_DIST) * 2);
      }

      // Update run animation
      _chaseMixer?.update(dt);

      // Caught
      if (dist < CHASE_COLLISION_DIST) _triggerCaught();
    }
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
updateMenuName();
updateFullscreenLabel();
animate();

(async function preload() {
  const bar   = document.getElementById('loading-bar');
  const label = document.getElementById('loading-label');

  const MODELS = [
    { path: CHASE_MONSTER_PATH,      store: g => { _monsterGltf       = g; } },
    { path: RANDOM_SCARE_MODEL_PATH, store: g => { _randomScareGltf   = g; } },
    { path: '/assets/3D/smily_horror_monster.glb', store: g => { _loseGltf = g; } },
  ];

  let done = 0;
  function setProgress(n) {
    bar.style.width = `${Math.round((n / MODELS.length) * 100)}%`;
  }

  function loadGLTF(path) {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(path, resolve, undefined, reject);
    });
  }

  await Promise.all(MODELS.map(async ({ path, store }) => {
    try {
      const gltf = await loadGLTF(path);
      store(gltf);
    } catch (err) {
      console.warn(`Failed to preload ${path}`, err);
    }
    setProgress(++done);
  }));

  label.textContent = 'READY';
  await new Promise(r => setTimeout(r, 120));
  showScreen('title');
})();
if (import.meta.env.DEV) {
  const devScareBtn = $('dev-scare-btn');
  devScareBtn?.removeAttribute('hidden');
  devScareBtn?.addEventListener('click', () => {
    _scare.cooldown = 0;
    _spawnScare(Math.random() < 0.5 ? 1 : -1);
    _scare.cooldown = 5;
  });
  window.__devPlay = () => { resetProgress(); startGame(); };
}
