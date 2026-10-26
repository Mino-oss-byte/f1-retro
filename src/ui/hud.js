import { formatTime, formatGap, escapeHtml } from './format.js';
import { TC_LEVELS, COMPOUNDS, COMPOUND_ORDER } from '../car/carPhysics.js';

const $ = (id) => document.getElementById(id);
const el = {
  root: $('hud'), pos: $('hud-pos'), lap: $('hud-lap'), gaps: $('hud-gaps'),
  time: $('hud-time'), last: $('hud-last'), best: $('hud-best'),
  lights: $('hud-lights'), msg: $('hud-msg'), speed: $('hud-speed'),
  tires: $('hud-tires'), tiresTxt: $('hud-tires-txt'), boost: $('hud-boost'), boostTxt: $('hud-boost-txt'),
  tc: $('hud-tc'), controls: $('hud-controls'), boostCall: $('hud-boostcall'),
  tower: $('hud-tower'), map: $('hud-map'),
  pit: $('hud-pit'), pitStatus: $('hud-pit-status'), pitTires: $('hud-pit-tires'), compound: $('hud-compound'),
};

export const CONTROLS = [
  ['W', 'Throttle'], ['S', 'Brake / reverse'], ['A / D', 'Steer'], ['G', 'Overtake (brake in turns to charge)'],
  ['B', 'Request pit stop'], ['1/2/3', 'Pit tire: soft / medium / hard'], ['T', 'Traction control'], ['C', 'Camera'], ['M', 'Mute'], ['Esc', 'Pause'],
];
el.controls.innerHTML = CONTROLS.map(([k, a]) => `<div><b>${k}</b> ${a}</div>`).join('');

let flash = { text: '', until: 0 };
const set = (node, html) => { if (node.innerHTML !== html) node.innerHTML = html; };
const chip = (team) => team ? `<span class="chip" style="background:${team.primary}"></span>` : '';

export function showHud(visible) { el.root.hidden = !visible; }
export function showControls(visible) { el.controls.hidden = !visible; }

// F1-style timing tower: position, team color, driver code, gap to the leader, tire.
function towerHtml(s) {
  const rows = s.standings.map((r, i) => {
    let gap;
    if (r.inPit) gap = '<span class="pit">PIT</span>';
    else if (i === 0) gap = 'LEADER';
    else if (r.lapsDown > 0) gap = `+${r.lapsDown} LAP${r.lapsDown > 1 ? 'S' : ''}`;
    else gap = r.gap === null ? '' : `+${r.gap.toFixed(1)}`;
    const cmp = COMPOUNDS[r.compound];
    return `<div class="row${r.isPlayer ? ' me' : ''}"><b>${i + 1}</b><i style="background:linear-gradient(${r.team.primary} 60%, ${r.team.secondary} 60%)"></i><span class="code">${escapeHtml(r.code)}</span><span class="gap">${gap}</span><span class="tyre" style="color:${cmp.color}">${cmp.letter}</span></div>`;
  }).join('');
  return `<div class="head">LAP ${s.lap}/${s.totalLaps}</div>${rows}`;
}

// ---- minimap: the track outline is drawn once per session, the car dots every frame ----
const MAP_PAD = 14;
let map = null;

export function setMinimapTrack(centerline) {
  const xs = centerline.map((p) => p[0]), zs = centerline.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const size = el.map.width;
  const scale = (size - MAP_PAD * 2) / Math.max(maxX - minX, maxZ - minZ);
  // centre the track in the square; game x is screen right and game z is screen down
  const ox = (size - (maxX - minX) * scale) / 2 - minX * scale;
  const oz = (size - (maxZ - minZ) * scale) / 2 - minZ * scale;
  const toMap = (x, z) => [ox + x * scale, oz + z * scale];
  const path = new Path2D();
  centerline.forEach(([x, z], i) => { const [px, pz] = toMap(x, z); i ? path.lineTo(px, pz) : path.moveTo(px, pz); });
  path.closePath();
  // start/finish: a short tick across the track at the first point
  const [ax, az] = toMap(...centerline[0]), [bx, bz] = toMap(...centerline[1]);
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const finish = { x: ax, z: az, nx: -(bz - az) / len, nz: (bx - ax) / len };
  map = { toMap, path, finish };
}

