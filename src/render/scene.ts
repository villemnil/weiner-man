import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sim } from '../physics/sim';
import { buildPlateGeometry, buildDecals } from './plateMesh';
import faceUrl from '../assets/weiner.svg';
import { EyeStyle, XRAY_BG, skullTexture, xrayBallMaterial, xrayPlateMaterial, xrayShellMaterial } from './xray';

const GROUND_Y = -6;
const FACE_U_OFFSET = 0.175;
const NORMAL_BG = '#3b2a20';
const PINK = new THREE.Color('#ff7ab8');

function carpetTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = '#7a4a2c';
  x.fillRect(0, 0, 512, 512);
  const cols = ['#a8623a', '#8a4f2e', '#c07a45', '#6b3d27', '#93705a', '#b0623e', '#5d3a2a', '#8c7466', '#d08a4e'];
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 9000; i++) {
    x.fillStyle = cols[(rnd() * cols.length) | 0];
    x.globalAlpha = 0.5 + rnd() * 0.5;
    const px = rnd() * 512, py = rnd() * 512, r = 1.5 + rnd() * 3.5;
    x.beginPath();
    x.ellipse(px, py, r, r * (0.5 + rnd() * 0.6), rnd() * 3.14, 0, 6.3);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, 9);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function faceTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const x = c.getContext('2d')!;
  // v runs along the capsule: canvas top = +axis end. Two-tone like the real one.
  x.fillStyle = '#ee5c9f';
  x.fillRect(0, 0, 1024, 256);
  x.fillStyle = '#e4488f';
  x.fillRect(0, 256, 1024, 256);
  x.fillStyle = 'rgba(150,40,95,0.55)';
  x.fillRect(0, 253, 1024, 5); // seam
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.offset.x = FACE_U_OFFSET; // puts the face on the side that looks up at the start
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  // The face artwork (src/assets/weiner.svg), on the upper half. The canvas is stretched
  // differently around the pill (~233 px/cm) than along it (~128 px/cm), so size it in cm.
  const img = new Image();
  img.onload = () => {
    const wCm = 0.78, hCm = (wCm * 322) / 276;
    const w = wCm * 233, h = hCm * 128;
    x.drawImage(img, 512 - w / 2, 172 - h / 2, w, h);
    t.needsUpdate = true;
  };
  img.src = faceUrl;
  return t;
}

function ballTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#d9dde2';
  x.fillRect(0, 0, 256, 128);
  x.fillStyle = '#7d858f';
  x.fillRect(0, 56, 256, 16); // equator band so you can see it roll
  x.fillRect(120, 0, 16, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  plateGroup = new THREE.Group();
  plateMesh!: THREE.Mesh;
  decals: THREE.Group | null = null;
  pill!: THREE.Mesh;
  ball!: THREE.Mesh;
  plateMat: THREE.MeshPhysicalMaterial;
  shellMat: THREE.MeshPhysicalMaterial;
  private ballMat: THREE.MeshStandardMaterial;
  private xPlateMat = xrayPlateMaterial();
  private xBallMat = xrayBallMaterial();
  private xShellMat = xrayShellMaterial(skullTexture(), FACE_U_OFFSET);
  xray = false;
  private lite = false;
  private builtKey = '';
  private boardMat: THREE.MeshPhysicalMaterial;
  private follow = new THREE.Vector3();
  private sun!: THREE.DirectionalLight;
  private ground!: THREE.Mesh;
  private ring!: THREE.Mesh;
  private camGoal: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  /** 0..1 opacity of the tutorial ring around the centre hole. */
  hint = 0;
  /** 0..1 while the pill is settling in the hole: the ring closes in and turns pink. */
  progress = 0;
  private popAt = -1e9;

  constructor(container: HTMLElement, private sim: Sim) {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    // phones: lighter plate mesh and shadows
    this.lite = matchMedia('(pointer: coarse)').matches;
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    container.appendChild(r.domElement);

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    this.scene.background = new THREE.Color('#3b2a20');
    this.scene.fog = new THREE.Fog('#3b2a20', 90, 220);

    this.camera = new THREE.PerspectiveCamera(34, 1, 1, 400);
    this.camera.position.set(0, 28, 24.8);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, 0, 2.1);
    this.controls.saveState();
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 55;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 1.2;
    this.controls.minAzimuthAngle = -0.9;
    this.controls.maxAzimuthAngle = 0.9;
    // left drag / one finger tilts the plate; right drag / two fingers orbit
    this.controls.mouseButtons = { LEFT: -1 as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: -1 as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.update();

    const sun = new THREE.DirectionalLight('#fff4e0', 2.1);
    sun.position.set(-22, 34, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.lite ? 1024 : 2048, this.lite ? 1024 : 2048);
    const sc = sun.shadow.camera;
    sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 5; sc.far = 90;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 5;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight('#fff1dd', '#5a3a28', 0.25));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 1 }),
    );
    (ground.material.map as THREE.Texture).repeat.set(40, 40);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

    // tutorial marker: a soft pulsing ring around the centre hole
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.26, 1.45, 72),
      new THREE.MeshBasicMaterial({ color: '#fff6e5', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.05;
    this.ring.renderOrder = 3;
    this.ring.visible = false;
    this.plateGroup.add(this.ring);

    this.plateMat = new THREE.MeshPhysicalMaterial({
      color: '#eea200', roughness: 0.38, clearcoat: 0.45, clearcoatRoughness: 0.25, side: THREE.DoubleSide,
    });
    this.ballMat = new THREE.MeshStandardMaterial({ map: ballTexture(), metalness: 0.95, roughness: 0.22 });
    this.shellMat = new THREE.MeshPhysicalMaterial({
      map: faceTexture(), roughness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.15,
    });
    // board for the slope scene: same plastic, with 2 cm stripes so the travel is readable
    const bc = document.createElement('canvas');
    bc.width = bc.height = 64;
    const bx = bc.getContext('2d')!;
    bx.fillStyle = '#eea200'; bx.fillRect(0, 0, 64, 64);
    bx.fillStyle = '#d98f00'; bx.fillRect(0, 0, 64, 32);
    const bt = new THREE.CanvasTexture(bc);
    bt.wrapS = bt.wrapT = THREE.RepeatWrapping;
    bt.repeat.set(1, 20);
    bt.colorSpace = THREE.SRGBColorSpace;
    this.boardMat = new THREE.MeshPhysicalMaterial({ map: bt, roughness: 0.38, clearcoat: 0.45, clearcoatRoughness: 0.25 });
    this.sun = sun;
    this.scene.add(sun.target);
    this.scene.add(this.plateGroup);
    this.rebuild();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /** (Re)build meshes whose shape depends on tunable parameters. */
  rebuild(): void {
    const p = this.sim.params, g = this.sim.plate.g;
    const key = JSON.stringify([g, p.shellLength, p.shellRadius, p.ballRadius]);
    if (key === this.builtKey) return;
    this.builtKey = key;
    if (this.plateMesh) { this.plateGroup.remove(this.plateMesh); this.plateMesh.geometry.dispose(); }
    if (this.decals) this.plateGroup.remove(this.decals);
    if (g.mode === 'plane') {
      // open flat board for the slope test scene
      const slab = new THREE.BoxGeometry(46, 0.3, 80);
      slab.translate(0, -0.15, 8);
      this.plateMesh = new THREE.Mesh(slab, this.boardMat);
      this.decals = null;
    } else {
      this.plateMesh = new THREE.Mesh(this.lite ? buildPlateGeometry(this.sim.plate, 540, 170) : buildPlateGeometry(this.sim.plate), this.plateMat);
      this.decals = buildDecals(this.sim.plate, this.plateMat);
      this.plateGroup.add(this.decals);
    }
    this.plateMesh.receiveShadow = true;
    this.plateMesh.castShadow = true;
    this.plateGroup.add(this.plateMesh);

    if (this.pill) { this.scene.remove(this.pill); this.pill.geometry.dispose(); }
    if (this.ball) { this.scene.remove(this.ball); this.ball.geometry.dispose(); }
    const cyl = Math.max(0.01, p.shellLength - 2 * p.shellRadius);
    this.pill = new THREE.Mesh(new THREE.CapsuleGeometry(p.shellRadius, cyl, 20, 40), this.shellMat);
    this.pill.castShadow = true;
    this.pill.renderOrder = 2;
    this.scene.add(this.pill);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(p.ballRadius, 32, 20), this.ballMat);
    this.ball.renderOrder = 1;
    this.scene.add(this.ball);
    this.setXray(this.xray);
  }

  setXray(on: boolean): void {
    this.xray = on;
    const board = this.sim.plate.g.mode === 'plane';
    const plate = on ? this.xPlateMat : board ? this.boardMat : this.plateMat;
    this.plateMesh.material = plate;
    this.decals?.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = on ? this.xPlateMat : this.plateMat; });
    this.pill.material = on ? this.xShellMat : this.shellMat;
    this.ball.material = on ? this.xBallMat : this.ballMat;
    this.ball.visible = on;
    // a radiograph has no carpet and no cast shadows
    this.ground.visible = !on;
    this.plateMesh.castShadow = !on;
    this.pill.castShadow = !on;
    (this.scene.background as THREE.Color).set(on ? XRAY_BG : NORMAL_BG);
  }

  resize(): void {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep the whole plate in view on narrow / portrait screens
    this.camera.fov = w / h < 1 ? 34 + (1 - w / h) * 30 : h < 520 ? 27 : 34; // short landscape phones: zoom in
    this.camera.updateProjectionMatrix();
  }

  /** Swap how the x-ray skull's eye sockets are drawn (for comparing looks). */
  setSkullEyes(style: EyeStyle): void {
    (this.xShellMat.uniforms.map.value as THREE.Texture).dispose();
    this.xShellMat.uniforms.map.value = skullTexture(style);
  }

  /** Make the pill pop in (call after placing it). */
  pop(): void { this.popAt = performance.now(); }

  /** Glide the camera to a new viewpoint. */
  glideTo(pos: [number, number, number], target: [number, number, number], instant = false): void {
    const goal = { pos: new THREE.Vector3(...pos), target: new THREE.Vector3(...target) };
    if (instant) {
      this.camera.position.copy(goal.pos);
      this.controls.target.copy(goal.target);
      this.camGoal = null;
    } else this.camGoal = goal;
  }

  /** Camera azimuth around +y (0 = default view), used to keep drag directions screen-relative. */
  azimuth(): number {
    return this.controls.getAzimuthalAngle();
  }

  render(): void {
    const s = this.sim;
    const attract = s.scene === 'attract';
    this.plateGroup.visible = !attract;
    this.ground.position.y = attract ? 0 : GROUND_Y;
    this.plateGroup.quaternion.set(s.plateQ[0], s.plateQ[1], s.plateQ[2], s.plateQ[3]);
    this.pill.position.set(s.shell.x[0], s.shell.x[1], s.shell.x[2]);
    this.pill.quaternion.set(s.shell.q[0], s.shell.q[1], s.shell.q[2], s.shell.q[3]);
    this.ball.position.set(s.ball.x[0], s.ball.x[1], s.ball.x[2]);
    this.ball.quaternion.set(s.ball.q[0], s.ball.q[1], s.ball.q[2], s.ball.q[3]);
    if (attract) {
      // On the title screen the floor is what tilts in the physics, but it is drawn level:
      // show the pill in the floor's own frame so it looks like it is moving by itself.
      const inv = this.plateGroup.quaternion.clone().invert();
      for (const m of [this.pill, this.ball]) {
        m.position.applyQuaternion(inv);
        m.quaternion.premultiply(inv);
      }
    }
    // tutorial ring
    const ringMat = this.ring.material as THREE.MeshBasicMaterial;
    this.ring.visible = this.hint > 0.01 && s.plate.g.mode === 'plate';
    const pulse = Math.sin(performance.now() / 260);
    if (this.progress > 0) {
      ringMat.color.set('#fff6e5').lerp(PINK, Math.min(1, this.progress * 1.4));
      ringMat.opacity = 0.9;
      this.ring.scale.setScalar(1.05 - 0.3 * this.progress);
    } else {
      ringMat.color.set('#fff6e5');
      ringMat.opacity = this.hint * (0.55 + 0.3 * pulse);
      this.ring.scale.setScalar(1 + 0.07 * pulse);
    }
    // little pop when the pill (re)appears
    const pt = (performance.now() - this.popAt) / 300;
    const ps = pt >= 1 ? 1 : 1 + 2.7 * (pt - 1) ** 3 + 1.7 * (pt - 1) ** 2; // ease-out-back
    this.pill.scale.setScalar(Math.max(0.01, ps));
    this.ball.scale.setScalar(Math.max(0.01, ps));
    if (this.camGoal) {
      this.camera.position.lerp(this.camGoal.pos, 0.07);
      this.controls.target.lerp(this.camGoal.target, 0.07);
      if (this.camera.position.distanceTo(this.camGoal.pos) < 0.02) this.camGoal = null;
    }
    // on the open board, keep the pill in frame by sliding camera, target and light together
    const want = s.scene === 'slope8' ? new THREE.Vector3(s.shell.x[0], 0, s.shell.x[2] - 2) : new THREE.Vector3();
    const d = want.sub(this.follow);
    if (d.lengthSq() > 1e-8) {
      this.follow.add(d);
      this.camera.position.add(d);
      this.controls.target.add(d);
      this.sun.position.add(d);
      this.sun.target.position.add(d);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
