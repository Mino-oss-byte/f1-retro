// Headless race test: player car is driven by the AI too. Reports pit stops, finish order and timing.
// node scripts/sim-race.mjs [trackId] [laps]
import { TRACKS } from '../src/data/tracks/index.js';
import { Session } from '../src/game/session.js';
import { driveAI } from '../src/ai/driver.js';

const only = process.argv[2];
const laps = Number(process.argv[3] || 4);

for (const trackData of TRACKS) {
  if (only && trackData.id !== only) continue;
  const t0 = Date.now();
  const s = new Session({ trackData, mode: 'race', teamId: 'tfr', tc: 1, difficulty: 'pro', laps });
  let simTime = 0, contacts = 0;
  while (s.phase !== 'finished' && simTime < laps * 200) {
    const p = s.player;
    const input = s.phase === 'racing' ? driveAI(p, p.driver, s.track, s.carAhead(p), p.pit.requested) : {};
    s.update(1 / 60, input);
    simTime += 1 / 60;
  }
  const res = s.results();
  const stops = s.cars.reduce((n, c) => n + c.pit.stops, 0);
  const pitted = s.cars.filter((c) => c.pit.stops > 0).length;
  const stuckInPit = s.cars.filter((c) => c.pit.phase !== 'none').length;
  console.log(`${trackData.id}: ${s.phase} in ${simTime.toFixed(0)}s sim (${Date.now() - t0}ms real), stops ${stops} by ${pitted} cars, still in pit ${stuckInPit}`);
  console.log('  ' + res.map((r) => `${r.position}.${r.team.id}${r.isPlayer ? '*' : ''} ${typeof r.gap === 'number' ? '+' + r.gap.toFixed(1) : r.gap ?? r.time.toFixed(1)}`).join('  '));
}
