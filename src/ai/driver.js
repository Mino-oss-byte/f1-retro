import { maxYawRate, gripOf, topSpeedOf, MAX_SPEED, BOOST_FACTOR } from '../car/carPhysics.js';

const CORNER_SAFETY = 0.46; // fraction of the turning capability the AI plans to use
const BRAKE_DECEL = 38;     // m/s^2 the AI plans to brake at (the car can do ~50)
const ACCEL_PLAN = 15;      // m/s^2 the AI assumes it can accelerate at

const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

// Fastest speed whose yaw rate (v / radius) the steering can hold, using CORNER_SAFETY of it.
function cornerSpeed(radius) {
  let lo = 0, hi = 200;
  for (let k = 0; k < 30; k++) {
    const v = (lo + hi) / 2;
    if (v / radius <= maxYawRate(v, 1) * CORNER_SAFETY) lo = v; else hi = v;
  }
  return lo;
}

// Target speed for every racing-line point: what the steering can hold through each corner,
// limited by braking distance into it and acceleration out of it. `top` is the car's top speed.
export function buildSpeedProfile(line, top = MAX_SPEED) {
  const { pts } = line;
  const n = pts.length;
  const ds = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = pts[(i + 1) % n];
    ds[i] = Math.hypot(b.x - pts[i].x, b.z - pts[i].z);
  }
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 4 + n) % n], b = pts[i], c = pts[(i + 4) % n];
    const h1 = Math.atan2(b.x - a.x, b.z - a.z), h2 = Math.atan2(c.x - b.x, c.z - b.z);
    const turn = Math.abs(wrap(h2 - h1));
    const arc = Math.hypot(b.x - a.x, b.z - a.z) + Math.hypot(c.x - b.x, c.z - b.z);
    const radius = turn < 1e-3 ? 1e6 : arc / turn;
    v[i] = Math.min(cornerSpeed(radius), top * 0.99);
  }
  // smooth out single-point noise, then braking (backwards) and acceleration (forwards) limits
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) v[i] = Math.min(v[i], (v[(i + 1) % n] + v[i] + v[(i - 1 + n) % n]) / 3 + 0.5);
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n * 2 - 1; i >= 0; i--) {
      const k = i % n, nx = (k + 1) % n;
      v[k] = Math.min(v[k], Math.sqrt(v[nx] * v[nx] + 2 * BRAKE_DECEL * ds[k]));
    }
    for (let i = 0; i < n * 2; i++) {
      const k = i % n, pv = (k - 1 + n) % n;
      v[k] = Math.min(v[k], Math.sqrt(v[pv] * v[pv] + 2 * ACCEL_PLAN * ds[pv]));
    }
  }
  let time = 0;
  for (let i = 0; i < n; i++) time += ds[i] / Math.max(v[i], 5);
  return { speed: v, refTime: time };
}

// Steering (-1..1, + = left) that curves the car onto the point (tx, tz): classic pure pursuit.
export function pursuit(car, tx, tz) {
  const speed = Math.max(Math.abs(car.speed), 3);
  const dx = tx - car.x, dz = tz - car.z;
  const ld = Math.max(Math.hypot(dx, dz), 1);
  const alpha = wrap(Math.atan2(dx, dz) - car.heading);
  const yawNeeded = (2 * Math.sin(alpha) * speed) / ld;
  return Math.max(-1, Math.min(1, yawNeeded / maxYawRate(speed, gripOf(car))));
}

// `profiles` (optional) holds one speed profile per tire compound, since each has its own top speed.
export function createDriver(line, profile, pace, profiles) {
  return { line, profile, profiles, pace, idx: undefined, offset: 0, offsetTarget: 0 };
}

