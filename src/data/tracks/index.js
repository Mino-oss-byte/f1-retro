import silverstone from './silverstone.js';
import albertpark from './albertpark.js';
import lasvegas from './lasvegas.js';
import cota from './cota.js';
import spa from './spa.js';

// In build order (see Game Project.md section 10).
export const TRACKS = [silverstone, albertpark, lasvegas, cota, spa];

// Shown in the garage. Lengths are computed from the data; these are the real-world facts.
export const TRACK_INFO = {
  silverstone: { country: 'UK', turns: 18, note: 'Fast and flowing. Day, overcast.' },
  albertpark: { country: 'Australia', turns: 14, note: 'Around a lake in a park. Day, sunny.' },
  lasvegas: { country: 'USA', turns: 17, note: 'Night street circuit. Long Strip straight.' },
  cota: { country: 'USA', turns: 20, note: 'Steep climb to Turn 1, rolling after.' },
  spa: { country: 'Belgium', turns: 19, note: 'Eau Rouge, Raidillon, ~100 m of elevation.' },
};

export function trackLength(data) {
  const c = data.centerline;
  let L = 0;
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}
