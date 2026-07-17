import * as THREE                  from 'three';
import { CFG }                    from './core/config.js';
import { ROOMS, EXIT_CODE }        from './data/questions.js';
import { buildWorld, flickerLights } from './world/world.js';
import { AudioManager }            from './audio/audio.js';
import { S, gState, look, keys }   from './core/game-state.js';
import { renderer, scene, camera } from './core/renderer.js';
import {
  GameDevice, applyDeviceProfile, initInput,
  lockPointer, flushLookInput, queueLookDelta,
  lookSensitivity, setLookSensitivity,
  MIN_LOOK_SENSITIVITY, MAX_LOOK_SENSITIVITY,
  MOVE_KEYS, KEY_LOOK_SPEED,
} from './input/input.js';
import {
  screens, elHud, elPrompt, elVignette,
  elCodeTracker, elHudPlayer,
  elOptionsConfirm, elOptionsConfirmText,
  elPersistentFsBtn,
  showScreen, showHUD, hideOptionsConfirm,
  updateFullscreenLabel, toggleFullscreen, setCanInteract,
} from './ui/hud.js';
import { updateAmbientScares, resetAmbientScares, clearScareSprite } from './scares/scare.js';
import { initLoseCanvas, updateLoseCanvas } from './scares/lose-canvas.js';
import { initChase, triggerChase, update as updateChase, cleanup as cleanupChase } from './scares/chase.js';
import { preloadAssets } from './loaders/preload.js';

// ── World ─────────────────────────────────────────────────────────────────────
const { wallBoxes, interactiveObjects } = buildWorld(scene);

// ── Menu camera ────────────────────────────────────────────────────────────────
const MENU_CAMERA_VIEW = {
  x: -2.0, y: CFG.player.eyeH, z: 1.8,
  yaw: Math.PI + 0.16, pitch: -0.035,
};
const START_CAMERA_VIEW = {
  x: 0, y: CFG.player.eyeH, z: 2,
  yaw: Math.PI, pitch: 0,
};
let _startCameraTransition = null;
let _holdStartViewFrames = 0;

function setCameraView(view) {
  camera.position.set(view.x, view.y, view.z);
  look.yaw = view.yaw;
  look.pitch = view.pitch;
  camera.rotation.set(look.pitch, look.yaw, 0);
}

function lerpAngle(from, to, t) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * t;
}

function setMenuCamera() {
  setCameraView(MENU_CAMERA_VIEW);
  scene.fog.density = CFG.fog.density;
}

// ── Extra DOM refs (settings-specific, only used here) ────────────────────────
const $ = id => document.getElementById(id);
const elSensitivity      = $('settings-sensitivity');
const elSensitivityValue = $('settings-sensitivity-value');

// ── Local storage / save ──────────────────────────────────────────────────────
const SAVE_KEY = 'escape_room_v1';
function loadSave()  { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } }
function writeSave(d) { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); }

function normalizeSensitivity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_LOOK_SENSITIVITY, Math.max(MIN_LOOK_SENSITIVITY, n));
}

let _save      = loadSave();
let playerName = _save.playerName || 'Student';
let bestScores = _save.bestScores || [null, null, null];
let bestTime   = _save.bestTime   || null;
setLookSensitivity(normalizeSensitivity(_save.lookSensitivity));

function persistSave() {
  writeSave({ playerName, bestScores, bestTime, lookSensitivity });
}

// ── Game state ────────────────────────────────────────────────────────────────
let roomProgress      = [0, 0, 0];
let roomDone          = [false, false, false];
let codeDigits        = ['_', '_', '_'];
let roomWrong         = [0, 0, 0];
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

// ── Fear stages ───────────────────────────────────────────────────────────────
const FEAR_STAGES = [
  { at: 0,    enemyVol: 0,    fogDensity: CFG.fog.density, vigOpacity: 0,    vigBg: '' },
  { at: 0.01, enemyVol: 0.26, fogDensity: 0.070,           vigOpacity: 0.12, vigBg: 'radial-gradient(ellipse at center, transparent 40%, rgba(48,0,8,0.50) 100%)' },
  { at: 0.40, enemyVol: 0.58, fogDensity: 0.115,           vigOpacity: 0.22, vigBg: 'radial-gradient(ellipse at center, transparent 28%, rgba(62,0,5,0.60) 100%)' },
];

function maxWrongAnswers() {
  const raw = Number(CFG.gameplay.maxWrongAnswers);
  return Math.max(1, Math.floor(Number.isFinite(raw) ? raw : 1));
}

function wrongProgress(level) {
  const raw = Number(level);
  const wrong = Number.isFinite(raw) ? raw : 0;
  return Math.min(1, Math.max(0, wrong) / maxWrongAnswers());
}

