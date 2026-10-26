export const MAX_SPEED = 85;        // m/s (~300 km/h)
export const BOOST_FACTOR = 1.15;  // overtake mode: +15% top speed
const ACCEL = 24;            // m/s^2
const BRAKE = 50;
const DRAG = 0.0022;         // quadratic drag
const REVERSE_MAX = 12;
const OFFTRACK_DRAG = 80;    // decel while slowing down to the off-track cap
const OFFTRACK_MAX = MAX_SPEED * 0.9; // grass / gravel: top speed is held to 90%
const MAX_STEER_RATE = 1.9;  // rad/s at low speed
const GRAVITY = 9.8 * 0.6;   // arcade: how strongly hills slow or speed the car

// Traction control levels. `spin` is how much wheelspin full throttle in a corner can cause.
export const TC_LEVELS = [
  { name: 'OFF', spin: 1, cornerAccel: 1 },
  { name: 'MEDIUM', spin: 0.5, cornerAccel: 0.94 },
  { name: 'FULL', spin: 0, cornerAccel: 0.85 }, // never spins, but is slow out of corners
];

const SLIP_BUILD = 1.2;      // per second while throttle + steering
const SLIP_DECAY = 2.5;
const OVERSTEER = 1.5;       // extra rad/s of rotation at full slip
const WEAR_BASE = 0.0008;    // per second
const WEAR_CORNERING = 0.0014;
const WEAR_SPIN = 0.002;
const MIN_GRIP = 0.6;        // grip left on fully worn tires

// Tire compounds: `speed` scales top speed, `wear` scales how fast the tires wear.
export const COMPOUNDS = {
  soft: { name: 'SOFT', letter: 'S', color: '#e2332b', speed: 1.1, wear: 1.2 },
  medium: { name: 'MEDIUM', letter: 'M', color: '#ffcc33', speed: 1.0, wear: 1.0 },
  hard: { name: 'HARD', letter: 'H', color: '#f4f1e8', speed: 0.92, wear: 0.8 },
};
export const COMPOUND_ORDER = ['soft', 'medium', 'hard'];

// Overtake energy only charges while braking in a corner; a full bar is about 7 s of boost.
const BOOST_CHARGE = 0.18;   // energy per second of corner braking (roughly a third to half a bar per lap)
const BOOST_CHARGE_MIN_SPEED = 10;
const BOOST_DRAIN = 0.14;
const BOOST_ACCEL = 1.35;
export const BOOST_MIN_ENERGY = 0.05; // needed to switch overtake mode on

export function createCarState(x, z, heading) {
  return {
    x, z, heading, y: 0, speed: 0,
    tc: 1, slip: 0, tireWear: 0, compound: 'medium',
    boostEnergy: 0, boostAvailable: false, boosting: false,
    slope: 0,
  };
}

export function cycleTractionControl(car) {
  car.tc = (car.tc + 1) % TC_LEVELS.length;
}

export function resetTires(car, compound) {
  car.tireWear = 0;
  if (compound) car.compound = compound;
}

// full grip on fresh tires, falling to MIN_GRIP when fully worn
export function gripOf(car) {
  return 1 - (1 - MIN_GRIP) * car.tireWear;
}

export function topSpeedOf(car) {
  return MAX_SPEED * COMPOUNDS[car.compound].speed;
}

// Max yaw rate (rad/s) the steering can produce at the car's current speed and grip.
export function maxYawRate(speed, grip) {
  return MAX_STEER_RATE * grip / (1 + Math.abs(speed) / 25);
}

// input: { throttle, brake, boost } booleans plus either `steer` (-1..1, + = left) or { left, right }.
// heading 0 points along +z; positive heading turns toward +x
export function stepCar(car, input, dt, onTrack) {
  const throttle = input.throttle ? 1 : 0;
  const steerInput = input.steer !== undefined ? input.steer : (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const steering = Math.abs(steerInput) > 0.3;
  const grip = gripOf(car);
  const tc = TC_LEVELS[car.tc];
  const cornering = throttle && steering && car.speed > 3;

  // overtake boost: spends stored energy under throttle; braking into a corner charges it
  car.boosting = !!input.boost && car.boostAvailable && car.boostEnergy > 0 && throttle > 0;
  if (car.boosting) car.boostEnergy = Math.max(0, car.boostEnergy - BOOST_DRAIN * dt);
  else if (input.brake && steering && car.speed > BOOST_CHARGE_MIN_SPEED) {
    car.boostEnergy = Math.min(1, car.boostEnergy + BOOST_CHARGE * dt);
  }

  // wheelspin builds when full throttle meets a corner; worn tires break away sooner
  const slipCap = Math.min(1, tc.spin * (2 - grip));
  if (cornering) car.slip = Math.min(slipCap, car.slip + SLIP_BUILD * dt);
  else car.slip = Math.max(0, car.slip - SLIP_DECAY * dt);

  if (throttle) {
    let a = ACCEL * (0.8 + 0.2 * grip);
    if (steering) a *= tc.cornerAccel;
    if (car.boosting) a *= BOOST_ACCEL;
    car.speed += a * (1 - 0.4 * car.slip) * dt;
  }
  if (input.brake) {
    // brake while moving forward, reverse once stopped
    car.speed -= (car.speed > 0.5 ? BRAKE * (0.7 + 0.3 * grip) : ACCEL * 0.5) * dt;
  }
  if (!throttle && !input.brake) {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 4 * dt);
  }

  car.speed -= Math.sign(car.speed) * DRAG * car.speed * car.speed * dt;
  car.speed -= GRAVITY * car.slope * (car.speed >= 0 ? 1 : -1) * dt; // uphill slows, downhill speeds up

  const tireTop = topSpeedOf(car);
  const top = car.boosting ? tireTop * BOOST_FACTOR : tireTop;
  if (!onTrack && car.speed > OFFTRACK_MAX) {
    car.speed = Math.max(OFFTRACK_MAX, car.speed - OFFTRACK_DRAG * dt);
  }
  // coming off boost, bleed back down to normal top speed rather than snapping
  if (!car.boosting && car.speed > tireTop) car.speed = Math.max(tireTop, car.speed - 12 * dt);
  car.speed = Math.max(-REVERSE_MAX, Math.min(top, car.speed));

  // steering weakens at high speed and on worn tires
  const direction = car.speed >= 0 ? 1 : -1;
  const speedScale = Math.min(1, Math.abs(car.speed) / 4); // no turning while stationary
  car.heading += steerInput * maxYawRate(car.speed, grip) * speedScale * direction * dt;
  // oversteer: rear steps out and the car rotates further into the corner
  car.heading += Math.sign(steerInput) * (steering ? 1 : 0) * car.slip * OVERSTEER * dt;

  // tires wear with time, hard cornering at speed and wheelspin
  const load = Math.abs(steerInput) * Math.abs(car.speed) / MAX_SPEED;
  car.tireWear = Math.min(1, car.tireWear + (WEAR_BASE + WEAR_CORNERING * load + WEAR_SPIN * car.slip) * COMPOUNDS[car.compound].wear * dt);

  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
}
