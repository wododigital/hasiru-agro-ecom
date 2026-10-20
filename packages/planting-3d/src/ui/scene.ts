// The three.js scene. Loaded only through `import('./scene')`, so three lives in its own chunk that the
// "View in 3D" link preloads on intent and the 3D route fetches after first paint.
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Matrix4,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Role } from '@ecomkit/core/contracts';
import { EYE_HEIGHT_FT, sunLight, walkStep, type Archetype, type PatchPoint, type ViewerData, type WalkState } from '../domain';

/** Realistic mango tree (glTF binary). The bundler emits it as a hashed static file next to this chunk. */
const MANGO_URL = new URL('../../assets/mango.glb', import.meta.url);
const MANGO = /mango/i;

export interface SceneColors {
  roles: Record<Role, string>;
  labelBg: string;
  labelFg: string;
  font: string;
}

export interface SceneOptions {
  colors: SceneColors;
  /** Template for dimension labels, e.g. "{n} ft". */
  feet: string;
  sun: number;
  rings: boolean;
  onPick: (point: PatchPoint | null) => void;
  /** Walk mode ended from inside the scene (Esc). */
  onWalkEnd: () => void;
  onStep: (step: 'model' | 'trees') => void;
}

export interface SceneHandle {
  setSun(value: number): void;
  setRings(on: boolean): void;
  setWalk(on: boolean): void;
  /** Thumbstick: x strafes, y walks (negative is forward), both -1..1. */
  setStick(x: number, y: number): void;
  dispose(): void;
}

// Scene palette (sRGB 0..255). Ground, bark and foliage are scenery, not brand colours; roles come from tokens.
const srgb = (r: number, g: number, b: number) => new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
const PALETTE = {
  sky: srgb(207, 230, 242),
  grass: srgb(95, 138, 60),
  soil: srgb(122, 86, 56),
  rib: srgb(106, 74, 48),
  drip: srgb(34, 34, 34),
  bark: srgb(122, 90, 58),
  bananaStem: srgb(107, 127, 58),
  shirt: srgb(44, 74, 122),
  skin: srgb(176, 122, 82),
  trousers: srgb(58, 58, 58),
  hemiSky: srgb(234, 244, 255),
  hemiGround: srgb(63, 90, 42),
};
const LEAF: Record<Archetype, Color> = {
  large_fruit: srgb(46, 107, 52),
  small_fruit: srgb(86, 140, 62),
  timber: srgb(58, 102, 58),
  shrub: srgb(110, 160, 70),
  banana: srgb(98, 158, 56),
};
/** Display height and crown width in ft per archetype (standard illustrations). */
const FORM: Record<Archetype, { h: number; w: number }> = {
  large_fruit: { h: 13, w: 10.4 },
  small_fruit: { h: 8, w: 6.8 },
  timber: { h: 20, w: 6.6 },
  shrub: { h: 5, w: 4.6 },
  banana: { h: 9, w: 7 },
};

const byKey = <K extends string, V>(keys: readonly K[], make: (k: K) => V) => Object.fromEntries(keys.map((k) => [k, make(k)])) as unknown as Record<K, V>;

