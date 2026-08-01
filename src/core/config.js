// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIG — world dimensions and game settings.
//
//  L-SHAPED LAYOUT (design doc: docs/design-exploration-rooms-and-hunting.md)
//
//  Leg 1: corridor x ∈ [-3, 3], z ∈ [0, 52]   (spawn at z≈2, walking +z)
//  Leg 2: corridor x ∈ [3, 44], z ∈ [46, 52]  (corner at x∈[-3,3] z∈[46,52])
//  Exit door in the end wall x = 44.
//
//  Rooms hang off the corridor walls. Each room is described by:
//    orient  which corridor wall its door is in —
//            'E' wall x=+3 (room extends +x)   'W' wall x=-3 (extends -x)
//            'N' wall z=52 (extends +z)        'S' wall z=46 (extends -z)
//    v0..v1  the room's span ALONG that wall (z for E/W, x for N/S)
//    door    the door opening's span along the wall (world coords)
//  world.js turns these into geometry via per-room local frames.
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
    hallW:   6,     // corridor width
    hallH:   3.6,   // corridor height
    leg1Len: 52,    // leg 1 runs z: 0 … leg1Len
    leg2EndX: 44,   // leg 2 runs x: 3 … leg2EndX, z: leg2Z0 … leg2Z1
    leg2Z0:  46,
    leg2Z1:  52,

    roomW:   12,    // classroom width & depth
    roomH:   3.6,   // room height
    wallT:   0.25,  // wall thickness (visual only)
    doorW:   1.6,   // classroom door opening — single door (was a 2.8 square)
    doorH:   2.9,

    // Classrooms in walking order: 3 real levels + 2 decoys that look real.
    // idx = level index (0 Easy / 1 Moderate / 2 Hard), null = decoy.
    // Chalkboards are blank everywhere, so nothing labels a room as real.
    classrooms: [
      { key: 'room1',  idx: 0,    orient: 'E', v0:  4, v1: 16, door: [ 7.2,  8.8] },
      { key: 'decoy1', idx: null, orient: 'E', v0: 18, v1: 30, door: [21.2, 22.8] },
      { key: 'room2',  idx: 1,    orient: 'E', v0: 32, v1: 44, door: [35.2, 36.8] },
      { key: 'decoy2', idx: null, orient: 'S', v0: 17, v1: 29, door: [20.2, 21.8] },
      { key: 'room3',  idx: 2,    orient: 'N', v0: 19, v1: 31, door: [22.2, 23.8] },
    ],

    // Vacant abandoned rooms (open dark doorways, no doors).
    // The 'N' one at v0:-4 sits dead ahead at the corner — the black doorway
    // the player walks straight toward before the corridor bends right.
    vacants: [
      { orient: 'W', v0:  8, v1: 16, door: [11.2, 12.8] },
      { orient: 'W', v0: 24, v1: 32, door: [27.2, 28.8] },
      { orient: 'N', v0: -4, v1:  4, door: [-0.8,  0.8] },
      { orient: 'N', v0:  7, v1: 15, door: [10.2, 11.8] },
      { orient: 'S', v0: 33, v1: 41, door: [36.2, 37.8] },
    ],
    vacantDepth: 7,
  },

  // ── Atmosphere ───────────────────────────────────────────────────────────────
  fog:      { density: 0.030 },
  ambLight: 0x0a0a0a,

  // ── Gameplay ─────────────────────────────────────────────────────────────────
  gameplay: {
    maxWrongAnswers: 5,     // wrong answers allowed per room before the chase penalty
    pLearnMode:      false, // toggled from menu — shows hint before each question
    answerTimeSeconds: [15, 25, 30],  // per-level time limit by room index
                            // (Easy / Moderate / Hard); PLAY mode only. Timeout
                            // resets the room to Q1 with freshly drawn problems.
  },
};
