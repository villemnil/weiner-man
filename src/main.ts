import GUI from 'lil-gui';
import { Sim, SceneName, defaultParams } from './physics/sim';
import { defaultGeom } from './physics/plate';
import { View } from './render/scene';
import { TiltInput } from './input';
import { chime, clack, sound, unlockAudio } from './sound';
import { MAX_NAME, Score, formatTime, savedName, submitScore, topScores } from './scores';

const app = document.getElementById('app')!;
const sim = new Sim();
const view = new View(app, sim);
const input = new TiltInput(view.renderer.domElement);

// ---------- UI ----------
// All UI lives inside one Jelly UI theme (https://jelly-ui.com): soft, squishy web components.
const uiRoot = document.createElement('jelly-theme');
uiRoot.setAttribute('mode', 'light');
uiRoot.setAttribute('accent', '#f4b81f');
document.body.appendChild(uiRoot);
/** True when a key event comes from a text field (native or a jelly-input's inner one). */
const isTyping = (e: Event): boolean =>
  e.target instanceof HTMLInputElement || (e.target instanceof Element && !!e.target.closest('jelly-input'));
const el = (html: string): HTMLElement => {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  const n = d.firstElementChild as HTMLElement;
  uiRoot.appendChild(n);
  return n;
};
el(`<div id="vignette"></div>`);
const confettiBox = el(`<div id="confetti"></div>`);
const letters = (t: string): string =>
  [...t].map((ch, i) => (ch === ' ' ? ' ' : `<span style="animation-delay:${(i * 0.09).toFixed(2)}s">${ch}</span>`)).join('');
const squiggle = `<svg class="squiggle" viewBox="0 0 220 14" aria-hidden="true"><path d="M3 8 q13 -9 26 0 t26 0 t26 0 t26 0 t26 0 t26 0 t26 0 t26 0" /></svg>`;
const menu = el(`<div id="menu" class="on">
  <h1 aria-label="Wiener Man">${letters('Wiener Man')}</h1>${squiggle}
  <p>a wobbly little tilting toy</p>
  <jelly-button id="start" size="large">Start</jelly-button>
  <jelly-button id="menuScores" size="small" variant="white">Best times</jelly-button></div>`);
const hintEl = el(`<div id="hint">Get the Wiener Man to stand<br>in the middle of the plate</div>`);
const touch = matchMedia('(pointer: coarse)').matches;
const controlsEl = el(touch
  ? `<div id="controls"><span>drag anywhere to tilt the plate</span></div>`
  : `<div id="controls">
  <span><kbd>drag</kbd> or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> tilt the plate</span>
  <span><kbd>R</kbd> start over</span></div>`);
const menuBtn = el(`<jelly-button id="back" size="small" variant="white" label="Back to menu">&larr; Menu</jelly-button>`);
const tools = el(`<div id="tools">
  <jelly-chip id="xray" selectable size="large" variant="azure" title="See the steel ball inside">X-ray</jelly-chip>
  <jelly-icon-button id="again" shape="circle" size="small" variant="white" label="Start over" title="Start over">&#8634;</jelly-icon-button></div>`);
const xrayBtn = document.getElementById('xray') as HTMLElement & { selected: boolean };
const timerEl = el(`<div id="timer">0.0</div>`);
const stats = el(`<div id="stats"></div>`);
const toast = el(`<div id="toast"></div>`);
const win = el(`<div id="win"><div class="top"><h2>You did it!</h2>${squiggle}
    <div id="winTime"></div><p>Wiener is up</p></div>
  <div class="bottom">
    <form id="scoreForm" autocomplete="off">
      <jelly-input id="nameIn" size="small" placeholder="your name" label="Your name" no-autofill></jelly-input>
      <jelly-button type="submit" size="small" variant="white">Save time</jelly-button></form>
    <div id="saved"></div>
    <jelly-button id="playAgain" size="large">Play again</jelly-button>
    <div class="row"><jelly-button id="winScores" size="small" variant="white">Best times</jelly-button><jelly-button id="winMenu" size="small" variant="white">&larr; Menu</jelly-button></div>
  </div></div>`);
