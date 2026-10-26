# F1-Retro

Browser 3D formula racer with a retro low-poly look (spec: `../Game Project.md`).

## Run

```
npm install
npm run dev        # http://localhost:5173
```

## Share it (static hosting)

```
npm run build      # outputs dist/
```

Upload `dist/` to any static host:
- **Netlify**: drag the `dist` folder onto https://app.netlify.com/drop
- **Vercel**: `npx vercel deploy dist --prod`
- **GitHub Pages**: needs a public repo on the free plan. Set Settings → Pages → Source: GitHub Actions, then run **Deploy to GitHub Pages** from the Actions tab (it no longer runs on every push)

## Controls

W throttle · S brake/reverse · A/D steer · G overtake boost · B pit stop · T traction control · C camera · M mute · Esc pause

## Project layout

- `src/data/teams.js` – all team names and colors
- `src/data/tracks/*.js` – generated track data (do not edit by hand)
- `src/track/` – builds road, aprons, barriers, pit lane, scenery from track data; `themes.js` sets each track's look
- `src/car/` – arcade physics (traction control, tire wear, boost, off-track and hills) and the car model
- `src/ai/` – AI driver (racing line, speed profile, overtaking) and pit-lane logic
- `src/game/session.js` – practice and race rules: grid, start lights, laps, positions, collisions, results
- `src/ui/` – HUD and menus

## Scripts

- `scripts/import-track.js` – TUM CSV → track data. Example:
  `node scripts/import-track.js --track raw/Spa.csv --line raw/Spa_line.csv --out src/data/tracks/spa.js --id spa --name "Spa-Francorchamps" --direction clockwise --theme forest --elevation spa`
- `scripts/elevation-profiles.js` – hand-made elevation for COTA and Spa
- `scripts/make-vegas.js` – builds the approximate Las Vegas layout
- `scripts/sim-ai.mjs` – headless AI lap test per track
- `scripts/sim-race.mjs` – headless full race (`node scripts/sim-race.mjs silverstone 10`)

## Data credits

Silverstone, Albert Park, COTA and Spa layouts: TUM racetrack database (LGPL-3.0), centerlines from © OpenStreetMap contributors.
