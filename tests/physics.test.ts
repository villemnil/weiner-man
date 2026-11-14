import { describe, it, expect } from 'vitest';
import { Sim, defaultParams, defaultGeom, Params } from '../src/physics/sim';

const DEG = Math.PI / 180;
const planeSim = (over: Partial<Params> = {}): Sim => {
  const g = defaultGeom();
  g.mode = 'plane';
  return new Sim({ ...defaultParams(), ...over }, g);
};
const run = (s: Sim, secs: number, each?: (s: Sim) => void): void => {
  const n = Math.round(secs / s.dt);
  for (let i = 0; i < n; i++) {
    s.step();
    each?.(s);
  }
};
const speed = (s: Sim): number => Math.hypot(...s.shell.v);

describe('pill physics', () => {
  it('runs at >= 1000 Hz', () => {
    expect(1 / new Sim().dt).toBeGreaterThanOrEqual(1000);
  });

  it('1. lies on its side on a flat plate; a small tilt sends the ball to the low end', () => {
    const s = new Sim();
    s.reset('flat');
    run(s, 1.5);
    expect(s.tiltFromNormalDeg()).toBeGreaterThan(88);
    expect(speed(s)).toBeLessThan(0.5);
    // tilt 4 deg along the capsule axis: ball must end up at the downhill end
    const ax = s.toLocal(s.axis());
    const l = Math.hypot(ax[0], ax[2]);
    s.targetLean = [(ax[0] / l) * 4 * DEG, (ax[2] / l) * 4 * DEG];
    let maxRock = 0;
    run(s, 1.0, () => { maxRock = Math.max(maxRock, 90 - s.tiltFromNormalDeg()); });
    expect(s.ballS()).toBeGreaterThan(0.8);
    expect(maxRock).toBeGreaterThan(0.5); // the clunk visibly rocks the capsule
  });

  it('2. somersaults end over end down an 8 degree slope', () => {
    for (const yaw of [0, 6, -10]) {
      const s = planeSim();
      s.tiltLocked = true;
      s.setLean(0, 8 * DEG);
      s.placePill([0, 0.71, 0], [Math.sin(yaw * DEG), 0, Math.cos(yaw * DEG)], -1);
      const ends: number[] = [];
      let wasUp = false;
      run(s, 1.5, () => {
        const c = s.axis()[1] * 1; // world y is close enough to the plate normal at 8 deg
        const up = Math.abs(c) > 0.85;
        if (up && !wasUp) ends.push(Math.sign(c));
        if (Math.abs(c) < 0.4) wasUp = false; else if (up) wasUp = true;
      });
      expect(s.stats.flips, `yaw ${yaw}`).toBeGreaterThanOrEqual(2);
      // a true end-over-end tumble stands on alternating ends
      expect(ends.some((e, i) => i > 0 && e !== ends[i - 1]), `yaw ${yaw} alternates`).toBe(true);
      expect(s.toLocal(s.shell.x)[2]).toBeGreaterThan(4); // and it travelled downhill
    }
  });

  it('3. upright with the ball at the bottom is stable and self-righting', () => {
    const s = planeSim();
    s.reset('uprightDown'); // starts leaning 3 degrees
    expect(s.tiltFromNormalDeg()).toBeGreaterThan(2.5);
    let maxTilt = 0;
    run(s, 3, () => { maxTilt = Math.max(maxTilt, s.tiltFromNormalDeg()); });
    expect(maxTilt).toBeLessThan(8);
    expect(s.tiltFromNormalDeg()).toBeLessThan(1);
    expect(s.ballEndDown()).toBe(true);
    // nudge it: still comes back
    s.shell.w = [0.6, 0, 0];
    run(s, 2);
    expect(s.tiltFromNormalDeg()).toBeLessThan(1);
  });

  it('4. upright with the ball at the top topples immediately', () => {
    const s = planeSim();
    s.reset('uprightUp');
    let tToppled = Infinity;
    run(s, 2, () => { if (s.tiltFromNormalDeg() > 60 && tToppled === Infinity) tToppled = s.time; });
    expect(tToppled).toBeLessThan(1.0);
    expect(s.tiltFromNormalDeg()).toBeGreaterThan(80);
  });

  it('5. stands in the centre cup, ball end down, through small tilts, and wins', () => {
    const s = new Sim();
    s.reset('dropCup');
    run(s, 2);
    expect(s.inCup()).toBe(true);
    expect(s.won).toBe(true);
    let maxTilt = 0;
    for (const [lx, lz] of [[4, 0], [0, -4], [-3, 3], [0, 5], [0, 0]]) {
      s.targetLean = [lx * DEG, lz * DEG];
      run(s, 1.2, () => { maxTilt = Math.max(maxTilt, s.tiltFromNormalDeg()); });
      expect(s.inCup()).toBe(true);
    }
    expect(maxTilt).toBeLessThan(15);
    expect(s.isWinPose()).toBe(true);
  });

  // Lay the pill with one end sunk in the centre cup, leaning `deg` from upright.
  const leanInCup = (deg: number, ballInHoleEnd: boolean): Sim => {
    const s = new Sim();
    s.reset('flat');
    const a = deg * DEG;
    const c: [number, number, number] = [Math.sin(a) * s.hl, s.params.shellRadius - 0.35 + Math.cos(a) * s.hl, 0];
    // axis points from the cupped end up to the raised end; ballS = +1 puts the ball at the +axis end
    s.placePill(c, [-Math.sin(a), -Math.cos(a), 0], ballInHoleEnd ? 1 : -1);
    return s;
  };

  it('wins when the ball end is in the hole even if the pill is leaning', () => {
    for (const deg of [25, 45, 60]) {
      const s = leanInCup(deg, true);
      run(s, 2);
      expect(s.tiltFromNormalDeg(), `lean ${deg}`).toBeGreaterThan(15); // the old rule would have refused this
      expect(s.ballInCup(), `lean ${deg}`).toBe(true);
      expect(s.won, `lean ${deg}`).toBe(true);
    }
  });

  it('does not win when only the empty end is in the hole, or the pill is elsewhere', () => {
    // Checked on the placed pose: left to run, a top-heavy pill like this usually tumbles
    // until its ball end drops into the hole, which is a genuine win.
    expect(leanInCup(45, false).ballInCup()).toBe(false);
    expect(leanInCup(45, true).ballInCup()).toBe(true);
    for (const scene of ['flat', 'game', 'uprightDown'] as const) {
      const s = new Sim();
      s.reset(scene);
      run(s, 2);
      expect(s.won, scene).toBe(false);
    }
  });

  it('6. rolls sideways about its long axis without flipping', () => {
    const s = planeSim();
    s.tiltLocked = true;
    s.setLean(0, 8 * DEG);
    s.placePill([0, 0.71, 0], [1, 0, 0], 0);
    let minTilt = 90;
    run(s, 1.0, () => { minTilt = Math.min(minTilt, s.tiltFromNormalDeg()); });
    expect(s.toLocal(s.shell.x)[2]).toBeGreaterThan(8);
    expect(s.stats.flips).toBe(0);
    expect(minTilt).toBeGreaterThan(75);
    // it really is rolling: spin about the long axis matches v / R
    const wAxial = Math.abs(s.shell.w[0] * s.axis()[0] + s.shell.w[1] * s.axis()[1] + s.shell.w[2] * s.axis()[2]);
    expect(wAxial * s.params.shellRadius).toBeGreaterThan(0.7 * speed(s));
  });

  it('energy stays bounded and the ball never leaves the shell over 60 s of random tilting', () => {
    const s = new Sim();
    s.reset('game');
    let seed = 12345;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const g = s.params.gravity, m = s.params.shellMass + s.params.ballMass;
    // generous ceiling: everything lifted 8 cm (plate edge rises ~4 cm at 15 deg) and moving 150 cm/s
    const eMax = m * g * 8 + 0.5 * m * 150 * 150;
    let maxE = -Infinity, maxSpeed = 0;
    const stepsPerChange = Math.round(0.35 / s.dt);
    const n = Math.round(60 / s.dt);
    for (let i = 0; i < n; i++) {
      if (i % stepsPerChange === 0) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 15 * DEG;
        s.targetLean = [Math.cos(a) * r, Math.sin(a) * r];
      }
      s.step();
      if (s.fellOff) s.respawn();
      const e = s.energy();
      if (e > maxE) maxE = e;
      maxSpeed = Math.max(maxSpeed, Math.hypot(...s.shell.v), Math.hypot(...s.ball.v));
      if (!Number.isFinite(e)) throw new Error(`non-finite energy at t=${s.time}`);
    }
    expect(maxE).toBeLessThan(eMax);
    expect(maxSpeed).toBeLessThan(300);
    // ball centre never got further out than the wall thickness -> it never left the shell
    expect(s.stats.maxBallExcess).toBeLessThan(s.params.wall);
    console.log(`60 s random tilt: maxE ${maxE.toFixed(0)} erg (limit ${eMax.toFixed(0)}), max speed ${maxSpeed.toFixed(1)} cm/s, ` +
      `max ball excursion ${(s.stats.maxBallExcess * 10).toFixed(3)} mm, stand-ups ${s.stats.flips}, fell off ${s.stats.resets}x`);
  });

  it('stays stable when the plate follows fast finger swipes directly', () => {
    const s = new Sim();
    s.reset('game');
    s.tiltResponseOverride = 70; // what a drag / phone tilt uses
    let seed = 99;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const every = Math.round(0.07 / s.dt); // a new swipe target ~14 times a second
    let maxSpeed = 0, fell = 0;
    const n = Math.round(20 / s.dt);
    for (let i = 0; i < n; i++) {
      if (i % every === 0) {
        const a = rnd() * Math.PI * 2, r = rnd() * 15 * DEG;
        s.targetLean = [Math.cos(a) * r, Math.sin(a) * r];
      }
      s.step();
      if (s.fellOff) { s.respawn(); fell++; }
      maxSpeed = Math.max(maxSpeed, Math.hypot(...s.shell.v), Math.hypot(...s.ball.v));
      if (!Number.isFinite(s.energy())) throw new Error(`non-finite energy at t=${s.time}`);
    }
    expect(maxSpeed).toBeLessThan(300);
    expect(s.stats.maxBallExcess).toBeLessThan(s.params.wall);
    console.log(`fast swipes 20 s: max speed ${maxSpeed.toFixed(0)} cm/s, ball excursion ${(s.stats.maxBallExcess * 10).toFixed(3)} mm, fell off ${fell}x`);
  });
});
