export const S = Object.freeze({
  MENU: 0, PLAYING: 1, PAUSED: 2, QUESTION: 3,
  CODE: 4,  WIN: 5,    LOSE: 6,   CHASE: 7,
});

// Mutable objects — all modules import by reference so changes are visible everywhere
export const gState = { current: S.MENU };
export const look   = { yaw: 0, pitch: 0 };
export const keys   = {};
