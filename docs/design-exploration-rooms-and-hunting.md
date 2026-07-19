# Design Exploration — Room Layout v2 & Note Hunting

> **Status 2026-07-19:** Layout — the owner picked an **L-shaped** school (5 vacant
> + 3 real + 2 decoy rooms) instead of §2's straight interleave; built and shipped.
> Decoy doors are **always unlocked** (the "cruel" fake-locked variant was not
> chosen). Proposal B (containers) was **built, played, and reverted the same
> day** — the owner preferred the visible note papers; the game uses the
> one-visible-note-per-question hunt. This section stays as reference if the
> idea is ever revisited.

Research + proposal doc — read, mark up, veto freely.
The two problems being solved (raised 2026-07-18):

1. **Layout is too legible.** Question rooms all on the right, vacant rooms all on
   the left. Wooden door = math, dark doorway = decoration. Players learn this in
   one minute and stop looking at half the world.
2. **The notes aren't hidden.** All 5 note spots are face-up on surfaces. "Roam to
   find the problem" currently means "walk to the next obvious table."

---

## 1 · How the reference games do it

### Slendrina: The Cellar (the researchers' own reference)
- The whole objective is **hunting hidden objects**: 8 books scattered through a
  dark maze of rooms, **inside cabinets and containers**, not lying in the open.
- Progression is gated by **locked doors + found keys** — searching and unlocking
  are the same loop we already have (notes → code digits → exit).
- Item locations are **randomized for replayability**. Repeat plays test layout
  knowledge, not memorized answers.
- Nothing is on the UI. You find things by moving your flashlight over the world.

### Granny (same studio, the genre's mobile benchmark)
- **Items spawn in different places every run** (rotating placement presets).
  This is the single biggest anti-repetition tool in the genre: what carries
  between runs is *knowing the house*, not *knowing the answer sheet*.
- Containers are a first-class mechanic: drawers, cupboards, chests — most are
  empty most of the time, and **opening one is a risk** (noise attracts Granny).
  Searching itself is the tension, not just the reward.
- Hiding spots (wardrobes, beds) double as furniture — the same prop is both
  scenery and mechanic, so nothing in the world reads as pure decoration.

### Amnesia / Outlast (the PC ancestors of all of this)
- Rummaging **drawers and cabinets** for resources (tinderboxes, batteries,
  documents) is the core verb between scares. Most containers are empty — the
  emptiness is what makes a full one feel like a find.
- Documents/notes double as **story delivery**, which our question-notes already
  are — we're closer to this pattern than it might seem.

### Level-design theory (tension pacing)
- Horror levels alternate **corridor (tension) → chamber (event) → relief**.
  A hallway is a pacing device: the walk *is* the buildup. Slightly longer
  walks between rooms serve the horror, they don't hurt it.
- **Small layout violations create unease**: a door that's now ajar, a room
  that isn't where the pattern says it should be. Cheap to do, big effect.
- Safe/readable moments must exist so the scares have contrast — the question
  modal is our "safe room," which is convenient: math time = calm time.

---

## 2 · Proposal A — Layout v2: interleaved rooms

Stretch the hallway (z: 0→54 becomes ~0→82) and interleave:

```
LEFT (open dark doorways)          RIGHT (doors)
                                   ┌──────────────┐
vacant A  [4..12]                  │ ROOM 1  EASY │ [7..19]
                                   └──────────────┘
vacant B  [16..24]                 vacant R1 [23..31]   ← right side, open doorway
                                   ┌──────────────┐
vacant C  [28..36]                 │ ROOM 2  MOD  │ [35..47]
                                   └──────────────┘
vacant D  [42..50]                 vacant R2 [51..59]   ← DECOY: has a *door*
                                   ┌──────────────┐
vacant E  [56..64]                 │ ROOM 3  HARD │ [63..75]
                                   └──────────────┘
                                   EXIT [~80]
```

Key points:

- **Vacant rooms now exist on the level side too**, directly between classrooms —
  literally the PDF's "empty rooms na maagian."
- **One decoy door** (vacant R2): a wooden door identical to the level doors that
  opens (unlocked, creaks) onto an abandoned room. Breaks the "door = math" rule
  once, which is enough to make every door slightly untrustworthy. The decoy
  can host a strong one-time scare (recommended: the door opens, the room is
  empty, lights blackout as you step in).
- Walk time Room 1 → exit grows ~45%. With the scare systems + new sounds this
  is a feature (more runway for tension), but flag it: if a full run should stay
  under ~8 minutes for classroom sessions, we keep it at this length and no more.
- 7 vacant rooms total (5 left + 2 right) — still ≥5, spec-safe.

Cost: mostly constant-shuffling (`CFG.world.rooms`, exit z, light positions,
vacant table, collision) since builders are parameterized. Playtest scripts need
new coordinates. The classroom builder itself doesn't change. **Medium effort.**

Rejected alternative — mirroring classrooms to alternate left/right: stronger
visual variety, but requires rewriting the classroom/door/collision builders to
be side-agnostic. More surgery, less benefit than the decoy-door trick.

