// Tiny procedural "clack" for the steel ball hitting the capsule ends.
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
export const sound = { enabled: true };
/** Overall loudness of the clack. 1 = the original level. */
const VOLUME = 1.3;
export function unlockAudio(): void {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  try {
    ctx = new AudioContext();
    noise = ctx.createBuffer(1, 2048, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 180);
  } catch { ctx = null; }
}
/** A small three-note chime for the win. */
export function chime(): void {
  if (!ctx || !sound.enabled || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
    const o = ctx!.createOscillator(), g = ctx!.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const t = t0 + i * 0.085;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.5);
    o.connect(g).connect(ctx!.destination);
    o.start(t);
    o.stop(t + 0.55);
  });
}
export function clack(strength: number): void {
  if (!ctx || !noise || !sound.enabled || ctx.state !== 'running') return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.9 + Math.random() * 0.4;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.value = Math.min(0.5, strength) * VOLUME;
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start();
}
