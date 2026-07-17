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
| 2.2 | If time runs out, player restarts the level with a *different* problem | ✅ | On timeout the room resets to Q1 and its 5 problems are re-drawn from the full bank. An in-modal "TIME'S UP" notice shows, then the player re-examines the note to start over. |
| 2.3 | 15-second answer time limit — starts only when the player begins answering, not while browsing/roaming | ✅ | Countdown bar + seconds in the question modal; starts when the question opens (roaming untimed), resets to 15s on each new question and each wrong-answer retry. P-LEARN mode is untimed. Limit configurable via `CFG.gameplay.answerTimeSeconds`. **Known accepted behavior:** closing the modal cancels the timer (browsing is untimed per spec), so a player can dodge a near-timeout by exiting — flag to researchers if this matters. |
| 2.4 | Player roams the room to find questions/problems | ✅ | 5 notes per room at scattered spots: teacher's desk, two student desks, bookshelf side, back wall by the exit sign ([world.js](../src/world/world.js) `noteSpots`). |
| 2.5 | Questions are NOT continuous — after answering problem 1, the player must find problem 2 elsewhere in the room | ✅ | One question per note; only the next unsolved note is visible/interactable. After a correct answer the modal shows "Find the next note", closes, and the next note appears elsewhere. Timeout resets the hunt to note 1 with fresh problems. |
| 2.6 | Wrong-answer consequences | ✅ | (Not in PDF, but present) 5 wrong answers per room trigger a chase; caught = lose. Fear staging escalates fog/vignette/audio. |

## 3. Question Content

> **Decision (2026-07-18):** The PDF question banks are authoritative — the game must use
> them verbatim (15 Easy / 10 Moderate / 10 Hard), replacing the current 5/5/5 placeholder
> sets in [questions.js](../src/data/questions.js). Each run draws 5 per room.

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 3.1 | Room 1 Easy: PDF's 15 multiple-choice items, verbatim | ✅ | All 15 items imported verbatim; 5 drawn at random per run. **❓ Flag for researchers:** the PDF key for item 10 ("number of favorable outcome/s" for one coin toss) marks **1/2**, but the count of favorable outcomes is **1** — imported with the conceptually correct key pending confirmation (see note in [questions.js](../src/data/questions.js)). |
| 3.2 | Room 2 Moderate: PDF's 10 guided problems — favorable/total given, player fills in the `P(insert)` solution steps | 🟡 | All 10 items imported verbatim **with their solution-step data** (`steps` field). Currently rendered answer-only in the 4-choice modal; the tap-to-fill scaffold UI is queue item 6. |
| 3.3 | Room 3 Hard: PDF's 10 independent real-life word problems | 🟡 | All 10 items imported verbatim; rendered as 4-choice MC. Whether Hard should use a non-MC answer format is part of queue item 6. |

## 4. Accounts & Progress

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 4.1 | Login/register so players can edit profile and save achievements to an account | ❌ | No backend. Progress (name, best scores, best time) saved to browser `localStorage` only. |
| 4.2 | Researchers can view/monitor player achievements | ❌ | Nothing is sent anywhere; data lives on each player's device. |
| 4.3 | Player can change nickname only once | ❌ | Name is editable without limit in Settings. |

## 5. P-Learn Feature

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 5.1 | Lesson content: PDF's P-Learn text verbatim (What is Probability, key terms, formula, Examples 1–3) | 🟡 | 6 lesson slides exist ([main.js](../src/main.js) `PLEARN_SLIDES`) covering the same topics, but wording/examples are paraphrased. Align text and examples with the PDF (die > 4, coin toss, bookshelf). |
| 5.2 | "Pascroll dapat" — scrollable presentation | 🟡 | Implemented as prev/next slides with dot navigation instead of one scrolling page. Confirm slides are acceptable. |