function drawMap(cars, now) {
  if (!map) return;
  const ctx = el.map.getContext('2d');
  ctx.clearRect(0, 0, el.map.width, el.map.height);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'; ctx.lineWidth = 7; ctx.stroke(map.path);
  ctx.strokeStyle = '#c9ced8'; ctx.lineWidth = 3; ctx.stroke(map.path);
  const f = map.finish;
  ctx.strokeStyle = '#e2332b'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(f.x - f.nx * 7, f.z - f.nz * 7); ctx.lineTo(f.x + f.nx * 7, f.z + f.nz * 7); ctx.stroke();
  // AI first, then the player on top
  for (const c of [...cars.filter((c) => !c.isPlayer), ...cars.filter((c) => c.isPlayer)]) {
    const [x, z] = map.toMap(c.x, c.z);
    ctx.beginPath();
    ctx.arc(x, z, c.isPlayer ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = c.primary; ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.isPlayer ? (Math.floor(now * 3) % 2 ? '#ffcc33' : '#ffffff') : c.secondary;
    ctx.stroke();
  }
}

export function updateHud(s, events, now) {
  const race = s.mode === 'race';

  set(el.pos, race ? `P${s.position}<span style="font-size:11px">/${s.carCount}</span>` : 'PRACTICE');
  set(el.lap, race ? `LAP ${s.lap}/${s.totalLaps}` : `LAP ${s.lap}`);
  set(el.gaps, race && s.phase !== 'countdown'
    ? [s.gapAhead !== null ? `<div>${chip(s.aheadTeam)}${s.aheadCode} +${formatGap(s.gapAhead)}</div>` : '<div>LEADING</div>',
      s.gapBehind !== null ? `<div>${chip(s.behindTeam)}${s.behindCode} -${formatGap(s.gapBehind)}</div>` : ''].join('')
    : '');

  el.tower.hidden = !race;
  if (race) set(el.tower, towerHtml(s));
  drawMap(s.cars, now);

  set(el.time, formatTime(s.lapTime));
  set(el.last, `LAST ${formatTime(s.lastLap)}`);
  set(el.best, `BEST ${formatTime(s.bestLap)}`);

  // start lights
  el.lights.hidden = s.phase !== 'countdown';
  if (s.phase === 'countdown') [...el.lights.children].forEach((d, i) => d.classList.toggle('on', i < s.lights));

  set(el.speed, `${Math.round(Math.abs(s.speed) * 3.6)}<span style="font-size:11px"> KM/H</span>`);

  const life = 1 - s.tireWear;
  el.tires.style.width = `${life * 100}%`;
  el.tires.style.background = life > 0.5 ? '#3ddc5a' : life > 0.25 ? '#ffcc33' : '#e2332b';
  set(el.tiresTxt, `${Math.round(life * 100)}%`);
  const cmp = COMPOUNDS[s.compound];
  el.compound.style.background = cmp.color;
  set(el.compound, cmp.letter);

  // pit panel: where the entry is and which tires go on
  const pit = s.pit;
  const pitActive = pit.requested || pit.phase !== 'none';
  el.pit.hidden = !pitActive;
  if (pitActive) {
    let status;
    if (pit.phase === 'stopped') status = `PIT STOP ${Math.max(0, pit.time - pit.timer).toFixed(1)}s`;
    else if (pit.phase === 'exit') status = 'PIT EXIT';
    else if (pit.phase === 'enter') status = 'PIT LANE · LIMITER ON';
    else status = pit.toEntry < 400 ? `KEEP LEFT · PIT ENTRY ${Math.round(pit.toEntry)} M` : `PIT REQUESTED · ENTRY ${Math.round(pit.toEntry)} M`;
    set(el.pitStatus, status);
    el.pitStatus.classList.toggle('blink', pit.phase === 'none' && pit.toEntry < 400);
    const choosing = pit.phase !== 'exit';
    set(el.pitTires, choosing
      ? 'NEXT TIRE ' + COMPOUND_ORDER.map((c, i) => `<span class="${pit.next === c ? 'sel' : ''}" style="${pit.next === c ? `background:${COMPOUNDS[c].color}` : ''}">[${i + 1}] ${COMPOUNDS[c].name}</span>`).join('')
      : `FITTED ${COMPOUNDS[s.compound].name}`);
  }

  el.boost.style.width = `${s.boostEnergy * 100}%`;
  set(el.boostTxt, !race ? '' : s.boosting ? '<span style="color:#38c8ff">BOOST!</span>'
    : s.boostReady ? '<span style="color:#ffcc33">READY [G]</span>' : '<span style="color:#666">BRAKE IN TURNS</span>');

  // big overtake prompt in the middle of the screen: while it runs, and once the bar is full
  const charged = race && s.boostReady && s.boostEnergy >= 0.999 && !s.finished;
  el.boostCall.hidden = !(s.overtakeOn || charged);
  el.boostCall.classList.toggle('active', s.overtakeOn);
  el.boostCall.classList.toggle('ready', !s.overtakeOn && charged);
  set(el.boostCall, s.overtakeOn ? `OVERTAKE +15% · ${Math.round(s.boostEnergy * 100)}%` : 'OVERTAKE CHARGED · PRESS G');

  set(el.tc, `TC ${TC_LEVELS[s.tc].name}${s.slip > 0.3 ? ' <span style="color:#ffcc33">SPIN</span>' : ''}`);

  // centre message: events flash briefly, otherwise persistent state
  for (const e of events) {
    if (e === 'GO') flash = { text: 'GO!', until: now + 1.2 };
    if (e === 'LAP' && s.lastLap) flash = { text: `LAP ${formatTime(s.lastLap)}`, until: now + 2 };
    if (e === 'FINISH') flash = { text: `FINISHED P${s.position}`, until: now + 4 };
  }
  let msg = '';
  if (now < flash.until) msg = flash.text;
  else if (s.finished) msg = `FINISHED P${s.position}`;
  set(el.msg, escapeHtml(msg));
}
