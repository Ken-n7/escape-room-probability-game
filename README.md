# 🔦 ProbXcape — Escape Room · Simple Probability

A browser-based **3D horror escape room** that teaches **simple probability**. Players are trapped in a dim, fog-filled L-shaped school corridor and must survive three classrooms — **Easy**, **Moderate**, and **Hard** — answering probability questions to earn digits of the exit code. Get too many wrong and something starts *chasing* you.

Built with **Three.js** for the 3D world and **Supabase** for accounts, leaderboards, and gameplay analytics, then shipped as a static site on **Vercel**.

---

## Table of Contents

- [What it is](#what-it-is)
- [Gameplay](#gameplay)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [How the game is wired together](#how-the-game-is-wired-together)
- [The world](#the-world)
- [Questions & the exit code](#questions--the-exit-code)
- [Accounts, leaderboard & analytics](#accounts-leaderboard--analytics)
- [Teacher / admin dashboard](#teacher--admin-dashboard)
- [Getting started](#getting-started)
- [Supabase setup](#supabase-setup)
- [Build & deploy](#build--deploy)
- [Configuration reference](#configuration-reference)
- [Documentation](#documentation)

---

## What it is

This is an educational game made for teaching the topic of **probability of simple events**. The learning content (definitions, guided problems, and real-life word problems) is transcribed verbatim from a researchers' content document, and the game wraps that content in a tense, atmospheric first-person horror experience so students stay engaged.

Three concepts drive the design:

1. **Learn by surviving** — every classroom is a short quiz; passing it gives you one digit of the door code.
2. **Anti-memorization** — each run randomly draws a subset of questions per room, so replaying (or being sent back by a timeout) presents fresh problems.
3. **Measurable learning** — every answer, timeout, and run outcome is logged to Supabase so a teacher can see, per student and per question, where the class is struggling.

---

## Gameplay

- **Explore** a first-person 3D corridor with WASD + mouse look (pointer lock). Touch controls and device profiles are supported for mobile.
- **Find the notes.** Rooms are interleaved with **decoy rooms** (look real, aren't) and **vacant abandoned rooms** (open dark doorways). Chalkboards are deliberately blank so nothing visually labels which room is "real."
- **Answer questions** at each real classroom:
  - **Room 1 · EASY** — 15-item multiple-choice bank on probability definitions/concepts.
  - **Room 2 · MODERATE** — 10 guided problems with a tap-to-fill `P(…) = (…)/(…)` solution scaffold.
  - **Room 3 · HARD** — 10 real-life word problems: identify the data, then compute.
- **Watch the clock.** In PLAY mode each question has a **15-second** limit; a timeout resets that room to question 1 with newly drawn problems.
- **Don't get too many wrong.** Up to **5 wrong answers** per room are tolerated before the **chase** penalty triggers (a monster pursuit, blackout, and jumpscare set pieces).
- **Assemble the code.** Each cleared room yields one digit; combine all three to open the exit door and **win**.
- **P-Learn mode** — an optional practice toggle that shows a hint before each question.

Game states are modeled explicitly: `MENU`, `PLAYING`, `PAUSED`, `QUESTION`, `CODE`, `WIN`, `LOSE`, `CHASE`.

---

## Tech stack

| Layer | Choice |
|---|---|
| 3D engine | [Three.js](https://threejs.org/) `^0.170` (WebGL, GLTF models, fog, lighting) |
| Build tool | [Vite](https://vitejs.dev/) `^5` (ES modules, dev server, production bundling) |
| Backend | [Supabase](https://supabase.com/) — Postgres + Auth + Row Level Security |
| Charts | [Chart.js](https://www.chartjs.org/) `^4.5` (analytics dashboard) |
| Icons | [Lucide](https://lucide.dev/) `^1.26` |
| Testing tooling | [Playwright](https://playwright.dev/) `^1.60` (dev dependency) |
| Hosting | [Vercel](https://vercel.com/) (static output from `dist/`) |

---

## Project structure

```
escape-room-probability-game/
├── index.html                  # single-page entry; all screens live here
├── package.json                # scripts + dependencies
├── vercel.json                 # framework preset + asset cache headers
├── src/
│   ├── main.js                 # game loop, orchestration, screen wiring
│   ├── core/
│   │   ├── config.js           # world dimensions, player, gameplay tuning (CFG)
│   │   ├── renderer.js         # Three.js renderer, scene, camera
│   │   └── game-state.js       # state enum (S), shared mutable state
│   ├── world/world.js          # builds the corridor, rooms, doors, notes
│   ├── data/questions.js       # the question banks + EXIT_CODE derivation
│   ├── loaders/                # GLTF loader + asset preloading
│   ├── input/input.js          # keyboard/mouse/touch input, device profiles
│   ├── audio/                  # ambient drone, SFX, jumpscare audio manager
│   ├── scares/                 # chase, blackout, lose-canvas, ambient scares
│   ├── ui/                     # HUD, dashboard, charts
│   ├── styles/                 # per-feature CSS (theme, hud, screens, …)
│   └── net/                    # Supabase client, auth, scores, analytics
├── supabase/schema.sql         # full production DB schema (idempotent)
├── scripts/seed-players.mjs    # seed demo players/analytics for the dashboard
├── public/assets/              # images, audio, fonts, 3D models (.glb/.gltf)
└── docs/                       # design & requirements-tracking documents
```

---

## How the game is wired together

`src/main.js` is the conductor. On load it:

1. Assigns each question a stable id (`"roomId.bankIndex"`, e.g. `1.4`) for analytics.
2. Calls `buildWorld(scene)` to generate the corridor, rooms, doors, and interactive notes.
3. Sets up the menu camera, input, audio, and UI screens.
4. Runs the render/update loop: movement + collision, interaction prompts (`Press E`), ambient scares, the chase system, and the active question modal.

State is shared by **reference** — modules import the same mutable objects (`gState`, `look`, `keys`) from `core/game-state.js`, so a change in one module is visible everywhere. Local progress is persisted to `localStorage` under the key `escape_room_v1`.

---

## The world

The layout is an **L-shaped corridor** defined entirely in `src/core/config.js`:

- **Leg 1** runs along `z` for 52 units from the spawn point.
- **Leg 2** bends right along `x` to the exit door at `x = 44`.
- **Rooms hang off the corridor walls.** Each room declares which wall its door sits in (`E`/`W`/`N`/`S`), its span along that wall, and the door opening; `world.js` turns those into geometry via per-room local frames.

Room roster (walking order): 3 real classrooms interleaved with 2 decoys, plus 5 vacant abandoned rooms with open black doorways for atmosphere and misdirection — including one dead-ahead at the corner that you walk straight toward before the corridor bends.

Atmosphere is tuned with exponential **fog**, near-black ambient light, flickering fluorescent lights, and a horror asset set (blood decals, 3D monster models, ambient/jumpscare audio, a custom scratch font).

---

## Questions & the exit code

All learning content lives in `src/data/questions.js`, transcribed verbatim from the researchers' content document (do not reword without approval).

- Each room defines a `codeDigit`. Room 1 → `4`, Room 2 → `7`, Room 3 → `9`.
- The exit code is **derived**, not hard-coded: `EXIT_CODE = ROOMS.map(r => r.codeDigit).join('')` → `"479"`.
- `QUESTIONS_PER_ROOM = 5` — each run randomly draws 5 items from that room's bank, so repeated attempts see different problems.
- Each question carries `text`, four `choices`, the `correct` index, and a `hint` (shown in P-Learn mode). Moderate questions additionally carry `steps` for the tap-to-fill solution scaffold.

---

## Accounts, leaderboard & analytics

The `src/net/` layer talks to Supabase:

- **`auth.js`** — sign up / sign in / sign out, username availability, admin checks.
- **`scores.js`** — submit a finished run, fetch the leaderboard.
- **`analytics.js`** — fire-and-forget telemetry that **never throws** (telemetry must never be able to break the game). It records a `plays` row at run start, then per-question `attempts` and `events`, and finalizes the run with an outcome (`won` / `lost` / `abandoned`), duration, rooms completed, score, and best time.

The database schema (`supabase/schema.sql`) is production-grade and **idempotent** (safe to re-run — it's also the upgrade path). Highlights:

- **`profiles`** — one row per account, `role` is `student` or `admin`. A `handle_new_user()` trigger creates the profile **inside the signup transaction**, so an auth user can never exist without a profile, and `role` is forced to `student` server-side so it can't be spoofed. Usernames are validated by DB constraints (3–20 chars, restricted charset) and enforced **case-insensitively** unique.
- **`runs`** — one row per finished playthrough (`room_scores`, `total_score` 0–100, `best_time`).
- **`plays` / attempts / events** — fine-grained analytics tables tied to the user, protected by **Row Level Security** so only the player and admins can read them.
- **`username_available()`** — `SECURITY DEFINER` function so the signup form can pre-check a name without exposing profile data.

---

## Teacher / admin dashboard

`src/ui/dashboard.js` + `charts.js` (built on Chart.js) render an admin-only dashboard for teachers/researchers: run outcomes, per-question item analysis, and player activity. To populate it for a demo, `scripts/seed-players.mjs` creates 20 realistic players with varied plays, attempts, and events.

To make yourself an admin: sign up in the game, then set your `profiles.role` to `admin` in the Supabase table editor (or `update public.profiles set role='admin' where username='YOUR_NAME';`).

---

## Getting started

```bash
# install dependencies
npm install

# run the dev server (Vite)
npm run dev
```

Then open the local URL Vite prints. Controls: **WASD** to move, **mouse** to look, **E** to interact, and the on-screen menu for settings (look sensitivity, P-Learn, fullscreen).

---

## Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor → New query**, paste the entire `supabase/schema.sql`, and run it.
3. (Recommended) **Authentication → Providers → Email → turn OFF "Confirm email"** so students can log in without a real inbox.
4. Point the app's Supabase URL / anon key (see `src/net/supabase.js`) at your project.
5. Sign up, then promote your account to `admin` (see above) to view the dashboard.

> Note: the anon key is a public, RLS-guarded key by design. Access control is enforced by Row Level Security in the database, not by hiding the key.

---

## Build & deploy

```bash
npm run build     # outputs static site to dist/
```

Deploy on **Vercel** by importing the GitHub repo. Settings (auto-detected, or set manually):

- Framework preset: **Vite**
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`

`vercel.json` adds long-lived cache headers for hashed JS/CSS and media assets, while keeping `index.html` always revalidated.

---

## Configuration reference

Key tuning knobs in `src/core/config.js` (`CFG`):

| Setting | Default | Meaning |
|---|---|---|
| `player.speed` | `4.5` | Movement speed (units/sec) |
| `player.eyeH` | `1.7` | Camera eye height |
| `player.radius` | `0.35` | Collision radius |
| `player.interactR` | `2.2` | Max distance to show the "Press E" prompt |
| `gameplay.maxWrongAnswers` | `5` | Wrong answers per room before the chase penalty |
| `gameplay.answerTimeSeconds` | `15` | Per-question time limit (PLAY mode) |
| `gameplay.pLearnMode` | `false` | Show a hint before each question |
| `fog.density` | `0.030` | Corridor fog thickness |

World geometry (corridor lengths, room widths, door openings, decoy/vacant room placement) is fully data-driven in the same file.

---

## Documentation

- `docs/requirements-tracking.md` — feature requirements and changelog mapped to implementation.