function fearStage(level) {
  const progress = wrongProgress(level);
  let stage = FEAR_STAGES[0];
  for (const candidate of FEAR_STAGES) {
    if (progress >= candidate.at) stage = candidate;
  }
  return stage;
}

function applyFear(level) {
  const stage = fearStage(level);
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

let _wrongFeedbackTimer = null;
function flashWrongVignette(fearLevel) {
  const stage = fearStage(fearLevel);
  if (_wrongFeedbackTimer) { clearTimeout(_wrongFeedbackTimer); _wrongFeedbackTimer = null; }
  elVignette.style.transition = 'none';
  elVignette.style.background = 'radial-gradient(ellipse at center, transparent 18%, rgba(84,0,0,0.72) 100%)';
  elVignette.style.opacity    = '0.58';
  _wrongFeedbackTimer = setTimeout(() => {
    elVignette.style.transition = 'opacity 0.6s, background 0.6s';
    elVignette.style.background = stage.vigBg;
    elVignette.style.opacity    = String(stage.vigOpacity);
    _wrongFeedbackTimer = null;
  }, 350);
}

// ── HUD helpers ───────────────────────────────────────────────────────────────
function updateHUD() {
  elCodeTracker.textContent = 'CODE: ' + codeDigits.join(' ');
  elCodeTracker.classList.toggle('complete', roomDone.every(Boolean));
  roomDone.forEach((done, i) => {
    $('pip-' + i).className = 'room-pip' + (done ? ' done' : '');
  });
  const qEl = $('hud-q-progress');
  if (qEl) {
    const ri = gState.current === S.QUESTION
      ? activeRoomIdx
      : roomDone.findIndex((done, i) => !done && roomProgress[i] > 0);
    qEl.textContent = ri >= 0 && !roomDone[ri]
      ? 'Q ' + (roomProgress[ri] + 1) + '/' + ROOMS[ri].questions.length
      : '';
  }
  const sEl = $('hud-streak');
  if (sEl) sEl.textContent = correctStreak >= 2 ? '+ ' + correctStreak + ' streak' : '';
}

function updateMenuName() {
  const el = $('menu-player-name') || $('menu-name-display');
  if (el) el.textContent = 'Player: ' + playerName;
}

function updateSensitivityUI() {
  if (!elSensitivity || !elSensitivityValue) return;
  const percent = Math.round(lookSensitivity * 100);
  elSensitivity.value = String(percent);
  elSensitivityValue.textContent = percent + '%';
}

function updateSettingsScores() {
  bestScores.forEach((score, i) => {
    const el = $('score-room-' + i);
    if (score === null) { el.textContent = '—'; el.className = 'score-val'; }
    else { el.textContent = score + '%'; el.className = 'score-val' + (score === 100 ? ' perfect' : ''); }
  });
  const btEl = $('score-best-time');
  if (btEl) btEl.textContent = bestTime !== null ? formatTime(bestTime) : '—';
}

// ── Time helpers ──────────────────────────────────────────────────────────────
function getElapsedSeconds() { return Math.floor((Date.now() - gameStartTime) / 1000); }
function formatTime(s) {
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
}

// ── Progress reset ────────────────────────────────────────────────────────────
function resetProgress() {
  roomProgress  = [0, 0, 0];
  roomDone      = [false, false, false];
  codeDigits    = ['_', '_', '_'];
  roomWrong     = [0, 0, 0];
  correctStreak = 0;
  shuffleRooms();
  resetAmbientScares();
  cleanupChase();
  updateHUD();
}

function clearMovementInput() {
  Object.keys(keys).forEach(code => { keys[code] = false; });
  footstepTimer = 0;
}

// ── Interaction ───────────────────────────────────────────────────────────────
const INTERACT_DOT = 0.72;
const INTERACT_DIR  = new THREE.Vector3();
const INTERACT_TO   = new THREE.Vector3();
let nearObject = null;

function findNearObject() {
  let best = null, bestScore = -Infinity;
  camera.getWorldDirection(INTERACT_DIR);
  interactiveObjects.forEach(obj => {
    INTERACT_TO.subVectors(obj.position, camera.position);
    const d = INTERACT_TO.length();
    if (d > CFG.player.interactR) return;
    const facing = INTERACT_TO.normalize().dot(INTERACT_DIR);
    if (facing < INTERACT_DOT) return;
    const score = facing - d / (CFG.player.interactR * 4);
    if (score > bestScore) { bestScore = score; best = obj; }
  });
  return best;
}

function tryInteract() {
  if (gState.current !== S.PLAYING || !nearObject) return;
  if (nearObject.userData.isKeypad)                      openKeypad();
  else if (nearObject.userData.roomIndex !== undefined)  openQuestion(nearObject.userData.roomIndex);
}

// ── Collision ─────────────────────────────────────────────────────────────────
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

// ── Settings ──────────────────────────────────────────────────────────────────
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

// ── Options / pause flow ──────────────────────────────────────────────────────
let pendingOptionsAction = null;

function requestOptionsConfirm(message, action) {
  pendingOptionsAction = action;
  elOptionsConfirmText.textContent = message;
  elOptionsConfirm.classList.remove('hidden');
}

function openOptions(playSound = true) {
  if (gState.current !== S.PLAYING && gState.current !== S.PAUSED) return;
  clearMovementInput();
  hideOptionsConfirm();
  updateFullscreenLabel();
  gState.current = S.PAUSED;
  AudioManager.setVolume('enemyNear', 0, 0.45);
  if (playSound) AudioManager.play('uiClick');
  showScreen('options');
}

function resumeGame() {
  if (gState.current !== S.PAUSED) return;
  hideOptionsConfirm();
  showHUD();
  gState.current = S.PLAYING;
  prevTime = performance.now();
  AudioManager.play('uiClick');
  lockPointer();
}

function returnHomeFromOptions() {
  hideOptionsConfirm();
  clearMovementInput();
  resetProgress();
  CFG.gameplay.pLearnMode = false;
  storyIdx  = 0;
  plearnIdx = 0;
  gState.current = S.MENU;
  elVignette.style.cssText = 'opacity:0';
  AudioManager.setVolume('enemyNear', 0, 0.25);
  setMenuCamera();
  showScreen('menu');
}

// ── Question system ───────────────────────────────────────────────────────────
let activeRoomIdx         = -1;
let activeQIdx            = 0;
let wrongCount            = 0;
let _questionAdvanceTimer = null;
let _wrongResetTimer      = null;
let _questionArmTimer     = null;
let _questionInputReadyAt = 0;
const QUESTION_ARM_MS     = 700;

function clearQuestionTimers() {
  if (_questionAdvanceTimer) clearTimeout(_questionAdvanceTimer);
  if (_wrongFeedbackTimer)   clearTimeout(_wrongFeedbackTimer);
  if (_wrongResetTimer)      clearTimeout(_wrongResetTimer);
  if (_questionArmTimer)     clearTimeout(_questionArmTimer);
  _questionAdvanceTimer = null;
  _wrongFeedbackTimer   = null;
  _wrongResetTimer      = null;
  _questionArmTimer     = null;
}

function openQuestion(roomIdx) {
  if (roomDone[roomIdx]) return;
  clearScareSprite();
  clearQuestionTimers();
  activeRoomIdx = roomIdx;
  activeQIdx    = roomProgress[roomIdx];
  wrongCount    = 0;
  gState.current = S.QUESTION;
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

  _questionInputReadyAt = performance.now() + QUESTION_ARM_MS;
  document.querySelectorAll('.choice-btn').forEach((btn, i) => {
    btn.textContent = q.choices[i];
    btn.className   = 'choice-btn';
    btn.disabled    = true;
    btn.onclick     = e => {
      e?.preventDefault();
      e?.stopPropagation();
      handleAnswer(i);
    };
  });

  showScreen('question');
  _questionArmTimer = setTimeout(() => {
    if (gState.current !== S.QUESTION) return;
    document.querySelectorAll('.choice-btn').forEach(btn => { btn.disabled = false; });
    _questionArmTimer = null;
  }, QUESTION_ARM_MS);
}

function handleAnswer(choiceIdx) {
  if (performance.now() < _questionInputReadyAt) return;
  const q = shuffledQuestions[activeRoomIdx][activeQIdx];
  clearQuestionTimers();
  document.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);

  if (choiceIdx === q.correct) {
    document.querySelectorAll('.choice-btn')[choiceIdx].classList.add('correct');
    AudioManager.play('pickup');
    correctStreak++;
    if (correctStreak === 3) AudioManager.play('pickup');

    const answeredRoomIdx = activeRoomIdx;
    activeQIdx++;
    roomProgress[answeredRoomIdx] = activeQIdx;

    if (activeQIdx >= ROOMS[answeredRoomIdx].questions.length) {
      roomDone[answeredRoomIdx]   = true;
      codeDigits[answeredRoomIdx] = ROOMS[answeredRoomIdx].codeDigit;

      const score = calcScore(answeredRoomIdx);
      if (bestScores[answeredRoomIdx] === null || score > bestScores[answeredRoomIdx]) {
        bestScores[answeredRoomIdx] = score;
        persistSave();
      }

      resetFear();
      updateHUD();
      const flashEl = $('room-clear-flash');
      if (flashEl) { flashEl.classList.remove('active'); void flashEl.offsetWidth; flashEl.classList.add('active'); }
      _questionAdvanceTimer = setTimeout(() => {
        if (gState.current === S.QUESTION && activeRoomIdx === answeredRoomIdx) closeQuestion();
      }, 900);
    } else {
      _questionAdvanceTimer = setTimeout(() => {
        if (gState.current === S.QUESTION && activeRoomIdx === answeredRoomIdx) showQuestionUI();
      }, 900);
    }

  } else {
    document.querySelectorAll('.choice-btn')[choiceIdx].classList.add('wrong');
    correctStreak = 0;
    updateHUD();
    wrongCount++;
    roomWrong[activeRoomIdx]++;
    const roomWrongNow = roomWrong[activeRoomIdx];
    const max = maxWrongAnswers();

    if (roomWrongNow >= max) {
      triggerChase({ clearQuestionTimers, showHUD });
      return;
    }

    applyFear(roomWrongNow);
    const fearVol = fearStage(roomWrongNow).enemyVol;
    AudioManager.setVolume('enemyNear', Math.min(1, fearVol + 0.42), 0.02);
    setTimeout(() => AudioManager.setVolume('enemyNear', fearVol, 0.7), 380);
    flashWrongVignette(roomWrongNow);

    const msg = wrongProgress(roomWrongNow) < 0.4
      ? '⚠ The ghost stirs…'
      : '⚠ The ghost grows stronger…';
    $('question-wrong-count').textContent =
      `${msg}  (${roomWrongNow}/${max})`;

    _wrongResetTimer = setTimeout(() => {
      if (gState.current === S.QUESTION) {
        document.querySelectorAll('.choice-btn').forEach(b => { b.disabled = false; b.classList.remove('wrong'); });
      }
      _wrongResetTimer = null;
    }, 700);
  }
}