const board = el(`<div id="board"><jelly-card class="card"><h3>Best times</h3>${squiggle}
  <ol id="boardList"></ol><p id="boardNote"></p><jelly-button id="boardClose" size="small">Close</jelly-button></jelly-card></div>`);
const scoreForm = document.getElementById('scoreForm') as HTMLFormElement;
const nameIn = document.getElementById('nameIn') as HTMLElement & { value: string };
// jelly-input has no maxlength: trim as they type, and let Enter save
nameIn.addEventListener('input', () => { if (nameIn.value.length > MAX_NAME) nameIn.value = nameIn.value.slice(0, MAX_NAME); });
nameIn.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); scoreForm.requestSubmit(); } });
const savedEl = document.getElementById('saved')!;
const gyroBtn = el(`<jelly-button id="gyro" size="small" variant="white">Tilt with your phone</jelly-button>`);
let toastTimer = 0;
const showToast = (msg: string): void => {
  toast.textContent = msg;
  toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('on'), 1400);
};

// ---------- state ----------
const ui = {
  scene: 'game' as SceneName,
  xray: false,
  timeScale: 1,
  paused: false,
  sound: true,
  step: () => { stepFrames = 1; },
  reset: () => restart(),
  resetView: () => { view.controls.reset(); },
  defaults: () => {
    Object.assign(sim.params, defaultParams());
    Object.assign(sim.plate.g, defaultGeom());
    applyParams();
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    restart();
  },
};
let stepFrames = 0;
let winShown = false;
let respawnAt = 0;
let mode: 'menu' | 'play' = 'menu';
let hintStart = 0; // performance time the tutorial started, 0 = not showing
let tuning = false;
let runClean = true; // false once the tuning panel has been open during a run: no score for that one
let finalMs = 0;

const CAM_PLAY: [[number, number, number], [number, number, number]] = [[0, 30.2, 26.8], [0, 0, 2.5]];
const CAM_MENU: [[number, number, number], [number, number, number]] = [[0, 16, 27], [0, 0, -5]];

function restart(scene: SceneName = ui.scene): void {
  ui.scene = scene;
  sim.reset(scene);
  view.rebuild();
  winShown = false;
  win.classList.remove('on');
  respawnAt = 0;
  runClean = !tuning;
  view.pop();
}

/** Show the scoreboard, optionally marking the run that was just saved. */
async function showBoard(mine?: Score): Promise<void> {
  const list = document.getElementById('boardList')!, note = document.getElementById('boardNote')!;
  list.replaceChildren();
  note.textContent = 'Loading…';
  board.classList.add('on');
  const { scores, shared } = await topScores(10);
  let marked = false;
  for (const sc of scores) {
    const li = document.createElement('li');
    const n = document.createElement('span'), t = document.createElement('b');
    n.textContent = sc.name;
    t.textContent = formatTime(sc.ms);
    li.append(n, t);
    if (mine && !marked && sc.name === mine.name && sc.ms === mine.ms) { li.classList.add('me'); marked = true; }
    list.appendChild(li);
  }
  note.textContent = scores.length === 0 ? 'No times yet. Be the first!' : shared ? '' : 'Times saved on this device.';
}
function onWin(): void {
  finalMs = Math.max(0, sim.time - 1) * 1000; // the moment he got in, not the end of the 1 s hold
  document.getElementById('winTime')!.textContent = formatTime(finalMs);
  const scored = runClean && sim.scene === 'game';
  scoreForm.style.display = scored ? '' : 'none';
  savedEl.textContent = scored ? '' : 'Practice run: no time saved.';
  nameIn.value = savedName();
  win.classList.add('on');
  confetti();
  chime();
}
scoreForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nameIn.value;
  scoreForm.style.display = 'none';
  (document.activeElement as HTMLElement | null)?.blur();
  savedEl.textContent = 'Saving…';
  const { shared } = await submitScore(name, finalMs);
  savedEl.textContent = shared ? 'Saved to the scoreboard!' : 'Saved!';
  void showBoard({ name: savedName(), ms: Math.round(finalMs) });
});

