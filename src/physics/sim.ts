// Custom rigid-body simulation of the tilt-maze toy. No rendering dependencies.
// Units: cm, g, s  (g = 981 cm/s^2, energy in erg).
//
// Bodies:  shell  - thin-walled hollow capsule, full 3D rigid body (axis = body +Y)
//          ball   - solid steel sphere, free to roll around inside the shell
//          plate  - kinematic, tilts about the origin; its angular velocity feeds the contacts
// Contacts are solved with sequential impulses (accumulated, warm-started), with
// speculative margins so nothing tunnels and nothing needs a big penetration push.
import {
  V3, Q, M3, add, sub, scale, addS, dot, cross, len, norm, incS,
  qFromRotVec, qFromTo, qMul, qConj, qToM3, mMul, mTMul, qIntegrate, qIdent, clamp,
} from './math';
import { Plate, PlateGeom, defaultGeom, FEATURE_COUNT } from './plate';

export interface Params {
  // pill
  shellLength: number; // overall length, cm
  shellRadius: number; // outer radius, cm
  wall: number; // wall thickness, cm
  shellMass: number; // g
  endFlat: number; // radius of the tiny flat on each pole, cm (0 = perfect hemisphere)
  ballRadius: number; // cm
  ballMass: number; // g
  // contacts
  muPlate: number; // shell <-> plate Coulomb friction
  restPlate: number; // shell <-> plate restitution
  muBall: number; // ball <-> shell friction
  restBall: number; // ball <-> shell restitution
  rollResist: number; // resistance to rolling about the long axis, lever arm in cm
  spinResist: number; // resistance to twisting about the plate normal, lever arm in cm
  ballRollResist: number; // ball rolling resistance lever arm, cm
  linDamp: number; // 1/s
  angDamp: number; // 1/s
  // solver
  gravity: number; // cm/s^2
  substeps: number; // per 1/60 s frame
  iterations: number;
  // plate
  maxTiltDeg: number;
  tiltResponse: number; // rad/s, natural frequency of the tilt smoothing spring
}

export const defaultParams = (): Params => ({
  shellLength: 3.2,
  shellRadius: 0.7,
  wall: 0.05,
  shellMass: 1.2,
  endFlat: 0.12,
  ballRadius: 0.5,
  ballMass: 7.0,
  muPlate: 0.7,
  restPlate: 0.3,
  muBall: 0.08,
  restBall: 0.4,
  rollResist: 0.004,
  spinResist: 0.004,
  ballRollResist: 0.003,
  linDamp: 0.05,
  angDamp: 0.15,
  gravity: 981,
  substeps: 24,
  iterations: 10,
  maxTiltDeg: 15,
  tiltResponse: 14,
});

export type SceneName = 'game' | 'flat' | 'slope8' | 'uprightDown' | 'uprightUp' | 'dropCup' | 'attract';
export const SCENES: SceneName[] = ['game', 'flat', 'slope8', 'uprightDown', 'uprightUp', 'dropCup'];

export interface Body {
  m: number;
  invM: number;
  invI: V3; // body-frame diagonal inverse inertia
  I: V3; // body-frame diagonal inertia
  x: V3;
  v: V3;
  w: V3;
  q: Q;
  R: M3;
}

interface Contact {
  a: Body;
  b: Body | null; // null = kinematic plate
  p: V3;
  n: V3; // pushes a (away from b)
  gap: number;
  mu: number;
  e: number;
  key: number;
  ra: V3;
  rb: V3;
  vb: V3; // plate velocity at p (when b is null)
  kn: number;
  target: number;
  bounced: boolean;
  jn: number;
  jt: V3;
}

const MARGIN = 0.05; // speculative contact distance, cm
const SLOP = 0.001;
const BETA = 0.2;
const MAX_CORR = 30; // cm/s
const REST_VTH = 4; // cm/s, below this impacts are inelastic
const MAX_W = 400; // rad/s safety clamp
const FLAT_PTS = 6;
const N_SPHERES = 7;
const BALL_KEY = 1 << 20;