function calcScore(roomIdx) {
  return Math.max(0, Math.round((1 - wrongProgress(roomWrong[roomIdx])) * 100));
}

function leaveQuestion() {
  if (gState.current !== S.QUESTION) return;
  AudioManager.play('uiClick');
  closeQuestion();
}

function closeQuestion() {
  clearQuestionTimers();
  showHUD();
  activeRoomIdx  = -1;
  gState.current = S.PLAYING;
}

// ── Jump scare ────────────────────────────────────────────────────────────────
function triggerJumpScare() {
  document.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);
  clearQuestionTimers();

  AudioManager.setVolume('ambient',   0, 0.05);
  AudioManager.setVolume('enemyNear', 0, 0.05);
  scene.fog.density = 0.48;

  setTimeout(() => {
    const overlay = $('jumpscare-overlay');
    overlay.classList.add('active');
    overlay.style.opacity = '1';

    document.body.classList.add('screenshake');
    renderer.domElement.style.filter = 'blur(2px) saturate(2.5) brightness(1.4)';

    elVignette.style.transition = 'none';
    elVignette.style.background = 'rgba(255,228,215,1)';
    elVignette.style.opacity    = '1';

    AudioManager.play('jumpscare');
    AudioManager.playScream();

    setTimeout(() => {
      document.body.classList.remove('screenshake');
      renderer.domElement.style.filter = '';
      elVignette.style.transition = 'background 0.35s, opacity 0.35s';
      elVignette.style.background = 'rgba(4,0,0,1)';
    }, 130);

    setTimeout(() => {
      overlay.style.transition = 'opacity 0.9s';
      overlay.style.opacity    = '0';
    }, 700);

    setTimeout(() => {
      overlay.classList.remove('active');
      overlay.style.transition = '';
      overlay.style.opacity    = '';
      triggerLose();
    }, 1700);

  }, 220);
}

