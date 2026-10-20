// Las Vegas is not in the TUM database. This builds an approximate centerline from hand-placed
// corner points (a simplified trace of the street-circuit layout: long Strip straight, tight
// 90-degree corners) and writes it as TUM-format CSVs, which import-track.js then converts.
// Coordinates are metres, x east / y north, driven anticlockwise. Replace with OpenStreetMap
// data for an exact layout (credit "(c) OpenStreetMap contributors" if you do).
import fs from 'node:fs';

// [x, y, fillet radius]
const corners = [
  [1300, 600, 40],   // end of Koval Lane section, start/finish straight heads north
  [1300, 2000, 35],
  [1000, 2000, 30],
  [1000, 2350, 35],
  [700, 2350, 60],   // small kink on the north side
  [640, 2290, 60],
  [300, 2290, 40],   // onto the Strip, heading south
  [300, 1650, 60],   // chicane
  [350, 1580, 60],
  [350, 1400, 60],
  [300, 1330, 60],
  [300, 350, 40],
  [850, 350, 30],
  [850, 520, 25],
  [900, 560, 25],
  [900, 600, 30],
];

const SPACING = 5;
const SCALE = 1.06; // stretch the hand-placed layout to the real ~6.2 km lap
for (const c of corners) { c[0] *= SCALE; c[1] *= SCALE; c[2] *= SCALE; }
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// Build the dense polyline: straight edges joined by quadratic Bezier fillets.
const dense = [];
const n = corners.length;
for (let i = 0; i < n; i++) {
  const prev = corners[(i - 1 + n) % n], c = corners[i], next = corners[(i + 1) % n];
  const lenIn = dist(prev, c), lenOut = dist(c, next);
  const r = Math.min(c[2], lenIn / 2.2, lenOut / 2.2);
  const a = [c[0] + (prev[0] - c[0]) * r / lenIn, c[1] + (prev[1] - c[1]) * r / lenIn];
  const b = [c[0] + (next[0] - c[0]) * r / lenOut, c[1] + (next[1] - c[1]) * r / lenOut];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    dense.push([
      (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
      (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
    ]);
  }
}

// Resample to even spacing, closed loop.
const cum = [0];
for (let i = 1; i <= dense.length; i++) cum.push(cum[i - 1] + dist(dense[i - 1], dense[i % dense.length]));
const total = cum[cum.length - 1];
const count = Math.round(total / SPACING);
const pts = [];
let seg = 0;
for (let k = 0; k < count; k++) {
  const s = (k / count) * total;
  while (cum[seg + 1] < s) seg++;
  const t = (s - cum[seg]) / (cum[seg + 1] - cum[seg]);
  const p = dense[seg], q = dense[(seg + 1) % dense.length];
  pts.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
}

// Start/finish: ~120 m up the first straight.
const shift = Math.round(120 / (total / count));
const ordered = pts.slice(shift).concat(pts.slice(0, shift));

// Racing line: heavily smoothed centerline so the AI cuts corners a little.
let line = ordered.map((p) => p.slice());
for (let pass = 0; pass < 2; pass++) {
  line = line.map((_, i) => {
    let x = 0, y = 0;
    for (let k = -3; k <= 3; k++) { const q = line[(i + k + count) % count]; x += q[0]; y += q[1]; }
    return [x / 7, y / 7];
  });
}
const maxDev = Math.max(...line.map((p, i) => dist(p, ordered[i])));

const W = 6.5; // half-width of a street circuit
const csv = (rows) => rows.map((r) => r.map((v) => v.toFixed(3)).join(',')).join('\n') + '\n';
fs.writeFileSync('raw/LasVegas.csv', '# x_m,y_m,w_tr_right_m,w_tr_left_m\n' + csv(ordered.map(([x, y]) => [x, y, W, W])));
fs.writeFileSync('raw/LasVegas_line.csv', '# x_m,y_m\n' + csv(line));
console.log(`Las Vegas: ${count} points, ${(total / 1000).toFixed(2)} km, racing line max deviation ${maxDev.toFixed(1)} m`);
