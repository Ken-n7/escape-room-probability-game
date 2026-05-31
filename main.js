import * as THREE from 'three';
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

const LOOK_SENS = 0.0022;
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
  yaw   -= dx * LOOK_SENS * multiplier;
  pitch -= dy * LOOK_SENS * multiplier;
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
  if (state !== S.PLAYING) return;
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
  if (e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    if (state === S.PLAYING) openOptions();
    else if (state === S.PAUSED && !screens.options.classList.contains('hidden')) resumeGame();
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
const mobileInteractButton = document.getElementById('mobile-interact-btn');
mobileInteractButton.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (mobileInteractButton.disabled) return;
  tryInteract();
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

let _save       = loadSave();
let playerName  = _save.playerName  || 'Student';
let bestScores  = _save.bestScores  || [null, null, null]; // null = not yet completed

function persistSave() {
  writeSave({ playerName, bestScores });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DOM REFS
// ═══════════════════════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const screens = {
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

function setCanInteract(canInteract) {
  document.body.dataset.canInteract = canInteract ? 'true' : 'false';
  mobileInteractButton.disabled = !canInteract;
}

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
  setCanInteract(false);
  renderer.domElement.style.cursor = 'auto';   // restore cursor for UI
  unlockPointer();                              // release pointer lock for any UI
  if (name) screens[name].classList.remove('hidden');
}

function showHUD() {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  elHud.style.display = 'block';
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
  const btn = $('btn-options-fullscreen');
  if (!document.fullscreenEnabled) {
    btn.disabled = true;
    btn.textContent = 'Fullscreen Unavailable';
    return;
  }
  btn.disabled = false;
  btn.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
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
function openSettings() {
  $('settings-name').value = playerName;
  $('settings-saved').textContent = '';
  updateSettingsScores();
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
  persistSave();
  updateSettingsScores();
  resetProgress();
  $('settings-saved').textContent = '✓ Progress reset';
  setTimeout(() => { $('settings-saved').textContent = ''; }, 2000);
};

$('btn-settings-back').onclick = () => showScreen('menu');

// ── Settings and About icons on the menu ──────────────────────────────────────
$('icon-settings').onclick = openSettings;
$('icon-about').onclick    = () => showScreen('about');
$('btn-about-back').onclick = () => showScreen('menu');

// ═══════════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════════════════════════════════════
const S = { MENU:0, PLAYING:1, PAUSED:2, QUESTION:3, CODE:4, WIN:5, LOSE:6 };
let state = S.MENU;

let roomProgress  = [0, 0, 0];
let roomDone      = [false, false, false];
let codeDigits    = ['_', '_', '_'];
let roomWrong     = [0, 0, 0];   // wrong answers accumulated per room this run

function calcScore(roomIdx) {
  const totalQ = ROOMS[roomIdx].questions.length;
  // Each wrong answer costs a third of one question's score; floor at 0
  return Math.max(0, Math.round((1 - roomWrong[roomIdx] / (totalQ * 2)) * 100));
}

function updateHUD() {
  elCodeTracker.textContent = 'CODE: ' + codeDigits.join(' ');
  roomDone.forEach((done, i) => {
    $('pip-' + i).className = 'room-pip' + (done ? ' done' : '');
  });
}

function resetProgress() {
  roomProgress = [0, 0, 0];
  roomDone     = [false, false, false];
  codeDigits   = ['_', '_', '_'];
  roomWrong    = [0, 0, 0];
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
  clearQuestionTimers();
  activeRoomIdx = roomIdx;
  activeQIdx    = roomProgress[roomIdx];
  wrongCount    = 0;
  state = S.QUESTION;   // set BEFORE showScreen so pointerlockchange doesn't trigger pause
  showQuestionUI();
}

function showQuestionUI() {
  const room = ROOMS[activeRoomIdx];
  const q    = room.questions[activeQIdx];

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
  const q = ROOMS[activeRoomIdx].questions[activeQIdx];
  clearQuestionTimers();
  document.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);

  if (choiceIdx === q.correct) {
    document.querySelectorAll('.choice-btn')[choiceIdx].classList.add('correct');
    AudioManager.play('pickup');

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

      updateHUD();
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
    wrongCount++;
    roomWrong[activeRoomIdx]++;
    AudioManager.play('jumpscare');

    elVignette.style.opacity    = '0.8';
    elVignette.style.background = 'rgba(80,0,0,0.92)';
    wrongFeedbackTimer = setTimeout(() => {
      elVignette.style.background = '';
      elVignette.style.opacity = '0';
      wrongFeedbackTimer = null;
    }, 500);

    $('question-wrong-count').textContent =
      wrongCount >= CFG.gameplay.maxWrongAnswers
        ? '⚠ The ghost grows stronger…'
        : `✗ Wrong  (${wrongCount}/${CFG.gameplay.maxWrongAnswers})`;

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
  showScreen('win');
  AudioManager.stopAll();
  AudioManager.play('win');
}

function triggerLose() {
  state = S.LOSE;
  elVignette.style.background = 'rgba(50,0,0,0.94)';
  elVignette.style.opacity    = '1';
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
  yaw = 0; pitch = 0;
  camera.rotation.set(0, 0, 0);
  elVignette.style.cssText = 'opacity:0';
  elHudPlayer.textContent = playerName;
  showHUD();
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
$('btn-win-restart').onclick  = () => { showScreen('title'); CFG.gameplay.pLearnMode = false; };
$('btn-lose-retry').onclick   = () => { showScreen('title'); CFG.gameplay.pLearnMode = false; };
$('hud-options-btn').onclick = () => openOptions();
$('btn-options-resume').onclick = resumeGame;
$('btn-options-fullscreen').onclick = toggleFullscreen;
$('btn-options-restart').onclick = () => {
  requestOptionsConfirm('Restart this run? Current room progress will be cleared.', () => startGame());
};
$('btn-options-home').onclick = () => {
  requestOptionsConfirm('Return to the home screen? Current run progress will be cleared.', returnHomeFromOptions);
};
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

  const wrongTotal = roomWrong.reduce((sum, count) => sum + count, 0);
  const solvedRooms = roomDone.filter(Boolean).length;
  const threat = Math.min(0.38, wrongTotal * 0.055 + solvedRooms * 0.035);
  AudioManager.setVolume('enemyNear', threat, 0.8);
}

// Skip GPU work when tab is hidden
let _tabHidden = false;
document.addEventListener('visibilitychange', () => { _tabHidden = document.hidden; });

function animate() {
  requestAnimationFrame(animate);

  // No GPU work during tab-switch or fullscreen opaque menus
  if (_tabHidden) return;
  if (state === S.MENU || state === S.WIN || state === S.LOSE) return;

  const now = performance.now();
  const dt  = Math.min((now - prevTime) / 1000, 0.05);
  prevTime  = now;
  const t   = now * 0.001;

  // ── Flickering lights (hall fluorescents + room candles) ──────────────────
  flickerLights.forEach(({ light, base, speed, amp, type }) => {
    if (type === 'candle') {
      light.intensity = base + Math.sin(t * speed) * amp * 0.5 + Math.random() * amp * 0.5;
    } else {
      // Broken fluorescent: slow wave + rare sudden cut
      light.intensity = base + Math.sin(t * speed) * amp * 0.3
        + (Math.random() < 0.008 ? -(base * 0.6) : 0);
    }
  });

  updateThreatAudio(dt);

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

// ── Boot ──────────────────────────────────────────────────────────────────────
updateMenuName();
showScreen('title');
animate();