// ── Keypad / code ─────────────────────────────────────────────────────────────
function openKeypad() {
  if (!roomDone.every(Boolean)) {
    elPrompt.textContent = '⚠ Solve all rooms first';
    elPrompt.style.opacity = '1';
    setTimeout(() => { elPrompt.style.opacity = '0'; elPrompt.textContent = '[ E ] Examine'; }, 2000);
    return;
  }
  gState.current = S.CODE;
  $('code-input').value = '';
  $('code-error').textContent = '';
  showScreen('code');
  setTimeout(() => $('code-input').focus(), 100);
}

// ── Win / Lose ────────────────────────────────────────────────────────────────
function buildWinScores() {
  $('win-scores').innerHTML = bestScores.map((s, i) =>
    `<div>${ROOMS[i].name} · ${ROOMS[i].label}: <strong>${s !== null ? s+'%' : '—'}</strong></div>`
  ).join('');
}

function triggerWin({ recordRun = true } = {}) {
  gState.current = S.WIN;
  buildWinScores();
  if (recordRun) {
    const elapsed    = getElapsedSeconds();
    const isNewBest  = bestTime === null || elapsed < bestTime;
    if (isNewBest) { bestTime = elapsed; persistSave(); }
    const bestLabel  = bestTime !== null ? '  Best: ' + formatTime(bestTime) + (isNewBest ? ' (new!)' : '') : '';
    $('win-time').textContent = 'Time: ' + formatTime(elapsed) + bestLabel;
  } else {
    $('win-time').textContent = 'Time: Test run';
  }
  $('s-win').classList.toggle('perfect', bestScores.every(s => s === 100));
  showScreen('win');
  AudioManager.stopAll();
  AudioManager.play('win');
}

