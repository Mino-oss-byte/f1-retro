import { pursuit } from './driver.js';
import { resetTires } from '../car/carPhysics.js';

export const PIT_STOP_TIME = 3; // seconds stationary in the box

export function createPitState(slot) {
  return { slot, requested: false, phase: 'none', r: 0, timer: 0, stops: 0, nextCompound: 'medium' };
}

// The compound fitted at the next stop. Can be changed any time before the tires go on.
export function setNextCompound(car, compound) {
  car.pit.nextCompound = compound;
}

// B: request a stop (the car turns in at the next pit entry) or cancel the request.
export function togglePitRequest(car) {
  if (car.pit.phase === 'none') car.pit.requested = !car.pit.requested;
}

export const inPitLane = (car) => car.pit.phase !== 'none';

// Runs the pit-lane sequence for a car. Returns driving input while the car is in the pit lane
// (entering, stopped, leaving), or null when the car should drive normally.
export function updatePit(car, track, dt) {
  const pit = car.pit;
  const P = track.pit;
  const path = P.path;

  if (pit.phase === 'none') {
    if (!pit.requested) return null;
    const rel = (car.idx - P.entryIndex + track.n) % track.n;
    if (rel < P.ramp && car.alongTrack > 0) { pit.phase = 'enter'; pit.r = 0; pit.timer = 0; } else return null;
  }

  // pit lane speed limit is applied automatically
  if (car.speed > P.speed) car.speed = P.speed;

  // progress along the pit path: nearest path point ahead of where we were
  let best = Infinity, bi = pit.r;
  for (let r = pit.r; r <= Math.min(path.length - 1, pit.r + 8); r++) {
    const d = (path[r].x - car.x) ** 2 + (path[r].z - car.z) ** 2;
    if (d < best) { best = d; bi = r; }
  }
  pit.r = bi;

  const box = P.boxR(pit.slot);
  const spacing = track.avgSpacing;
  const look = Math.max(2, Math.round((6 + 0.4 * Math.abs(car.speed)) / spacing));
  const target = path[Math.min(path.length - 1, pit.r + look)];
  const steer = pursuit(car, target.x, target.z);

  if (pit.phase === 'enter') {
    const distBox = (box - pit.r) * spacing;
    const vt = distBox < 0.8 ? 0 : Math.min(P.speed, Math.sqrt(2 * 7 * distBox) + 1.5);
    if (distBox < 1.2 && car.speed < 1.5) { pit.phase = 'stopped'; pit.timer = 0; }
    return { throttle: car.speed < vt - 0.5, brake: car.speed > vt + 1, steer, boost: false };
  }

  if (pit.phase === 'stopped') {
    pit.timer += dt;
    car.speed = 0;
    if (pit.timer >= PIT_STOP_TIME) {
      resetTires(car, pit.nextCompound);
      pit.phase = 'exit';
      pit.stops++;
    }
    return { throttle: false, brake: false, steer: 0, boost: false };
  }

  // exit: drive out at the limit and rejoin
  if (pit.r >= path.length - 2) {
    pit.phase = 'none';
    pit.requested = false;
    return null;
  }
  return { throttle: car.speed < P.speed - 0.5, brake: false, steer, boost: false };
}
