// Analytic plate geometry (plate-local frame, cm).
//   +y is the plate normal, bowl floor is y = 0, the bowl centre / cup is the origin,
//   the tail (start pad) points toward +z.
// Dimensions are taken from photos of the real tray, using the 3.2 x 1.4 cm pill as the ruler:
// about 14 cm tip to far rim, round part just under 10 cm across.
// The solid is a union of three "features", each with its own signed distance so a
// sphere sitting in a corner gets one contact per feature:
//   0 floor   : half-space y < 0 with the spherical centre cup carved out
//   1 plateau : everything outside the bowl+channel, up to y = depth (rim top, tail, pad)
//   2 lip     : optional raised outer lip (the real tray has none: lipH = 0)
import { V3, clamp, smoothstep } from './math';

export interface PlateGeom {
  mode: 'plate' | 'plane';
  bowlR: number; // radius of the bowl at the top edge of its wall
  flangeW: number; // flat rim top between the bowl wall and the outline
  depth: number; // bowl / channel depth below the rim top
  lipH: number; // outer lip height above the rim top (0 = none)
  lipT: number; // extra rim width outside the outline
  tailZ: number; // centre of the tail circle (start pad)
  tailR: number; // radius of the tail circle of the outline
  padR: number; // recessed start-pad disc radius (visual only)
  channelW: number; // channel half-width
  channelLen: number; // channel centre-line length
  cupR: number; // radius of curvature of the centre cup
  cupDepth: number; // depth of the centre cup
  // Far wall (opposite the tail): two shallow rounded-triangle teeth, mirrored, peaks outermost
  toothMid: number; // degrees, direction of the valley between the two teeth
  toothSpan: number; // degrees of arc covered by each tooth
  toothPeak: number; // degrees from a tooth's outer end to its peak
  toothHeight: number; // how far the peak reaches into the bowl, cm
  toothRound: number; // peak rounding radius, cm
  // Tail side: the bowl is cut off by a straight wall (the long edge of the triangular plateau)
  chordDist: number; // distance of that wall from the bowl centre, cm
  chordAngle: number; // degrees, rotation of the wall's normal from +z toward +x
}

export const defaultGeom = (): PlateGeom => ({
  mode: 'plate',
  bowlR: 4.3,
  flangeW: 0.35,
  depth: 0.8,
  lipH: 0,
  lipT: 0.25,
  tailZ: 8.0,
  tailR: 0.9,
  padR: 0.8,
  channelW: 0.85,
  channelLen: 5.2,
  cupR: 0.85,
  cupDepth: 0.45,
  toothMid: -85,
  toothSpan: 27,
  toothPeak: 9,
  toothHeight: 0.42,
  toothRound: 0.15,
  chordDist: 3.4,
  chordAngle: -12,
});

export interface Hit {
  d: number; // signed distance from the query point to the feature surface
  n: V3; // unit normal (plate-local), pointing out of the solid
}

export const FEATURE_COUNT = 3;
/** Horizontal width of the sloped bowl wall as drawn (the physics wall is vertical at its top edge). */
const WALL_SLOPE = 0.6;

type P2 = [number, number];

export class Plate {
  g: PlateGeom;
  // derived
  outR = 0;
  hullA = 0;
  hullB = 0;
  chA: P2 = [0, 0];
  chB: P2 = [0, 0];
  /** Each tooth is the intersection of two half-planes: [n1x, n1z, c1, n2x, n2z, c2]. */
  teeth: number[][] = [];
  cupOpenR = 0;
  cupCy = 0;
  chordN: P2 = [0, 1];
  inset = 0; // channel centre-line distance from the straight left edge
  label: P2[] = [];

  constructor(g: PlateGeom = defaultGeom()) {
    this.g = g;
    this.update();
  }