function triggerLose() {
  gState.current = S.LOSE;
  elVignette.style.background = 'rgba(14,0,0,0.55)';
  elVignette.style.opacity    = '0.7';
  showScreen('lose');
  AudioManager.stopAll();
  AudioManager.play('jumpscare');
}

// ── Game start / restart ──────────────────────────────────────────────────────
function finishStartGame() {
  _startCameraTransition = null;
  setCameraView(START_CAMERA_VIEW);
  showHUD();
  gameStartTime  = Date.now();
  prevTime = performance.now();
  lockPointer();
  setCameraView(START_CAMERA_VIEW);
  _holdStartViewFrames = 5;
  gState.current = S.PLAYING;
  AudioManager.init().catch(err => console.warn('Audio init failed.', err));
}

function startGame({ transition = false } = {}) {
  resetProgress();
  scene.fog.density = CFG.fog.density;
  AudioManager.setVolume('enemyNear', 0, 0.1);
  elVignette.style.cssText = 'opacity:0';
  elHudPlayer.textContent = playerName;

  if (transition) {
    clearMovementInput();
    gState.current = S.MENU;
    setCameraView(MENU_CAMERA_VIEW);
    showScreen(null);
    _startCameraTransition = {
      startedAt: performance.now(),
      duration: 1250,
      from: { ...MENU_CAMERA_VIEW },
      to: { ...START_CAMERA_VIEW },
    };
    return;
  }

  finishStartGame();
}

// ── Story slides ──────────────────────────────────────────────────────────────
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
  const backBtn = $('btn-story-back');
  const nextBtn = $('btn-story-next');
  if (backBtn) backBtn.disabled = storyIdx === 0;
  if (nextBtn) nextBtn.textContent = storyIdx === STORY_SLIDES.length - 1 ? 'Ready' : 'Next';

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
  if (storyIdx >= STORY_SLIDES.length - 1 && dir > 0) { showScreen('ready'); return; }
  storyIdx = Math.max(0, Math.min(STORY_SLIDES.length - 1, storyIdx + dir));
  renderStory();
};

window.storySkip = function() {
  storyIdx = STORY_SLIDES.length - 1;
  showScreen('ready');
};

window.goHome = function() {
  storyIdx = 0;
  plearnIdx = 0;
  gState.current = S.MENU;
  clearMovementInput();
  resetFear();
  setMenuCamera();
  showScreen('menu');
};

function goToStory() {
  storyIdx = 0;
  setMenuCamera();
  renderStory();
  showScreen('story');
  screens.story.onclick = e => { if (e.target === screens.story) window.storyStep(1); };
}

