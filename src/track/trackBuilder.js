import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { THEMES } from './themes.js';

const PIT_RAMP = 10;       // points for the entry/exit flare
const PIT_BOX_SPACING = 5; // points between garage boxes
const PIT_SPEED = 22;      // m/s pit lane limit (~80 km/h)
const STAND_LENGTH = 36;
const STAND_SPACING = 42;  // m along the track between grandstands
const STAND_GAP = 14;      // m between apron edge and the stand front
const APRON_TURN_ANGLE = 0.04; // rad between neighbouring segments that counts as a turn
const GROUND_DROP = 0.4;   // m the flat ground plane sits below the lowest road point
const VERGE_DROP = 0.25;   // m the hillside verges sit below the road edge

// Collects many small meshes and merges them per material, so scenery costs a few draw calls.
class Batch {
  constructor() { this.map = new Map(); }
  add(material, geometry, matrix) {
    const g = geometry.clone().applyMatrix4(matrix);
    if (!this.map.has(material)) this.map.set(material, []);
    this.map.get(material).push(g);
  }
  build(group) {
    for (const [material, geos] of this.map) {
      if (!geos.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(geos), material);
      group.add(mesh);
      geos.forEach((g) => g.dispose());
    }
  }
}

const rand = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();

// Builds everything the game needs from a track data file (see scripts/import-track.js).
export function createTrack(data) {
  const theme = THEMES[data.theme];
  const APRON_WIDTH = theme.apron;
  const n = data.centerline.length;
  const pts = data.centerline.map(([x, z]) => ({ x, z }));
  const wl = data.widthLeft;
  const wr = data.widthRight;
  const elev = data.elevation || new Array(n).fill(0);
  const relief = Math.max(...elev) - Math.min(...elev);
  const baseY = Math.min(...elev);

  // segment lengths and cumulative arc length
  const segLen = pts.map((p, i) => Math.hypot(pts[(i + 1) % n].x - p.x, pts[(i + 1) % n].z - p.z));
  const cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + segLen[i]);
  const length = cum[n];
  const avgSpacing = length / n;

  // Left-of-travel normal in game coordinates (z = -y of the source map).
  const normals = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    return { x: (b.z - a.z) / segLen[i], z: -(b.x - a.x) / segLen[i] };
  });
  const tangents = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    return { x: (b.x - a.x) / segLen[i], z: (b.z - a.z) / segLen[i] };
  });

  // apron[i] is true when the segment i -> i+1 sits in a turn
  const apron = pts.map((_, i) => {
    if (APRON_WIDTH === 0) return false;
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
    let d = Math.abs(Math.atan2(c.x - b.x, c.z - b.z) - Math.atan2(b.x - a.x, b.z - a.z));
    if (d > Math.PI) d = Math.PI * 2 - d;
    return d > APRON_TURN_ANGLE;
  });

  // ---- pit lane layout (left of the start straight) ----
  const pitStart = data.pit.start;
  const pitLength = data.pit.length;
  function pitT(k) { // 0 outside the pit lane, 1 on the full-width section, ramping in between
    const r = (k - pitStart + n) % n;
    if (r > pitLength) return 0;
    return Math.min(1, r / PIT_RAMP, (pitLength - r) / PIT_RAMP);
  }
  function nearPit(i, margin) {
    const r = (i - pitStart + n) % n;
    return r <= pitLength + margin || r >= n - margin;
  }
  const laneOuter = (k) => wl[k] + 2 + 11 * pitT(k);
  const barrierLeft = (k) => wl[k] + APRON_WIDTH + 3 + 12 * pitT(k);
  const barrierRight = (k) => wr[k] + APRON_WIDTH + 3;

  // ---- locating a car on the track ----
  // Windowed search around `hint` (a car only moves a few segments per step); falls back to a full scan.
  function scan(x, z, from, count) {
    let best = Infinity, index = 0, bt = 0;
    for (let c = 0; c < count; c++) {
      const i = (from + c + n) % n;
      const a = pts[i];
      const abx = tangents[i].x * segLen[i], abz = tangents[i].z * segLen[i];
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (segLen[i] * segLen[i])));
      const dx = x - (a.x + abx * t), dz = z - (a.z + abz * t);
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; index = i; bt = t; }
    }
    return { dist: Math.sqrt(best), index, t: bt };
  }
  function locate(x, z, hint) {
    let r = hint === undefined ? null : scan(x, z, hint - 25, 51);
    if (!r || r.dist > 60) r = scan(x, z, 0, n);
    const a = pts[r.index];
    const cx = a.x + tangents[r.index].x * segLen[r.index] * r.t;
    const cz = a.z + tangents[r.index].z * segLen[r.index] * r.t;
    const side = (x - cx) * normals[r.index].x + (z - cz) * normals[r.index].z >= 0 ? 1 : -1;
    return { ...r, cx, cz, side };
  }

  // Updates a car's track-relative state (index, lap count, height, slope, surface) and keeps it
  // inside the barriers. `car.laps` must be initialised by the caller (-1 on a grid behind the line).
  function step(car) {
    const loc = locate(car.x, car.z, car.idx);
    if (car.idx !== undefined) {
      if (car.idx > n * 0.75 && loc.index < n * 0.25) car.laps++;
      else if (car.idx < n * 0.25 && loc.index > n * 0.75) car.laps--;
    }
    const i = loc.index;
    const j = (i + 1) % n;
    const half = loc.side > 0 ? wl[i] : wr[i];
    const limit = loc.side > 0 ? barrierLeft(i) : barrierRight(i);
    if (loc.dist > limit) {
      const s = limit / loc.dist;
      car.x = loc.cx + (car.x - loc.cx) * s;
      car.z = loc.cz + (car.z - loc.cz) * s;
      car.speed *= 0.6;
      car.hitBarrier = true;
    }
    car.idx = i;
    car.t = loc.t;
    car.s = cum[i] + loc.t * segLen[i];
    car.progress = car.laps * length + car.s;
    car.trackDist = loc.dist * loc.side; // signed lateral offset, + = left
    car.onTrack = loc.dist <= half || (apron[i] && loc.dist <= half + APRON_WIDTH);
    car.y = elev[i] + (elev[j] - elev[i]) * loc.t;
    const along = Math.sin(car.heading) * tangents[i].x + Math.cos(car.heading) * tangents[i].z;
    car.slope = ((elev[j] - elev[i]) / segLen[i]) * (along >= 0 ? 1 : -1);
    car.alongTrack = along; // > 0 when facing the direction of travel
  }

  // Position and heading `s` metres along the lap (may be negative = behind the line), offset to the left.
  function pointAt(s, lateral = 0) {
    const m = ((s % length) + length) % length;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= m) lo = mid; else hi = mid; }
    const t = (m - cum[lo]) / segLen[lo];
    const a = pts[lo];
    return {
      x: a.x + tangents[lo].x * segLen[lo] * t + normals[lo].x * lateral,
      z: a.z + tangents[lo].z * segLen[lo] * t + normals[lo].z * lateral,
      heading: Math.atan2(tangents[lo].x, tangents[lo].z),
      y: elev[lo],
    };
  }

  const startPose = { ...pointAt(0), heading: Math.atan2(tangents[data.startIndex].x, tangents[data.startIndex].z) };

  // ---- geometry helpers ----
  // Per-point normals (average of the two neighbouring segments), so adjacent ribbon pieces share
  // their edge vertices and leave no wedge-shaped gaps on the outside of bends.
  const vertexNormals = pts.map((_, k) => {
    const a = normals[(k - 1 + n) % n], b = normals[k];
    const x = a.x + b.x, z = a.z + b.z;
    const len = Math.hypot(x, z) || 1;
    return { x: x / len, z: z / len };
  });
  const ribbonPoint = (segment, k, d, y) => {
    const nr = vertexNormals[k];
    const dist = typeof d === 'function' ? d(k) : d;
    return [pts[k].x + nr.x * dist, y + elev[k], pts[k].z + nr.z * dist];
  };
  function finish(positions, indices, material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }
  function ribbonMesh(from, to, material, y, filter) {
    const positions = [], indices = [];
    for (let i = 0; i < n; i++) {
      if (filter && !filter(i)) continue;
      const j = (i + 1) % n;
      const base = positions.length / 3;
      for (const k of [i, j]) {
        positions.push(...ribbonPoint(i, k, from, y), ...ribbonPoint(i, k, to, y));
      }
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    return finish(positions, indices, material);
  }
  const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
  const dbl = { side: THREE.DoubleSide };
  // road markings and run-off sit just above the road; the depth offset keeps them drawn on top
  const onTop = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };

  function createRoad() {
    return ribbonMesh((k) => -wr[k], (k) => wl[k], lambert(theme.road, dbl), 0);
  }

  function createAprons() {
    const group = new THREE.Group();
    if (APRON_WIDTH === 0) return group;
    const kerb = 1.2;
    const tarmac = lambert(0x8a8a92, onTop);
    const red = new THREE.MeshBasicMaterial({ color: 0xd02020, ...onTop });
    const white = new THREE.MeshBasicMaterial({ color: 0xf0f0f0, ...onTop });
    const turn = (i) => apron[i];
    const even = (i) => apron[i] && i % 2 === 0;
    const odd = (i) => apron[i] && i % 2 === 1;
    group.add(ribbonMesh((k) => wl[k], (k) => wl[k] + APRON_WIDTH - kerb, tarmac, 0.03, turn));
    group.add(ribbonMesh((k) => -wr[k], (k) => -(wr[k] + APRON_WIDTH - kerb), tarmac, 0.03, turn));
    group.add(ribbonMesh((k) => wl[k] + APRON_WIDTH - kerb, (k) => wl[k] + APRON_WIDTH, red, 0.04, even));
    group.add(ribbonMesh((k) => wl[k] + APRON_WIDTH - kerb, (k) => wl[k] + APRON_WIDTH, white, 0.04, odd));
    group.add(ribbonMesh((k) => -(wr[k] + APRON_WIDTH - kerb), (k) => -(wr[k] + APRON_WIDTH), red, 0.04, even));
    group.add(ribbonMesh((k) => -(wr[k] + APRON_WIDTH - kerb), (k) => -(wr[k] + APRON_WIDTH), white, 0.04, odd));
    return group;
  }

  function wallMesh(offset, material, filter) {
    const positions = [], indices = [];
    for (let i = 0; i < n; i++) {
      if (!filter(i)) continue;
      const j = (i + 1) % n;
      const base = positions.length / 3;
      for (const k of [i, j]) positions.push(...ribbonPoint(i, k, offset, 0), ...ribbonPoint(i, k, offset, 1.1));
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    return finish(positions, indices, material);
  }

  function createBarriers() {
    const group = new THREE.Group();
    const red = lambert(0xc02828, dbl);
    const white = lambert(0xe8e8e8, dbl);
    const redBlock = (i) => Math.floor(i / 4) % 2 === 0;
    const whiteBlock = (i) => !redBlock(i);
    for (const [offset, sign] of [[barrierLeft, 1], [barrierRight, -1]]) {
      const o = (k) => sign * offset(k);
      group.add(wallMesh(o, red, redBlock), wallMesh(o, white, whiteBlock));
    }
    return group;
  }

  // ---- pit lane ----
  const pitPath = [];
  for (let r = 0; r <= pitLength; r++) {
    const k = (pitStart + r) % n;
    const d = wl[k] + (2 + 11 * pitT(k)) / 2;
    pitPath.push({ x: pts[k].x + normals[k].x * d, z: pts[k].z + normals[k].z * d, y: elev[k] });
  }
  const pitBoxR = (slot) => PIT_RAMP + 4 + slot * PIT_BOX_SPACING;

  function createPitLane() {
    const group = new THREE.Group();
    group.add(ribbonMesh((k) => wl[k], laneOuter, lambert(0x55555c, onTop), 0.03, (i) => pitT(i) > 0 || pitT((i + 1) % n) > 0));

    const batch = new Batch();
    const garageMat = lambert(0xb8b8c0);
    const doorMat = lambert(0x303038);
    const m = new THREE.Matrix4();
    const o = new THREE.Object3D();
    for (let r = PIT_RAMP; r <= pitLength - PIT_RAMP; r += 3) {
      const k = (pitStart + r) % n;
      const nr = normals[k], p = pts[k];
      const d = wl[k] + 2 + 11 + 3.5;
      o.position.set(p.x + nr.x * d, elev[k], p.z + nr.z * d);
      o.rotation.set(0, Math.atan2(nr.x, nr.z), 0); // local -z faces the lane
      o.updateMatrix();
      m.makeTranslation(0, 2, 0).premultiply(o.matrix);
      batch.add(garageMat, new THREE.BoxGeometry(12, 4, 7), m);
      m.makeTranslation(0, 1.6, -3.55).premultiply(o.matrix);
      batch.add(doorMat, new THREE.BoxGeometry(9, 3, 0.2), m);
    }
    batch.build(group);
    return group;
  }

  // ---- pit entry signs: blocky "PIT <" boards on the left, facing oncoming cars ----
  const GLYPHS = {
    P: ['111', '101', '111', '100', '100'],
    I: ['111', '010', '010', '010', '111'],
    T: ['111', '010', '010', '010', '010'],
    '<': ['00100', '01000', '11111', '01000', '00100'],
  };
  function createPitSigns() {
    const group = new THREE.Group();
    const batch = new Batch();
    const boardMat = lambert(0x1f4fd1);
    const pixelMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const poleMat = lambert(0x666a72);
    const px = 0.5;
    const pixelGeo = new THREE.BoxGeometry(px * 0.95, px * 0.95, 0.12);
    const o = new THREE.Object3D();
    const m = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const text = ['P', 'I', 'T', '<'];
    const textWidth = text.reduce((w, g) => w + GLYPHS[g][0].length * px + px, -px);
    const boardW = textWidth + 2, boardH = 5 * px + 1.4, boardY = 6;

    for (const metresBefore of [220, 70]) {
      const k = (pitStart - Math.round(metresBefore / avgSpacing) + n) % n;
      const d = barrierLeft(k) + 2.5;
      const t = tangents[k], nr = normals[k];
      o.position.set(pts[k].x + nr.x * d, elev[k], pts[k].z + nr.z * d);
      o.rotation.set(0, Math.atan2(-t.x, -t.z), 0); // local +z faces approaching cars, local +x is their right
      o.updateMatrix();
      const put = (mat, geo, x, y, z) => batch.add(mat, geo, m.copy(o.matrix).multiply(local.makeTranslation(x, y, z)));
      put(boardMat, new THREE.BoxGeometry(boardW, boardH, 0.2), 0, boardY, 0);
      for (const x of [-boardW / 2 + 0.4, boardW / 2 - 0.4]) put(poleMat, new THREE.BoxGeometry(0.35, boardY, 0.35), x, boardY / 2, -0.2);
      let cx = -textWidth / 2;
      for (const g of text) {
        const rows = GLYPHS[g];
        rows.forEach((row, r) => [...row].forEach((bit, c) => {
          if (bit === '1') put(pixelMat, pixelGeo, cx + c * px + px / 2, boardY + (2 - r) * px, 0.14);
        }));
        cx += rows[0].length * px + px;
      }
    }
    batch.build(group);
    return group;
  }

  // ---- start line and gantry ----
  function createStartLine() {
    const group = new THREE.Group();
    const s = data.startIndex;
    const w = wl[s] + wr[s];
    const mid = (wl[s] - wr[s]) / 2;
    const nr = normals[s];
    const line = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.5), new THREE.MeshBasicMaterial({ color: 0xffffff, ...onTop }));
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = -startPose.heading;
    line.position.set(pts[s].x + nr.x * mid, elev[s] + 0.05, pts[s].z + nr.z * mid);
    group.add(line);

    // gantry over the line
    const gantry = new THREE.Group();
    const steel = lambert(0x444a55);
    const half = (w + 6) / 2;
    for (const x of [-half, half]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), steel);
      post.position.set(x, 4, 0);
      gantry.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 7, 1.2, 1.2), lambert(0xcc3333));
    beam.position.y = 8.4;
    gantry.add(beam);
    gantry.position.set(pts[s].x + nr.x * mid, elev[s], pts[s].z + nr.z * mid);
    gantry.rotation.y = startPose.heading;
    group.add(gantry);
    return group;
  }

  // ---- ground / terrain ----
  // How far (m beyond the road edge) the ground on one side of each point can extend before it
  // would reach a different part of the circuit. Probes outward and checks every 3rd point.
  function clearanceSide(sign) {
    const out = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const nr = vertexNormals[k];
      const base = sign > 0 ? wl[k] : wr[k];
      let clear = 330;
      for (let d = 15; d <= 330; d += 15) {
        const px = pts[k].x + nr.x * sign * (base + d), pz = pts[k].z + nr.z * sign * (base + d);
        let hit = false;
        for (let i = 0; i < n; i += 3) {
          let gap = Math.abs(i - k); gap = Math.min(gap, n - gap);
          const dx = pts[i].x - px, dz = pts[i].z - pz;
          let reach = Math.max(wl[i], wr[i]) + APRON_WIDTH + 25;
          // Nearby points of this same stretch only count once they are closer to the probe than
          // this point is: the ground has crossed the inside of a hairpin onto the other leg.
          if (gap < 40) reach = Math.min(reach, base + d - 8);
          if (dx * dx + dz * dz < reach * reach) { hit = true; break; }
        }
        if (hit) { clear = Math.max(4, d - 25); break; }
      }
      out[k] = clear;
    }
    // smooth so the verge edge does not zig-zag
    const sm = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let m = Infinity;
      for (let o = -4; o <= 4; o++) m = Math.min(m, out[(k + o + n) % n]);
      sm[k] = m;
    }
    return sm;
  }

  function createGround() {
    const group = new THREE.Group();
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const margin = 600;
    const grassMat = lambert(theme.ground);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX + margin * 2, maxZ - minZ + margin * 2), grassMat);
    plane.rotation.x = -Math.PI / 2;
    // well below the road so it cannot z-fight through it at a distance
    plane.position.set((minX + maxX) / 2, baseY - GROUND_DROP, (minZ + maxZ) / 2);
    group.add(plane);

    if (relief > 2) {
      // On hilly tracks the verges follow the road height, then fall away to the base level.
      // Each verge stops short of any other part of the circuit, so a verge at one height
      // never covers a nearby section of road at another height.
      const grass = lambert(theme.ground, dbl);
      for (const sign of [1, -1]) {
        const clear = clearanceSide(sign);
        const w = (k) => (sign > 0 ? wl[k] : wr[k]);
        const edge = (k) => sign * (w(k) + 0.5);
        const outer = (k) => sign * (w(k) + Math.min(90, clear[k]));
        const far = (k) => sign * (w(k) + Math.min(320, Math.max(clear[k], 1)));
        group.add(ribbonMesh(edge, outer, grass, -VERGE_DROP));
        // skirt drops to the base plane
        const positions = [], indices = [];
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const b = positions.length / 3;
          for (const k of [i, j]) {
            positions.push(...ribbonPoint(i, k, outer, -VERGE_DROP));
            const f = ribbonPoint(i, k, far, 0);
            positions.push(f[0], baseY - GROUND_DROP, f[2]);
          }
          indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
        }
        group.add(finish(positions, indices, grass));
      }
    }
    return group;
  }

  // ---- scenery ----
  const concrete = lambert(0x9a9a9a);
  const roofMat = lambert(0xcc3333);

  function createGrandstands() {
    const group = new THREE.Group();
    const batch = new Batch();
    const crowdMatrices = [];
    const crowdColors = [];
    const palette = [0xff4040, 0x4080ff, 0xffd040, 0xffffff, 0x40c060, 0xff8040].map((c) => new THREE.Color(c));
    const tiers = 4, tierDepth = 2.2, tierHeight = 1.4;
    const o = new THREE.Object3D();
    const local = new THREE.Matrix4();
    const world = new THREE.Matrix4();
    const place = (material, geo, x, y, z) => {
      world.copy(o.matrix).multiply(local.makeTranslation(x, y, z));
      batch.add(material, geo, world);
    };
    const perTier = Math.floor(STAND_LENGTH / 1.3);
    const tierGeos = [];
    for (let k = 0; k < tiers; k++) tierGeos.push(new THREE.BoxGeometry(STAND_LENGTH, tierHeight * (k + 1), tierDepth));
    const roofGeo = new THREE.BoxGeometry(STAND_LENGTH + 2, 0.4, tiers * tierDepth + 2);
    const postGeo = new THREE.BoxGeometry(0.4, 4.5 + tierHeight * tiers, 0.4);

    let travelled = 0, nextAt = STAND_SPACING / 2;
    for (let i = 0; i < n; i++) {
      travelled += segLen[i];
      if (travelled < nextAt) continue;
      nextAt = travelled + STAND_SPACING;

      // only on straights: no apron within a few points either side
      let straight = true;
      for (let k = -4; k <= 4; k++) if (apron[(i + k + n) % n]) straight = false;
      if (!straight) continue;

      for (const side of [1, -1]) {
        if (side > 0 && nearPit(i, 8)) continue; // pit lane and garages sit on the left
        const offset = (side > 0 ? wl[i] : wr[i]) + APRON_WIDTH + STAND_GAP;
        const px = pts[i].x + normals[i].x * side * offset;
        const pz = pts[i].z + normals[i].z * side * offset;
        // skip if another part of the circuit is closer than this stand's own stretch of track
        if (scan(px, pz, 0, n).dist < offset - 4) continue;

        o.position.set(px, elev[i], pz);
        o.rotation.set(0, Math.atan2(-normals[i].x * side, -normals[i].z * side), 0); // local +z faces the track
        o.updateMatrix();
        for (let k = 0; k < tiers; k++) place(concrete, tierGeos[k], 0, (tierHeight * (k + 1)) / 2, -k * tierDepth);
        place(roofMat, roofGeo, 0, tierHeight * tiers + 4.5, -(tiers - 1) * tierDepth / 2);
        for (const x of [-STAND_LENGTH / 2, STAND_LENGTH / 2]) {
          place(concrete, postGeo, x, (4.5 + tierHeight * tiers) / 2, -(tiers - 1) * tierDepth - 0.8);
        }
        for (let k = 0; k < tiers; k++) {
          for (let p = 0; p < perTier; p++) {
            const m = new THREE.Matrix4().copy(o.matrix).multiply(
              local.makeTranslation(-STAND_LENGTH / 2 + 0.8 + p * 1.3, tierHeight * (k + 1) + 0.5, -k * tierDepth + 0.3));
            crowdMatrices.push(m);
            crowdColors.push(palette[Math.floor(rand() * palette.length)]);
          }
        }
      }
    }
    batch.build(group);
    if (crowdMatrices.length) {
      const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 1.0, 0.6), lambert(0xffffff), crowdMatrices.length);
      crowdMatrices.forEach((m, idx) => { crowd.setMatrixAt(idx, m); crowd.setColorAt(idx, crowdColors[idx]); });
      group.add(crowd);
    }
    return group;
  }

  // Neon-lit city blocks and street lamps for the night street circuit.
  function createCity() {
    const group = new THREE.Group();
    const neon = [0xff2fb4, 0x25e4ff, 0xff8a1f, 0x8a4dff, 0x2f6bff, 0xffe14a];
    const mats = neon.map((c) => new THREE.MeshLambertMaterial({
      color: new THREE.Color(c).multiplyScalar(0.18), emissive: c, emissiveIntensity: 0.55, flatShading: true,
    }));
    const batch = new Batch();
    const m = new THREE.Matrix4();
    let travelled = 0, nextAt = 0;
    for (let i = 0; i < n; i++) {
      travelled += segLen[i];
      if (travelled < nextAt) continue;
      nextAt = travelled + 30;
      for (const side of [1, -1]) {
        const w = 22 + rand() * 26, d = 22 + rand() * 30, h = 25 + rand() * rand() * 140;
        const offset = (side > 0 ? barrierLeft(i) : barrierRight(i)) + 14 + d / 2 + rand() * 40;
        const px = pts[i].x + normals[i].x * side * offset;
        const pz = pts[i].z + normals[i].z * side * offset;
        if (scan(px, pz, 0, n).dist < offset - 8) continue;
        m.makeRotationY(Math.atan2(tangents[i].x, tangents[i].z)).setPosition(px, elev[i] + h / 2, pz);
        batch.add(mats[Math.floor(rand() * mats.length)], new THREE.BoxGeometry(w, h, d), m);
      }
    }
    // street lamps
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    const poleMat = lambert(0x333333);
    for (let i = 0; i < n; i += 12) {
      for (const side of [1, -1]) {
        const offset = (side > 0 ? barrierLeft(i) : barrierRight(i)) + 1.2;
        const px = pts[i].x + normals[i].x * side * offset;
        const pz = pts[i].z + normals[i].z * side * offset;
        m.makeTranslation(px, elev[i] + 4, pz);
        batch.add(poleMat, new THREE.BoxGeometry(0.3, 8, 0.3), m);
        m.makeTranslation(px, elev[i] + 8.2, pz);
        batch.add(lampMat, new THREE.BoxGeometry(0.9, 0.4, 0.9), m);
      }
    }
    batch.build(group);
    return group;
  }

  function createTrees() {
    const group = new THREE.Group();
    const count = theme.trees;
    if (!count) return group;
    const foliage = new THREE.InstancedMesh(new THREE.ConeGeometry(3.2, 10, 6), lambert(0xffffff), count);
    const trunks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 3, 0.8), lambert(0x5a3b22), count);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let placed = 0;
    for (let attempt = 0; attempt < count * 4 && placed < count; attempt++) {
      const i = Math.floor(rand() * n);
      const side = rand() < 0.5 ? 1 : -1;
      const offset = (side > 0 ? barrierLeft(i) : barrierRight(i)) + 10 + rand() * 70;
      const px = pts[i].x + normals[i].x * side * offset;
      const pz = pts[i].z + normals[i].z * side * offset;
      const near = scan(px, pz, 0, n);
      if (near.dist < Math.max(barrierLeft(near.index), barrierRight(near.index)) + 6) continue; // keep clear of the track
      const y = elev[near.index] + (elev[(near.index + 1) % n] - elev[near.index]) * near.t;
      const s = 0.8 + rand() * 0.9;
      m.makeScale(s, s, s).setPosition(px, y + 3 + 5 * s, pz);
      foliage.setMatrixAt(placed, m);
      foliage.setColorAt(placed, c.setHSL(0.3 + rand() * 0.05, 0.55, 0.2 + rand() * 0.12));
      m.makeTranslation(px, y + 1.5, pz);
      trunks.setMatrixAt(placed, m);
      placed++;
    }
    foliage.count = trunks.count = placed;
    group.add(foliage, trunks);
    return group;
  }

  const mesh = new THREE.Group();
  mesh.add(createGround(), createRoad(), createAprons(), createStartLine(), createPitLane(), createPitSigns(), createBarriers(), createTrees());
  if (theme.scenery === 'city') mesh.add(createCity());
  else mesh.add(createGrandstands());

  // ---- racing line for the AI ----
  const rl = (data.racingLine || data.centerline).map(([x, z]) => ({ x, z }));
  const rlCum = [0];
  for (let i = 0; i < rl.length; i++) {
    const b = rl[(i + 1) % rl.length];
    rlCum.push(rlCum[i] + Math.hypot(b.x - rl[i].x, b.z - rl[i].z));
  }
  const racingLine = { pts: rl, cum: rlCum, length: rlCum[rl.length], normalsOf: (i) => normals[i] };

  return {
    id: data.id,
    name: data.name,
    theme,
    mesh,
    length,
    n,
    startPose,
    step,
    pointAt,
    racingLine,
    elevationAt: (i) => elev[i],
    widthAt: (i) => ({ left: wl[i], right: wr[i] }),
    pit: {
      entryIndex: pitStart,
      entryS: cum[pitStart],
      length: pitLength,
      ramp: PIT_RAMP,
      speed: PIT_SPEED,
      path: pitPath,
      boxR: pitBoxR,
    },
    avgSpacing,
  };
}
