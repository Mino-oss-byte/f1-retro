import { TEAMS } from '../data/teams.js';
import { TRACKS, TRACK_INFO, trackLength } from '../data/tracks/index.js';
import { TC_LEVELS, COMPOUNDS, COMPOUND_ORDER } from '../car/carPhysics.js';
import { getBestLap } from '../storage.js';
import { formatTime, escapeHtml } from './format.js';
import { CONTROLS } from './hud.js';

const root = document.getElementById('menu');
const lengths = Object.fromEntries(TRACKS.map((t) => [t.id, trackLength(t)]));

function show(html, style = 'backdrop') {
  root.className = style;
  root.innerHTML = html;
  root.querySelector('button')?.focus();
}

export function hideMenu() {
  root.className = '';
  root.innerHTML = '';
}

function bind(handlers) {
  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', () => handlers[b.dataset.act]?.(b.dataset.val));
  });
}

export function titleScreen(app) {
  show(`<div class="screen title-screen">
    <h1>F1-RETRO</h1>
    <p class="hint">A low-poly formula racer</p>
    <p class="press">PRESS ENTER</p>
    <div class="btn-col" style="margin-top:20px"><button class="primary" data-act="go">START</button></div>
  </div>`);
  bind({ go: () => app.modeSelect() });
}

export function modeScreen(app) {
  show(`<div class="screen">
    <h2>SELECT MODE</h2>
    <div class="btn-col">
      <button class="primary" data-act="mode" data-val="practice">PRACTICE<br><span class="hint">Alone on track, set your best lap</span></button>
      <button class="primary" data-act="mode" data-val="race">RACE<br><span class="hint">12 cars, one per team</span></button>
      <button data-act="credits">CREDITS</button>
      <button data-act="back">BACK</button>
    </div>
  </div>`);
  bind({ mode: (m) => app.garage(m), credits: () => app.credits(), back: () => app.title() });
}

export function garageScreen(app, mode, settings) {
  const race = mode === 'race';
  const opt = (key, value, label) =>
    `<button data-act="set" data-val="${key}:${value}" class="${String(settings[key]) === String(value) ? 'sel' : ''}">${label}</button>`;

  const tracks = TRACKS.map((t) => {
    const info = TRACK_INFO[t.id];
    const best = getBestLap(t.id);
    return `<button data-act="set" data-val="trackId:${t.id}" class="${settings.trackId === t.id ? 'sel' : ''}">
      ${escapeHtml(t.name)}<small>${info.country} · ${(lengths[t.id] / 1000).toFixed(2)} km · ${info.turns} turns</small>
      <small>${info.note}</small><small>BEST ${formatTime(best)}</small></button>`;
  }).join('');

  const teams = TEAMS.map((t) =>
    `<button data-act="set" data-val="teamId:${t.id}" class="${settings.teamId === t.id ? 'sel' : ''}">
      <span class="swatch" style="background:linear-gradient(90deg, ${t.primary} 55%, ${t.secondary} 55%)"></span>${escapeHtml(t.name)}</button>`).join('');

  const best = getBestLap(settings.trackId);
  const autoNote = best ? `AUTO uses your practice best (${formatTime(best)})` : 'AUTO: no practice lap on this track yet, plays like PRO';

  show(`<div class="screen">
    <h2>GARAGE · ${race ? 'RACE' : 'PRACTICE'}</h2>
    <h3>TRACK</h3><div class="tracks">${tracks}</div>
    <h3>TEAM (all cars perform the same)</h3><div class="teams">${teams}</div>
    <h3>STARTING TIRE</h3><div class="opts">${COMPOUND_ORDER.map((c) => opt('startCompound', c, COMPOUNDS[c].name)).join('')}</div>
    <p class="hint">SOFT: +10% top speed, wears 20% faster · MEDIUM: balanced · HARD: -8% top speed, wears 20% slower. Press 1/2/3 in a pit stop to change.</p>
    <h3>TRACTION CONTROL</h3><div class="opts">${TC_LEVELS.map((l, i) => opt('tc', i, l.name)).join('')}</div>
    ${race ? `
      <h3>AI DIFFICULTY</h3><div class="opts">${opt('difficulty', 'auto', 'AUTO')}${opt('difficulty', 'rookie', 'ROOKIE')}${opt('difficulty', 'pro', 'PRO')}${opt('difficulty', 'legend', 'LEGEND')}</div>
      <p class="hint">${autoNote}</p>
      <h3>RACE LENGTH</h3><div class="opts">${opt('laps', 5, '5 LAPS')}${opt('laps', 10, '10 LAPS')}${opt('laps', 15, '15 LAPS')}</div>` : ''}
    <div class="btn-row"><button class="primary" data-act="start">START ${race ? 'RACE' : 'PRACTICE'}</button><button data-act="back">BACK</button></div>
  </div>`);

  bind({
    set: (v) => {
      const [k, val] = v.split(':');
      settings[k] = k === 'tc' || k === 'laps' ? Number(val) : val;
      app.saveSettings();
      const scroll = root.scrollTop;
      garageScreen(app, mode, settings);
      root.scrollTop = scroll;
    },
    start: () => app.start(mode),
    back: () => app.modeSelect(),
  });
  root.querySelector('[data-act=start]')?.focus();
}