// ── P-Learn slides ────────────────────────────────────────────────────────────
const PLEARN_SLIDES = [
  {
    label: 'LESSON 1 / 6 — INTRODUCTION', title: 'What is Probability?',
    body: `Probability tells us how <em>likely</em> an event is to happen.<br><br>
           It is always a number between <strong>0</strong> and <strong>1</strong>:<br><br>
           &nbsp;&nbsp;• <strong>0</strong> = Impossible — will <em>never</em> happen<br>
           &nbsp;&nbsp;• <strong>0.5</strong> = Equal chance — could go either way<br>
           &nbsp;&nbsp;• <strong>1</strong> = Certain — will <em>always</em> happen`, note: null,
  },
  {
    label: 'LESSON 2 / 6 — KEY TERMS', title: 'Important Terms',
    body: `<strong>Experiment</strong> — any activity that produces outcomes<br>
           <em style="color:#8899bb">e.g. flipping a coin, rolling a die</em><br><br>
           <strong>Sample Space (S)</strong> — the set of ALL possible outcomes<br>
           <em style="color:#8899bb">e.g. {Heads, Tails} for a coin flip</em><br><br>
           <strong>Event (E)</strong> — the specific outcome(s) we want<br><br>
           <strong>Favorable Outcomes</strong> — outcomes that match our event`, note: null,
  },
  {
    label: 'LESSON 3 / 6 — THE FORMULA', title: 'How to Calculate Probability',
    body: `To find the probability of an event, always use this formula:`,
    note: 'P(Event) = Favorable Outcomes ÷ Total Possible Outcomes',
  },
  {
    label: 'LESSON 4 / 6 — EASY EXAMPLE', title: 'Example: Rolling a Die',
    body: `<strong>Problem:</strong> A fair die is rolled. What is P(rolling a 3)?<br><br>
           → Sample Space = {1, 2, 3, 4, 5, 6} &nbsp;→&nbsp; Total = <strong>6</strong><br>
           → Favorable outcomes = {3} &nbsp;→&nbsp; Count = <strong>1</strong><br><br>
           Apply the formula:`,
    note: 'P(3) = 1 ÷ 6 = 1/6 ≈ 0.17',
  },
  {
    label: 'LESSON 5 / 6 — MODERATE EXAMPLE', title: 'Example: Marbles in a Bag',
    body: `<strong>Problem:</strong> A bag has 4 red and 6 blue marbles. What is P(red)?<br><br>
           → Total marbles = 4 + 6 = <strong>10</strong><br>
           → Favorable (red) = <strong>4</strong><br><br>
           Apply the formula:`,
    note: 'P(red) = 4 ÷ 10 = 2/5 = 0.4',
  },
  {
    label: 'LESSON 6 / 6 — HARD EXAMPLE', title: 'Real-Life Word Problem',
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
  $('plearn-title').textContent       = slide.title;
  $('plearn-body').innerHTML          = slide.body;

  const noteEl = $('plearn-note');
  if (slide.note) { noteEl.style.display = 'block'; noteEl.textContent = slide.note; }
  else            { noteEl.style.display = 'none'; }

  $('btn-plearn-prev').disabled = plearnIdx === 0;
  $('btn-plearn-next').textContent = plearnIdx === PLEARN_SLIDES.length - 1 ? 'Ready' : 'Next';

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
  if (dir > 0 && plearnIdx === PLEARN_SLIDES.length - 1) {
    setMenuCamera();
    showScreen('ready');
    return;
  }
  plearnIdx = Math.max(0, Math.min(PLEARN_SLIDES.length - 1, plearnIdx + dir));
  renderPlearn();
};

function goToPlearn() {
  CFG.gameplay.pLearnMode = true;
  plearnIdx = 0;
  setMenuCamera();
  renderPlearn();
  showScreen('plearn');
}

function updateFlickerLights(t, dt) {
  flickerLights.forEach(flicker => {
    const { light, base, speed, amp, type } = flicker;
    let intensity;
    if (type === 'candle') {
      intensity = base + Math.sin(t * speed) * amp * 0.5 + Math.random() * amp * 0.5;
    } else {
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
      flicker.glowMaterials.forEach(mat => { mat.opacity = Math.min(0.42, 0.055 + sync * 0.28); });
    }
  });
}

function updateStartCameraTransition(now) {
  const tr = _startCameraTransition;
  if (!tr) return false;

  const t = Math.min(1, (now - tr.startedAt) / tr.duration);
  const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  camera.position.set(
    tr.from.x + (tr.to.x - tr.from.x) * eased,
    tr.from.y + (tr.to.y - tr.from.y) * eased,
    tr.from.z + (tr.to.z - tr.from.z) * eased,
  );
  look.yaw = lerpAngle(tr.from.yaw, tr.to.yaw, eased);
  look.pitch = tr.from.pitch + (tr.to.pitch - tr.from.pitch) * eased;
  camera.rotation.set(look.pitch, look.yaw, 0);

  if (t >= 1) finishStartGame();
  return true;
}

// ── Threat audio ──────────────────────────────────────────────────────────────
let tensionTimer = 0;
function updateThreatAudio(dt) {
  tensionTimer -= dt;
  if (tensionTimer > 0) return;
  tensionTimer = 0.45;

  if (gState.current !== S.PLAYING) { AudioManager.setVolume('enemyNear', 0, 0.6); return; }

  const maxWrong = roomWrong.reduce((m, w, i) => roomDone[i] ? m : Math.max(m, w), 0);
  const stage    = fearStage(maxWrong);
  AudioManager.setVolume('enemyNear', stage.enemyVol, 0.8);
  scene.fog.density = stage.fogDensity;
}

// ── Game loop ─────────────────────────────────────────────────────────────────
let prevTime = performance.now();
let footstepTimer = 0;
const STEP_INTERVAL = 0.42;

let _tabHidden = false;
document.addEventListener('visibilitychange', () => { _tabHidden = document.hidden; });

function animate() {
  requestAnimationFrame(animate);
  if (_tabHidden) return;

  const now = performance.now();
  const dt  = Math.min((now - prevTime) / 1000, 0.05);
  prevTime  = now;
  const t   = now * 0.001;

  updateFlickerLights(t, dt);

  if (updateStartCameraTransition(now)) { renderer.render(scene, camera); return; }
  if (gState.current === S.LOSE) { initLoseCanvas(); updateLoseCanvas(); return; }
  if (gState.current === S.WIN) return;
  if (gState.current === S.MENU) { renderer.render(scene, camera); return; }

  updateThreatAudio(dt);
  updateAmbientScares(dt);

  if (gState.current === S.CHASE) { updateChase(dt); renderer.render(scene, camera); return; }
  if (gState.current !== S.PLAYING) { renderer.render(scene, camera); return; }

  if (_holdStartViewFrames > 0) {
    _holdStartViewFrames--;
    setCameraView(START_CAMERA_VIEW);
    renderer.render(scene, camera);
    return;
  }

  // ── Key look ──────────────────────────────────────────────────────────────
  const kx = ((keys['KeyL']) ? 1 : 0) - ((keys['KeyJ']) ? 1 : 0);
  const ky = ((keys['KeyK']) ? 1 : 0) - ((keys['KeyI']) ? 1 : 0);
  if (kx || ky) queueLookDelta(kx * KEY_LOOK_SPEED * dt, ky * KEY_LOOK_SPEED * dt);
  flushLookInput();

  // ── Movement ──────────────────────────────────────────────────────────────
  const fwd = ((keys['KeyW']||keys['ArrowUp']   )?1:0) - ((keys['KeyS']||keys['ArrowDown'] )?1:0);
  const rgt = ((keys['KeyD']||keys['ArrowRight'] )?1:0) - ((keys['KeyA']||keys['ArrowLeft'] )?1:0);

  if (fwd || rgt) {
    const sinY = Math.sin(look.yaw), cosY = Math.cos(look.yaw);
    const spd  = CFG.player.speed * dt;
    if (fwd) { camera.position.x -= sinY*fwd*spd; camera.position.z -= cosY*fwd*spd; resolveCollision(camera.position); }
    if (rgt) { camera.position.x += cosY*rgt*spd; camera.position.z -= sinY*rgt*spd; resolveCollision(camera.position); }
    camera.position.y = CFG.player.eyeH;
    footstepTimer -= dt;
    if (footstepTimer <= 0) { AudioManager.play('footstep'); footstepTimer = STEP_INTERVAL; }
  } else {
    footstepTimer = 0;
  }

  // ── Interaction prompt ────────────────────────────────────────────────────
  nearObject = findNearObject();
  setCanInteract(Boolean(nearObject));
  if (nearObject) {
    const action = GameDevice.controls === 'touch' ? 'Tap !' : '[ E ]';
    elPrompt.textContent = nearObject.userData.isKeypad ? `${action} Enter Code` : `${action} Examine`;
    elPrompt.style.opacity = '1';
  } else {
    elPrompt.style.opacity = '0';
  }
  if (!nearObject && GameDevice.controls === 'keyboardMouse' && document.pointerLockElement !== renderer.domElement) {
    elPrompt.textContent   = 'Click Game Area To Look';
    elPrompt.style.opacity = '1';
  }

  renderer.render(scene, camera);
}

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  applyDeviceProfile();
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('orientationchange', () => setTimeout(applyDeviceProfile, 80));

// ── Audio priming ─────────────────────────────────────────────────────────────
function primeAudio() {
  AudioManager.startLoop('ambient').catch(err => console.warn('Audio preload failed.', err));
}
document.addEventListener('pointerdown', primeAudio, { once: true });
document.addEventListener('keydown',     primeAudio, { once: true });
window.AudioManager = AudioManager;

// ── Pre-game UI click sound ───────────────────────────────────────────────────
const PRE_GAME_SCREENS   = ['title', 'menu', 'story', 'plearn', 'ready', 'settings', 'about'];
const PRE_GAME_CONTROLS  = ['button','.nav-back','.nav-fwd','.nav-home','#title-arrow','#icon-settings','#icon-about'].join(',');

document.addEventListener('click', e => {
  if (!PRE_GAME_SCREENS.some(name => !screens[name].classList.contains('hidden'))) return;
  const control = e.target.closest(PRE_GAME_CONTROLS);
  if (!control) return;
  if (
    (control.classList.contains('nav-back') || control.classList.contains('nav-fwd')) &&
    (!screens.story.classList.contains('hidden') || !screens.plearn.classList.contains('hidden'))
  ) return;
  AudioManager.play('uiClick');
});

// ── Button wiring ─────────────────────────────────────────────────────────────
$('btn-play').onclick       = () => { CFG.gameplay.pLearnMode = false; goToStory(); };
$('btn-plearn').onclick     = goToPlearn;
$('btn-yes').onclick        = () => startGame({ transition: true });
$('btn-no').onclick         = () => window.goHome();
$('btn-win-restart').onclick  = () => { CFG.gameplay.pLearnMode = false; window.goHome(); };
$('btn-lose-retry').onclick   = () => { gState.current = S.MENU; setMenuCamera(); showScreen('ready'); };
$('hud-options-btn').onclick  = () => openOptions();
$('btn-options-resume').onclick = resumeGame;
$('btn-options-restart').onclick = () =>
  requestOptionsConfirm('Restart this run? Current room progress will be cleared.', () => startGame());
$('btn-options-home').onclick = () =>
  requestOptionsConfirm('Return to the home screen? Current run progress will be cleared.', returnHomeFromOptions);
$('btn-options-settings').onclick = () => openSettings('options');
$('btn-options-confirm-no').onclick  = hideOptionsConfirm;
$('btn-options-confirm-yes').onclick = () => {
  const action = pendingOptionsAction; pendingOptionsAction = null; if (action) action();
};
$('btn-question-exit').onclick = leaveQuestion;
$('btn-code-submit').onclick   = () => {
  const val = $('code-input').value.trim();
  if (val === EXIT_CODE) triggerWin();
  else { $('code-error').textContent = '✗ Incorrect code. Try again.'; AudioManager.play('jumpscare'); }
};
$('btn-code-cancel').onclick   = () => { showHUD(); gState.current = S.PLAYING; };
$('code-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-code-submit').click(); });
$('btn-save-name').onclick     = () => {
  const n = $('settings-name').value.trim();
  if (n) {
    playerName = n; persistSave(); updateMenuName();
    elHudPlayer.textContent = playerName;
    $('settings-saved').textContent = '✓ Saved';
    setTimeout(() => { $('settings-saved').textContent = ''; }, 1800);
  }
};
$('btn-reset-progress').onclick = () => {
  if (!confirm('Reset all progress and scores?')) return;
  bestScores = [null, null, null]; bestTime = null;
  persistSave(); updateSettingsScores(); resetProgress();
  $('settings-saved').textContent = '✓ Progress reset';
  setTimeout(() => { $('settings-saved').textContent = ''; }, 2000);
};
elSensitivity?.addEventListener('input', e => {
  setLookSensitivity(normalizeSensitivity(Number(e.target.value)));
  updateSensitivityUI();
  persistSave();
});
$('btn-settings-back').onclick = () => {
  if (settingsFrom === 'options') openOptions(false); else showScreen('menu');
};
$('icon-settings').onclick   = () => openSettings('menu');
$('icon-about').onclick      = () => showScreen('about');
$('btn-about-back').onclick  = () => showScreen('menu');
$('persistent-fs-btn')?.addEventListener('click', () => {
  toggleFullscreen(); AudioManager.play('uiClick');
});

