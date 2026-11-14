import { Sim, defaultParams, defaultGeom, Params } from '../src/physics/sim';
const f = (n: number) => n.toFixed(1);
const run = (s: Sim, t: number) => { for (let i = 0; i < t / s.dt; i++) s.step(); };
if (process.argv[2] === 'cup') {
  for (const [cr, cd] of [[1.0, 0.35], [0.9, 0.4], [0.85, 0.45], [0.8, 0.4], [0.78, 0.5]]) {
    let out = `cupR ${cr} depth ${cd}:`;
    for (const [dropH, off] of [[0.3, 0.1], [0.6, 0.15], [1.2, 0.12], [0.3, 0.3]]) {
      const g = defaultGeom(); g.cupR = cr; g.cupDepth = cd;
      const s = new Sim(defaultParams(), g); s.reset('flat');
      s.placePill([off, 1.6 - cd + dropH, 0], [0, 1, 0], -1);
      run(s, 2.5);
      out += `  d${dropH}/o${off}→${f(s.tiltFromNormalDeg())}${s.won ? 'WIN' : ''}`;
    }
    console.log(out);
  }
} else {
  const variants: [string, Partial<Params>][] = [];
  for (const ms of [1.5, 1.2, 1.0]) for (const rb of [0.3, 0.5, 0.65]) for (const mu of [0.5, 0.8])
    variants.push([`ms${ms} restB${rb} mu${mu}`, { shellMass: ms, restBall: rb, muPlate: mu }]);
  for (const deg of [8, 12]) {
    console.log(`--- slope ${deg}°: flips in 2.5 s for yaw 0,6,-6,12,-12,25  (dist cm)`);
    for (const [name, over] of variants) {
      const g = defaultGeom(); g.mode = 'plane';
      let out = '';
      let tot = 0;
      for (const yaw of [0, 6, -6, 12, -12, 25]) {
        const s = new Sim({ ...defaultParams(), ...over }, g); s.reset('game');
        s.tiltLocked = true; s.setLean(0, deg * Math.PI / 180);
        const a = yaw * Math.PI / 180;
        s.placePill([0, 0.71, 0], [Math.sin(a), 0, Math.cos(a)], -1);
        run(s, 1.5);
        const l = s.toLocal(s.shell.x);
        out += ` ${s.stats.flips}(${f(Math.hypot(l[0], l[2]))})`; tot += s.stats.flips;
      }
      console.log(name.padEnd(22), 'total', String(tot).padStart(2), out);
    }
  }
}
