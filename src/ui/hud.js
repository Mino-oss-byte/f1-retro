import { formatTime, formatGap, escapeHtml } from './format.js';
import { TC_LEVELS, COMPOUNDS, COMPOUND_ORDER } from '../car/carPhysics.js';

const $ = (id) => document.getElementById(id);
const el = {
  root: $('hud'), pos: $('hud-pos'), lap: $('hud-lap'), gaps: $('hud-gaps'),
  time: $('hud-time'), last: $('hud-last'), best: $('hud-best'),
  lights: $('hud-lights'), msg: $('hud-msg'), speed: $('hud-speed'),
  tires: $('hud-tires'), tiresTxt: $('hud-tires-txt'), boost: $('hud-boost'), boostTxt: $('hud-boost-txt'),
  tc: $('hud-tc'), controls: $('hud-controls'), boostCall: $('hud-boostcall'),
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

export function updateHud(s, events, now) {
  const race = s.mode === 'race';

  set(el.pos, race ? `P${s.position}<span style="font-size:11px">/${s.carCount}</span>` : 'PRACTICE');
  set(el.lap, race ? `LAP ${s.lap}/${s.totalLaps}` : `LAP ${s.lap}`);
  set(el.gaps, race && s.phase !== 'countdown'
    ? [s.gapAhead !== null ? `<div>${chip(s.aheadTeam)}AHEAD +${formatGap(s.gapAhead)}</div>` : '<div>LEADING</div>',
      s.gapBehind !== null ? `<div>${chip(s.behindTeam)}BEHIND -${formatGap(s.gapBehind)}</div>` : ''].join('')
    : '');

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