const makeBody = (): Body => ({
  m: 1, invM: 1, invI: [1, 1, 1], I: [1, 1, 1],
  x: [0, 0, 0], v: [0, 0, 0], w: [0, 0, 0], q: qIdent(), R: qToM3(qIdent()),
});

const applyInvI = (b: Body, t: V3): V3 => {
  const l = mTMul(b.R, t);
  return mMul(b.R, [l[0] * b.invI[0], l[1] * b.invI[1], l[2] * b.invI[2]]);
};
const velAt = (b: Body, r: V3): V3 => add(b.v, cross(b.w, r));
const applyImpulse = (b: Body, r: V3, j: V3, sign: number): void => {
  incS(b.v, j, sign * b.invM);
  incS(b.w, applyInvI(b, cross(r, j)), sign);
};
const kAlong = (b: Body, r: V3, d: V3): number => {
  const rn = cross(r, d);
  return b.invM + dot(cross(applyInvI(b, rn), r), d);
};

export class Sim {
  params: Params;
  plate: Plate;
  shell: Body = makeBody();
  ball: Body = makeBody();

  /** Plate lean (radians): [toward +x, toward +z]. Positive = that side goes down. */
  lean: [number, number] = [0, 0];
  leanVel: [number, number] = [0, 0];
  targetLean: [number, number] = [0, 0];
  tiltLocked = false;
  /** When set, replaces params.tiltResponse (used so a finger drag moves the plate without lag). */
  tiltResponseOverride: number | null = null;
  plateQ: Q = qIdent();
  plateR: M3 = qToM3(qIdent());
  plateW: V3 = [0, 0, 0];

  time = 0;
  scene: SceneName = 'game';
  won = false;
  winTimer = 0;
  fellOff = false;
  stats = { flips: 0, maxBallExcess: 0, maxSpeed: 0, resets: 0 };
  /** Normal impulse the ball delivered to the shell during the last step (for audio/debug). */
  lastBallImpulse = 0;

  private upright = false;
  private cache = new Map<number, { jn: number; jt: V3 }>();
  // derived pill geometry
  hl = 0.9; // half length of the axis segment
  cavity = 0.15; // radius of the ball-centre region around the axis segment

  private baseMode: 'plate' | 'plane';

  constructor(params: Params = defaultParams(), geom: PlateGeom = defaultGeom()) {
    this.params = params;
    this.plate = new Plate(geom);
    this.baseMode = geom.mode;
    this.rebuild();
    this.reset('game');
  }

  /** Recompute masses / inertia after parameters change. */
  rebuild(): void {
    const p = this.params;
    p.ballRadius = Math.min(p.ballRadius, p.shellRadius - p.wall - 0.01);
    p.endFlat = clamp(p.endFlat, 0, p.shellRadius * 0.6);
    const R = p.shellRadius;
    const L = Math.max(0.01, p.shellLength - 2 * R);
    this.hl = L / 2;
    this.cavity = R - p.wall - p.ballRadius;
    // thin-walled capsule: cylinder shell + two hemispherical shells, mass by area
    const rm = R - p.wall / 2;
    const aCyl = 2 * Math.PI * rm * L;
    const aHem = 2 * Math.PI * rm * rm;
    const mc = (p.shellMass * aCyl) / (aCyl + 2 * aHem);
    const mh = (p.shellMass * aHem) / (aCyl + 2 * aHem);
    const iAxial = mc * rm * rm + 2 * ((2 / 3) * mh * rm * rm);
    const dH = L / 2 + rm / 2;
    const iTrans = mc * ((rm * rm) / 2 + (L * L) / 12) + 2 * mh * ((5 / 12) * rm * rm + dH * dH);
    const s = this.shell;
    s.m = p.shellMass; s.invM = 1 / s.m;
    s.I = [iTrans, iAxial, iTrans];
    s.invI = [1 / iTrans, 1 / iAxial, 1 / iTrans];
    const b = this.ball;
    b.m = p.ballMass; b.invM = 1 / b.m;
    const ib = 0.4 * b.m * p.ballRadius * p.ballRadius;
    b.I = [ib, ib, ib];
    b.invI = [1 / ib, 1 / ib, 1 / ib];
    this.plate.update();
  }