/** Win celebration: a burst of little pink sausages, the same pink as the Wiener Man. */
function confetti(): void {
  const k = Math.max(0.8, Math.min(2.2, Math.min(innerWidth, innerHeight) / 620)); // scale with the screen
  for (let i = 0; i < 46; i++) {
    const p = document.createElement('i');
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, sp = (160 + Math.random() * 300) * k;
    const dx = Math.cos(a) * sp, up = Math.sin(a) * sp, spin = (Math.random() - 0.5) * 1100;
    const w = (8 + Math.random() * 6) * k, r0 = Math.random() * 360;
    p.style.width = `${w}px`;
    p.style.height = `${w * (2.1 + Math.random() * 0.5)}px`;
    confettiBox.appendChild(p);
    p.animate([
      { transform: `translate(0, 0) rotate(${r0}deg)`, opacity: 1 },
      { transform: `translate(${dx}px, ${up}px) rotate(${r0 + spin * 0.5}deg)`, opacity: 1, offset: 0.3, easing: 'ease-in' },
      { transform: `translate(${dx * 1.5}px, ${up + 620 * k}px) rotate(${r0 + spin}deg)`, opacity: 0 },
    ], { duration: 1500 + Math.random() * 900, easing: 'cubic-bezier(.15,.7,.3,1)' }).onfinish = () => p.remove();
  }
}
function applyParams(): void {
  sim.rebuild();
  view.rebuild();
}
/**
 * Title screen: steer the (invisible) floor tilt so the pill potters around a slowly wandering
 * point. A damped pull keeps it in frame; rocking along its own axis makes it flip and hop.
 */
function attractSteer(t: number): void {
  const p = sim.toLocal(sim.shell.x), v = sim.toLocal(sim.shell.v), ax = sim.toLocal(sim.axis());
  const DEG = Math.PI / 180;
  // Every so often he takes off: rolls clean out of the picture, then wanders back in.
  const CYCLE = 24, phase = t % CYCLE, trip = Math.floor(t / CYCLE) % EXITS.length;
  const away = phase > 14 && phase < 19;
  const tx = away ? EXITS[trip][0] : 4 * Math.min(1, innerWidth / innerHeight / 1.2) * Math.cos(0.19 * t);
  const tz = away ? EXITS[trip][1] : 1.5 + 2.5 * Math.sin(0.27 * t + 1);
  // Aim for a velocity toward the target (slower as he gets close) and tilt to correct the
  // difference: brisk on a trip, gentle at home, and no overshooting on the way back.
  const ex = tx - p[0], ez = tz - p[2], dist = Math.hypot(ex, ez) || 1;
  const far = dist > 7;
  const speed = Math.min(22, 2.2 * dist);
  let lx = 0.012 * ((ex / dist) * speed - v[0]), lz = 0.012 * ((ez / dist) * speed - v[2]);
  const l = Math.hypot(lx, lz) || 1, cap = (far ? 10.5 : 6) * DEG;
  if (l > cap) { lx *= cap / l; lz *= cap / l; }
  // rock end to end so the ball keeps slamming about; at home it rests between bouts
  const al = Math.hypot(ax[0], ax[2]) || 1;
  const bout = far ? 0.45 : Math.max(0, Math.sin(0.5 * t)) ** 0.5;
  const rock = 10.5 * DEG * bout * Math.sign(Math.sin(2.1 * t));
  sim.targetLean = [lx + (ax[0] / al) * rock, lz + (ax[2] / al) * rock];
}
/** Off-screen spots (x, z) for the title-screen trips: right, left, then out past the camera. */
const EXITS: [number, number][] = [[24, 3], [-24, 4], [5, 26]];

