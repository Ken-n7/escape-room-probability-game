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
    src: `${AUDIO_DIR}jumpscares/sound_effects75-eyesaur-jumpscare-sound-482110.mp3`,
    loop: false,
    vol: 1,
  },
  ghostScream: {
    src: `${AUDIO_DIR}jumpscares/sound_effects75-eyesaur-jumpscare-sound-482110.mp3`,
    loop: false,
    vol: 1,
  },
  randomScareWhisper: {
    src: `${AUDIO_DIR}jumpscares/dragon-studio-creepy-ghost-whisper-410564.mp3`,
    loop: false,
    vol: 0.95,
  },
  randomScareHit: {
    src: `${AUDIO_DIR}jumpscares/sound_effects75-eyesaur-jumpscare-sound-482110.mp3`,
    loop: false,
    vol: 1,
  },
  randomMoan: {
    src: `${AUDIO_DIR}randoms/dragon-studio-creepy-ghosts-moan-sfx-482866.mp3`,
    loop: false,
    vol: 0.55,
  },
  randomTone: {
    src: `${AUDIO_DIR}randoms/dragon-studio-ghostly-tone-499659.mp3`,
    loop: false,
    vol: 0.48,
  },
  randomRunning: {
    src: `${AUDIO_DIR}randoms/ghost-running-sound.mp3`,
    loop: false,
    vol: 0.42,
  },
  randomScream: {
    src: `${AUDIO_DIR}randoms/ghost-scream.mp3`,
    loop: false,
    vol: 0.5,
  },
  win: {
    src: `${AUDIO_DIR}win_chime.wav`,
    loop: false,
    vol: 0.95,
  },

  // ── freesound.org CC0 additions (variety for ambience + vacant rooms) ──────
  randomCrying1: {
    src: `${AUDIO_DIR}randoms/fs453000-baby-crying-corridor.mp3`,
    loop: false,
    vol: 0.5,
  },
  randomCrying2: {
    src: `${AUDIO_DIR}randoms/fs175206-sad-ghost-crying.mp3`,
    loop: false,
    vol: 0.5,
  },
  randomLaughKids: {
    src: `${AUDIO_DIR}randoms/fs419800-kids-laughing-reversed.mp3`,
    loop: false,
    vol: 0.42,
  },
  randomLaughEvil: {
    src: `${AUDIO_DIR}randoms/fs275146-evil-laugh.mp3`,
    loop: false,
    vol: 0.45,
  },
  randomWhisper2: {
    src: `${AUDIO_DIR}randoms/fs143902-four-voices-whispering.mp3`,
    loop: false,
    vol: 0.5,
  },
  randomKnock: {
    src: `${AUDIO_DIR}randoms/fs433732-deep-knocking.mp3`,
    loop: false,
    vol: 0.55,
  },
  randomMoan2: {
    src: `${AUDIO_DIR}randoms/fs643741-ghost-moan.mp3`,
    loop: false,
    vol: 0.5,
  },
  ambientSwell: {
    src: `${AUDIO_DIR}randoms/fs534876-horror-drone-swell.mp3`,
    loop: false,
    vol: 0.3,
  },
};