export function loadingScreen(trackName) {
  show(`<div class="screen title-screen"><h2>LOADING ${escapeHtml(trackName.toUpperCase())}...</h2></div>`);
}

export function pauseScreen(app) {
  show(`<div class="screen" style="max-width:520px">
    <h2>PAUSED</h2>
    <div class="btn-col">
      <button class="primary" data-act="resume">RESUME</button>
      <button data-act="restart">RESTART</button>
      <button data-act="quit">QUIT TO MENU</button>
    </div>
    <h3>CONTROLS</h3>
    <table>${CONTROLS.map(([k, a]) => `<tr><td>${k}</td><td>${a}</td></tr>`).join('')}</table>
  </div>`, 'overlay');
  bind({ resume: () => app.resume(), restart: () => app.restart(), quit: () => app.quit() });
}

export function resultsScreen(app, results, trackName) {
  const rows = results.map((r) => {
    const gap = r.position === 1 ? formatTime(r.time) : typeof r.gap === 'number' ? `+${r.gap.toFixed(3)}s` : r.gap;
    return `<tr class="${r.isPlayer ? 'me' : ''}"><td>${r.position}</td>
      <td><span class="swatch" style="display:inline-block;vertical-align:middle;margin-right:8px;background:linear-gradient(90deg, ${r.team.primary} 55%, ${r.team.secondary} 55%)"></span>${escapeHtml(r.isPlayer ? 'YOU' : r.name)} <span class="hint">${escapeHtml(r.team.name)}</span></td>
      <td>${gap}</td><td>${formatTime(r.bestLap)}</td><td>${r.stops}</td></tr>`;
  }).join('');
  show(`<div class="screen">
    <h2>RESULTS · ${escapeHtml(trackName.toUpperCase())}</h2>
    <table><tr><th>POS</th><th>DRIVER</th><th>TIME / GAP</th><th>BEST LAP</th><th>PITS</th></tr>${rows}</table>
    <div class="btn-row"><button class="primary" data-act="restart">RACE AGAIN</button><button data-act="garage">GARAGE</button><button data-act="quit">MAIN MENU</button></div>
  </div>`);
  bind({ restart: () => app.restart(), garage: () => app.garage('race'), quit: () => app.quit() });
}

export function creditsScreen(app) {
  show(`<div class="screen credits">
    <h2>CREDITS</h2>
    <p>Coded by Mino.</p>
    <p>Inspired by Tulane Formula Racing.</p>
    <p>Track layouts for Silverstone, Albert Park, COTA and Spa-Francorchamps:
      <a href="https://github.com/TUMFTM/racetrack-database" target="_blank" rel="noopener">TUM racetrack database</a>
      (Technical University of Munich, LGPL-3.0).</p>
    <p>Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>.</p>
    <p>Las Vegas layout traced by hand as a simplified approximation.</p>
    <p>Elevation for COTA and Spa added by hand.</p>
    <p>3D rendering: <a href="https://threejs.org" target="_blank" rel="noopener">Three.js</a>.</p>
    <p>Font: Press Start 2P by CodeMan38.</p>
    <p class="hint">Team names and colors only. No logos, sponsors or real liveries.</p>
    <div class="btn-row"><button data-act="back">BACK</button></div>
  </div>`);
  bind({ back: () => app.modeSelect() });
}