---

## 3 · Proposal B — Container-based note hunting ("soft search")

Replace the 5 face-up notes with **6 searchable containers per classroom**:

| Container | Where | Interaction flavor |
|---|---|---|
| Teacher's desk drawer | teacher's desk | drawer slides open |
| Storage cabinet | back corner | door swings, creak |
| Backpack | floor between desks | unzip rustle |
| Bookshelf | existing shelf | a book pulls out |
| Trash bin | near door | paper rustle |
| Chalkboard tray | under the board | eraser/chalk shuffle |

Mechanic (borrowing Granny's "searching is the game" + an anti-frustration cap):

1. Only **one container holds the current note**; which one is **random per
   question per run** (Slendrina/Granny randomization — this is also our main
   anti-repetition weapon: 6 containers × 5 questions × random order means no
   two runs search the same).
2. **All containers are always interactable.** Wrong ones give flavor text
   ("Empty. Something shifted behind you…") and a ~15% chance to fire a whisper
   /knock (Granny's "searching makes noise" risk, softened).
3. **Rescue rule:** after 2 wrong searches for the same note, the correct
   container starts a faint paper-glint/pulse. Kids never get hard-stuck; the
   researchers' assessment is untouched because the 15s timer still only starts
   when the question opens.
4. Searched-empty containers stay "open" (visual state) until the next note —
   so players can see where they've looked. This is what stops search from
   feeling repetitive *within* a room: the room visibly changes as you work it.

Optional layer (cut first if scope is tight): vacant rooms get 1–2 dummy
containers that are always empty but can scare — makes the empty rooms
searchable too, so exploring them has a reason beyond ambience.

Cost: new prop meshes (all box-based, batched like existing furniture), a
container state machine replacing note visibility, interaction text variants.
**Medium-high effort — the biggest piece in this doc.**

---

## 4 · Anti-repetition principles (applies to everything above)

From the research, the four tools that keep a small game from feeling samey:

1. **Randomize placement, not content** (Granny/Slendrina): questions stay
   PDF-fixed; *where* they hide reshuffles every run.
2. **Make scenery mechanical**: every prop that can be looked at should be
   interactable or reactive at least once. Decoy door, searchable trash bin,
   the bookshelf that's also a note spot.
3. **Escalate by room**: Room 1 containers behave politely; Room 3 searches
   have higher scare chance, longer blackouts, meaner flavor text. Same systems,
   rising temperature — progression without new mechanics.
4. **Small world violations after events**: after a blackout or a chase, a
   vacant-room door that was open is now shut, a new scrawl exists, a chair
   moved. One or two per run, precomputed, cheap — the "the rooms are
   remembering you" line from the story slides, made literal.

---

## 5 · Suggested build order (when approved)

1. Layout v2 (Proposal A) — foundation; everything else sits on it.
2. Containers + soft search (Proposal B) — the core gameplay change.
3. Escalation tuning + decoy-door scare — polish pass on top.
4. World-violation touches (§4.4) — last, purely atmospheric.

Each step ships/commits independently, so we can stop or revert anywhere.

## 6 · Open questions for the owner

- **Run length:** is ~8 minutes for a good full run acceptable for classroom use?
  (Layout v2 adds walking. If sessions are tight, we shorten the vacant rooms.)
- **Decoy door:** in or out? It's the one place we deliberately "lie" to the player.
- **Rescue rule tuning:** glint after 2 wrong searches — too generous? too stingy?
- **Search scares:** okay that searching can *cause* scares (Granny-style), or
  should searching always be safe and scares stay ambient-only?

## Sources

- [Granny — Item Locations (Fandom wiki)](https://granny.fandom.com/wiki/Item_Locations)
- [Granny — guide to items and randomized locations (BlueStacks)](https://www.bluestacks.com/blog/game-guides/granny/guide-single-use-items-locations-en.html)
- [Slendrina: The Cellar (Fandom wiki)](https://slendrinahorrorgame.fandom.com/wiki/Slendrina:_The_Cellar)
- [Slendrina: The Cellar (Google Play)](https://play.google.com/store/apps/details?id=com.dvloper.slendrinacellarfree&hl=en_US)
- [Creating Horror through Level Design: Tension, Jump Scares, and Chase Sequences (Game Developer)](https://www.gamedeveloper.com/design/creating-horror-through-level-design-tension-jump-scares-and-chase-sequences)
- [The Balancing Act of Tension in Horror Game Design (Game Developer)](https://www.gamedeveloper.com/design/the-balancing-act-of-tension-in-horror-game-design)
- [Deconstructing the Level Design of Iconic Horror Mansions (GameHaunt)](https://gamehaunt.com/deconstructing-the-level-design-of-iconic-horror-mansions/)
- [Level Design Secrets for Horror Games (Algoryte, Medium)](https://medium.com/@algoryte/the-art-of-fear-level-design-secrets-for-spine-chilling-horror-games-8a3e10059c09)
