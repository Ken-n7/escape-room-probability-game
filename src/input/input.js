import { gState, look, keys, S } from '../core/game-state.js';
import { renderer, camera } from '../core/renderer.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const BASE_LOOK_SENS = 0.0022;
export const MIN_LOOK_SENSITIVITY = 0.45;
export const MAX_LOOK_SENSITIVITY = 1.8;

export const MOVE_KEYS = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
const LOOK_KEYS = new Set(['KeyI','KeyJ','KeyK','KeyL']);
const JOYSTICK_MOVE_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
const JOYSTICK_DEADZONE = 0.22;

// ── Look sensitivity (set by settings, read by applyLookDelta) ────────────────
export let lookSensitivity = 1;
export function setLookSensitivity(v) { lookSensitivity = v; }

// ── Device profile ────────────────────────────────────────────────────────────
export const GameDevice = {};

const DEVICE_QUERIES = {
  primaryCoarse: window.matchMedia('(pointer: coarse)'),
  primaryFine:   window.matchMedia('(pointer: fine)'),
  anyCoarse:     window.matchMedia('(any-pointer: coarse)'),
  narrow:        window.matchMedia('(max-width: 760px)'),
  landscape:     window.matchMedia('(orientation: landscape)'),
};

export function applyDeviceProfile() {
  const touchControls = DEVICE_QUERIES.primaryCoarse.matches || DEVICE_QUERIES.narrow.matches;
  Object.assign(GameDevice, {
    mode:           touchControls ? 'mobile' : 'desktop',
    controls:       touchControls ? 'touch'  : 'keyboardMouse',
    hasTouch:       DEVICE_QUERIES.anyCoarse.matches || navigator.maxTouchPoints > 0,
    hasFinePointer: DEVICE_QUERIES.primaryFine.matches,
    orientation:    DEVICE_QUERIES.landscape.matches ? 'landscape' : 'portrait',
    usePointerLock: !touchControls && DEVICE_QUERIES.primaryFine.matches,
  });
  GameDevice.mustRotate =
    GameDevice.hasTouch && GameDevice.controls === 'touch' && GameDevice.orientation === 'portrait';

  document.body.dataset.device      = GameDevice.mode;
  document.body.dataset.controls    = GameDevice.controls;
  document.body.dataset.orientation = GameDevice.orientation;
  document.body.dataset.touch       = GameDevice.hasTouch ? 'true' : 'false';
  document.body.dataset.mustRotate  = GameDevice.mustRotate ? 'true' : 'false';
  window.GameDevice = GameDevice;

  if (!GameDevice.usePointerLock && document.pointerLockElement === renderer.domElement) {
    _suppressUnlockPause = true;
    unlockPointer();
  }

  const hudVisible = document.getElementById('hud')?.style.display === 'block';
  if (hudVisible) {
    renderer.domElement.style.cursor = GameDevice.usePointerLock ? 'none' : 'auto';
  }
}

Object.values(DEVICE_QUERIES).forEach(q => {
  if (q.addEventListener) q.addEventListener('change', applyDeviceProfile);
  else q.addListener?.(applyDeviceProfile);
});

// ── Pointer lock ──────────────────────────────────────────────────────────────
export function lockPointer() {
  if (!GameDevice.usePointerLock) return;
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.focus({ preventScroll: true });
    try {
      const req = renderer.domElement.requestPointerLock();
      req?.catch?.(() => {});
    } catch {}
  }
}

export function unlockPointer() {
  if (document.pointerLockElement) document.exitPointerLock();
}

export function capturePointer(el, pointerId) {
  try { el.setPointerCapture?.(pointerId); } catch {}
}

// ── Look delta queue ──────────────────────────────────────────────────────────
let _queuedDX = 0, _queuedDY = 0;

export function applyLookDelta(dx, dy, multiplier = 1) {
  look.yaw   -= dx * BASE_LOOK_SENS * lookSensitivity * multiplier;
  look.pitch -= dy * BASE_LOOK_SENS * lookSensitivity * multiplier;
  look.pitch  = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, look.pitch));
  camera.rotation.set(look.pitch, look.yaw, 0);
}

export function queueLookDelta(dx, dy, multiplier = 1) {
  _queuedDX += dx * multiplier;
  _queuedDY += dy * multiplier;
}

export function flushLookInput() {
  if (!_queuedDX && !_queuedDY) return;
  applyLookDelta(_queuedDX, _queuedDY);
  _queuedDX = 0;
  _queuedDY = 0;
}

// ── Mouse / trackpad look ─────────────────────────────────────────────────────
let _prevX = null, _prevY = null;

// Prevents a camera-jump the next time the mouse moves after HUD transitions
export function resetMouseDelta() { _prevX = null; _prevY = null; }
let _lastRawLookAt = 0;
let _suppressUnlockPause = false;