  get dt(): number {
    return 1 / (60 * this.params.substeps);
  }

  // ---------- plate ----------
  private setPlateFromLean(h: number): void {
    const q = qFromRotVec([this.lean[1], 0, -this.lean[0]]);
    if (h > 0) {
      const dq = qMul(q, qConj(this.plateQ));
      const s = dq[3] < 0 ? -2 / h : 2 / h;
      this.plateW = [dq[0] * s, dq[1] * s, dq[2] * s];
    } else this.plateW = [0, 0, 0];
    this.plateQ = q;
    this.plateR = qToM3(q);
  }

  /** Set the lean directly (radians), with no plate velocity. */
  setLean(lx: number, lz: number): void {
    this.lean = [lx, lz];
    this.targetLean = [lx, lz];
    this.leanVel = [0, 0];
    this.setPlateFromLean(0);
  }

  private updatePlate(h: number): void {
    const max = (this.params.maxTiltDeg * Math.PI) / 180;
    let tx = this.targetLean[0], tz = this.targetLean[1];
    const tl = Math.hypot(tx, tz);
    if (tl > max) { tx *= max / tl; tz *= max / tl; }
    const w0 = this.tiltResponseOverride ?? this.params.tiltResponse;
    for (let i = 0; i < 2; i++) {
      const t = i === 0 ? tx : tz;
      this.leanVel[i] += (w0 * w0 * (t - this.lean[i]) - 2 * w0 * this.leanVel[i]) * h;
      this.lean[i] += this.leanVel[i] * h;
    }
    this.setPlateFromLean(h);
  }

  toWorld(pl: V3): V3 { return mMul(this.plateR, pl); }
  toLocal(pw: V3): V3 { return mTMul(this.plateR, pw); }
  plateNormal(): V3 { return [this.plateR[1], this.plateR[4], this.plateR[7]]; }
  axis(): V3 { return [this.shell.R[1], this.shell.R[4], this.shell.R[7]]; }

  // ---------- placement / scenes ----------
  /**
   * Place the pill. `posL` = shell centre in plate-local coords, `axisL` = capsule axis in
   * plate-local coords, `ballS` in [-1, 1] = where the ball sits along the axis.
   */
  placePill(posL: V3, axisL: V3, ballS: number): void {
    const s = this.shell, b = this.ball;
    const aL = norm(axisL);
    s.q = qMul(this.plateQ, qFromTo([0, 1, 0], aL));
    s.R = qToM3(s.q);
    s.x = this.toWorld(posL);
    s.v = [0, 0, 0]; s.w = [0, 0, 0];
    const aW = this.axis();
    b.x = addS(s.x, aW, ballS * (this.hl + Math.max(0, this.cavity) * 0.98));
    b.v = [0, 0, 0]; b.w = [0, 0, 0];
    b.q = qIdent(); b.R = qToM3(b.q);
    this.cache.clear();
    this.won = false; this.winTimer = 0; this.fellOff = false;
    this.upright = Math.abs(dot(aW, this.plateNormal())) > 0.85;
  }

