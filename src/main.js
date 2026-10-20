import * as THREE from 'three';
import { getInput, wasPressed, clearPressed } from './input.js';
import { Session } from './game/session.js';
import { TRACKS } from './data/tracks/index.js';
import { DEFAULT_TEAM } from './data/teams.js';
import { Audio } from './audio.js';
import { loadSettings, saveSettings, getBestLap, setBestLap, getFlag, setFlag } from './storage.js';
import { updateHud, showHud, showControls } from './ui/hud.js';
import {
  titleScreen, modeScreen, garageScreen, loadingScreen, pauseScreen, resultsScreen, creditsScreen, hideMenu,
} from './ui/menus.js';

const RENDER_WIDTH = 480;
const RENDER_HEIGHT = 270;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
// Low internal resolution; CSS scales the canvas up with pixelated sampling.
renderer.setPixelRatio(1);
renderer.setSize(RENDER_WIDTH, RENDER_HEIGHT, false);

const audio = new Audio();
const settings = loadSettings({ trackId: 'silverstone', teamId: DEFAULT_TEAM, tc: 1, difficulty: 'auto', laps: 5, startCompound: 'medium', muted: false });
audio.setMuted(settings.muted);

let session = null;
let lastMode = 'practice';
let screen = 'title';

const app = {
  title() { screen = 'title'; titleScreen(app); },
  modeSelect() { screen = 'menu'; modeScreen(app); },
  garage(mode) { screen = 'menu'; lastMode = mode; endSession(); garageScreen(app, mode, settings); },
  credits() { screen = 'menu'; creditsScreen(app); },
  saveSettings() { saveSettings(settings); },
  start(mode) {
    lastMode = mode;
    const trackData = TRACKS.find((t) => t.id === settings.trackId) || TRACKS[0];
    loadingScreen(trackData.name);
    // let the loading screen paint before the (synchronous) track build
    setTimeout(() => startSession(mode, trackData), 30);
  },
  resume() {
    if (!session) return;
    session.paused = false;
    screen = 'game';
    hideMenu();
    clearPressed();
  },
  restart() { app.start(lastMode); },
  quit() { endSession(); app.modeSelect(); },
};

function startSession(mode, trackData) {
  endSession();
  session = new Session({
    trackData,
    mode,
    teamId: settings.teamId,
    tc: settings.tc,
    startCompound: settings.startCompound,
    difficulty: settings.difficulty,
    laps: settings.laps,
    bestLap: getBestLap(trackData.id),
    seed: Math.floor(Math.random() * 1e9),
    onNewBest: (t) => {
      const prev = getBestLap(trackData.id);
      if (prev === null || t < prev) setBestLap(trackData.id, t);
    },
  }, audio);
  screen = 'game';
  hideMenu();
  showHud(true);
  showControls(mode === 'practice' && !getFlag('seenControls'));
  clearPressed();
}

function endSession() {
  if (!session) return;
  if (session.mode === 'practice') setFlag('seenControls');
  session.dispose();
  session = null;
  showHud(false);
  showControls(false);
  audio.silence();
}

// Keys that work on menu screens.
window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (screen === 'title' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); app.modeSelect(); }
});
window.addEventListener('pointerdown', () => audio.unlock());

let last = performance.now();
let elapsed = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  elapsed += dt;

  if (wasPressed('KeyM')) {
    settings.muted = !settings.muted;
    audio.setMuted(settings.muted);
    saveSettings(settings);
  }

  if (session) {
    if (screen === 'game') {
      if (wasPressed('Escape')) {
        session.paused = true;
        screen = 'pause';
        audio.silence();
        pauseScreen(app);
      }
      if (wasPressed('KeyT')) session.cycleTC();
      if (wasPressed('KeyG')) session.toggleOvertake();
      if (wasPressed('KeyB')) session.togglePit();
      if (wasPressed('Digit1')) session.chooseCompound('soft');
      if (wasPressed('Digit2')) session.chooseCompound('medium');
      if (wasPressed('Digit3')) session.chooseCompound('hard');
      if (wasPressed('KeyC')) session.toggleCamera();

      session.update(dt, getInput());
      const state = session.hudState();
      updateHud(state, session.events, elapsed);
      if (state.lastLap !== null) showControls(false);

      if (session.phase === 'finished') {
        screen = 'results';
        audio.silence();
        resultsScreen(app, session.results(), session.track.name);
      }
    } else if (screen === 'pause' && wasPressed('Escape')) {
      app.resume();
    }
    renderer.render(session.scene, session.camera);
  } else {
    renderBackdrop();
  }
  requestAnimationFrame(frame);
}

// Behind the menus the canvas is just cleared; the menu CSS draws the backdrop.
function renderBackdrop() {
  renderer.setClearColor(0x07080d);
  renderer.clear();
}

app.title();
requestAnimationFrame(frame);