## 6. Settings Feature

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 6.1 | Player Profile: enter/edit name | ✅ | Name field in Settings, persisted, shown in HUD and menu. |
| 6.2 | Reset progress with confirmation prompt | ✅ | "Reset all progress and scores?" confirm; clears best scores/time. |
| 6.3 | Sound sensitivity controls for background music, footsteps, and jumpscare volumes | ❌ | Only mouse-look sensitivity exists. No volume sliders. Audio system ([audio.js](../src/audio/audio.js)) already supports per-sound volume, so this is UI work. |

## 7. Prototype / Presentation (Canva reference)

> **Decision (2026-07-18):** The Canva prototype's visual design is **superseded** — the
> game's current look is approved and will not be changed to match the prototype.
> Only functional elements from it remain tracked (login screen → see 4.1).
> The PDF remains the source of truth for **content**: question banks (§3), P-Learn
> lesson text (§5), and the About Us text (7.7).

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 7.1–7.6 | Prototype visuals (title, menu, ready screen, classroom, question UI) | ✅ | Superseded by current design — no further work. |
| 7.7 | About Us: study goal + no-copyright statement | 🟡 | About screen exists; align wording with the PDF's About Us text (study goal + "no copyright infringement" statement). |

---

## Summary

**Fully implemented:** 5 problems per room · roam-and-interact gameplay · jumpscares/chase/lose ·
P-Learn lessons · name editing · reset progress · ready screen · About · win/lose/best-time.

**Settled decisions:**

- PDF is the source of truth for content: question banks (verbatim, 15/10/10), P-Learn
  lesson text, About Us text.
- Canva prototype visuals are superseded — the current game look is final.

**Work queue (gaps to close):**

1. ~~**Import PDF question banks (3.1–3.3)**~~ ✅ Done 2026-07-18 — full 15/10/10 banks
   imported verbatim, random 5 drawn per room per run. Moderate `steps` data included
   for the future scaffold UI. One answer-key discrepancy flagged (3.1 ❓).
2. ~~**Per-question 15s timer (2.3) + timeout retry with different problems (2.2).**~~
   ✅ Done 2026-07-18 — 15s countdown in the modal, timeout resets the room with a
   fresh draw. P-LEARN untimed. One accepted-behavior note flagged in 2.3.
3. ~~**One-note-per-question flow (2.5)**~~ ✅ Done 2026-07-18 — 5 scattered notes per
   room, one question each, sequential hunt with visibility gating.
4. **Locked doors with jumpscare (1.4, 1.5)** — gate room 2 behind room 1, room 3 behind room 2.
5. **Empty creepy rooms (1.3)** — at least 5 vacant rooms along the hallway.
6. **Moderate `P(insert)` scaffold + Hard unguided format (3.2, 3.3).**
7. **P-Learn / About text alignment (5.1, 7.7).**
8. **Sound volume settings (6.3)** — sliders for music / footsteps / jumpscares.
9. **Accounts + researcher monitoring (4.1–4.3)** — the only backend item; scope TBD.

## Changelog

- 2026-07-18 — Initial audit against researchers' PDF.
- 2026-07-18 — Decisions recorded: PDF content is authoritative (questions, P-Learn, About);
  prototype visuals superseded by current design. Question sections re-scoped to verbatim
  PDF banks.
- 2026-07-18 — Queue item 1 done: full PDF banks imported (15 Easy / 10 Moderate / 10 Hard),
  random draw of 5 per room per run. Flagged Easy item 10 answer-key discrepancy for
  researcher confirmation.
- 2026-07-18 — Queue item 2 done: 15s per-question countdown (configurable), timeout resets
  the room to Q1 with freshly drawn problems. P-LEARN mode untimed. Flagged the
  close-modal-to-dodge-timer behavior as accepted per "browsing is untimed".
- 2026-07-18 — Queue item 3 done: one note per question, 5 scattered spots per room,
  sequential hunt (only the next unsolved note is visible). Timeout resets the hunt
  to note 1.
