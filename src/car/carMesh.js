import * as THREE from 'three';

const CAR_SCALE = 1.44;

const mat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

// Shared geometry for all cars; only the two team materials differ per car.
const geo = {
  body: new THREE.BoxGeometry(1.0, 0.45, 3.2),
  nose: new THREE.BoxGeometry(0.5, 0.3, 1.2),
  sidepod: new THREE.BoxGeometry(0.45, 0.4, 1.5),
  engine: new THREE.BoxGeometry(0.5, 0.3, 1.2),
  frontWing: new THREE.BoxGeometry(2.0, 0.08, 0.5),
  rearWing: new THREE.BoxGeometry(1.6, 0.5, 0.15),
  helmet: new THREE.BoxGeometry(0.4, 0.3, 0.4),
  wheel: new THREE.CylinderGeometry(0.38, 0.38, 0.45, 8).rotateZ(Math.PI / 2),
};
const dark = mat(0x151515);
const helmetMat = mat(0x111111);

export function createCarMesh(primary = '#006747', secondary = '#418FDE') {
  const car = new THREE.Group();
  const p = mat(primary);
  const s = mat(secondary);

  const add = (g, material, x, y, z) => {
    const m = new THREE.Mesh(g, material);
    m.position.set(x, y, z);
    car.add(m);
    return m;
  };

  add(geo.body, p, 0, 0.45, 0);
  add(geo.nose, p, 0, 0.4, 1.9);
  add(geo.sidepod, s, -0.72, 0.5, -0.1);
  add(geo.sidepod, s, 0.72, 0.5, -0.1);
  add(geo.engine, s, 0, 0.75, -0.2);
  add(geo.frontWing, s, 0, 0.3, 2.4);
  add(geo.rearWing, s, 0, 0.95, -1.7);
  add(geo.helmet, helmetMat, 0, 0.8, 0.4);
  for (const [x, z] of [[-1.0, 1.2], [1.0, 1.2], [-1.0, -1.2], [1.0, -1.2]]) add(geo.wheel, dark, x, 0.38, z);

  car.scale.setScalar(CAR_SCALE);
  car.rotation.order = 'YXZ';
  return car;
}
