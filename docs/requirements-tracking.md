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
| 1.1 | 5 main doors: Entrance, Room 1 (Easy), Room 2 (Moderate), Room 3 (Hard), Exit | ✅ | L-shaped school (2026-07-19): leg 1 holds Room 1 → Decoy 1 → Room 2, the corridor bends right at a corner, leg 2 holds Decoy 2 → Room 3 → exit door with keypad. **5 wooden doors** (3 real + 2 decoys that look identical) + the exit. No distinct entrance door — player spawns inside (unchanged). |
| 1.2 | Level rooms not close/beside each other | ✅ | Decoy classrooms and vacant rooms sit between the levels; the corner splits the school in two. Walking Room 2 → Room 3 crosses the corner past two dark doorways and a decoy. |
| 1.3 | At least 5 empty/vacant rooms between levels for creepy aesthetics (crying/laughing sounds, school works, abandoned rooms) — Slendrina-style | ✅ | 5 vacant abandoned classrooms along the left side of the hallway ([world.js](../src/world/world.js) `VACANT_ROOMS`): dark open doorways between the lockers, overturned/askew desks, scattered school work, chalk scrawls ("HELP US", "P(ESCAPE) = 0"…). Entering one triggers a creepy sound with a 30s per-room cooldown — now drawing from real **crying and laughing** clips (freesound.org CC0) plus moans/whispers, as the spec asks. |
| 1.4 | Doors 2 and 3 locked until previous room completed | ✅ | Wooden door panels in every doorway ([world.js](../src/world/world.js) `buildDoor`). Rooms 2/3 start locked (blocking movement) and swing open with an audio cue when the previous room is cleared. Room 1's door starts open. Notes can no longer be examined through walls from the hallway. |
| 1.5 | Jumpscare when trying to open a locked door | ✅ | Interacting with a locked door flashes the jumpscare face + sting + screenshake (non-lethal) and shows "🔒 LOCKED — clear Room N first" ([main.js](../src/main.js) `triggerLockedDoorScare`, 4s cooldown so it can't be spammed). |

## 2. Gameplay Flow

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 2.1 | Exactly 5 problems per level | ✅ | 5 questions per room ([questions.js](../src/data/questions.js)), order shuffled each run. |
| 2.2 | If time runs out, player restarts the level with a *different* problem | ✅ | On timeout the room resets to Q1 and its 5 problems are re-drawn from the full bank. An in-modal "TIME'S UP" notice shows, then the player re-examines the note to start over. |
| 2.3 | 15-second answer time limit — starts only when the player begins answering, not while browsing/roaming | ✅ | Countdown bar + seconds in the question modal; starts when the question opens (roaming untimed), resets to 15s on each new question and each wrong-answer retry. P-LEARN mode is untimed. Limit configurable via `CFG.gameplay.answerTimeSeconds`. **Known accepted behavior:** closing the modal cancels the timer (browsing is untimed per spec), so a player can dodge a near-timeout by exiting — flag to researchers if this matters. |
| 2.4 | Player roams the room to find questions/problems | ✅ | **Container search (2026-07-19, design doc Proposal B):** each classroom has 6 searchable hiding spots — teacher's desk drawer, corner cabinet, backpack, bookshelf book, trash bin, chalk tray. The current problem hides in ONE of them, randomized per question per run. Wrong containers open visually, give creepy flavor text, and can trigger a small scare (12/18/24% by room). After 2 wrong searches the right container glints (rescue rule). Searching is untimed — the 15s timer still starts at the question. |
| 2.5 | Questions are NOT continuous — after answering problem 1, the player must find problem 2 elsewhere in the room | ✅ | After each correct answer the containers reset and the next problem re-hides in a random container. Timeout re-hides and redraws the problems. Decoy classrooms have the same 6 containers — all permanently empty, with their own flavor text and a higher scare chance. |
| 2.6 | Wrong-answer consequences | ✅ | (Not in PDF, but present) 5 wrong answers per room trigger a chase; caught = lose. Fear staging escalates fog/vignette/audio. |

## 3. Question Content

> **Decision (2026-07-18):** The PDF question banks are authoritative — the game must use
> them verbatim (15 Easy / 10 Moderate / 10 Hard), replacing the current 5/5/5 placeholder
> sets in [questions.js](../src/data/questions.js). Each run draws 5 per room.

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 3.1 | Room 1 Easy: PDF's 15 multiple-choice items, verbatim | ✅ | All 15 items imported verbatim; 5 drawn at random per run. **❓ Flag for researchers:** the PDF key for item 10 ("number of favorable outcome/s" for one coin toss) marks **1/2**, but the count of favorable outcomes is **1** — imported with the conceptually correct key pending confirmation (see note in [questions.js](../src/data/questions.js)). |
| 3.2 | Room 2 Moderate: PDF's 10 guided problems — favorable/total given, player fills in the `P(insert)` solution steps | ✅ | Tap-to-fill scaffold: the modal shows `P(event) = ▢ = ▢` and the player taps the value that fills each glowing blank in order (substitution → simplified). Wrong taps count as wrong answers; each blank gets a fresh 15s. Distractors for the substitution blank are generated so no numerically-equivalent value is marked wrong; the final blank uses the PDF's own answer choices. |
| 3.3 | Room 3 Hard: PDF's 10 independent real-life word problems | ✅ | **Decision (2026-07-18):** Hard stays 4-choice multiple choice — that is the format of the PDF's own Hard bank, and "independent" is expressed by giving no scaffold/steps (the player identifies data and computes alone). Flag to researchers if they wanted free-input answers instead. |

## 4. Accounts & Progress

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 4.1 | Login/register so players can edit profile and save achievements to an account | ❌ | No backend. Progress (name, best scores, best time) saved to browser `localStorage` only. |
| 4.2 | Researchers can view/monitor player achievements | ❌ | Nothing is sent anywhere; data lives on each player's device. |
| 4.3 | Player can change nickname only once | ❌ | Name is editable without limit in Settings. |

## 5. P-Learn Feature

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 5.1 | Lesson content: PDF's P-Learn text verbatim (What is Probability, key terms, formula, Examples 1–3) | ✅ | All 6 slides now carry the PDF text: intro, the 5 key terms, the formula + examples list, and the PDF's own Examples 1–3 (die > 4, coin toss, bookshelf). **❓ Flag for researchers:** the PDF's Example 3 contains copy-paste errors — labels say "P(selecting fiction)" / "P(number greater than 4)" and the closing line says **1/3**, but 10/40 simplifies to **1/4**. Imported with corrected labels and 1/4. |
| 5.2 | "Pascroll dapat" — scrollable presentation | 🟡 | Implemented as prev/next slides with dot navigation instead of one scrolling page. Confirm slides are acceptable. |

## 6. Settings Feature

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 6.1 | Player Profile: enter/edit name | ✅ | Name field in Settings, persisted, shown in HUD and menu. |
| 6.2 | Reset progress with confirmation prompt | ✅ | "Reset all progress and scores?" confirm; clears best scores/time. |
| 6.3 | Sound sensitivity controls for background music, footsteps, and jumpscare volumes | ✅ | Three Settings sliders (Music / Footsteps / Jumpscares, 0–100%) mapped to sound categories in [audio.js](../src/audio/audio.js) (`setCategoryVolume`). Jumpscare category covers stings, screams, whispers, and the tension breathing loop. Values persist in the save and apply live, with a throttled audible preview while dragging. |

## 7. Prototype / Presentation (Canva reference)

> **Decision (2026-07-18):** The Canva prototype's visual design is **superseded** — the
> game's current look is approved and will not be changed to match the prototype.
> Only functional elements from it remain tracked (login screen → see 4.1).
> The PDF remains the source of truth for **content**: question banks (§3), P-Learn
> lesson text (§5), and the About Us text (7.7).

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 7.1–7.6 | Prototype visuals (title, menu, ready screen, classroom, question UI) | ✅ | Superseded by current design — no further work. |
| 7.7 | About Us: study goal + no-copyright statement | ✅ | PURPOSE section now carries the PDF's study-goal paragraph verbatim; a DISCLAIMER section carries the "no copyright infringement" statement verbatim. Extra sections (difficulty levels, features, asset credits) kept. |

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
4. ~~**Locked doors with jumpscare (1.4, 1.5)**~~ ✅ Done 2026-07-18 — door panels in all
   doorways; rooms 2/3 gated behind the previous room, locked-door attempts trigger a
   non-lethal jumpscare.
5. ~~**Empty creepy rooms (1.3)**~~ ✅ Done 2026-07-18 — 5 vacant classrooms off the
   hallway with abandoned props, scrawls, and entry-triggered scare sounds.
6. ~~**Moderate `P(insert)` scaffold + Hard unguided format (3.2, 3.3)**~~ ✅ Done
   2026-07-18 — tap-to-fill scaffold for Moderate; Hard stays MC per the PDF bank.
7. ~~**P-Learn / About text alignment (5.1, 7.7)**~~ ✅ Done 2026-07-18 — PDF text imported
   verbatim; Example 3's PDF errors corrected and flagged (5.1 ❓).
8. ~~**Sound volume settings (6.3)**~~ ✅ Done 2026-07-18 — Music / Footsteps / Jumpscares
   sliders in Settings, persisted, applied live.
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
- 2026-07-18 — Queue item 4 done: locked doors with jumpscare. Rooms 2/3 physically
  locked until the previous room is cleared; doors swing open on unlock. Locked-door
  attempts fire a non-lethal jumpscare + "LOCKED" prompt. Also fixed: notes can no
  longer be interacted with through walls, and the loading screen no longer stomps
  the active screen if the game state moved on.
- 2026-07-18 — Queue item 5 done: 5 vacant creepy rooms on the hallway's left side
  (open doorways, abandoned desks, papers, chalk scrawls, entry-triggered sounds).
- 2026-07-18 — Queue item 6 done: Moderate questions now use the tap-to-fill
  `P(event) = ▢ = ▢` scaffold (wrong taps penalized, fresh 15s per blank).
  Decision recorded: Hard stays 4-choice MC per the PDF's own bank.
- 2026-07-18 — Queue item 7 done: P-Learn slides and About Us aligned verbatim with the
  PDF. Flagged the PDF's Example 3 copy-paste/answer errors (imported as 10/40 = 1/4).
- 2026-07-18 — Queue item 8 done: volume sliders for background music, footsteps, and
  jumpscares in Settings (persisted, live category volumes in the audio manager).
- 2026-07-18 — Audio variety: 8 new CC0 sounds from freesound.org (2 cries, 2 creepy
  laughs, whisper, knocking, moan, drone swell). Vacant rooms now use real
  crying/laughing; ambient noise pool grew from 4 to 10 sounds. Credit line added
  to About.
- 2026-07-18 — New blackout scare (not in PDF; owner-requested): as a third outcome of
  the roaming tension trigger (~22%), every light dies for ~2.5–3.5s with a sound in
  the dark, then stutters back — 25% chance the ghost is standing there when they
  return. Can only start while roaming (never inside a question), mutually exclusive
  with the ghost apparition, cleaned up on reset.
- 2026-07-19 — **Layout v2 (owner-requested, per design doc):** the school is now
  L-shaped. Leg 1: Room 1 → Decoy 1 → Room 2 with two vacant rooms opposite; a vacant
  doorway sits dead ahead at the corner; leg 2: Decoy 2 → Room 3 → exit keypad, with
  two more vacants. The 2 decoy classrooms have identical wooden doors (always
  unlocked, open on interact), full classroom interiors with **lying chalkboard
  labels** ("ROOM 2"/"ROOM 3"), desks facing the back wall, a faint "IT LIED" scrawl,
  no notes — and stepping inside trips the blackout once per run. World builder
  rewritten around per-room frames (rooms can face any wall). Also fixed: corridor
  floors/ceilings were mis-sized on the old map; chalkboard text was occluded by its
  frame; chase spawn no longer clamps to the old single-hallway x-range.
- 2026-07-19 — **Container hunting (design doc Proposal B):** face-up notes replaced by
  6 searchable containers per classroom (drawer, cabinet, backpack, book, bin, chalk
  tray) with open/closed visual states. One holds the current problem (random per
  question per run — Granny/Slendrina-style placement randomization); wrong searches
  give flavor text + escalating scare chance; rescue glint after 2 wrong searches.
  Decoy classrooms have the same containers, always empty.
