// Finds road spots covered by grass: casts rays down onto each track and reports points where a
// ground mesh sits above the road surface. node scripts/check-surface.mjs [trackId]
import * as THREE from 'three';
import { TRACKS } from '../src/data/tracks/index.js';
import { createTrack } from '../src/track/trackBuilder.js';

const only = process.argv[2];
const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);

for (const data of TRACKS) {
  if (only && data.id !== only) continue;
  const track = createTrack(data);
  track.mesh.updateMatrixWorld(true);
  const [ground, road] = track.mesh.children;
  const groundMeshes = [];
  ground.traverse((o) => o.isMesh && groundMeshes.push(o));
  const bad = [];
  let samples = 0;
  for (let i = 0; i < track.n; i++) {
    const { left, right } = track.widthAt(i);
    for (const f of [-0.95, -0.5, 0, 0.5, 0.95]) {
      const lateral = f > 0 ? f * left : f * right;
      const p = pointOn(track, data, i, lateral);
      ray.set(new THREE.Vector3(p.x, 500, p.z), down);
      const roadHit = ray.intersectObject(road)[0];
      if (!roadHit) continue;
      samples++;
      const g = ray.intersectObjects(groundMeshes)[0];
      if (g && g.point.y > roadHit.point.y - 0.01) bad.push(i);
    }
  }
  const spots = [...new Set(bad)];
  console.log(`${data.id}: ${spots.length} of ${track.n} points have grass over the road (${bad.length}/${samples} samples)` +
    (spots.length ? ` e.g. ${spots.slice(0, 12).join(',')}` : ''));
}

function pointOn(track, data, i, lateral) {
  const a = data.centerline[i], b = data.centerline[(i + 1) % track.n];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  // same left normal as trackBuilder
  const nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len;
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  return { x: mx + nx * lateral, z: mz + nz * lateral };
}