function _queueMouseLook(e) {
  if (gState.current !== S.PLAYING && gState.current !== S.CHASE) return;
  if (!GameDevice.usePointerLock && GameDevice.controls === 'touch') return;
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

// ── Touch look ────────────────────────────────────────────────────────────────
let _touchLookId = null, _touchLookX = 0, _touchLookY = 0;

// ── Event wiring (called once from initInput) ─────────────────────────────────
let _cb = {};

function setJoystickKeys(x, y) {
  keys.KeyW = y < -JOYSTICK_DEADZONE;
  keys.KeyS = y > JOYSTICK_DEADZONE;
  keys.KeyA = x < -JOYSTICK_DEADZONE;
  keys.KeyD = x > JOYSTICK_DEADZONE;
}

function clearJoystickKeys() {
  JOYSTICK_MOVE_CODES.forEach(code => { keys[code] = false; });
}

function initMoveJoystick() {
  const joystick = document.getElementById('mobile-joystick');
  const knob = document.getElementById('mobile-joystick-knob');
  if (!joystick || !knob) return;

  let activePointerId = null;

  const resetJoystick = () => {
    activePointerId = null;
    joystick.classList.remove('active');
    knob.style.transform = 'translate(-50%, -50%)';
    clearJoystickKeys();
  };

  const updateJoystick = e => {
    if (gState.current !== S.PLAYING) {
      resetJoystick();
      return;
    }

    const rect = joystick.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const maxRadius = Math.max(18, rect.width * 0.5 - knob.offsetWidth * 0.5 - 8);
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);

    if (len > maxRadius) {
      dx = (dx / len) * maxRadius;
      dy = (dy / len) * maxRadius;
    }

    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    setJoystickKeys(dx / maxRadius, dy / maxRadius);
  };

  joystick.addEventListener('pointerdown', e => {
    if (gState.current !== S.PLAYING || activePointerId !== null) return;
    e.preventDefault();
    e.stopPropagation();
    activePointerId = e.pointerId;
    joystick.classList.add('active');
    capturePointer(joystick, e.pointerId);
    updateJoystick(e);
  });

  joystick.addEventListener('pointermove', e => {
    if (e.pointerId !== activePointerId) return;
    e.preventDefault();
    e.stopPropagation();
    updateJoystick(e);
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
    joystick.addEventListener(type, e => {
      if (e.pointerId !== activePointerId) return;
      e.preventDefault();
      e.stopPropagation();
      resetJoystick();
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetJoystick();
  });
}

export function initInput(callbacks = {}) {
  _cb = callbacks;

  document.addEventListener('pointerlockchange', () => {
    _prevX = null; _prevY = null;
    if (_suppressUnlockPause) { _suppressUnlockPause = false; return; }
    if (!document.pointerLockElement && gState.current === S.PLAYING) {
      _cb.onPause?.();
    }
  });
  document.addEventListener('pointerlockerror', () => { _prevX = null; _prevY = null; });

  renderer.domElement.addEventListener('click',     () => { if (gState.current === S.PLAYING) lockPointer(); });
  renderer.domElement.addEventListener('mousedown', () => { if (gState.current === S.PLAYING) lockPointer(); });

  document.addEventListener('pointerrawupdate', e => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    _lastRawLookAt = performance.now();
    _queueMouseLook(e);
  }, { capture: true });

  document.addEventListener('mousemove', e => {
    if (performance.now() - _lastRawLookAt < 8) return;
    _queueMouseLook(e);
  }, { capture: true });

  renderer.domElement.addEventListener('mouseleave', () => { _prevX = null; _prevY = null; });

  renderer.domElement.addEventListener('pointerdown', e => {
    if (gState.current !== S.PLAYING) return;
    renderer.domElement.focus({ preventScroll: true });
    if (e.pointerType === 'mouse') {
      lockPointer();
      _prevX = e.clientX; _prevY = e.clientY;
      return;
    }
    if (GameDevice.usePointerLock) return;
    _touchLookId = e.pointerId;
    _touchLookX  = e.clientX;
    _touchLookY  = e.clientY;
    capturePointer(renderer.domElement, e.pointerId);
  });

  renderer.domElement.addEventListener('pointermove', e => {
    if (GameDevice.usePointerLock || gState.current !== S.PLAYING || e.pointerId !== _touchLookId) return;
    queueLookDelta(e.clientX - _touchLookX, e.clientY - _touchLookY, 1.35);
    _touchLookX = e.clientX; _touchLookY = e.clientY;
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
    renderer.domElement.addEventListener(type, e => {
      if (e.pointerId === _touchLookId) _touchLookId = null;
    });
  });

  document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (MOVE_KEYS.has(e.code) || LOOK_KEYS.has(e.code)) e.preventDefault();
    if (e.code === 'Space' && gState.current === S.PLAYING) e.preventDefault();   // jump — no page scroll
    if (e.code === 'KeyE') _cb.onInteract?.();
    if (e.code === 'KeyR') { e.preventDefault(); _cb.onRestartKey?.(); }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault();
      _cb.onPauseKey?.();
    }
  });

  document.addEventListener('keyup', e => { keys[e.code] = false; });

  initMoveJoystick();

  document.addEventListener('selectstart', e => {
    if (!_isEditable(e.target)) e.preventDefault();
  });

  document.addEventListener('contextmenu', e => {
    if (GameDevice.hasTouch && !_isEditable(e.target)) e.preventDefault();
  });
}

function _isEditable(target) {
  return Boolean(target?.closest?.('input, textarea, [contenteditable="true"]'));
}

export const KEY_LOOK_SPEED = 560;