screens.pause.addEventListener('click', () => {
  if (gState.current === S.PAUSED) { showHUD(); gState.current = S.PLAYING; lockPointer(); }
});

// ── Input callbacks ───────────────────────────────────────────────────────────
initInput({
  onInteract:   tryInteract,
  onRestartKey: () => {
    if (gState.current === S.WIN)  $('btn-win-restart').click();
    if (gState.current === S.LOSE) $('btn-lose-retry').click();
  },
  onPauseKey: () => {
    if (gState.current === S.PLAYING) openOptions();
    else if (gState.current === S.PAUSED) {
      if (!screens.options.classList.contains('hidden'))                                   resumeGame();
      else if (!screens.settings.classList.contains('hidden') && settingsFrom === 'options') openOptions(false);
    }
  },
  onPause: () => openOptions(false),
});

// ── Chase + interaction setup ─────────────────────────────────────────────────
initChase({ onCaught: triggerLose });
elPrompt.addEventListener('pointerdown', e => { e.preventDefault(); tryInteract(); });

function triggerDevWin() {
  clearMovementInput();
  clearQuestionTimers();
  clearScareSprite();
  cleanupChase();
  roomDone      = [true, true, true];
  roomProgress  = ROOMS.map(room => room.questions.length);
  roomWrong     = [0, 0, 0];
  codeDigits    = ROOMS.map(room => room.codeDigit);
  bestScores    = [100, 100, 100];
  correctStreak = 0;
  gameStartTime = Date.now();
  updateHUD();
  resetFear();
  triggerWin({ recordRun: false });
}

