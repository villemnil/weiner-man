// Gameplay sweep: how lively is the pill under gentle and wild random tilting?
import { Sim, defaultParams, Params } from '../src/physics/sim';
const DEG = Math.PI / 180;
const play = (over: Partial<Params>, maxDeg: number, period: number, secs = 60, seed0 = 7) => {
  const s = new Sim({ ...defaultParams(), ...over });
  s.reset('game');
  let seed = seed0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const every = Math.round(period / s.dt), n = Math.round(secs / s.dt);
  let roll = 0, wins = 0, fell = 0, maxEx = 0, flips = 0;
  for (let i = 0; i < n; i++) {
    if (i % every === 0) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * maxDeg * DEG; s.targetLean = [Math.cos(a) * r, Math.sin(a) * r]; }
    s.step();
    const ax = s.axis();
    roll += Math.abs(s.shell.w[0] * ax[0] + s.shell.w[1] * ax[1] + s.shell.w[2] * ax[2]) * s.dt;
    maxEx = Math.max(maxEx, s.stats.maxBallExcess);
    if (s.won) { wins++; flips += s.stats.flips; s.reset('game'); }
    if (s.fellOff) { fell++; s.respawn(); }
  }
  flips += s.stats.flips;
  return { flips, turns: roll / 6.283, wins, fell, maxEx };
};
const variants: [string, Partial<Params>][] = JSON.parse(process.argv[2] ?? '[["base",{}]]');
for (const [name, over] of variants) {
  let out = name.padEnd(34);
  for (const [deg, per] of [[5, 0.9], [9, 0.6], [15, 0.35]]) {
    let F = 0, T = 0, W = 0, X = 0, E = 0;
    for (const seed of [7, 99, 1234]) { const r = play(over, deg, per, 40, seed); F += r.flips; T += r.turns; W += r.wins; X += r.fell; E = Math.max(E, r.maxEx); }
    out += ` | ${deg}°: flips ${String(F).padStart(3)} rolls ${T.toFixed(0).padStart(4)} wins ${W} off ${X} ex ${(E * 10).toFixed(2)}`;
  }
  console.log(out);
}