function startGame(): void {
  mode = 'play';
  menu.classList.remove('on');
  for (const e of [controlsEl, menuBtn, tools, gyroBtn]) e.classList.add('on');
  restart('game');
  view.glideTo(...CAM_PLAY);
  hintStart = performance.now();
  unlockAudio();
}
function goMenu(): void {
  mode = 'menu';
  hintStart = 0;
  ui.paused = false;
  setTuning(false);
  menu.classList.add('on');
  for (const e of [controlsEl, menuBtn, tools, gyroBtn]) e.classList.remove('on');
  board.classList.remove('on');
  setXray(false);
  restart('attract');
  view.glideTo(...CAM_MENU);
}
function setXray(on: boolean): void {
  ui.xray = on;
  view.setXray(on);
  if (xrayBtn.selected !== on) xrayBtn.selected = on;
  uiRoot.setAttribute('mode', on ? 'dark' : 'light'); // the whole UI goes dark with the radiograph
  document.body.classList.toggle('xray', on);
}
function setTuning(on: boolean): void {
  tuning = on;
  if (on) gui.show(); else gui.hide();
  stats.classList.toggle('on', on);
}
document.getElementById('start')!.addEventListener('click', startGame);
menuBtn.addEventListener('click', goMenu);
xrayBtn.addEventListener('change', () => setXray(!!xrayBtn.selected));
document.getElementById('again')!.addEventListener('click', () => { restart(); (document.activeElement as HTMLElement | null)?.blur(); });
document.getElementById('winMenu')!.addEventListener('click', goMenu);
document.getElementById('playAgain')!.addEventListener('click', () => { restart('game'); hintStart = performance.now(); });
document.getElementById('winScores')!.addEventListener('click', () => void showBoard());
document.getElementById('menuScores')!.addEventListener('click', () => void showBoard());
document.getElementById('boardClose')!.addEventListener('click', () => board.classList.remove('on'));
board.addEventListener('click', (e) => { if (e.target === board) board.classList.remove('on'); });

// ---------- GUI ----------
const gui = new GUI({ title: 'Tuning' });
const sceneNames: Record<string, SceneName> = {
  'Game (start groove)': 'game',
  'Flat plate': 'flat',
  '8° constant slope': 'slope8',
  'Upright, ball down': 'uprightDown',
  'Upright, ball up': 'uprightUp',
  'Drop into cup': 'dropCup',
};
const sceneCtl = gui.add(ui, 'scene', sceneNames).name('test scene').onChange((v: SceneName) => restart(v));
gui.add(ui, 'reset').name('reset (R)');
gui.add(ui, 'xray').name('x-ray shell (X)').onChange((v: boolean) => setXray(v)).listen();
gui.add(ui, 'timeScale', 0.1, 1, 0.05).name('slow motion ×');
gui.add(ui, 'paused').name('pause (Space)').listen();
gui.add(ui, 'step').name('step one frame (.)');
gui.add(ui, 'sound').name('ball clack sound').onChange((v: boolean) => (sound.enabled = v));

