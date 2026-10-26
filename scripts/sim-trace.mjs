// Headless AI trace: reports where a solo AI car leaves the track (line index, speed vs plan, curvature).
// node scripts/sim-trace.mjs trackId [pace] [cornerSafety]
import { TRACKS } from '../src/data/tracks/index.js';
import { createTrack } from '../src/track/trackBuilder.js';
import { createCarState, stepCar } from '../src/car/carPhysics.js';
import { buildSpeedProfile, createDriver, driveAI } from '../src/ai/driver.js';

const data = TRACKS.find((t) => t.id === (process.argv[2] || 'spa'));
const pace = Number(process.argv[3] || 1);
const DT = 1 / 120;
const track = createTrack(data);
const profile = buildSpeedProfile(track.racingLine);
const pts = track.racingLine.pts;
console.log('line points', pts.length, 'avg spacing', (track.racingLine.cum[pts.length] / pts.length).toFixed(2), 'm');
const start = track.pointAt(-10);
const car = createCarState(start.x, start.z, start.heading);
car.tc = 2; car.laps = -1;
const driver = createDriver(track.racingLine, profile, pace);
track.step(car);
let t = 0, wasOn = true, steerSat = 0;
while (t < 120) {
  const input = driveAI(car, driver, track, null, false);
  if (Math.abs(input.steer) >= 0.999) steerSat += DT;
  stepCar(car, input, DT, car.onTrack);
  track.step(car);
  if (wasOn && !car.onTrack) {
    const i = driver.idx;
    console.log(`t ${t.toFixed(1)}  idx ${i}  speed ${car.speed.toFixed(1)}  plan ${(profile.speed[i] * pace).toFixed(1)}  steer ${input.steer.toFixed(2)}  offset ${car.trackDist.toFixed(1)}  grip ${(1 - 0.4 * car.tireWear).toFixed(2)}`);
  }
  wasOn = car.onTrack;
  t += DT;
}
console.log('steering saturated for', steerSat.toFixed(1), 's of', t.toFixed(0));
