// Headless check of racing action: overtakes, boost availability and use.
// node scripts/sim-overtakes.mjs [trackId] [laps]
import { TRACKS } from '../src/data/tracks/index.js';
import { Session } from '../src/game/session.js';
import { driveAI } from '../src/ai/driver.js';

const only = process.argv[2] || 'silverstone';
const laps = Number(process.argv[3] || 5);
const data = TRACKS.find((t) => t.id === only);
const s = new Session({ trackData: data, mode: 'race', teamId: 'tfr', tc: 1, difficulty: 'pro', laps }, null);
let overtakes = 0, availTime = 0, boostTime = 0, playerAvail = 0, t = 0;
let prev = s.ranked.map((c) => c.team.id);
let nextSample = 0; // compare order every 5 s so side-by-side flicker is not counted
while (s.phase !== 'finished' && t < laps * 200) {
  const p = s.player;
  s.update(1 / 60, s.phase === 'racing' ? driveAI(p, p.driver, s.track, s.carAhead(p), false) : {});
  t += 1 / 60;
  if (s.phase !== 'racing') continue;
  if (t < nextSample) { for (const c of s.cars) { if (c.boostAvailable) availTime += 1 / 60; if (c.boosting) boostTime += 1 / 60; } if (p.boostAvailable) playerAvail += 1 / 60; continue; }
  nextSample = t + 5;
  const now = s.ranked.map((c) => c.team.id);
  for (let i = 0; i < now.length; i++) {
    const c = s.ranked[i];
    const was = prev.indexOf(now[i]);
    if (was > i && c.pit.phase === 'none' && !s.ranked.slice(i + 1, was + 1).some((o) => o.pit.phase !== 'none')) overtakes += was - i;
  }
  prev = now;
  for (const c of s.cars) { if (c.boostAvailable) availTime += 1 / 60; if (c.boosting) boostTime += 1 / 60; }
  if (p.boostAvailable) playerAvail += 1 / 60;
}
console.log(`${only} ${laps} laps: overtakes ${overtakes}, boost available ${availTime.toFixed(0)} car-s, used ${boostTime.toFixed(1)} car-s, player eligible ${playerAvail.toFixed(0)}s of ${t.toFixed(0)}s`);