const P = sim.params;
const fPill = gui.addFolder('Pill');
fPill.add(P, 'shellMass', 0.3, 4, 0.05).name('shell mass (g)');
fPill.add(P, 'ballMass', 0.5, 10, 0.1).name('ball mass (g)');
fPill.add(P, 'shellLength', 2, 5, 0.05).name('length (cm)');
fPill.add(P, 'shellRadius', 0.5, 1.2, 0.01).name('radius (cm)');
fPill.add(P, 'wall', 0.02, 0.15, 0.005).name('wall (cm)');
fPill.add(P, 'ballRadius', 0.2, 1.0, 0.01).name('ball radius (cm)').listen();
fPill.add(P, 'endFlat', 0, 0.3, 0.005).name('end flat radius (cm)');
const fCon = gui.addFolder('Contacts');
fCon.add(P, 'muPlate', 0, 1.5, 0.01).name('friction shell↔plate');
fCon.add(P, 'restPlate', 0, 0.9, 0.01).name('restitution shell↔plate');
fCon.add(P, 'muBall', 0, 1, 0.01).name('friction ball↔shell');
fCon.add(P, 'restBall', 0, 0.9, 0.01).name('restitution ball↔shell');
fCon.add(P, 'rollResist', 0, 0.08, 0.001).name('roll resistance (cm)');
fCon.add(P, 'spinResist', 0, 0.08, 0.001).name('spin resistance (cm)');
fCon.add(P, 'ballRollResist', 0, 0.03, 0.0005).name('ball roll resist. (cm)');
fCon.add(P, 'linDamp', 0, 2, 0.01).name('linear damping (1/s)');
fCon.add(P, 'angDamp', 0, 4, 0.01).name('angular damping (1/s)');
const fSol = gui.addFolder('Solver / plate');
fSol.add(P, 'gravity', 100, 2000, 1).name('gravity (cm/s²)');
fSol.add(P, 'substeps', 17, 64, 1).name('substeps per 1/60 s');
fSol.add(P, 'iterations', 2, 30, 1).name('solver iterations');
fSol.add(P, 'maxTiltDeg', 3, 30, 0.5).name('max tilt (°)');
fSol.add(P, 'tiltResponse', 3, 40, 0.5).name('tilt response (rad/s)');
const G = sim.plate.g;
const fGeo = gui.addFolder('Plate shape');
fGeo.add(G, 'depth', 0.3, 1.5, 0.05).name('bowl depth (cm)');
fGeo.add(G, 'cupR', 0.72, 2, 0.01).name('cup curvature R (cm)');
if (import.meta.env.DEV) fGeo.add(G, 'cupDepth', 0.1, 0.7, 0.01).name('cup depth (cm)'); // local tuning only, never on the live site
fGeo.add(G, 'channelW', 0.8, 1.6, 0.05).name('channel half-width (cm)');
for (const f of [fPill, fCon, fSol, fGeo]) f.onFinishChange(() => { applyParams(); gui.controllersRecursive().forEach((c) => c.updateDisplay()); });
fCon.close(); fSol.close(); fGeo.close();
gui.add(ui, 'resetView').name('reset camera');
gui.add(ui, 'defaults').name('restore default tuning');
if (innerWidth < 700) gui.close();
setTuning(false);

// title screen: the pill potters about on the carpet by itself
restart('attract');
view.glideTo(...CAM_MENU, true);

// ---------- input ----------
addEventListener('keydown', (e) => {
  unlockAudio();
  if (isTyping(e)) return;
  if (board.classList.contains('on')) { if (e.code === 'Escape' || e.code === 'Enter') board.classList.remove('on'); return; }
  if (mode === 'menu') { if (e.code === 'Enter' || e.code === 'Space') startGame(); return; }
  if (e.code === 'Escape') goMenu();
  else if (e.code === 'KeyT') setTuning(!tuning);
  else if (e.code === 'KeyR') restart();
  else if (e.code === 'KeyX') setXray(!ui.xray);
  else if (e.code === 'Space') ui.paused = !ui.paused;
  else if (e.code === 'Period') { ui.paused = true; stepFrames = 1; }
});
addEventListener('pointerdown', unlockAudio);
if ('ontouchstart' in window && 'DeviceOrientationEvent' in window) {
  gyroBtn.classList.add('has');
  gyroBtn.addEventListener('click', async () => {
    if (input.gyroEnabled) { input.recenterGyro(); showToast('Tilt re-centred'); return; }
    const ok = await input.enableGyro();
    gyroBtn.textContent = ok ? 'Re-centre tilt' : 'Tilt not available';
  });
}