  update(): void {
    const g = this.g;
    const rad = Math.PI / 180;
    this.outR = g.bowlR + g.flangeW;
    // Convex hull of the big circle and the tail circle ("uneven capsule").
    this.hullB = (this.outR - g.tailR) / g.tailZ;
    this.hullA = Math.sqrt(1 - this.hullB * this.hullB);
    // Channel: parallel to the left (-x) straight edge of the tail, its outer wall flush
    // with the bowl wall, from inside the bowl up to just short of the start pad.
    const nx = -this.hullA, nz = this.hullB; // outward normal of the left edge
    const inset = (this.inset = g.channelW + g.flangeW);
    const bx = (this.outR - inset) * nx, bz = (this.outR - inset) * nz;
    this.chB = [bx, bz];
    this.chA = [bx + this.hullB * g.channelLen, bz + this.hullA * g.channelLen];
    const ca = g.chordAngle * rad;
    this.chordN = [Math.sin(ca), Math.cos(ca)];

    // Far-wall teeth. Wall points: outer end on the circle, peak inside, valley (shared) on the circle.
    const at = (deg: number, r: number): P2 => [Math.cos(deg * rad) * r, Math.sin(deg * rad) * r];
    const line = (a: P2, b: P2): number[] => {
      let lx = -(b[1] - a[1]), lz = b[0] - a[0];
      const l = Math.hypot(lx, lz) || 1;
      lx /= l; lz /= l;
      if (lx * a[0] + lz * a[1] < 0) { lx = -lx; lz = -lz; } // normal points away from the centre
      return [lx, lz, lx * a[0] + lz * a[1]];
    };
    this.teeth = [];
    if (g.toothHeight > 0 && g.toothSpan > 0) {
      const valley = at(g.toothMid, g.bowlR - 0.04);
      for (const s of [-1, 1]) {
        const end = at(g.toothMid + s * g.toothSpan, g.bowlR);
        const peak = at(g.toothMid + s * (g.toothSpan - g.toothPeak), g.bowlR - g.toothHeight);
        this.teeth.push([...line(end, peak), ...line(peak, valley)]);
      }
    }
    this.cupCy = g.cupR - g.cupDepth;
    this.cupOpenR = Math.sqrt(Math.max(0, g.cupR * g.cupR - this.cupCy * this.cupCy));
    this.label = this.labelTriangle();
  }

  /** Inset triangular label on the plateau between the channel, the straight wall and the rim. */
  labelTriangle(): P2[] {
    const g = this.g;
    const nL: P2 = [-this.hullA, this.hullB], nR: P2 = [this.hullA, this.hullB];
    const l1: [P2, number] = [nL, this.outR - this.inset - g.channelW - 0.3];
    const l2: [P2, number] = [this.chordN, g.chordDist + 0.35];
    const l3: [P2, number] = [nR, this.outR - 0.45];
    const hit = (p: [P2, number], q: [P2, number]): P2 => {
      const det = p[0][0] * q[0][1] - p[0][1] * q[0][0];
      return [(p[1] * q[0][1] - p[0][1] * q[1]) / det, (p[0][0] * q[1] - p[1] * q[0][0]) / det];
    };
    return [hit(l1, l2), hit(l2, l3), hit(l3, l1)];
  }

  /**
   * Start pose: lying in the rounded tail end of the channel groove, along the channel.
   * `pos` / `dir` are (x, z); `halfLen` keeps the pill clear of the groove's end wall.
   */
  startPose(halfLen = 1.6): { pos: P2; dir: P2 } {
    const dx = this.chB[0] - this.chA[0], dz = this.chB[1] - this.chA[1];
    const l = Math.hypot(dx, dz) || 1;
    const back = Math.max(0, halfLen - this.g.channelW + 0.12);
    return { pos: [this.chA[0] + (dx / l) * back, this.chA[1] + (dz / l) * back], dir: [dx / l, dz / l] };
  }

  /** Start pad centre (plate-local, on the plateau surface). */
  padCenter(): V3 {
    return [0, this.g.depth, this.g.tailZ];
  }