// ── Dev helpers ───────────────────────────────────────────────────────────────
if (import.meta.env.DEV) {
  window.__escapeRoomDebug = {
    getState: () => ({
      state: gState.current, yaw: look.yaw, pitch: look.pitch,
      position: { x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2) },
      lookSensitivity: +lookSensitivity.toFixed(2),
      canInteract: Boolean(nearObject), target: nearObject?.userData || null,
    }),
    setPose(p = {}) {
      look.yaw = p.yaw ?? look.yaw; look.pitch = p.pitch ?? look.pitch;
      camera.position.set(p.x ?? camera.position.x, p.y ?? camera.position.y, p.z ?? camera.position.z);
      camera.rotation.set(look.pitch, look.yaw, 0);
      nearObject = findNearObject(); setCanInteract(Boolean(nearObject));
      return this.getState();
    },
  };
  const devScareBtn = $('dev-scare-btn');
  devScareBtn?.removeAttribute('hidden');
  devScareBtn?.addEventListener('click', triggerDevWin);
  window.__devPlay    = () => { resetProgress(); startGame(); };
  window.__scene      = scene;
  window.__devLose    = () => { resetProgress(); startGame(); triggerLose(); };
  window.__devWin     = triggerDevWin;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
setMenuCamera();
applyDeviceProfile();
updateMenuName();
updateFullscreenLabel();
animate();
preloadAssets();
