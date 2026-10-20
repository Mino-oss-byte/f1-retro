// Headless AI test: drives one AI car solo and reports lap times, off-track time and barrier hits.
// node scripts/sim-ai.mjs [trackId] [pace]
import { TRACKS } from '../src/data/tracks/index.js';
import { createTrack } from '../src/track/trackBuilder.js';
import { createCarState, stepCar } from '../src/car/carPhysics.js';
import { buildSpeedProfile, createDriver, driveAI } from '../src/ai/driver.js';

const only = process.argv[2];
const pace = Number(process.argv[3] || 1);
const DT = 1 / 120;

for (const data of TRACKS) {
  if (only && data.id !== only) continue;
  const track = createTrack(data);
  const profile = buildSpeedProfile(track.racingLine);
  const start = track.pointAt(-10);
  const car = createCarState(start.x, start.z, start.heading);
  car.tc = 2; car.laps = -1;
  const driver = createDriver(track.racingLine, profile, pace);
  track.step(car);
  let t = 0, lapStart = null, offTime = 0, hits = 0, laps = [];
  let prevLaps = car.laps, worstOff = 0, wasHit = false;
  while (laps.length < 3 && t < 400) {
    const input = driveAI(car, driver, track, null, false);
    stepCar(car, input, DT, car.onTrack);
    car.hitBarrier = false;
    track.step(car);
    if (car.hitBarrier && !wasHit) hits++;
    wasHit = car.hitBarrier;
    if (!car.onTrack) offTime += DT;
    worstOff = Math.max(worstOff, Math.abs(car.trackDist));
    t += DT;
    if (car.laps !== prevLaps) {
      if (lapStart !== null) laps.push(t - lapStart);
      lapStart = t; prevLaps = car.laps;
    }
  }
  console.log(`${data.id.padEnd(11)} ref ${profile.refTime.toFixed(1)}s  laps ${laps.map((l) => l.toFixed(1)).join(', ')}  off-track ${offTime.toFixed(1)}s  barrier hits ${hits}  max offset ${worstOff.toFixed(1)}m  wear ${(car.tireWear * 100).toFixed(0)}%`);
}
