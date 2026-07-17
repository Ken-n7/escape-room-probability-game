// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIG — world dimensions and game settings.
// ═══════════════════════════════════════════════════════════════════════════════

export const CFG = {

  // ── Player ───────────────────────────────────────────────────────────────────
  player: {
    speed:       4.5,   // movement speed  (units / sec)
    eyeH:        1.7,   // camera height
    radius:      0.35,  // collision radius
    interactR:   2.2,   // max distance to trigger "Press E" prompt
  },

  // ── World dimensions ─────────────────────────────────────────────────────────
  world: {
    hallW:   6,     // hallway width  (x: -3 … 3)
    hallH:   3.6,   // hallway height
    hallL:   54,    // hallway length (z: 0 … 54)

    roomW:   12,    // room width extending right (x: 3 … 15)
    roomH:   3.6,   // room height
    wallT:   0.25,  // wall thickness (visual only)

    // Door opening size (in the wall between hallway and each room)
    doorW:   2.8,
    doorH:   3.0,

    // Room layout along Z axis: [zStart, zEnd, doorZStart, doorZEnd]
    rooms: [
      [  7, 19,  9.6, 12.4 ],   // Room 1
      [ 23, 35, 25.6, 28.4 ],   // Room 2
      [ 39, 51, 41.6, 44.4 ],   // Room 3
    ],

    // Exit door position (far end of hallway)
    exitZ:   53.5,
  },

  // ── Atmosphere ───────────────────────────────────────────────────────────────
  fog:      { density: 0.030 },
  ambLight: 0x0a0a0a,

  // ── Gameplay ─────────────────────────────────────────────────────────────────
  gameplay: {
    maxWrongAnswers: 5,    // wrong answers allowed per room before the chase penalty
    pLearnMode:      false, // toggled from menu — shows hint before each question
  },
};