// ---------- loop ----------
let last = performance.now();
let acc = 0;
let clackPeak = 0;
function frame(now: number): void {
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;

  // tilt target, screen-relative
  const [sx, sy] = input.read(P.maxTiltDeg);
  // a finger (or the phone itself) moves the plate one-to-one; keys keep the soft easing
  sim.tiltResponseOverride = mode === 'play' && input.direct ? 70 : null;
  const az = view.azimuth();
  const max = (P.maxTiltDeg * Math.PI) / 180;
  if (mode === 'menu') {
    attractSteer(now / 1000);
  } else if (!sim.tiltLocked) {
    sim.targetLean = [
      (sx * Math.cos(az) + sy * Math.sin(az)) * max,
      (-sx * Math.sin(az) + sy * Math.cos(az)) * max,
    ];
  }

  const h = sim.dt;
  if (!ui.paused) acc += real * ui.timeScale;
  else if (stepFrames > 0) { acc += 1 / 60; stepFrames = 0; }
  let guard = 0;
  while (acc >= h && guard++ < 400) {
    sim.step(h);
    acc -= h;
    if (sim.lastBallImpulse > clackPeak) clackPeak = sim.lastBallImpulse;
  }
  if (guard >= 400) acc = 0;

  // ball impact sound: impulse well above the resting load
  const restJ = P.ballMass * P.gravity * h;
  if (mode === 'play' && clackPeak > restJ * 6) clack((clackPeak - restJ * 6) / (P.ballMass * 60));
  clackPeak = 0;

  // the slope board is finite: loop the run
  if (sim.scene === 'slope8' && sim.shell.x[2] > 34) restart();
  if (mode === 'menu') {
    // title screen: if he ever strays too far (e.g. the tab was throttled), quietly bring him back
    const far = Math.hypot(sim.shell.x[0], sim.shell.x[2]) > 45;
    if (sim.fellOff || far) restart('attract');
  } else if (sim.fellOff && !respawnAt) { respawnAt = now + 700; showToast('Whoops, off the plate!'); }
  if (respawnAt && now > respawnAt) { respawnAt = 0; sim.respawn(); view.pop(); }
  if (sim.won && !winShown) { winShown = true; onWin(); }
  if (tuning) runClean = false;
  const timed = mode === 'play' && sim.scene === 'game';
  timerEl.classList.toggle('on', timed);
  if (timed && !sim.won) timerEl.textContent = formatTime(sim.time * 1000).replace(' s', '');

  // tutorial: ring the centre hole and say what to do, for the first few seconds of a round
  let hint = 0;
  if (hintStart && mode === 'play' && sim.scene === 'game' && !sim.won) {
    const ht = (now - hintStart) / 1000;
    hint = Math.max(0, Math.min(1, ht / 0.5, (7 - ht) / 0.8));
    if (ht > 7) hintStart = 0;
  }
  // while he is settling in the hole the ring closes in on him
  const settling = mode === 'play' && sim.winTimer > 0.05 && !sim.won;
  view.progress = settling ? Math.min(1, sim.winTimer) : 0;
  view.hint = settling ? 1 : hint;
  hintEl.style.opacity = String(hint);

  const lean = Math.hypot(sim.lean[0], sim.lean[1]) * (180 / Math.PI);
  if (tuning) stats.textContent =
    `plate tilt ${lean.toFixed(1)}°   pill ${(90 - sim.tiltFromNormalDeg()).toFixed(0)}° from flat\n` +
    `ball ${sim.ballS() > 0.5 ? 'face end' : sim.ballS() < -0.5 ? 'tail end' : 'mid'}   stand-ups ${sim.stats.flips}` +
    (sim.ballInCup() ? '   IN CUP' : '') + (ui.paused ? '   [paused]' : '');

  view.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// handy for debugging from the console
Object.assign(window as any, { sim, view, ui, restart, sceneCtl, startGame, goMenu, setTuning, attractSteer });
