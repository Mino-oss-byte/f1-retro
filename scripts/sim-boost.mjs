// Headless check of overtake charge: player car is driven by the AI. node scripts/sim-boost.mjs
import { TRACKS } from '../src/data/tracks/index.js';
import { Session } from '../src/game/session.js';
import { driveAI } from '../src/ai/driver.js';

for (const trackData of TRACKS) {
  const s = new Session({ trackData, mode: 'race', teamId: 'tfr', tc: 1, difficulty: 'pro', laps: 2 });
  let t = 0, charge = 0, fieldBoost = 0, top = 0;
  while (s.phase !== 'finished' && t < 600) {
    const p = s.player;
    const input = s.phase === 'racing' ? driveAI(p, p.driver, s.track, s.carAhead(p), p.pit.requested) : {};
    s.update(1 / 60, input);
    t += 1 / 60;
    if (p.laps === 0) charge = Math.max(charge, p.boostEnergy);
    for (const c of s.cars) if (c.boosting) { fieldBoost += 1 / 60; top = Math.max(top, c.speed); }
  }
  console.log(`${trackData.id}: player charge after lap 1 ${(charge * 100).toFixed(0)}%, field boost ${fieldBoost.toFixed(0)}s, top boost speed ${(top * 3.6).toFixed(0)} km/h`);
}
