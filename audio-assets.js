const AUDIO_DIR = '/assets/audio/';

// Swap sounds here, or replace files in public/assets/audio with the same names.
export const AUDIO_ASSETS = {
  ambient: {
    src: `${AUDIO_DIR}ambient_drone.wav`,
    loop: true,
    vol: 0.7,
  },
  footstep: {
    src: `${AUDIO_DIR}footstep_thud.wav`,
    loop: false,
    vol: 0.9,
  },
  pickup: {
    src: `${AUDIO_DIR}pickup_chime.wav`,
    loop: false,
    vol: 0.95,
  },
  uiClick: {
    src: `${AUDIO_DIR}ui_click.wav`,
    loop: false,
    vol: 0.7,
  },
  pageTurn: {
    src: `${AUDIO_DIR}page_turn.wav`,
    loop: false,
    vol: 0.75,
  },
  enemyNear: {
    src: `${AUDIO_DIR}enemy_near_breath.wav`,
    loop: true,
    vol: 0,
  },
  jumpscare: {
    src: `${AUDIO_DIR}jumpscare_sting.wav`,
    loop: false,
    vol: 1,
  },
  win: {
    src: `${AUDIO_DIR}win_chime.wav`,
    loop: false,
    vol: 0.95,
  },
};
