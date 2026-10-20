// localStorage can be unavailable (private mode, blocked site data); everything here fails soft.
const PREFIX = 'f1retro.';

function read(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* ignore */ }
}

export const loadSettings = (defaults) => ({ ...defaults, ...read('settings', {}) });
export const saveSettings = (s) => write('settings', s);
export const getBestLap = (trackId) => read(`best.${trackId}`, null);
export const setBestLap = (trackId, t) => write(`best.${trackId}`, t);
export const getFlag = (name) => read(`flag.${name}`, false);
export const setFlag = (name) => write(`flag.${name}`, true);
