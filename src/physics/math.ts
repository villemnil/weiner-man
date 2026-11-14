// Minimal vector / quaternion helpers. No dependencies.
export type V3 = [number, number, number];
/** Quaternion as [x, y, z, w]. */
export type Q = [number, number, number, number];
/** Row-major 3x3. */
export type M3 = [number, number, number, number, number, number, number, number, number];

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const addS = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
};
/** In-place a += b * s */
export const incS = (a: V3, b: V3, s: number): void => {
  a[0] += b[0] * s;
  a[1] += b[1] * s;
  a[2] += b[2] * s;
};

export const qIdent = (): Q => [0, 0, 0, 1];
export const qMul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qConj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
export const qNormalize = (q: Q): Q => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
/** Quaternion from a rotation vector (axis * angle). */
export const qFromRotVec = (v: V3): Q => {
  const ang = len(v);
  if (ang < 1e-10) return qNormalize([v[0] / 2, v[1] / 2, v[2] / 2, 1]);
  const s = Math.sin(ang / 2) / ang;
  return [v[0] * s, v[1] * s, v[2] * s, Math.cos(ang / 2)];
};
/** Shortest-arc quaternion taking unit a to unit b. */
export const qFromTo = (a: V3, b: V3): Q => {
  const d = dot(a, b);
  if (d < -0.999999) {
    const ax = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 0, 1]);
    const n = norm(ax);
    return [n[0], n[1], n[2], 0];
  }
  const c = cross(a, b);
  return qNormalize([c[0], c[1], c[2], 1 + d]);
};
export const qToM3 = (q: Q): M3 => {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ];
};
export const mMul = (m: M3, v: V3): V3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
/** Transpose(m) * v */
export const mTMul = (m: M3, v: V3): V3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];
/** Integrate orientation by world angular velocity w over h. */
export const qIntegrate = (q: Q, w: V3, h: number): Q => {
  const dq = qMul([w[0], w[1], w[2], 0], q);
  return qNormalize([
    q[0] + 0.5 * h * dq[0],
    q[1] + 0.5 * h * dq[1],
    q[2] + 0.5 * h * dq[2],
    q[3] + 0.5 * h * dq[3],
  ]);
};
export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