function nearestLineIndex(line, x, z, hint) {
  const { pts } = line;
  const n = pts.length;
  const search = (from, count) => {
    let best = Infinity, bi = 0;
    for (let c = 0; c < count; c++) {
      const i = (from + c + n) % n;
      const d = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return { best, bi };
  };
  if (hint !== undefined) {
    const r = search(hint - 10, 50);
    if (r.best < 40 * 40) return r.bi;
  }
  return search(0, n).bi;
}

// Returns the driving input for an AI car. `traffic` is the nearest car ahead (or null).
export function driveAI(car, driver, track, traffic, wantsPit) {
  const { line, pace } = driver;
  const profile = driver.profiles?.[car.compound] || driver.profile;
  const { pts, cum } = line;
  const n = pts.length;
  driver.idx = nearestLineIndex(line, car.x, car.z, driver.idx);
  const i = driver.idx;

  const grip = gripOf(car);
  const speed = car.speed;
  let vt = profile.speed[(i + 2) % n] * pace * Math.pow(grip, 0.65);

  // --- traffic: follow or pass the car ahead ---
  let offsetTarget = 0;
  let attacking = false;
  const gap = traffic ? traffic.progress - car.progress : Infinity; // metres along the track
  if (traffic && gap > 0 && gap < 50) {
    const lateral = traffic.trackDist - car.trackDist;
    if (Math.abs(lateral) < 3.4) {
      attacking = true;
      // pick the side with more room once per target and commit to it
      if (driver.passTarget !== traffic) {
        const w = track.widthAt(car.idx);
        const roomLeft = w.left - traffic.trackDist;
        const roomRight = w.right + traffic.trackDist;
        driver.passSide = roomLeft >= roomRight ? 1 : -1;
        driver.passTarget = traffic;
      }
      offsetTarget = 3.6 * driver.passSide;
      // only hold station when right behind it; once partly alongside, keep the pace
      if (gap < 12 && Math.abs(lateral) < 1.9) vt = Math.min(vt, Math.max(traffic.speed - 0.5, 0) + Math.max(0, gap - 7) * 0.8);
    }
  }
  if (!attacking) driver.passTarget = null;
  if (wantsPit) offsetTarget = Math.max(offsetTarget, 3.5); // drift toward the pit side (left) before the entry
  driver.offsetTarget = offsetTarget;
  driver.offset += (offsetTarget - driver.offset) * 0.04;
  // keep clear of the barriers whatever the offset
  const w = track.widthAt(car.idx);
  const lateralNow = car.trackDist + 0; // current signed position
  const maxLeft = w.left - 2.2 - lateralNow, maxRight = w.right - 2.2 + lateralNow;
  const off = Math.max(-Math.max(0, maxRight), Math.min(Math.max(0, maxLeft), driver.offset));

  // --- steering: pure pursuit toward a point ahead on the line ---
  const lookahead = Math.max(7, Math.min(45, 5 + 0.3 * Math.abs(speed)));
  let j = i, travelled = 0;
  while (travelled < lookahead && j - i < n) {
    const k = j % n;
    travelled += cum[k + 1] - cum[k];
    j++;
  }
  const t = pts[j % n];
  const t2 = pts[(j + 1) % n];
  const len = Math.hypot(t2.x - t.x, t2.z - t.z) || 1;
  const nx = (t2.z - t.z) / len, nz = -(t2.x - t.x) / len; // left normal of the line
  const tx = t.x + nx * off, tz = t.z + nz * off;
  const steer = pursuit(car, tx, tz);

  // --- throttle / brake / boost ---
  // boost is saved for an actual attack on a straight, not spent sitting in a train
  let boost = false;
  const straightAhead = Math.abs(steer) < 0.2 && profile.speed[(i + 12) % n] > MAX_SPEED * 0.85;
  if (car.boostAvailable && car.boostEnergy > 0.1 && straightAhead && attacking && gap < 35 && !traffic.boosting) {
    boost = true;
    vt = Math.min(topSpeedOf(car) * BOOST_FACTOR - 1, vt + 12);
  }
  const throttle = speed < vt - 0.5;
  const brake = speed > vt + 2.5;
  return { throttle, brake, steer, boost };
}