/** Seeded random (Park-Miller) so a patch looks the same on every visit. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function makeTree(arch: Archetype, rnd: () => number, mats: { bark: Material; leaf: Material; stem: Material }): Group {
  const g = new Group();
  const { h, w } = FORM[arch];
  const add = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const trunk = (th: number, r: number) => add(new CylinderGeometry(r * 0.7, r, th, 6), mats.bark, 0, th / 2, 0);
  const blob = (r: number, x: number, y: number, z: number, sy = 1) => {
    const m = add(new IcosahedronGeometry(r, 0), mats.leaf, x, y, z);
    m.scale.y = sy;
    m.rotation.set(rnd() * 3, rnd() * 3, 0);
    return m;
  };
  if (arch === 'large_fruit') {
    trunk(h * 0.42, 0.45);
    blob(w * 0.46, 0, h * 0.64, 0, 0.78);
    blob(w * 0.3, w * 0.26, h * 0.56, 0.6);
    blob(w * 0.28, -w * 0.24, h * 0.6, -0.5);
  } else if (arch === 'small_fruit') {
    trunk(h * 0.38, 0.25);
    blob(w * 0.46, 0, h * 0.62, 0, 0.9);
    blob(w * 0.28, 0.7, h * 0.78, 0.3);
  } else if (arch === 'timber') {
    trunk(h * 0.55, 0.35);
    const c = add(new ConeGeometry(w * 0.55, h * 0.62, 7), mats.leaf, 0, h * 0.66, 0);
    c.rotation.y = rnd() * 3;
    blob(w * 0.42, 0, h * 0.48, 0, 1.1);
  } else if (arch === 'banana') {
    add(new CylinderGeometry(0.3, 0.42, h * 0.55, 7), mats.stem, 0, h * 0.275, 0);
    for (let i = 0; i < 7; i++) {
      const f = add(new BoxGeometry(w * 0.48, 0.04, 0.75), mats.leaf, 0, h * 0.55, 0);
      f.geometry.translate(w * 0.24, 0, 0);
      f.rotation.set(0, (i / 7) * Math.PI * 2 + rnd() * 0.3, 0.35 - rnd() * 0.75);
    }
  } else {
    trunk(h * 0.3, 0.12);
    blob(w * 0.38, 0, h * 0.5, 0, 1);
    blob(w * 0.3, w * 0.25, h * 0.38, 0.3);
    blob(w * 0.28, -w * 0.2, h * 0.42, -0.3);
  }
  return g;
}

function label(text: string, widthFt: number, colors: SceneColors): Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = colors.labelBg;
  g.fillRect(8, 12, 240, 72);
  g.fillStyle = colors.labelFg;
  g.font = `700 46px ${colors.font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 50);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const s = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(widthFt, widthFt * 0.375, 1);
  s.renderOrder = 10;
  return s;
}

/** Height-normalised mango geometry from the GLB, or null (the code-drawn tree is used). */
async function loadMango(): Promise<{ geo: BufferGeometry; mat: Material | Material[]; lift: number; scale: number } | null> {
  try {
    const res = await fetch(MANGO_URL.href);
    if (!res.ok) return null;
    // Embedded textures load through <img> (TextureLoader) instead of fetch(blob:), which the storefront CSP's
    // connect-src blocks; img-src allows blob:.
    const loader = new GLTFLoader().register((parser) => {
      parser.textureLoader = new TextureLoader(parser.options.manager).setCrossOrigin(parser.options.crossOrigin);
      return { name: 'image_element_textures' };
    });
    const gltf = await loader.parseAsync(await res.arrayBuffer(), '');
    let found: Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!found && (o as Mesh).isMesh) found = o as Mesh;
    });
    const mesh = found as Mesh | null;
    if (!mesh) return null;
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const height = box.max.y - box.min.y || 1;
    const scale = FORM.large_fruit.h / height;
    return { geo, mat: mesh.material, lift: -box.min.y * scale, scale };
  } catch {
    return null;
  }
}