  /** 2D signed distance to the teardrop outline. <0 inside. */
  outline(x: number, z: number): number {
    const g = this.g;
    const px = Math.abs(x);
    const k = -this.hullB * px + this.hullA * z;
    if (k < 0) return Math.hypot(px, z) - this.outR;
    if (k > this.hullA * g.tailZ) return Math.hypot(px, z - g.tailZ) - g.tailR;
    return px * this.hullA + z * this.hullB - this.outR;
  }

  /** 2D signed distance to the recessed region (bowl minus teeth and tail wall, plus channel). <0 inside. */
  low(x: number, z: number): number {
    const g = this.g;
    let d = Math.hypot(x, z) - g.bowlR;
    if (d > -(g.toothHeight + 0.4)) {
      const r = g.toothRound;
      for (const t of this.teeth) {
        // rounded intersection of the two half-planes; negative inside the tooth
        const v1 = t[2] - (t[0] * x + t[1] * z) + r, v2 = t[5] - (t[3] * x + t[4] * z) + r;
        const solid = Math.min(Math.max(v1, v2), 0) + Math.hypot(Math.max(v1, 0), Math.max(v2, 0)) - r;
        if (-solid > d) d = -solid;
      }
    }
    // straight wall on the tail side
    const dch = x * this.chordN[0] + z * this.chordN[1] - g.chordDist;
    if (dch > d) d = dch;
    // channel capsule
    const ax = this.chA[0], az = this.chA[1], bx = this.chB[0], bz = this.chB[1];
    const ex = bx - ax, ez = bz - az;
    const t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1);
    const dc = Math.hypot(x - ax - ex * t, z - az - ez * t) - g.channelW;
    return Math.min(d, dc);
  }

  private grad(f: (x: number, z: number) => number, x: number, z: number): P2 {
    const e = 1e-4;
    const gx = f.call(this, x + e, z) - f.call(this, x - e, z);
    const gz = f.call(this, x, z + e) - f.call(this, x, z - e);
    const l = Math.hypot(gx, gz) || 1;
    return [gx / l, gz / l];
  }

  /**
   * Signed distance + normal from point p to feature `f`, or null when the point is
   * farther than `reach` from that feature (cheap early-out).
   */
  feature(f: number, p: V3, reach: number): Hit | null {
    const g = this.g;
    const x = p[0], y = p[1], z = p[2];
    if (g.mode === 'plane') {
      if (f !== 0 || y > reach) return null;
      return { d: y, n: [0, 1, 0] };
    }
    const top = g.depth + g.lipH;
    if (y > top + reach) return null;

    if (f === 0) {
      if (y > reach) return null;
      const o = this.outline(x, z);
      if (o > g.lipT) return null; // nothing under you out there
      const rho = Math.hypot(x, z);
      const a = this.cupOpenR;
      if (rho >= a || a <= 0) return { d: y, n: [0, 1, 0] };
      // over the cup opening
      const vx = x, vy = y - this.cupCy, vz = z;
      const vl = Math.hypot(vx, vy, vz);
      if (vl > 1e-9 && this.cupCy + (g.cupR * vy) / vl <= 0) {
        return { d: g.cupR - vl, n: [-vx / vl, -vy / vl, -vz / vl] };
      }
      if (vl <= 1e-9) return { d: g.cupR, n: [0, 1, 0] };
      // nearest surface is the cup lip ring
      const s = rho > 1e-9 ? a / rho : 0;
      const rx = rho > 1e-9 ? x * s : a, rz = z * s;
      const dx = x - rx, dy = y, dz = z - rz;
      const dl = Math.hypot(dx, dy, dz);
      if (dl < 1e-9) return { d: 0, n: [0, 1, 0] };
      return { d: dl, n: [dx / dl, dy / dl, dz / dl] };
    }

    if (f === 1) {
      if (y > g.depth + reach) return null;
      const u = this.low(x, z);
      if (u < -reach) return null;
      const o = this.outline(x, z);
      if (o > g.lipT) return null;
      const dy = y - g.depth;
      if (u >= 0) {
        if (dy >= 0) return { d: dy, n: [0, 1, 0] };
        // inside the solid: exit through the nearer face
        if (-u > dy) {
          const gr = this.grad(this.low, x, z);
          return { d: -u, n: [-gr[0], 0, -gr[1]] };
        }
        return { d: dy, n: [0, 1, 0] };
      }
      const gr = this.grad(this.low, x, z);
      if (dy <= 0) return { d: -u, n: [-gr[0], 0, -gr[1]] };
      const dl = Math.hypot(u, dy);
      return { d: dl, n: [(-gr[0] * -u) / dl, dy / dl, (-gr[1] * -u) / dl] };
    }

    // lip: box [0, lipT] x (-inf, top] in (outline distance, y)
    if (g.lipH <= 0) return null;
    const o = this.outline(x, z);
    if (o < -reach || o > g.lipT + reach) return null;
    const half = g.lipT / 2;
    const c = o - half;
    const qx = Math.abs(c) - half;
    const qy = y - top;
    const sx = c >= 0 ? 1 : -1;
    const gr = this.grad(this.outline, x, z);
    if (qx > 0 && qy > 0) {
      const dl = Math.hypot(qx, qy);
      return { d: dl, n: [(gr[0] * sx * qx) / dl, qy / dl, (gr[1] * sx * qx) / dl] };
    }
    if (qx > qy) return { d: qx, n: [gr[0] * sx, 0, gr[1] * sx] };
    return { d: qy, n: [0, 1, 0] };
  }

  /** Top-surface height used only for building the render mesh (adds the moulded look). */
  renderHeight(x: number, z: number): number {
    const g = this.g;
    const rho = Math.hypot(x, z);
    let h = 0;
    if (rho < this.cupOpenR) h = this.cupCy - Math.sqrt(g.cupR * g.cupR - rho * rho);
    // The physics wall is vertical at low() = 0; draw it as the tray's concave, sloped wall.
    const t = clamp((this.low(x, z) + WALL_SLOPE) / WALL_SLOPE, 0, 1);
    // quarter-ellipse fillet, stopped short of vertical so the top edge stays clean on the mesh
    const K = 0.9, tk = t * K;
    h += ((g.depth - h) * (1 - Math.sqrt(1 - tk * tk))) / (1 - Math.sqrt(1 - K * K));
    if (t >= 1) {
      // sunken details on the rim-level plateau: start-pad disc and the triangular label
      h -= 0.07 * smoothstep(0.06, -0.06, Math.hypot(x, z - g.tailZ) - g.padR);
      h -= 0.06 * smoothstep(0.06, -0.06, sdTriangle(x, z, this.label));
    }
    const o = this.outline(x, z);
    if (g.lipH > 0) h += (g.depth + g.lipH - h) * smoothstep(-0.09, 0.05, o);
    h -= 0.1 * smoothstep(g.lipT - 0.18, g.lipT, o) ** 2; // rounded outer edge
    return h;
  }
}

/** Exact signed distance to a 2D triangle (negative inside). */
function sdTriangle(px: number, pz: number, t: P2[]): number {
  let d2 = Infinity, sgn = Infinity;
  const s = Math.sign((t[1][0] - t[0][0]) * (t[0][1] - t[2][1]) - (t[1][1] - t[0][1]) * (t[0][0] - t[2][0]));
  for (let i = 0; i < 3; i++) {
    const a = t[i], b = t[(i + 1) % 3];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const vx = px - a[0], vz = pz - a[1];
    const h = clamp((vx * ex + vz * ez) / (ex * ex + ez * ez), 0, 1);
    const qx = vx - ex * h, qz = vz - ez * h;
    d2 = Math.min(d2, qx * qx + qz * qz);
    sgn = Math.min(sgn, s * (vx * ez - vz * ex));
  }
  return -Math.sqrt(d2) * Math.sign(sgn);
}
