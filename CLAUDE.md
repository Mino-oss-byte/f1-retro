# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

F1-Retro is a browser 3D formula racer (Three.js + Vite, plain ES modules, no framework, no TypeScript). The design spec is `../Game Project.md`, which sits outside this repo and is not tracked.

## Commands

```
npm run dev        # Vite dev server, http://localhost:5173
npm run build      # static build to dist/ (base './', so it works from any sub-folder)
```

There is no linter or test runner. Instead, headless Node scripts import the real game modules (Three.js runs fine without a renderer) and print numbers. Run the relevant one after changing physics, AI, pits or track geometry:

```
node scripts/sim-ai.mjs [trackId] [pace]        # one AI car alone: lap times, off-track time, barrier hits
node scripts/sim-race.mjs [trackId] [laps]      # full race via Session: pit stops, finish order, cars stuck in pit
node scripts/sim-overtakes.mjs [trackId] [laps] # overtakes and overtake-mode use
node scripts/sim-boost.mjs                      # overtake charge gained per lap, top boost speed
node scripts/check-surface.mjs [trackId]        # raycasts for grass/ground meshes covering the road
```

Leave out `trackId` to run every track. Track ids: `silverstone`, `albertpark`, `lasvegas`, `cota`, `spa`. Python is not installed on this machine, so use Node for scripted edits.

## Architecture

**Frame loop and session.** `src/main.js` owns the WebGL renderer: 480×270 internal resolution, scaled up by CSS with pixelated sampling. It runs the menu/game/pause/results screen state and turns key presses into calls on `Session`. `src/game/session.js` holds a whole practice session or race: the scene, the track, every car (player and AI), the race rules, collisions, ranking, camera and HUD state. It runs physics at a fixed `PHYSICS_DT = 1/120` using an accumulator. The sim scripts drive `Session` directly, so it must not depend on the DOM; `audio` is optional (`this.audio?.`).

**Cars are plain state objects.** `createCarState` (`src/car/carPhysics.js`) returns a mutable object. `Session` and `pit.js` add fields to it (`team`, `pit`, `driver`, `mesh`, `laps`, `compound` and others). `stepCar(car, input, dt, onTrack)` is the only physics step, and the player and the AI use it the same way. Both produce the same input shape: `{ throttle, brake, steer, boost }`. During a pit stop, `updatePit` returns an input that overrides the driver's.

**Track pipeline.** Track data in `src/data/tracks/*.js` is generated, so don't edit it by hand. It holds centerline, per-point left/right widths, elevation, racing line, pit start/length, theme and direction, with points about 5 m apart. `createTrack(data)` (`src/track/trackBuilder.js`) builds every mesh: road, aprons, verges, barriers, pit lane and scenery. It returns a query API that the rest of the game relies on:
- `step(car)` locates the car on the centerline, counts laps (by the index wrapping through the 25%/75% quarters) and sets `onTrack` and the barrier result.
- `pointAt(s, lateral)` gives a pose at arc length `s`.
- `racingLine`, `widthAt(i)`, `elevationAt(i)` and `pit` (the pit-lane path and box positions).

Game coordinates use `z = -y` of the source map. `src/track/themes.js` sets each theme's sky, fog, lighting, apron width (0 on street circuits) and scenery.

To add or regenerate a track, run `scripts/import-track.js`, which converts TUM racetrack-database CSVs from `raw/`. The README has the full command. Elevation is not in the TUM data: the hand-made profiles for COTA and Spa are in `scripts/elevation-profiles.js`. Las Vegas comes from `scripts/make-vegas.js`, which writes TUM-format CSVs. Then register the track in `src/data/tracks/index.js` (`TRACKS` order, plus `TRACK_INFO` for the garage).

**AI.** `buildSpeedProfile(racingLine, topSpeed)` (`src/ai/driver.js`) works out a target speed for each point of the racing line. `Session` caches one profile per tire compound for each track, because the compounds have different top speeds. `driveAI` uses pure pursuit along the racing line plus a lateral offset for overtaking. Each AI car's `pace` comes from difficulty, or in `auto` mode from the player's practice best lap via `AI_LAP_FACTOR`, scaled by a seeded per-car skill. Field order, AI skill and starting tires come from the `mulberry(seed)` RNG, so a race with the same seed is reproducible.

**Tuning constants** are at the top of each module: `carPhysics.js` for speed, grip, tire wear, `COMPOUNDS` and overtake charge; `driver.js` for AI braking and cornering margins; `session.js` for grid spacing and difficulty pace; `trackBuilder.js` for the pit-lane limit and scenery spacing. After changing them, re-check with the sim scripts.

**UI.** The HUD (`src/ui/hud.js`) updates fixed DOM elements declared in `index.html` from `session.hudState()` and `session.events`. Menus (`src/ui/menus.js`) render HTML strings into `#menu`. `src/storage.js` wraps `localStorage` (prefix `f1retro.`) so it fails silently when storage is blocked. Team names and colors are only in `src/data/teams.js`; the real F1 driver names the AI is randomly given are in `src/data/drivers.js`. In a race the HUD shows an F1-style timing tower on the left (gaps to the leader come from `Session.timeMark`, taken every `TIMING_STEP` metres) and a minimap on the right (`setMinimapTrack` in `hud.js`, drawn from the track centerline).

## Workflow

### Commit and push regularly

GitHub is the record of the project's progress. Work that is not pushed can be lost. Don't let work pile up locally.

- **Commit as you go.** Each time a working piece is finished and checked (a feature, a fix, a tuning pass, a new track), commit it. In a long task, commit at each milestone too, not only at the end. Make each commit one logical change, so any one of them can be reverted on its own.
- **Push right after each commit** (`git push`; remote `origin`, branch `main`, public repo https://github.com/Mino-oss-byte/f1-retro). If a push fails, tell the user straight away. Never end a session with commits that exist only locally.
- **Clean commit messages:**
  - The subject line is imperative, under ~70 characters, and says what changed (for example: "Bigger cars (1.2x), tire compounds set top speed and wear rate").
  - After a blank line, the body says *why*, and gives any numbers that matter (tuning values, sim-script results).
  - No "WIP", "fix", "update" or other vague subjects.
- Run `git status` before finishing a task, and make sure the working tree is clean and pushed.
- Don't commit `node_modules/` or `dist/`; both are in `.gitignore`.

### Deploying

- The main public link is GitHub Pages, https://mino-oss-byte.github.io/f1-retro/. The workflow (`.github/workflows/deploy.yml`) builds and deploys it on every push to `main`, so pushing is deploying. Check that the run succeeded (`gh run list --workflow deploy.yml`).
- The older shared build is a claude.ai artifact (https://claude.ai/artifact/5WSsnuW95aFM3QENx7js8K). To update it after a change:
  1. Run `npm run build`.
  2. Publish a page made from `dist/index.html` with its doctype/html/head/body/meta wrapper lines removed, and `dist/assets/*` as supporting files under `assets/`.
  3. Bundle file names are hashed and change on every build, so set the old bundle's path to `null` when updating.