export async function mountScene(host: HTMLElement, data: ViewerData, opts: SceneOptions): Promise<SceneHandle> {
  const wantsMango = data.points.some((p) => p.archetype === 'large_fruit' && MANGO.test(p.name));
  if (wantsMango) opts.onStep('model');
  const mango = wantsMango ? await loadMango() : null;
  opts.onStep('trees');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const { w: W0, d: D0 } = data.extent;
  const plant = data.spacing.plant;
  const row = data.spacing.row;
  const W = W0 - plant; // span between the first and last position
  const D = Math.max(0, D0 - row);
  const cx = W / 2;
  const cz = D / 2;
  const span = Math.max(W, D, 1);
  const f = data.scale;
  const width = host.clientWidth || 600;
  const height = host.clientHeight || 400;

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = PALETTE.sky;
  scene.fog = new Fog(PALETTE.sky, span + 40, span * 3 + 160);
  scene.add(new HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.6));
  const sun = new DirectionalLight(srgb(255, 255, 255), 2.4);
  sun.castShadow = true;
  const sc = span / 2 + 25;
  Object.assign(sun.shadow.camera, { left: -sc, right: sc, top: sc, bottom: -sc, near: 1, far: span * 4 + 300 });
  sun.shadow.mapSize.set(2048, 2048);
  sun.target.position.set(cx, 0, cz);
  scene.add(sun, sun.target);
  const setSun = (v: number) => {
    const s = sunLight(v);
    const r = 160;
    sun.position.set(cx + Math.cos(s.elevation) * Math.sin(s.azimuth) * r, Math.sin(s.elevation) * r, cz + Math.cos(s.elevation) * Math.cos(s.azimuth) * r);
    sun.color.setRGB(1, 0.94 - s.warmth * 0.18, 0.85 - s.warmth * 0.35, SRGBColorSpace);
    sun.intensity = s.intensity * 2;
  };
  setSun(opts.sun);

  // Ground, soil bed, raised rows with drip lines.
  const lambert = (color: Color) => new MeshLambertMaterial({ color });
  const ground = new Mesh(new PlaneGeometry(900, 900), lambert(PALETTE.grass));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, 0, cz);
  ground.receiveShadow = true;
  const bed = new Mesh(new PlaneGeometry(W + plant * 1.5, D + row * 1.5), lambert(PALETTE.soil));
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(cx, 0.03, cz);
  bed.receiveShadow = true;
  scene.add(ground, bed);
  const baseY = data.raised ? 0.35 : 0.03;
  if (data.raised) {
    const ribMat = lambert(PALETTE.rib);
    const dripMat = lambert(PALETTE.drip);
    for (let z = 0; z <= D + 1e-6; z += row) {
      const rib = new Mesh(new BoxGeometry(W + plant, 0.35, 2.4), ribMat);
      rib.position.set(cx, 0.17, z);
      rib.receiveShadow = true;
      const drip = new Mesh(new CylinderGeometry(0.06, 0.06, W + plant, 5), dripMat);
      drip.rotation.z = Math.PI / 2;
      drip.position.set(cx, 0.4, z + 0.7);
      scene.add(rib, drip);
    }
  }

  // Plants, invisible pick cylinders and M / X / O basin rings.
  const rnd = rng(11);
  const mats = { bark: lambert(PALETTE.bark), stem: lambert(PALETTE.bananaStem) };
  const leafMats = byKey(Object.keys(LEAF) as Archetype[], (k) => new MeshLambertMaterial({ color: LEAF[k], flatShading: true }));
  const ringMats = byKey(['M', 'X', 'O'] as const, (r) => new MeshBasicMaterial({ color: new Color(opts.colors.roles[r]), side: DoubleSide }));
  const pickMat = new MeshBasicMaterial({ visible: false });
  const rings = new Group();
  const picks: Mesh[] = [];
  const mangoAt: Matrix4[] = [];
  const dummy = new Object3D();
  for (const p of data.points) {
    const s = f * (0.9 + rnd() * 0.2);
    const rot = rnd() * Math.PI * 2;
    if (mango && p.archetype === 'large_fruit' && MANGO.test(p.name)) {
      dummy.position.set(p.x, baseY + mango.lift * s, p.z);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.setScalar(mango.scale * s);
      dummy.updateMatrix();
      mangoAt.push(dummy.matrix.clone());
    } else {
      const t = makeTree(p.archetype, rnd, { ...mats, leaf: leafMats[p.archetype] });
      t.scale.setScalar(s);
      t.position.set(p.x, baseY, p.z);
      t.rotation.y = rot;
      scene.add(t);
    }
    const h = FORM[p.archetype].h * s;
    const pick = new Mesh(new CylinderGeometry(2.6 * f, 2.6 * f, h, 8), pickMat);
    pick.position.set(p.x, baseY + h / 2, p.z);
    pick.userData.point = p;
    picks.push(pick);
    scene.add(pick);
    const ring = new Mesh(new RingGeometry(1.1 * f + 0.2, 1.6 * f + 0.3, 24), ringMats[p.role]);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, baseY + 0.04, p.z);
    rings.add(ring);
  }
  if (mango && mangoAt.length) {
    const inst = new InstancedMesh(mango.geo, mango.mat, mangoAt.length);
    mangoAt.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = true;
    inst.receiveShadow = true;
    scene.add(inst);
  }
  rings.visible = opts.rings;
  scene.add(rings);

  // A 5.5 ft person for scale.
  const person = new Group();
  const torso = new Mesh(new CylinderGeometry(0.55, 0.65, 3.4, 8), lambert(PALETTE.shirt));
  torso.position.y = 2.2;
  const legs = new Mesh(new CylinderGeometry(0.5, 0.45, 1.5, 8), lambert(PALETTE.trousers));
  legs.position.y = 0.75;
  const head = new Mesh(new SphereGeometry(0.45, 10, 8), lambert(PALETTE.skin));
  head.position.y = 5;
  for (const o of [torso, legs, head]) {
    o.castShadow = true;
    person.add(o);
  }
  person.position.set(-plant * 0.6 - 1.5, 0, cz);
  scene.add(person);

  // Spacing labels along the row and between rows.
  const lw = f < 1 ? 2.6 : 6;
  const dim = (a: [number, number, number], b: [number, number, number], ft: number) => {
    const line = new Line(new BufferGeometry().setFromPoints([new Vector3(...a), new Vector3(...b)]), new LineBasicMaterial({ color: new Color(opts.colors.labelFg), depthTest: false }));
    line.renderOrder = 9;
    const l = label(opts.feet.replace('{n}', String(ft)), lw, opts.colors);
    l.position.set((a[0] + b[0]) / 2, a[1] + lw * 0.3, (a[2] + b[2]) / 2);
    scene.add(line, l);
  };
  dim([0, 0.6, -row * 0.45 - 1], [plant, 0.6, -row * 0.45 - 1], plant);
  if (D > 0) dim([W + plant * 0.45 + 1, 0.6, 0], [W + plant * 0.45 + 1, 0.6, row], row);

  // Camera, orbit, walk.
  const camera = new PerspectiveCamera(50, width / height, 0.1, 2000);
  const dist = Math.max(span, 26) * (width < height ? 1.6 : 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 6;
  controls.maxDistance = span * 3 + 120;
  controls.enableDamping = true;
  const aerial = () => {
    camera.position.set(cx + dist * 0.5, dist * 0.55 + 4, cz + dist * 0.8);
    controls.target.set(cx, 2, cz);
    controls.update();
  };
  aerial();

  const bounds = { minX: -plant * 1.5 - 6, maxX: W + plant * 1.5 + 6, minZ: -row * 1.5 - 6, maxZ: D + row * 1.5 + 6 };
  let walking = false;
  let walk: WalkState = { x: 0, z: 0, yaw: 0 };
  let pitch = 0;
  const keys = { f: 0, b: 0, l: 0, r: 0, sl: 0, sr: 0 };
  const stick = { x: 0, y: 0 };
  const setWalk = (on: boolean) => {
    walking = on;
    controls.enabled = !on;
    Object.assign(keys, { f: 0, b: 0, l: 0, r: 0, sl: 0, sr: 0 });
    Object.assign(stick, { x: 0, y: 0 });
    if (on) {
      // Start at the head of the first aisle looking down it; a dense planting has no aisle, so start outside.
      walk = f < 1 || D === 0 ? { x: cx, z: D + row * 1.2 + 6, yaw: 0 } : { x: -plant * 1.5, z: row / 2, yaw: -Math.PI / 2 };
      pitch = -0.06;
    } else {
      camera.rotation.set(0, 0, 0);
      aerial();
    }
  };
  const KEYMAP: Record<string, keyof typeof keys> = { ArrowUp: 'f', w: 'f', W: 'f', ArrowDown: 'b', s: 'b', S: 'b', ArrowLeft: 'l', ArrowRight: 'r', a: 'sl', A: 'sl', d: 'sr', D: 'sr' };
  const onKey = (e: KeyboardEvent) => {
    if (!walking) return;
    if (e.key === 'Escape' && e.type === 'keydown') {
      setWalk(false);
      opts.onWalkEnd();
      return;
    }
    const k = KEYMAP[e.key];
    if (!k) return;
    e.preventDefault();
    keys[k] = e.type === 'keydown' ? 1 : 0;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  // Tap to identify (a press that did not drag); drag to look around while walking.
  const ray = new Raycaster();
  const ptr = new Vector2();
  let down: [number, number] | null = null;
  let drag: [number, number] | null = null;
  const el = renderer.domElement;
  const onDown = (e: PointerEvent) => {
    down = [e.clientX, e.clientY];
    if (walking) drag = [e.clientX, e.clientY];
  };
  const onMove = (e: PointerEvent) => {
    if (!walking || !drag) return;
    walk = { ...walk, yaw: walk.yaw - (e.clientX - drag[0]) * 0.005 };
    pitch = Math.max(-0.6, Math.min(0.6, pitch - (e.clientY - drag[1]) * 0.004));
    drag = [e.clientX, e.clientY];
  };
  const onUp = (e: PointerEvent) => {
    drag = null;
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const b = el.getBoundingClientRect();
    ptr.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(picks, false)[0];
    opts.onPick(hit ? (hit.object.userData.point as PatchPoint) : null);
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);

  const resize = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  let raf = 0;
  let last = performance.now();
  const loop = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    if (walking) {
      walk = walkStep(walk, { forward: keys.f - keys.b - stick.y, strafe: keys.sr - keys.sl + stick.x, turn: keys.l - keys.r }, dt, bounds);
      camera.position.set(walk.x, EYE_HEIGHT_FT, walk.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(pitch, walk.yaw, 0);
    } else controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    setSun,
    setRings: (on) => void (rings.visible = on),
    setWalk,
    setStick: (x, y) => Object.assign(stick, { x, y }),
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      controls.dispose();
      scene.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
        const list = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of list) {
          (mat as MeshBasicMaterial).map?.dispose();
          mat.dispose();
        }
      });
      renderer.dispose();
      el.remove();
    },
  };
}
