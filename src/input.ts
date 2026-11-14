// Tilt input: mouse / touch drag, WASD + arrows, and device orientation.
// Returns a lean target in "screen" terms (right, toward-viewer) scaled to [-1, 1].
export class TiltInput {
  private keys = new Set<string>();
  private drag: { x0: number; y0: number; dx: number; dy: number; id: number } | null = null;
  private gyro: [number, number] | null = null;
  private gyroBase: [number, number] | null = null;
  gyroEnabled = false;

  constructor(private el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.drag = null; });
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (this.drag) { this.drag = null; return; } // second finger: let orbit controls take over
      this.drag = { x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, id: e.pointerId };
    });
    addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.drag.dx = e.clientX - this.drag.x0;
      this.drag.dy = e.clientY - this.drag.y0;
    });
    const end = (e: PointerEvent): void => { if (this.drag && e.pointerId === this.drag.id) this.drag = null; };
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Must be called from a user gesture (iOS permission prompt). */
  async enableGyro(): Promise<boolean> {
    const D = (window as any).DeviceOrientationEvent;
    if (!D) return false;
    try {
      if (typeof D.requestPermission === 'function' && (await D.requestPermission()) !== 'granted') return false;
    } catch { return false; }
    this.gyroBase = null;
    addEventListener('deviceorientation', (e) => {
      if (e.beta == null || e.gamma == null) return;
      if (!this.gyroBase) this.gyroBase = [e.gamma, e.beta];
      this.gyro = [e.gamma - this.gyroBase[0], e.beta - this.gyroBase[1]];
    });
    this.gyroEnabled = true;
    return true;
  }
  recenterGyro(): void { this.gyroBase = null; }

  /** [right, towardViewer], each in [-1, 1] (1 = max tilt). `maxDeg` scales the gyro. */
  read(maxDeg: number): [number, number] {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (x !== 0 || y !== 0) {
      const l = Math.hypot(x, y);
      return [x / l, y / l];
    }
    if (this.drag) {
      const full = Math.min(innerWidth, innerHeight) * 0.22; // px of drag for full tilt
      x = this.drag.dx / full; y = this.drag.dy / full;
    } else if (this.gyro) {
      x = this.gyro[0] / maxDeg; y = this.gyro[1] / maxDeg;
    }
    const l = Math.hypot(x, y);
    return l > 1 ? [x / l, y / l] : [x, y];
  }
  get dragging(): boolean { return !!this.drag; }
  /** True while the tilt comes straight from a hand (drag or phone tilt), not from keys. */
  get direct(): boolean {
    const k = this.keys;
    const keyed = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].some((c) => k.has(c));
    return !keyed && (!!this.drag || !!this.gyro);
  }
}
