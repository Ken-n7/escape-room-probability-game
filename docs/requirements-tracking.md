# Requirements Tracking — Escape Room Probability Game

Tracks the researchers' requirements ("ESCAPE ROOM GAME — General Suggestion and
Recommendations of the Researchers" PDF + Canva prototype) against the current build.

**Last audited:** 2026-07-18 (`main` @ merge of `feat/loading-screen`)

**Legend:**
- ✅ Implemented
- 🟡 Partial — exists but differs from the spec
- ❌ Missing
- ❓ Needs decision from researchers

---

## 1. World & Level Design

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1.1 | 5 main doors: Entrance, Room 1 (Easy), Room 2 (Moderate), Room 3 (Hard), Exit | 🟡 | 3 level rooms + exit door with keypad exist along one hallway ([world.js](../src/world/world.js), rooms at z 7–19 / 23–35 / 39–51, exit at z 53.5). No distinct entrance door — player spawns inside. |
| 1.2 | Level rooms not close/beside each other | 🟡 | Rooms are separated by ~4 units of hallway wall, but there is nothing between them. |
| 1.3 | At least 5 empty/vacant rooms between levels for creepy aesthetics (crying/laughing sounds, school works, abandoned rooms) — Slendrina-style | ❌ | No vacant rooms exist. Hallway has lockers only. Ambient scare sounds (moans, whispers, screams) exist globally but are not tied to rooms. |
| 1.4 | Doors 2 and 3 locked until previous room completed | ❌ | All rooms are open from the start; only the exit keypad requires all 3 rooms done ([main.js](../src/main.js) `openKeypad`). |
| 1.5 | Jumpscare when trying to open a locked door | ❌ | No locked doors, so no trigger. (Jumpscare systems do exist and could be reused: [scare.js](../src/scares/scare.js), [chase.js](../src/scares/chase.js).) |

## 2. Gameplay Flow

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 2.1 | Exactly 5 problems per level | ✅ | 5 questions per room ([questions.js](../src/data/questions.js)), order shuffled each run. |
| 2.2 | If time runs out, player restarts the level with a *different* problem | ❌ | No per-question timer, and question banks contain exactly 5 items per room — no spares to swap in. PDF supplies 15 Easy / 10 Moderate / 10 Hard items; the game currently uses 5/5/5. |
| 2.3 | 15-second answer time limit — starts only when the player begins answering, not while browsing/roaming | ❌ | No timer of any kind on questions. |
| 2.4 | Player roams the room to find questions/problems | 🟡 | Free-roam first-person 3D with an interactable note per room — but there is one note per room, not one per question. |
| 2.5 | Questions are NOT continuous — after answering problem 1, the player must find problem 2 elsewhere in the room | ❌ | Examining the note opens all 5 questions back-to-back in one modal session ([main.js](../src/main.js) `openQuestion`). |
| 2.6 | Wrong-answer consequences | ✅ | (Not in PDF, but present) 5 wrong answers per room trigger a chase; caught = lose. Fear staging escalates fog/vignette/audio. |

## 3. Question Content

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 3.1 | Room 1 Easy: multiple-choice definitions/concepts (PDF bank: 15 items) | 🟡 | 5 MC items implemented; wording matches a subset of the PDF bank. 10 PDF items unused. |
| 3.2 | Room 2 Moderate: guided problems — favorable/total outcomes given, player fills in the `P(insert)` solution steps (PDF bank: 10 items) | 🟡 | Implemented as plain multiple choice on the final answer. The PDF's step-by-step fill-in scaffold format is not implemented. 5 of 10 PDF items used. |
| 3.3 | Room 3 Hard: independent real-life word problems (PDF bank: 10 items) | 🟡 | Implemented as multiple choice. PDF intends unguided computation (implies typed/keypad answer entry rather than choices). 5 of 10 PDF items used. |

## 4. Accounts & Progress

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 4.1 | Login/register so players can edit profile and save achievements to an account | ❌ | No backend. Progress (name, best scores, best time) saved to browser `localStorage` only. |
| 4.2 | Researchers can view/monitor player achievements | ❌ | Nothing is sent anywhere; data lives on each player's device. |
| 4.3 | Player can change nickname only once | ❌ | Name is editable without limit in Settings. |

## 5. P-Learn Feature

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 5.1 | Lesson content: What is Probability, key terms, formula, worked examples | ✅ | 6 lesson slides: intro, key terms, formula, easy/moderate/hard examples ([main.js](../src/main.js) `PLEARN_SLIDES`) — content mirrors the PDF. |
| 5.2 | "Pascroll dapat" — scrollable presentation | 🟡 | Implemented as prev/next slides with dot navigation instead of one scrolling page. |

## 6. Settings Feature

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 6.1 | Player Profile: enter/edit name | ✅ | Name field in Settings, persisted, shown in HUD and menu. |
| 6.2 | Reset progress with confirmation prompt | ✅ | "Reset all progress and scores?" confirm; clears best scores/time. |
| 6.3 | Sound sensitivity controls for background music, footsteps, and jumpscare volumes | ❌ | Only mouse-look sensitivity exists. No volume sliders. Audio system ([audio.js](../src/audio/audio.js)) already supports per-sound volume, so this is UI work. |

## 7. Prototype / Presentation (Canva reference)

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 7.1 | Title screen: horror hallway + "ESCAPE ROOM" title | ✅ | Atmospheric loading + scene-backed 3D menu. |
| 7.2 | Login screen after title | ❌ | Depends on 4.1. |
| 7.3 | PLAY / P-LEARN menu buttons | ✅ | |
| 7.4 | "ARE YOU READY?" — YES / "NO, I'M SCARED." | ✅ | Ready screen with both options; NO returns home. |
| 7.5 | Classroom scene: chalkboard "solve the problems to escape", cluttered props | 🟡 | Chalkboard ("ROOM n / SOLVE TO ESCAPE"), desks, chairs, bookshelf, candles present; less cluttered than prototype. |
| 7.6 | Question UI: dark framed panel with 4 choices | ✅ | Restyled modal keeps the 3D room visible behind it. |
| 7.7 | About Us: study goal + no-copyright statement | ✅ | About screen ("CASE NOTES") with purpose section. Verify exact no-copyright wording matches researchers' text. |

---

## Summary

**Fully implemented:** 5 problems per room · roam-and-interact gameplay · jumpscares/chase/lose ·
P-Learn lessons · name editing · reset progress · ready screen · About · win/lose/best-time.

**Biggest gaps (decisions needed):**

1. **Accounts + researcher monitoring (4.1–4.3)** — the only item requiring a backend/database.
   Everything else is client-side work.
2. **Per-question 15s timer + question pool rotation (2.2, 2.3)** — needs the full PDF banks
   (15/10/10) imported so a timed-out or replayed level can draw different problems.
3. **One-note-per-question flow (2.5)** — scatter 5 interactables per room instead of 1.
4. **Locked doors with jumpscare (1.4, 1.5)** — gate room 2 behind room 1, room 3 behind room 2.
5. **Empty creepy rooms (1.3)** — at least 5 vacant rooms along the hallway.
6. **Sound volume settings (6.3)** — sliders for music / footsteps / jumpscares.
7. **Moderate scaffold format (3.2)** — fill-in `P(insert)` steps vs current multiple choice.

## Changelog

- 2026-07-18 — Initial audit against researchers' PDF.
