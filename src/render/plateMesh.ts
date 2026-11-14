import * as THREE from 'three';
import { Plate } from '../physics/plate';

/**
 * Build the plate's top surface from the same analytic geometry the physics uses.
 * Polar grid around the bowl centre, stretched to the teardrop outline, so the outer
 * silhouette is exact and the bowl wall follows grid rings.
 */
export function buildPlateGeometry(plate: Plate, nTheta = 960, nR = 300): THREE.BufferGeometry {
  const g = plate.g;
  const top = g.depth + g.lipH;
  const bottom = g.depth - 0.25;
  const rings = nR + 1 + 2; // surface rings + 2 skirt rings
  const cols = nTheta + 1;
  const pos = new Float32Array(cols * rings * 3);
  const nor = new Float32Array(cols * rings * 3);
  const eps = 0.015;
  for (let i = 0; i < cols; i++) {
    const th = (i / nTheta) * Math.PI * 2;
    const cx = Math.cos(th), sz = Math.sin(th);
    // distance to the outer edge of the lip along this ray
    let lo = 0, hi = 30;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (plate.outline(cx * mid, sz * mid) - g.lipT < 0) lo = mid; else hi = mid;
    }
    const rOut = lo;
    // outward 2D normal of the outline here
    const ox = plate.outline(cx * rOut + eps, sz * rOut) - plate.outline(cx * rOut - eps, sz * rOut);
    const oz = plate.outline(cx * rOut, sz * rOut + eps) - plate.outline(cx * rOut, sz * rOut - eps);
    const ol = Math.hypot(ox, oz) || 1;
    for (let j = 0; j < rings; j++) {
      const k = (i * rings + j) * 3;
      if (j <= nR) {
        const r = (rOut * j) / nR;
        const x = cx * r, z = sz * r;
        const h = j === nR ? top - 0.1 : plate.renderHeight(x, z);
        pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
        const hx = (plate.renderHeight(x + eps, z) - plate.renderHeight(x - eps, z)) / (2 * eps);
        const hz = (plate.renderHeight(x, z + eps) - plate.renderHeight(x, z - eps)) / (2 * eps);
        const l = Math.hypot(hx, 1, hz);
        nor[k] = -hx / l; nor[k + 1] = 1 / l; nor[k + 2] = -hz / l;
      } else {
        pos[k] = cx * rOut; pos[k + 1] = j === nR + 1 ? top - 0.1 : bottom; pos[k + 2] = sz * rOut;
        nor[k] = ox / ol; nor[k + 1] = 0; nor[k + 2] = oz / ol;
      }
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nTheta; i++) {
    for (let j = 0; j < rings - 1; j++) {
      if (j === nR) continue; // gap between the surface and the skirt (duplicated edge)
      const a = i * rings + j, b = a + 1, c = (i + 1) * rings + j, d = c + 1;
      if (j > 0) idx.push(a, c, b);
      idx.push(b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/** Raised arrow inside the sunken start-pad disc, pointing at the groove. */
export function buildDecals(plate: Plate, material: THREE.Material): THREE.Group {
  const g = plate.g;
  const group = new THREE.Group();
  const dir = Math.atan2(plate.chA[1] - g.tailZ, plate.chA[0]);
  const k = g.padR / 1.25;
  const arrow = new THREE.Shape();
  const pts: [number, number][] = [[0.72, 0], [0.0, 0.6], [0.0, 0.33], [-0.55, 0.33], [-0.55, -0.33], [0.0, -0.33], [0.0, -0.6]];
  pts.forEach(([px, pz], i) => {
    const x = (px * Math.cos(dir) - pz * Math.sin(dir)) * k;
    const z = (px * Math.sin(dir) + pz * Math.cos(dir)) * k + g.tailZ;
    if (i === 0) arrow.moveTo(x, z); else arrow.lineTo(x, z);
  });
  arrow.closePath();
  const h = 0.06;
  const geo = new THREE.ExtrudeGeometry(arrow, { depth: h, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.015, bevelSegments: 2 });
  const m = new THREE.Mesh(geo, material);
  m.rotation.x = Math.PI / 2; // shape (x, y) -> plate (x, z); extrusion goes down from position.y
  m.position.y = g.depth - 0.07 + h + 0.015;
  m.receiveShadow = true;
  group.add(m);
  return group;
}