  reset(scene: SceneName = this.scene): void {
    this.scene = scene;
    const p = this.params, g = this.plate.g;
    const R = p.shellRadius, half = p.shellLength / 2;
    this.time = 0;
    this.stats = { flips: 0, maxBallExcess: 0, maxSpeed: 0, resets: this.stats.resets };
    this.tiltLocked = false;
    // the slope scene runs on an open flat board: the real bowl is only ~1 flip across
    g.mode = scene === 'slope8' || scene === 'attract' ? 'plane' : this.baseMode;
    this.setLean(0, 0);
    const lean3 = (deg: number): V3 => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180), 0];
    const floorY = 0;
    switch (scene) {
      case 'game':
        this.placeAtStart();
        break;
      case 'flat':
        this.placePill([2.0, floorY + R + 0.01, -1.6], [1, 0, 0.15], 0);
        break;
      case 'attract':
        // title screen: the pill wanders an open floor, steered from outside via targetLean
        this.placePill([0, floorY + R + 0.01, 2], [1, 0, 0.3], 0);
        break;
      case 'slope8':
        this.tiltLocked = true;
        this.setLean(0, (8 * Math.PI) / 180);
        // lying along the fall line, ball parked at the uphill end
        this.placePill([0, floorY + R + 0.01, -9], [0, 0, 1], -1);
        break;
      case 'uprightDown':
        this.placePill([1.7, floorY + half + 0.02, -1.5], lean3(3), -1);
        break;
      case 'uprightUp':
        this.placePill([1.7, floorY + half + 0.02, -1.5], lean3(3), 1);
        break;
      case 'dropCup':
        this.placePill([0.07, floorY + half - g.cupDepth + 0.35, 0.04], [0, 1, 0], -1);
        break;
    }
  }

  // ---------- contact generation ----------
  private pushContact(
    out: Contact[], a: Body, b: Body | null, p: V3, n: V3, gap: number, mu: number, e: number, key: number,
  ): void {
    out.push({
      a, b, p, n, gap, mu, e, key,
      ra: sub(p, a.x), rb: b ? sub(p, b.x) : [0, 0, 0],
      vb: b ? [0, 0, 0] : cross(this.plateW, p),
      kn: 0, target: 0, bounced: false, jn: 0, jt: [0, 0, 0],
    });
  }

  private collectPlateContacts(out: Contact[]): void {
    const p = this.params, s = this.shell;
    const R = p.shellRadius;
    const axisW = this.axis();
    const xL = this.toLocal(s.x);
    const axL = this.toLocal(axisW);
    const flat = p.endFlat;
    const cosCone = flat > 0 ? Math.sqrt(1 - (flat / R) * (flat / R)) : 2;
    const poleH = this.hl + R * cosCone; // distance from centre to the flat's plane
    // two body-frame directions perpendicular to the axis (in plate-local coords)
    const e1 = this.toLocal([s.R[0], s.R[3], s.R[6]]);
    const e2 = this.toLocal([s.R[2], s.R[5], s.R[8]]);
    for (let i = 0; i < N_SPHERES; i++) {
      const t = -this.hl + (2 * this.hl * i) / (N_SPHERES - 1);
      const c = addS(xL, axL, t);
      const endSign = i === 0 ? -1 : i === N_SPHERES - 1 ? 1 : 0;
      for (let f = 0; f < FEATURE_COUNT; f++) {
        const hit = this.plate.feature(f, c, R + MARGIN);
        if (!hit) continue;
        const gap = hit.d - R;
        if (gap > MARGIN) continue;
        if (endSign !== 0 && flat > 0 && -dot(hit.n, axL) * endSign > cosCone) {
          // resting on the pole flat: use the rim of the flat instead of the sphere
          for (let k = 0; k < FLAT_PTS; k++) {
            const ang = (k * 2 * Math.PI) / FLAT_PTS;
            const cs = Math.cos(ang) * flat, sn = Math.sin(ang) * flat;
            const pt: V3 = [
              xL[0] + axL[0] * endSign * poleH + e1[0] * cs + e2[0] * sn,
              xL[1] + axL[1] * endSign * poleH + e1[1] * cs + e2[1] * sn,
              xL[2] + axL[2] * endSign * poleH + e1[2] * cs + e2[2] * sn,
            ];
            const h2 = this.plate.feature(f, pt, MARGIN);
            if (!h2 || h2.d > MARGIN) continue;
            this.pushContact(out, s, null, this.toWorld(pt), this.toWorld(h2.n), h2.d,
              p.muPlate, p.restPlate, i * 64 + f * 8 + k);
          }
        } else {
          const pw = this.toWorld(addS(c, hit.n, -R));
          this.pushContact(out, s, null, pw, this.toWorld(hit.n), gap, p.muPlate, p.restPlate, i * 64 + f * 8 + 7);
        }
      }
    }
  }

  /** Ball centre relative to the capsule's inner axis: outward dir (world) and distance. */
  private ballInShell(): { out: V3; dist: number } {
    const s = this.shell;
    const bl = mTMul(s.R, sub(this.ball.x, s.x));
    const sy = clamp(bl[1], -this.hl, this.hl);
    const r: V3 = [bl[0], bl[1] - sy, bl[2]];
    const dist = len(r);
    const out = dist > 1e-9 ? mMul(s.R, scale(r, 1 / dist)) : ([0, 1, 0] as V3);
    return { out, dist };
  }

  private collectBallContact(out: Contact[]): void {
    const p = this.params;
    const { out: o, dist } = this.ballInShell();
    const gap = this.cavity - dist;
    if (gap > MARGIN || dist < 1e-9) return;
    const pw = addS(this.ball.x, o, p.ballRadius);
    this.pushContact(out, this.ball, this.shell, pw, scale(o, -1), gap, p.muBall, p.restBall, BALL_KEY);
  }

  // ---------- step ----------
  step(h: number = this.dt): void {
    const p = this.params, s = this.shell, b = this.ball;
    if (!this.tiltLocked) this.updatePlate(h);
    else this.plateW = [0, 0, 0];

    // external forces
    s.v[1] -= p.gravity * h;
    b.v[1] -= p.gravity * h;
    // gyroscopic torque on the (non-spherical) shell
    const wl = mTMul(s.R, s.w);
    const Lw: V3 = [wl[0] * s.I[0], wl[1] * s.I[1], wl[2] * s.I[2]];
    const gy = cross(wl, Lw);
    incS(s.w, mMul(s.R, [gy[0] * s.invI[0], gy[1] * s.invI[1], gy[2] * s.invI[2]]), -h);
    const ld = Math.max(0, 1 - p.linDamp * h), ad = Math.max(0, 1 - p.angDamp * h);
    s.v = scale(s.v, ld); b.v = scale(b.v, ld);
    s.w = scale(s.w, ad); b.w = scale(b.w, ad);

    // contacts
    const cs: Contact[] = [];
    this.collectPlateContacts(cs);
    const nPlate = cs.length;
    this.collectBallContact(cs);

    const restCap = 3 * (s.m + b.m) * p.gravity * h;
    for (const c of cs) {
      const vrel = this.relVel(c);
      const vn = dot(vrel, c.n);
      c.kn = kAlong(c.a, c.ra, c.n) + (c.b ? kAlong(c.b, c.rb, c.n) : 0);
      let target = c.gap >= 0 ? -c.gap / h : Math.min((BETA * Math.max(0, -c.gap - SLOP)) / h, MAX_CORR);
      if (vn < -REST_VTH && c.gap < Math.max(0.003, -vn * h)) { target = Math.max(target, -c.e * vn); c.bounced = true; }
      c.target = target;
    }
    // warm start (after every target is fixed, so it cannot fake an approach velocity)
    for (const c of cs) {
      // only resting contacts are warm-started: replaying an impact impulse injects energy
      const old = c.bounced ? undefined : this.cache.get(c.key);
      if (old) {
        c.jn = Math.min(old.jn * 0.9, restCap);
        const jt = addS(old.jt, c.n, -dot(old.jt, c.n));
        const jl = len(jt), lim = c.mu * c.jn;
        c.jt = jl > lim && jl > 0 ? scale(jt, lim / jl) : jt;
        const j = addS(c.jt, c.n, c.jn);
        applyImpulse(c.a, c.ra, j, 1);
        if (c.b) applyImpulse(c.b, c.rb, j, -1);
      }
    }

    for (let it = 0; it < p.iterations; it++) {
      for (const c of cs) {
        // normal
        let vrel = this.relVel(c);
        const dj = (c.target - dot(vrel, c.n)) / c.kn;
        const jn0 = c.jn;
        c.jn = Math.max(0, jn0 + dj);
        const dn = c.jn - jn0;
        if (dn !== 0) {
          const j = scale(c.n, dn);
          applyImpulse(c.a, c.ra, j, 1);
          if (c.b) applyImpulse(c.b, c.rb, j, -1);
        }
        // friction (2D, along the current slip direction)
        if (c.mu <= 0) continue;
        vrel = this.relVel(c);
        const vt = addS(vrel, c.n, -dot(vrel, c.n));
        const vtl = len(vt);
        const lim = c.mu * c.jn;
        let jt = c.jt;
        if (vtl > 1e-9) {
          const t = scale(vt, 1 / vtl);
          const kt = kAlong(c.a, c.ra, t) + (c.b ? kAlong(c.b, c.rb, t) : 0);
          jt = addS(c.jt, t, -vtl / kt);
        }
        const jl = len(jt);
        if (jl > lim) jt = jl > 0 ? scale(jt, lim / jl) : [0, 0, 0];
        const d = sub(jt, c.jt);
        c.jt = jt;
        if (d[0] !== 0 || d[1] !== 0 || d[2] !== 0) {
          applyImpulse(c.a, c.ra, d, 1);
          if (c.b) applyImpulse(c.b, c.rb, d, -1);
        }
      }
    }

    // rolling / spin resistance (Coulomb-like torque, lever arm * normal force)
    let jPlate = 0;
    for (let i = 0; i < nPlate; i++) jPlate += cs[i].jn;
    if (jPlate > 0) {
      // rolling about the long axis (seam / out-of-roundness) and twisting about the plate
      // normal (contact patch) are resisted; pitching over an end is left free.
      const dirs: [V3, number][] = [[this.axis(), p.rollResist], [this.plateNormal(), p.spinResist]];
      for (const [u, arm] of dirs) {
        if (arm <= 0) continue;
        const wu = dot(sub(s.w, this.plateW), u);
        if (Math.abs(wu) < 1e-9) continue;
        const iu = 1 / dot(u, applyInvI(s, u));
        const L = Math.min(iu * Math.abs(wu), arm * jPlate) * Math.sign(wu);
        incS(s.w, applyInvI(s, u), -L);
      }
    }
    this.lastBallImpulse = 0;
    if (cs.length > nPlate) {
      const jb = cs[nPlate].jn;
      this.lastBallImpulse = jb;
      if (jb > 0 && p.ballRollResist > 0) {
        const wr = sub(b.w, s.w);
        const wm = len(wr);
        if (wm > 1e-9) {
          const u = scale(wr, 1 / wm);
          const kb = b.invI[0] + dot(u, applyInvI(s, u));
          const L = Math.min(wm / kb, p.ballRollResist * jb);
          incS(b.w, u, -L * b.invI[0]);
          incS(s.w, applyInvI(s, u), L);
        }
      }
    }

    this.cache.clear();
    for (const c of cs) if (c.jn > 0 && !c.bounced) this.cache.set(c.key, { jn: c.jn, jt: c.jt });

    // integrate
    for (const body of [s, b]) {
      const wm = len(body.w);
      if (wm > MAX_W) body.w = scale(body.w, MAX_W / wm);
      incS(body.x, body.v, h);
      body.q = qIntegrate(body.q, body.w, h);
      body.R = qToM3(body.q);
    }

    // hard guarantee: the ball centre stays inside the cavity
    const { out: o, dist } = this.ballInShell();
    const ex = dist - this.cavity;
    if (ex > this.stats.maxBallExcess) this.stats.maxBallExcess = ex;
    if (ex > 1e-4) {
      const tot = s.m + b.m;
      incS(b.x, o, (-ex * s.m) / tot);
      incS(s.x, o, (ex * b.m) / tot);
    }

    this.time += h;
    this.postStep(h);
  }

  private relVel(c: Contact): V3 {
    const va = velAt(c.a, c.ra);
    return c.b ? sub(va, velAt(c.b, c.rb)) : sub(va, c.vb);
  }

  // ---------- derived state ----------
  /** Angle (deg) between the capsule axis and the plate normal, 0..90. */
  tiltFromNormalDeg(): number {
    return (Math.acos(clamp(Math.abs(dot(this.axis(), this.plateNormal())), 0, 1)) * 180) / Math.PI;
  }
  /** Ball position along the axis in [-1, 1]. */
  ballS(): number {
    const bl = mTMul(this.shell.R, sub(this.ball.x, this.shell.x));
    return clamp(bl[1] / (this.hl + Math.max(1e-6, this.cavity)), -1, 1);
  }
  /** True when the ball sits in the end of the capsule that points into the plate. */
  ballEndDown(): boolean {
    const sgn = dot(this.axis(), this.plateNormal()) > 0 ? -1 : 1; // which end is down
    return this.ballS() * sgn > 0.5;
  }
  /** True when the lower end of the capsule is seated in the centre cup. */
  inCup(): boolean {
    if (this.plate.g.mode !== 'plate') return false;
    const sgn = dot(this.axis(), this.plateNormal()) > 0 ? -1 : 1;
    const endL = this.toLocal(addS(this.shell.x, this.axis(), sgn * this.hl));
    return (
      Math.hypot(endL[0], endL[2]) < this.plate.cupOpenR &&
      endL[1] < this.params.shellRadius - 0.3 * this.plate.g.cupDepth
    );
  }
  /**
   * True when the end of the capsule holding the steel ball is sunk into the centre cup,
   * whatever angle the pill is at (upright, leaning or lying across the hole).
   */
  ballInCup(): boolean {
    if (this.plate.g.mode !== 'plate') return false;
    const s = this.ballS();
    if (Math.abs(s) < 0.5) return false; // ball is not at either end
    const endL = this.toLocal(addS(this.shell.x, this.axis(), Math.sign(s) * this.hl));
    return (
      Math.hypot(endL[0], endL[2]) < this.plate.cupOpenR &&
      endL[1] < this.params.shellRadius - 0.3 * this.plate.g.cupDepth
    );
  }
  isWinPose(): boolean {
    return this.ballInCup();
  }

  energy(): number {
    const g = this.params.gravity;
    let e = 0;
    for (const b of [this.shell, this.ball]) {
      const wl = mTMul(b.R, b.w);
      e += 0.5 * b.m * dot(b.v, b.v);
      e += 0.5 * (b.I[0] * wl[0] * wl[0] + b.I[1] * wl[1] * wl[1] + b.I[2] * wl[2] * wl[2]);
      e += b.m * g * b.x[1];
    }
    return e;
  }

  private postStep(h: number): void {
    const s = this.shell;
    const sp = Math.max(len(s.v), len(this.ball.v));
    if (sp > this.stats.maxSpeed) this.stats.maxSpeed = sp;
    // count end-over-end stand-ups
    const c = Math.abs(dot(this.axis(), this.plateNormal()));
    if (!this.upright && c > 0.85) { this.upright = true; this.stats.flips++; }
    else if (this.upright && c < 0.4) this.upright = false;
    // win: upright, ball end down, in the cup, held 1 s
    if (this.isWinPose()) {
      this.winTimer += h;
      if (this.winTimer >= 1) this.won = true;
    } else this.winTimer = 0;
    // fell off the plate
    if (s.x[1] < -12 || !Number.isFinite(s.x[0] + s.x[1] + s.x[2])) {
      this.fellOff = true;
    }
  }

  /** Lay the pill in the rounded end of the channel groove (where the pad's arrow points). */
  private placeAtStart(): void {
    const R = this.params.shellRadius;
    if (this.plate.g.mode === 'plane') { this.placePill([0, R + 0.01, 0], [1, 0, 0], 0); return; }
    const st = this.plate.startPose(this.params.shellLength / 2);
    this.placePill([st.pos[0], R + 0.01, st.pos[1]], [st.dir[0], 0, st.dir[1]], 0);
  }

  /** Put the pill back at the start without touching the plate tilt. */
  respawn(): void {
    this.placeAtStart();
    this.stats.resets++;
  }
}

export { defaultGeom };
export type { PlateGeom };
