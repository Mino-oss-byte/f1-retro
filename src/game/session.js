import * as THREE from 'three';
import { TEAMS } from '../data/teams.js';
import { DRIVERS, PLAYER_DRIVER } from '../data/drivers.js';
import { createTrack } from '../track/trackBuilder.js';
import { createCarMesh } from '../car/carMesh.js';
import { createCarState, stepCar, cycleTractionControl, COMPOUNDS, COMPOUND_ORDER, MAX_SPEED, BOOST_MIN_ENERGY } from '../car/carPhysics.js';
import { buildSpeedProfile, createDriver, driveAI } from '../ai/driver.js';
import { createPitState, togglePitRequest, updatePit, inPitLane, setNextCompound, PIT_STOP_TIME } from '../ai/pit.js';

const PHYSICS_DT = 1 / 120;
const GRID_SPACING = 7;
const AI_LAP_FACTOR = 1.045; // measured: an AI lap takes ~4.5% longer than the speed profile's ideal time
const DIFFICULTY_PACE = { rookie: 0.86, pro: 0.96, legend: 1.0 };
const AUTO_EDGE = 1.02;      // auto difficulty: the field aims 2% quicker than the player's practice best
const MAX_AI_PACE = 1.03;    // ceiling for any one AI car's pace, after its skill roll
const TIMING_STEP = 100;     // metres between the timing marks the leaderboard gaps are taken at

// one AI speed profile per tire compound, since each compound has its own top speed
const profileCache = new Map();
const profilesFor = (track) => {
  if (!profileCache.has(track.id)) {
    profileCache.set(track.id, Object.fromEntries(COMPOUND_ORDER.map((c) => [c, buildSpeedProfile(track.racingLine, MAX_SPEED * COMPOUNDS[c].speed)])));
  }
  return profileCache.get(track.id);
};

// Seeded so a given race always has the same field spread.
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One practice session or race: owns the scene, track, cars and the rules.
export class Session {
  // opts: { trackData, mode: 'practice'|'race', teamId, tc, difficulty: 'auto'|'rookie'|'pro'|'legend', laps, bestLap, onNewBest }
  constructor(opts, audio) {
    this.opts = opts;
    this.audio = audio;
    this.mode = opts.mode;
    this.totalLaps = opts.mode === 'race' ? opts.laps : Infinity;
    this.acc = 0;
    this.clock = 0;          // seconds since the session went green
    this.cameraMode = 'chase';
    this.fovBoost = 0;
    this.overtakeOn = false; // player's overtake mode, toggled with G
    this.paused = false;
    this.finishOrder = 0;
    this.events = [];        // transient messages for the HUD
    this.markTimes = new Map(); // timing mark -> clock when the first car crossed it

    this.track = createTrack(opts.trackData);
    this.profiles = profilesFor(this.track);
    this.profile = this.profiles.medium;
    this.buildScene();
    this.buildCars();

    if (this.mode === 'race') {
      this.phase = 'countdown';
      this.countdown = 0;
      this.goAt = 5 + 0.6 + this.rng() * 1.0;
    } else {
      this.phase = 'racing';
    }
    this.updateRanking();
    this.syncMeshes();
    this.snapCamera();
  }

