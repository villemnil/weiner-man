// X-ray look: everything turns into a glowing blue radiograph. Edges and steep surfaces
// glow, flat surfaces stay dark, the steel ball is the brightest thing in the picture.
import * as THREE from 'three';

export const XRAY_BG = '#020a12';

const VERT = /* glsl */ `
  varying vec3 vN; varying vec3 vV; varying vec3 vO; varying vec2 vUv;
  void main() {
    vUv = uv;
    vO = normal;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

/** Plate: dark blue sheet, walls and edges glow (object-space slope + view-angle rim). */
export function xrayPlateMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vO;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float edge = 1.0 - abs(normalize(vO).y);
        float rim = pow(1.0 - ndv, 2.0);
        vec3 c = vec3(0.025, 0.105, 0.17) + vec3(0.42, 0.82, 1.0) * (0.8 * pow(edge, 0.85) + 0.3 * rim);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** Shell: see-through film with a bright outline and the skull printed on it. */
export function xrayShellMaterial(skull: THREE.Texture, uOffset: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { map: { value: skull }, uOffset: { value: uOffset } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float uOffset;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(1.0 - ndv, 1.6);
        vec4 s = texture2D(map, vUv + vec2(uOffset, 0.0));
        vec3 c = vec3(0.5, 0.88, 1.0) * (0.3 + rim) + s.rgb * s.a;
        gl_FragColor = vec4(c, clamp(0.13 + 0.8 * rim + s.a, 0.0, 1.0));
        #include <colorspace_fragment>
      }`,
  });
}

/** Steel ball: dense, so it reads almost white. */
export function xrayBallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        gl_FragColor = vec4(mix(vec3(0.55, 0.86, 1.0), vec3(1.0), pow(ndv, 1.4)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * A friendly skull where the face is: round sockets with little pupils, a heart-shaped nose
 * and a toothy grin. Same canvas layout as the face texture (233 px/cm around, 128 px/cm along).
 */
export function skullTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const x = c.getContext('2d')!;
  x.translate(512, 172);
  x.scale(233, 128); // draw in cm from here on
  x.lineCap = 'round'; x.lineJoin = 'round';
  x.strokeStyle = '#dff8ff'; x.fillStyle = '#dff8ff';
  x.shadowColor = '#7fdcff'; x.shadowBlur = 10;
  for (const s of [-1, 1]) {
    // socket
    x.lineWidth = 0.028;
    x.beginPath(); x.ellipse(s * 0.17, -0.07, 0.125, 0.16, s * 0.12, 0, Math.PI * 2);
    x.globalAlpha = 0.16; x.fill();
    x.globalAlpha = 1; x.stroke();
    // friendly pupil, looking slightly inward
    x.beginPath(); x.arc(s * 0.15, -0.04, 0.042, 0, Math.PI * 2); x.fill();
  }
  // nose: a little upside-down heart
  x.beginPath();
  x.moveTo(0, 0.1);
  x.bezierCurveTo(0.07, 0.17, 0.06, 0.24, 0, 0.2);
  x.bezierCurveTo(-0.06, 0.24, -0.07, 0.17, 0, 0.1);
  x.fill();
  // grin: two arcs with teeth between them
  x.lineWidth = 0.024;
  const top = (u: number): number => 0.31 + 0.06 * (1 - u * u), bot = (u: number): number => 0.39 + 0.1 * (1 - u * u);
  for (const f of [top, bot]) {
    x.beginPath();
    for (let i = 0; i <= 20; i++) { const u = -1 + i / 10; if (i === 0) x.moveTo(u * 0.25, f(u)); else x.lineTo(u * 0.25, f(u)); }
    x.stroke();
  }
  x.lineWidth = 0.02;
  for (let i = -3; i <= 3; i++) {
    const u = i / 3;
    x.beginPath(); x.moveTo(u * 0.25, top(u)); x.lineTo(u * 0.25, bot(u)); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
