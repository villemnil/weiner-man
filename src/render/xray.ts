// X-ray look: everything turns into a glowing blue radiograph. Edges and steep surfaces
// glow, flat surfaces stay dark, the steel ball is the brightest thing in the picture.
import * as THREE from 'three';
import skullSvg from '../assets/skeleton.svg?raw';

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

export type EyeStyle = 'stroke' | 'fill' | 'both';

/**
 * The skull face (src/assets/skeleton.svg) where the normal face is, tinted the radiograph's
 * pale blue with a soft glow. Same canvas layout as the face texture (233 px/cm around the
 * pill, 128 px/cm along it). `eyes` picks how the two big sockets are drawn:
 *   'stroke' - outlined sockets with only a faint tint inside
 *   'fill'   - solid shapes, no outline      'both' - the artwork as drawn (solid + outline)
 */
export function skullTexture(eyes: EyeStyle = 'stroke'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const x = c.getContext('2d')!;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;

  let svg = skullSvg;
  if (eyes === 'stroke') {
    // the two eye ellipses are the only rx="49.5" shapes: keep their outline, fade the fill
    svg = svg.replace(/(<ellipse[^>]*rx="49\.5"[^>]*)fill="white"/g, '$1fill="white" fill-opacity="0.13"');
  } else if (eyes === 'fill') {
    svg = svg.replace(/(mask="url\(#stroke[01]_[^"]*\)")/g, '$1 stroke-opacity="0"');
  }
  const img = new Image();
  img.onload = () => {
    // Same width and top edge as the normal face, so the features sit where his face was.
    const w = 0.78 * 233, h = ((0.78 * img.naturalHeight) / img.naturalWidth) * 128; // whatever the artwork's shape
    const left = 512 - w / 2, top = 172 - (((0.78 * 322) / 276) * 128) / 2;
    // tint: draw the white artwork on a scratch canvas and recolour it, then stamp it with a glow
    const s = document.createElement('canvas');
    s.width = Math.ceil(w); s.height = Math.ceil(h);
    const sx = s.getContext('2d')!;
    sx.drawImage(img, 0, 0, s.width, s.height);
    sx.globalCompositeOperation = 'source-in';
    sx.fillStyle = '#dff8ff';
    sx.fillRect(0, 0, s.width, s.height);
    x.clearRect(0, 0, c.width, c.height);
    x.shadowColor = '#7fdcff';
    x.shadowBlur = 10;
    x.drawImage(s, left, top);
    t.needsUpdate = true;
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return t;
}