  buildScene() {
    const theme = this.track.theme;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(theme.sky);
    this.scene.fog = new THREE.Fog(theme.fog[0], theme.fog[1], theme.fog[2]);
    this.scene.add(new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], theme.hemi[2]));
    const sun = new THREE.DirectionalLight(theme.sun[0], theme.sun[1]);
    sun.position.set(100, 200, 50);
    this.scene.add(sun);
    this.scene.add(this.track.mesh);
    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.5, 1800);
    this.headlight = null;
    if (theme.scenery === 'city') {
      this.headlight = new THREE.PointLight(0xfff0d0, 1.4, 90);
      this.scene.add(this.headlight);
    }
  }

  buildCars() {
    const { opts, track } = this;
    this.rng = mulberry(opts.seed || 1337);
    const playerTeam = TEAMS.find((t) => t.id === opts.teamId) || TEAMS[0];
    const aiTeams = TEAMS.filter((t) => t !== playerTeam);
    // shuffle the AI order, then put the player mid-pack
    for (let i = aiTeams.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [aiTeams[i], aiTeams[j]] = [aiTeams[j], aiTeams[i]];
    }
    const order = this.mode === 'race' ? aiTeams.slice() : [];
    if (this.mode === 'race') order.splice(5, 0, playerTeam); else order.push(playerTeam);
    // AI drivers get random real F1 names; their own RNG keeps the skill and tire draws unchanged
    const nameRng = mulberry((opts.seed || 1337) ^ 0x5bd1e995);
    const names = DRIVERS.slice();
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(nameRng() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }

    // AI pace: from the player's practice best (auto) or a fixed difficulty
    let basePace = DIFFICULTY_PACE.pro;
    if (opts.difficulty === 'auto') {
      if (opts.bestLap) basePace = Math.max(0.6, Math.min(1.0, (this.profile.refTime * AI_LAP_FACTOR * AUTO_EDGE) / opts.bestLap));
    } else basePace = DIFFICULTY_PACE[opts.difficulty] || DIFFICULTY_PACE.pro;
    this.basePace = basePace;

    this.cars = [];
    order.forEach((team, gridIndex) => {
      const isPlayer = team === playerTeam;
      const s = this.mode === 'race' ? -(8 + gridIndex * GRID_SPACING) : -14;
      const lateral = this.mode === 'race' ? (gridIndex % 2 === 0 ? 2.6 : -2.6) : 0;
      const p = track.pointAt(s, lateral);
      const c = createCarState(p.x, p.z, p.heading);
      c.y = p.y;
      c.tc = isPlayer ? opts.tc : 2;
      // the player picks a starting tire; the AI mostly starts on mediums, some gamble on softs
      c.compound = isPlayer ? (COMPOUNDS[opts.startCompound] ? opts.startCompound : 'medium') : (this.rng() < 0.35 ? 'soft' : 'medium');
      c.laps = -1;
      c.team = team;
      c.isPlayer = isPlayer;
      const who = isPlayer ? PLAYER_DRIVER : names.pop();
      c.name = who.name;
      c.code = who.code;
      c.gridIndex = gridIndex;
      c.pit = createPitState(TEAMS.indexOf(team));
      c.finished = false;
      c.finishTime = null;
      c.lastLap = null; c.bestLap = null; c.lapStart = null;
      c.stuck = 0;
      c.mesh = createCarMesh(team.primary, team.secondary);
      this.scene.add(c.mesh);
      const skill = 0.95 + this.rng() * 0.08; // each AI is a little faster or slower, so the field has to pass
      c.driver = createDriver(track.racingLine, this.profile, Math.min(MAX_AI_PACE, basePace * skill), this.profiles);
      c.planPitWear = 0.5 + this.rng() * 0.15; // AI pits once when its tires reach this wear
      this.cars.push(c);
      if (isPlayer) setNextCompound(c, c.compound);
      track.step(c);
      c.timingMark = Math.floor(c.progress / TIMING_STEP);
      c.gapLeader = null;
    });
    this.player = this.cars.find((c) => c.isPlayer);
    this.ranked = this.cars.slice();
    this.pitMessageTimer = 0;
  }

  // ---- input from the app ----
  toggleCamera() { this.cameraMode = this.cameraMode === 'chase' ? 'cockpit' : 'chase'; }
  cycleTC() { cycleTractionControl(this.player); }
  // G: release the stored overtake charge, or press again to save what is left
  toggleOvertake() {
    const p = this.player;
    if (this.overtakeOn) this.overtakeOn = false;
    else if (p.boostAvailable && p.boostEnergy >= BOOST_MIN_ENERGY) this.overtakeOn = true;
  }
  togglePit() {
    if (this.phase === 'racing') togglePitRequest(this.player);
  }
  // 1/2/3: tire for the next stop (still changeable while stopped, until the new set goes on)
  chooseCompound(compound) {
    const p = this.player.pit;
    if (p.phase === 'none' || p.phase === 'enter' || p.phase === 'stopped') setNextCompound(this.player, compound);
  }

  // ---- simulation ----
  update(dt, playerInput) {
    if (this.paused) return;
    this.acc += Math.min(dt, 0.1);
    this.events.length = 0;
    this.updateRanking();
    while (this.acc >= PHYSICS_DT) {
      this.acc -= PHYSICS_DT;
      this.stepWorld(PHYSICS_DT, playerInput);
    }
    this.syncMeshes();
    this.updateCamera(dt);
    this.audio?.setEngine(this.player.speed, playerInput.throttle && this.phase !== 'countdown', this.player.boosting);
  }

  stepWorld(dt, playerInput) {
    if (this.phase === 'countdown') {
      const before = this.countdown;
      this.countdown += dt;
      const litBefore = Math.min(5, Math.floor(before)), lit = Math.min(5, Math.floor(this.countdown));
      if (lit > litBefore) this.audio?.beep(440, 0.15);
      if (this.countdown >= this.goAt) {
        this.phase = 'racing';
        this.clock = 0;
        this.audio?.beep(880, 0.5);
        this.events.push('GO');
      }
    } else {
      this.clock += dt;
    }
    const racing = this.phase !== 'countdown';

    for (const c of this.cars) {
      let input = { throttle: false, brake: false, steer: 0, boost: false };
      if (racing) {
        if (c.isPlayer && !c.finished) input = { ...playerInput, boost: this.overtakeOn };
        else input = this.aiInput(c);
        const pitInput = updatePit(c, this.track, dt);
        if (pitInput) input = pitInput;
      }
      if (this.mode === 'race' && racing) c.boostAvailable = !c.finished && !inPitLane(c);
      else c.boostAvailable = false;
      c.hitBarrier = false;
      stepCar(c, input, dt, c.onTrack);
    }
    // overtake mode switches itself off once the charge runs out
    if (this.overtakeOn && (this.player.boostEnergy <= 0 || !this.player.boostAvailable)) this.overtakeOn = false;
    this.collide();
    for (const c of this.cars) {
      const prevLaps = c.laps;
      this.track.step(c);
      if (c.laps > prevLaps) this.onLapCrossed(c);
      if (this.mode === 'race' && racing && !c.finished) this.timeMark(c);
      if (c.isPlayer && c.hitBarrier) this.audio?.thud(c.speed);
      if (racing && !c.isPlayer) this.unstick(c, dt);
    }
  }

  aiInput(c) {
    const ahead = this.carAhead(c);
    const wantsPit = c.pit.requested && c.pit.phase === 'none';
    // AI pits once, when its tires are worn and there is enough race left
    if (this.mode === 'race' && !c.pit.requested && c.pit.stops === 0 && c.tireWear > c.planPitWear && c.laps < this.totalLaps - 1 && c.laps >= 0) {
      c.pit.requested = true;
      // long way to go: hards; short run to the flag: softs; otherwise mediums
      const lapsLeft = this.totalLaps - c.laps;
      setNextCompound(c, lapsLeft > this.totalLaps * 0.55 ? 'hard' : lapsLeft <= 3 ? 'soft' : 'medium');
    }
    return driveAI(c, c.driver, this.track, ahead, wantsPit);
  }

  carAhead(c) {
    const i = this.ranked.indexOf(c);
    for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
      const o = this.ranked[k];
      if (!inPitLane(o) && o.progress > c.progress) return o;
    }
    return null;
  }

  onLapCrossed(c) {
    if (c.laps < 0) return;
    if (c.lapStart !== null) {
      const t = this.clock - c.lapStart;
      c.lastLap = t;
      if (c.bestLap === null || t < c.bestLap) {
        c.bestLap = t;
        if (c.isPlayer && this.mode === 'practice' && t > this.profile.refTime * 0.6) this.opts.onNewBest?.(t);
      }
      if (c.isPlayer) this.events.push('LAP');
    }
    c.lapStart = this.clock;
    if (this.mode === 'race' && c.laps >= this.totalLaps && !c.finished) {
      c.finished = true;
      c.finishTime = this.clock;
      c.finishPlace = ++this.finishOrder;
      if (c.isPlayer) { this.playerFinishedClock = this.clock; this.events.push('FINISH'); }
    }
    if (this.mode === 'race' && this.player.finished && this.phase === 'racing' && this.clock - this.playerFinishedClock > 3) {
      this.phase = 'finished';
    }
  }

  // AI that has stopped against a barrier is put back on the racing line.
  unstick(c, dt) {
    if (inPitLane(c)) { c.stuck = 0; return; }
    if (Math.abs(c.speed) < 1.5) c.stuck += dt; else c.stuck = 0;
    if (c.stuck > 2.5) {
      const line = this.track.racingLine.pts;
      const i = ((c.driver.idx || 0) + 4) % line.length;
      const a = line[i], b = line[(i + 1) % line.length];
      c.x = a.x; c.z = a.z; c.heading = Math.atan2(b.x - a.x, b.z - a.z);
      c.speed = 10; c.stuck = 0;
      this.track.step(c);
    }
  }

  // Two circles per car (nose and tail) keep nose-to-tail contact believable.
  collide() {
    const cars = this.cars;
    const R = 1.44, OFF = 1.87; // sized to the 1.44x car mesh
    for (let a = 0; a < cars.length; a++) {
      for (let b = a + 1; b < cars.length; b++) {
        const A = cars[a], B = cars[b];
        if (inPitLane(A) || inPitLane(B)) continue;
        const dx0 = B.x - A.x, dz0 = B.z - A.z;
        if (dx0 * dx0 + dz0 * dz0 > 49) continue;
        let hit = false;
        for (const fa of [-OFF, OFF]) {
          for (const fb of [-OFF, OFF]) {
            const ax = A.x + Math.sin(A.heading) * fa, az = A.z + Math.cos(A.heading) * fa;
            const bx = B.x + Math.sin(B.heading) * fb, bz = B.z + Math.cos(B.heading) * fb;
            const dx = ax - bx, dz = az - bz;
            const d = Math.hypot(dx, dz) || 0.001;
            if (d < R * 2) {
              const push = (R * 2 - d) / 2;
              const nx = dx / d, nz = dz / d;
              A.x += nx * push; A.z += nz * push;
              B.x -= nx * push; B.z -= nz * push;
              hit = true;
            }
          }
        }
        if (hit) {
          const [front, back] = A.progress >= B.progress ? [A, B] : [B, A];
          back.speed = Math.min(back.speed, front.speed + 0.5) * 0.985;
          front.speed *= 0.999;
          if (A.isPlayer || B.isPlayer) this.audio?.thud(Math.abs(A.speed - B.speed) + 10);
        }
      }
    }
  }

  // ---- race order and gaps ----
  // Gap to the leader, timed like F1: a car's gap is how long after the first car it crossed its latest timing mark.
  timeMark(c) {
    const mark = Math.floor(c.progress / TIMING_STEP);
    if (mark <= c.timingMark) return;
    c.timingMark = mark;
    if (!this.markTimes.has(mark)) this.markTimes.set(mark, this.clock);
    c.gapLeader = this.clock - this.markTimes.get(mark);
  }

  // A slow or stopped car's gap keeps growing once the leader has crossed its next mark.
  liveGap(c) {
    const next = this.markTimes.get(c.timingMark + 1);
    return next === undefined ? c.gapLeader : Math.max(c.gapLeader ?? 0, this.clock - next);
  }

  // Leaderboard rows, in race order.
  standings() {
    const L = this.track.length;
    const leaderProgress = Math.min(this.ranked[0].progress, this.totalLaps * L);
    return this.ranked.map((c, i) => ({
      code: c.code,
      team: c.team,
      isPlayer: c.isPlayer,
      gap: i === 0 ? null : c.finished ? c.finishTime - this.ranked[0].finishTime : this.liveGap(c),
      lapsDown: c.finished ? 0 : Math.max(0, Math.floor((leaderProgress - c.progress) / L)),
      inPit: c.pit.phase !== 'none',
      compound: c.compound,
    }));
  }

  updateRanking() {
    this.ranked = this.cars.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    this.ranked.forEach((c, i) => {
      c.position = i + 1;
      const ahead = this.ranked[i - 1];
      c.gapAhead = ahead ? Math.max(0, (ahead.progress - c.progress) / Math.max(c.speed, 20)) : null;
    });
    this.ranked.forEach((c, i) => {
      const behind = this.ranked[i + 1];
      c.gapBehind = behind ? Math.max(0, (c.progress - behind.progress) / Math.max(behind.speed, 20)) : null;
    });
  }

  // ---- visuals ----
  syncMeshes() {
    for (const c of this.cars) {
      c.mesh.position.set(c.x, c.y, c.z);
      c.mesh.rotation.y = c.heading;
      c.mesh.rotation.x = -Math.atan(c.slope);
      c.mesh.visible = !(c.isPlayer && this.cameraMode === 'cockpit');
    }
    if (this.headlight) this.headlight.position.set(this.player.x, this.player.y + 8, this.player.z);
  }

  snapCamera() {
    const c = this.player;
    this.camera.position.set(c.x - Math.sin(c.heading) * 9, c.y + 3.5, c.z - Math.cos(c.heading) * 9);
    this.updateCamera(1);
  }

  updateCamera(dt) {
    const c = this.player;
    const sin = Math.sin(c.heading), cos = Math.cos(c.heading);
    const cam = this.camera;
    if (this.cameraMode === 'cockpit') {
      cam.fov = 85;
      cam.position.set(c.x + sin * 0.86, c.y + 1.66, c.z + cos * 0.86);
      cam.lookAt(c.x + sin * 40, c.y + 1.44 + c.slope * 40 * 0.5, c.z + cos * 40);
    } else {
      // widen the view with speed, and kick it out further while boosting
      this.fovBoost += ((c.boosting ? 10 : 0) - this.fovBoost) * Math.min(1, dt * 4);
      cam.fov = 70 + Math.min(12, Math.abs(c.speed) * 0.12) + this.fovBoost;
      const target = new THREE.Vector3(c.x - sin * 9, c.y + 3.5, c.z - cos * 9);
      cam.position.lerp(target, 1 - Math.exp(-6 * dt));
      cam.lookAt(c.x + sin * 6, c.y + 1, c.z + cos * 6);
    }
    cam.updateProjectionMatrix();
  }

  // ---- state for the HUD ----
  hudState() {
    const p = this.player;
    const lapNumber = Math.max(1, Math.min(p.laps + 1, this.totalLaps));
    return {
      mode: this.mode,
      phase: this.phase,
      lights: this.phase === 'countdown' ? Math.min(5, Math.floor(this.countdown)) : 0,
      speed: p.speed,
      lap: lapNumber,
      totalLaps: this.totalLaps,
      position: p.position,
      carCount: this.cars.length,
      gapAhead: p.gapAhead,
      gapBehind: p.gapBehind,
      aheadTeam: this.ranked[p.position - 2]?.team,
      behindTeam: this.ranked[p.position]?.team,
      aheadCode: this.ranked[p.position - 2]?.code,
      behindCode: this.ranked[p.position]?.code,
      standings: this.mode === 'race' ? this.standings() : null,
      cars: this.cars.map((c) => ({ x: c.x, z: c.z, primary: c.team.primary, secondary: c.team.secondary, isPlayer: c.isPlayer })),
      lapTime: p.lapStart === null ? 0 : this.clock - p.lapStart,
      lastLap: p.lastLap,
      bestLap: p.bestLap,
      tc: p.tc,
      slip: p.slip,
      tireWear: p.tireWear,
      boostEnergy: p.boostEnergy,
      boostReady: p.boostAvailable && p.boostEnergy >= BOOST_MIN_ENERGY,
      overtakeOn: this.overtakeOn,
      boosting: p.boosting,
      pit: {
        requested: p.pit.requested, phase: p.pit.phase, timer: p.pit.timer, time: PIT_STOP_TIME, stops: p.pit.stops,
        next: p.pit.nextCompound,
        // metres to the pit entry along the lap
        toEntry: ((this.track.pit.entryS - p.s) % this.track.length + this.track.length) % this.track.length,
      },
      compound: p.compound,
      finished: p.finished,
      trackName: this.track.name,
      team: p.team,
    };
  }

  // Final classification for the results screen.
  results() {
    const winner = this.ranked[0];
    const L = this.track.length;
    return this.ranked.map((c, i) => {
      let note;
      if (c.finished) note = i === 0 ? c.finishTime : c.finishTime - winner.finishTime;
      else {
        const remaining = this.totalLaps * L - c.progress;
        const lapsDown = Math.ceil(remaining / L) - 1;
        const est = this.clock + remaining / Math.max(c.speed, 40) - (winner.finishTime ?? this.clock);
        note = lapsDown >= 1 ? `+${lapsDown} lap${lapsDown > 1 ? 's' : ''}` : est;
      }
      return { position: i + 1, team: c.team, name: c.name, isPlayer: c.isPlayer, finished: c.finished, time: i === 0 ? winner.finishTime : null, gap: i === 0 ? null : note, bestLap: c.bestLap, stops: c.pit.stops };
    });
  }

  dispose() {
    // car geometry is shared between sessions; track and scenery geometry is not
    this.scene.traverse((o) => { if (o.geometry && o.parent === this.track.mesh) o.geometry.dispose(); });
  }
}
