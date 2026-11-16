import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Store } from '../app/store';
import { catalogEntry } from '../catalog/catalog';
import { itemCorners } from '../geometry/collide';
import { bbox, dot, leftNormal, norm, projectOnSegment, sub } from '../geometry/vec';
import type { Item, Level, Opening, Vec2 } from '../model/types';
import {
  buildHub,
  buildItem,
  buildOpening,
  buildSlab,
  buildWall,
  material,
  MM,
  type WallMeshes,
} from './meshes';

export type CameraMode = 'orbit' | 'top' | 'iso' | 'walk';
export type WallMode = 'auto' | 'all' | 'dollhouse';

const WALL_COLOR = '#ece9e3';
const WALL_TOP = '#6d7179';
const FLOOR_DEFAULTS = ['#e6dfd1', '#dde3dc', '#e0dde6', '#e6ddd8', '#dbe1e6', '#e4e0d4'];
const CUT_AUTO = 300;
const CUT_DOLLHOUSE = 1100;
const EYE = 1600;
const BODY_R = 250;

interface WallEntry {
  id: string;
  full: THREE.Group;
  cut: THREE.Group | null;
  cutH: number;
  mid: Vec2;
  /** Outward normal (away from the building centre). */
  nOut: Vec2;
  build: (cut: number) => THREE.Group;
}

interface HubEntry {
  full: THREE.Group;
  cut: THREE.Group | null;
  cutH: number;
  walls: string[];
  build: (cut: number) => THREE.Group;
}

function meshesToGroup(m: WallMeshes): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Mesh(m.sides, material(WALL_COLOR));
  s.castShadow = true;
  s.receiveShadow = true;
  const t = new THREE.Mesh(m.top, material(WALL_TOP));
  g.add(s, t);
  return g;
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh && c.geometry.userData['shared'] !== true) {
      // Unit primitives are shared across items; only per-wall/floor geometry is owned.
      if (c.userData['owned']) c.geometry.dispose();
    }
  });
}

function owned<T extends THREE.Object3D>(g: T): T {
  g.traverse((c) => {
    if (c instanceof THREE.Mesh) c.userData['owned'] = true;
  });
  return g;
}

/**
 * Greybox 3D view of the current level. View-only: it follows the store
 * (including live 2D drag previews) and never edits the document.
 */
export class View3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private persp: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;
  private orbit: OrbitControls;
  private orthoCtl: OrbitControls;
  private structure = new THREE.Group();
  private itemsGroup = new THREE.Group();
  private ground: THREE.Mesh;
  private grid: THREE.GridHelper;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private walls: WallEntry[] = [];
  private hubs: HubEntry[] = [];
  private ceilings = new THREE.Group();
  private items = new Map<string, { src: Item; selected: boolean; g: THREE.Group }>();
  private lastStructKey: unknown[] = [];
  private raf = 0;
  private syncQueued = false;
  private active = false;
  private fitted = false;
  private box = { minX: 0, minY: 0, maxX: 6000, maxY: 4500 };
  private center: Vec2 = { x: 3000, y: 2250 };
  private collision: [Vec2, Vec2][] = [];
  private resizeObs: ResizeObserver;
  private unsub: () => void;
  cameraMode: CameraMode = 'orbit';
  wallMode: WallMode = 'auto';
  showCeiling = false;
  /** Called after each frame (tests / UI). */
  onFrame: (() => void) | null = null;
  frames = 0;

  // walk state
  private walk = {
    x: 0,
    y: 0,
    yaw: 0,
    pitch: -0.05,
    keys: new Set<string>(),
    joy: { x: 0, y: 0 },
    last: 0,
    running: false,
  };
  private joystick: HTMLDivElement | null = null;

  constructor(
    private host: HTMLElement,
    private store: Store,
    opts: { preserve?: boolean; lowPower?: boolean } = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: !opts.lowPower,
      preserveDrawingBuffer: !!opts.preserve,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(opts.lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = !opts.lowPower;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'view3d-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', '3D view (view only)');
    host.appendChild(this.canvas);

    this.scene.background = new THREE.Color('#f3f2ee');
    this.persp = new THREE.PerspectiveCamera(50, 1, 0.05, 400);
    this.ortho = new THREE.OrthographicCamera(-5, 5, 5, -5, -100, 300);
    this.orbit = new OrbitControls(this.persp, this.canvas);
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.minDistance = 1;
    this.orbit.maxDistance = 120;
    this.orthoCtl = new OrbitControls(this.ortho, this.canvas);
    this.orthoCtl.enabled = false;
    this.orthoCtl.screenSpacePanning = true;
    for (const c of [this.orbit, this.orthoCtl]) {
      c.addEventListener('change', () => {
        this.updateCutaway();
        this.requestRender();
      });
    }

    const hemi = new THREE.HemisphereLight('#ffffff', '#b9b2a4', 1.25);
    this.hemi = hemi;
    this.sun = new THREE.DirectionalLight('#ffffff', 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(hemi, this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material('#e7e5df'));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.012;
    this.ground.receiveShadow = true;
    this.grid = new THREE.GridHelper(1, 1, '#cfcbc2', '#dedad2');
    this.grid.position.y = -0.006;
    this.scene.add(this.ground, this.grid, this.structure, this.itemsGroup);
    this.structure.add(this.ceilings);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.unsub = store.subscribe((reason) => {
      if (reason === 'view' || reason === 'tool') return;
      this.queueSync();
    });
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.host.dataset['lost'] = '1';
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      delete this.host.dataset['lost'];
      this.lastStructKey = [];
      this.items.forEach((v) => disposeTree(v.g));
      this.items.clear();
      this.itemsGroup.clear();
      this.queueSync();
    });
    this.bindWalkInput();
    this.resize();
  }

  // ------------------------------------------------------------ lifecycle
  setActive(on: boolean): void {
    this.active = on;
    if (on) {
      this.resize();
      this.queueSync();
    }
  }

  dispose(): void {
    this.unsub();
    this.resizeObs.disconnect();
    this.orbit.dispose();
    this.orthoCtl.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  private get camera(): THREE.Camera {
    return this.cameraMode === 'top' || this.cameraMode === 'iso' ? this.ortho : this.persp;
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.updateOrthoFrustum();
    this.requestRender();
  }

  private orthoHalf = 5;
  private updateOrthoFrustum(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    const a = w / h;
    this.ortho.left = -this.orthoHalf * a;
    this.ortho.right = this.orthoHalf * a;
    this.ortho.top = this.orthoHalf;
    this.ortho.bottom = -this.orthoHalf;
    this.ortho.updateProjectionMatrix();
  }

  requestRender(): void {
    if (!this.active || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    this.onFrame?.();
  }

  // ------------------------------------------------------------ sync
  private queueSync(): void {
    if (!this.active || this.syncQueued) return;
    this.syncQueued = true;
    requestAnimationFrame(() => {
      this.syncQueued = false;
      this.sync();
    });
  }

  /** Rebuilds whatever changed since last time (by object identity of the immutable document). */
  sync(): void {
    const s = this.store;
    const lv = s.level;
    const key = [lv.walls, lv.nodes, lv.openings, lv.rooms, lv.height];
    if (key.some((k, i) => k !== this.lastStructKey[i])) {
      this.lastStructKey = key;
      this.rebuildStructure(lv);
    }
    this.syncItems(lv);
    if (!this.fitted && (Object.keys(lv.walls).length || Object.keys(lv.items).length)) {
      this.fitted = true;
      this.fit();
    }
    this.updateCutaway();
    this.requestRender();
  }

  private rebuildStructure(lv: Level): void {
    for (const c of [...this.structure.children]) {
      if (c === this.ceilings) continue;
      disposeTree(c);
      this.structure.remove(c);
    }
    disposeTree(this.ceilings);
    this.ceilings.clear();
    this.walls = [];
    this.hubs = [];
    const d = this.store.derived;
    const fps = d.footprints;

    // bounds + centre
    const pts: Vec2[] = [];
    for (const f of fps.walls.values()) pts.push(...f.poly);
    for (const it of Object.values(lv.items)) pts.push(...itemCorners(it));
    this.box = pts.length ? bbox(pts) : { minX: 0, minY: 0, maxX: 6000, maxY: 4500 };
    this.center = { x: (this.box.minX + this.box.maxX) / 2, y: (this.box.minY + this.box.maxY) / 2 };
    this.updateEnvironment();

    const openingsByWall = new Map<string, Opening[]>();
    for (const o of Object.values(lv.openings)) {
      const arr = openingsByWall.get(o.wallId) ?? [];
      arr.push(o);
      openingsByWall.set(o.wallId, arr);
    }

    for (const w of Object.values(lv.walls)) {
      const fp = fps.walls.get(w.id);
      if (!fp) continue;
      const ops = openingsByWall.get(w.id) ?? [];
      const build = (cut: number) => {
        const g = owned(meshesToGroup(buildWall(lv, fp, w, ops, cut)));
        for (const o of ops) g.add(buildOpening(lv, o, cut));
        return g;
      };
      const full = build(Infinity);
      const mid = { x: (fp.axis[0].x + fp.axis[1].x) / 2, y: (fp.axis[0].y + fp.axis[1].y) / 2 };
      let nOut = leftNormal(norm(sub(fp.axis[1], fp.axis[0])));
      if (dot(nOut, sub(mid, this.center)) < 0) nOut = { x: -nOut.x, y: -nOut.y };
      this.structure.add(full);
      this.walls.push({ id: w.id, full, cut: null, cutH: 0, mid, nOut, build });
    }

    fps.hubs.forEach((poly, i) => {
      const nodeId = fps.hubNodes[i];
      const inc = Object.values(lv.walls).filter((w) => w.a === nodeId || w.b === nodeId);
      const h = inc.length
        ? Math.min(...inc.map((w) => (w.a === nodeId ? w.height : (w.heightEnd ?? w.height))))
        : lv.height;
      const build = (cut: number) => owned(meshesToGroup(buildHub(poly, Math.min(h, cut))));
      const full = build(Infinity);
      this.structure.add(full);
      this.hubs.push({ full, cut: null, cutH: 0, walls: inc.map((w) => w.id), build });
    });

    d.rooms.forEach((r, i) => {
      const floor = new THREE.Mesh(
        buildSlab(r.polygon, r.holes, 0),
        material(r.meta?.color ?? FLOOR_DEFAULTS[i % FLOOR_DEFAULTS.length] ?? '#e6dfd1'),
      );
      floor.receiveShadow = true;
      floor.userData['owned'] = true;
      this.structure.add(floor);
      const ch = r.meta?.ceilingHeight ?? lv.height;
      const ceil = new THREE.Mesh(buildSlab(r.polygon, r.holes, ch, true), material('#f7f6f3'));
      ceil.userData['owned'] = true;
      this.ceilings.add(ceil);
    });
    this.ceilings.visible = this.showCeiling || this.cameraMode === 'walk';
    this.buildCollision(lv);
  }

  private syncItems(lv: Level): void {
    const sel = new Set(this.store.selection.filter((r) => r.coll === 'items').map((r) => r.id));
    for (const [id, rec] of this.items) {
      const it = lv.items[id];
      if (it === rec.src && sel.has(id) === rec.selected) continue;
      disposeTree(rec.g);
      this.itemsGroup.remove(rec.g);
      this.items.delete(id);
    }
    for (const it of Object.values(lv.items)) {
      if (this.items.has(it.id)) continue;
      const g = buildItem(it, catalogEntry(it.catalogId), sel.has(it.id));
      this.itemsGroup.add(g);
      this.items.set(it.id, { src: it, selected: sel.has(it.id), g });
    }
  }

  private updateEnvironment(): void {
    const w = (this.box.maxX - this.box.minX) * MM;
    const h = (this.box.maxY - this.box.minY) * MM;
    const size = Math.max(w, h, 6) + 12;
    const cx = this.center.x * MM;
    const cz = this.center.y * MM;
    this.ground.scale.set(size * 3, size * 3, 1);
    this.ground.position.set(cx, -0.012, cz);
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    const n = Math.ceil(size);
    this.grid = new THREE.GridHelper(n, n, '#cfcbc2', '#dedad2');
    this.grid.position.set(Math.round(cx), -0.006, Math.round(cz));
    this.scene.add(this.grid);
    // Sun from the south-west-ish, high; shadow box fits the building.
    const r = Math.max(w, h) / 2 + 2;
    this.sun.position.set(cx - r * 0.8, r * 2.2 + 4, cz + r * 1.1);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    sc.left = -r * 1.6;
    sc.right = r * 1.6;
    sc.top = r * 1.6;
    sc.bottom = -r * 1.6;
    sc.near = 0.5;
    sc.far = r * 8 + 20;
    sc.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ cameras
  setCameraMode(m: CameraMode): void {
    this.cameraMode = m;
    this.orbit.enabled = m === 'orbit';
    this.orthoCtl.enabled = m === 'top' || m === 'iso';
    this.orthoCtl.enableRotate = m === 'iso';
    this.ceilings.visible = this.showCeiling || m === 'walk';
    // Indoors the ceiling blocks the sun: brighter fill light while walking.
    this.hemi.intensity = m === 'walk' ? 2.1 : 1.25;
    if (this.joystick) this.joystick.hidden = m !== 'walk';
    if (m === 'walk') this.enterWalk();
    else this.fit();
    this.updateCutaway();
    this.requestRender();
  }

  setWallMode(m: WallMode): void {
    this.wallMode = m;
    this.updateCutaway();
    this.requestRender();
  }

  setCeiling(on: boolean): void {
    this.showCeiling = on;
    this.ceilings.visible = on || this.cameraMode === 'walk';
    this.requestRender();
  }

  /** Frames the whole level for the current camera mode. */
  fit(): void {
    const cx = this.center.x * MM;
    const cz = this.center.y * MM;
    const w = Math.max((this.box.maxX - this.box.minX) * MM, 3);
    const h = Math.max((this.box.maxY - this.box.minY) * MM, 3);
    const radius = Math.hypot(w, h) / 2;
    if (this.cameraMode === 'orbit') {
      const dist = (radius / Math.sin((this.persp.fov * Math.PI) / 360)) * 0.95;
      const dir = new THREE.Vector3(0.55, 0.95, 0.85).normalize();
      this.persp.position.set(cx + dir.x * dist, dir.y * dist, cz + dir.z * dist);
      this.orbit.target.set(cx, 0.4, cz);
      this.orbit.update();
    } else if (this.cameraMode === 'top' || this.cameraMode === 'iso') {
      const aspect = this.host.clientWidth / Math.max(1, this.host.clientHeight);
      // Iso shows the walls' height too and the footprint diagonally: frame the bounding sphere.
      this.orthoHalf =
        this.cameraMode === 'top'
          ? Math.max(h / 2, w / 2 / aspect) * 1.12 + 0.3
          : Math.max(radius * 0.85, (radius * 1.05) / aspect) + 0.6;
      this.ortho.zoom = 1;
      this.updateOrthoFrustum();
      if (this.cameraMode === 'top') {
        this.ortho.up.set(0, 0, -1);
        this.ortho.position.set(cx, 60, cz);
      } else {
        this.ortho.up.set(0, 1, 0);
        this.ortho.position.set(cx + 30, 34, cz + 30);
      }
      this.orthoCtl.target.set(cx, 0, cz);
      this.ortho.lookAt(cx, 0, cz);
      this.orthoCtl.update();
    }
    this.updateCutaway();
    this.requestRender();
  }

  /** Lowers walls between the camera and the rooms (auto), or all walls (dollhouse). */
  private updateCutaway(): void {
    const cam = this.camera.position;
    const camPlan = { x: cam.x / MM, y: cam.z / MM };
    const autoCut = this.wallMode === 'auto' && (this.cameraMode === 'orbit' || this.cameraMode === 'iso');
    const cutWalls = new Set<string>();
    for (const w of this.walls) {
      let cutH = 0;
      if (this.wallMode === 'dollhouse' && this.cameraMode !== 'walk') cutH = CUT_DOLLHOUSE;
      else if (autoCut && dot(w.nOut, sub(camPlan, w.mid)) > 0) cutH = CUT_AUTO;
      this.applyCut(w, cutH);
      if (cutH) cutWalls.add(w.id);
    }
    const hubCut = this.wallMode === 'dollhouse' && this.cameraMode !== 'walk' ? CUT_DOLLHOUSE : CUT_AUTO;
    for (const h of this.hubs) this.applyCut(h, h.walls.some((id) => cutWalls.has(id)) ? hubCut : 0);
  }

  private applyCut(e: WallEntry | HubEntry, cutH: number): void {
    if (cutH && (!e.cut || e.cutH !== cutH)) {
      if (e.cut) {
        disposeTree(e.cut);
        this.structure.remove(e.cut);
      }
      e.cut = e.build(cutH);
      e.cutH = cutH;
      this.structure.add(e.cut);
    }
    e.full.visible = !cutH;
    if (e.cut) e.cut.visible = !!cutH;
  }

  // ------------------------------------------------------------ walk mode
  private buildCollision(lv: Level): void {
    const segs: [Vec2, Vec2][] = [];
    const fps = this.store.derived.footprints;
    for (const w of Object.values(lv.walls)) {
      const fp = fps.walls.get(w.id);
      if (!fp) continue;
      const A = fp.axis[0];
      const d = norm(sub(fp.axis[1], A));
      const gaps = Object.values(lv.openings)
        .filter((o) => o.wallId === w.id && o.sill < 100 && o.kind !== 'window')
        .map((o) => [o.offset - o.width / 2, o.offset + o.width / 2] as const)
        .sort((p, q) => p[0] - q[0]);
      for (const face of [fp.right, fp.left]) {
        const t0 = dot(sub(face[0], A), d);
        const t1 = dot(sub(face[1], A), d);
        let cur = Math.min(t0, t1);
        const end = Math.max(t0, t1);
        const off = sub(face[0], { x: A.x + d.x * t0, y: A.y + d.y * t0 });
        const at = (t: number) => ({ x: A.x + d.x * t + off.x, y: A.y + d.y * t + off.y });
        for (const [g0, g1] of gaps) {
          if (g0 > cur) segs.push([at(cur), at(Math.min(g0, end))]);
          cur = Math.max(cur, g1);
        }
        if (cur < end) segs.push([at(cur), at(end)]);
      }
      segs.push([fp.poly[0] as Vec2, fp.poly[3] as Vec2], [fp.poly[1] as Vec2, fp.poly[2] as Vec2]);
    }
    for (const it of Object.values(lv.items)) {
      const e = catalogEntry(it.catalogId);
      if (!e || e.category === 'rug' || e.mount !== 'floor' || it.elevation > 600 || it.height < 150)
        continue;
      const c = itemCorners(it);
      for (let i = 0; i < 4; i++) segs.push([c[i] as Vec2, c[(i + 1) % 4] as Vec2]);
    }
    this.collision = segs;
  }

  private enterWalk(): void {
    const rooms = this.store.derived.rooms;
    const big = [...rooms].sort((a, b) => b.area - a.area)[0];
    const p = big ? big.center : this.center;
    this.walk.x = p.x;
    this.walk.y = p.y;
    this.walk.yaw = Math.atan2(this.center.y - p.y, this.center.x - p.x) || 0;
    this.walk.pitch = -0.05;
    this.collide();
    this.placeWalkCamera();
    this.canvas.focus({ preventScroll: true });
  }

  private placeWalkCamera(): void {
    const { x, y, yaw, pitch } = this.walk;
    this.persp.position.set(x * MM, EYE * MM, y * MM);
    const look = new THREE.Vector3(
      Math.cos(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.sin(yaw) * Math.cos(pitch),
    );
    this.persp.up.set(0, 1, 0);
    this.persp.lookAt(this.persp.position.clone().add(look));
  }

  private collide(): void {
    for (let k = 0; k < 4; k++) {
      for (const [a, b] of this.collision) {
        const pr = projectOnSegment({ x: this.walk.x, y: this.walk.y }, a, b);
        if (pr.dist < BODY_R && pr.dist > 1e-6) {
          const push = BODY_R - pr.dist;
          this.walk.x += ((this.walk.x - pr.point.x) / pr.dist) * push;
          this.walk.y += ((this.walk.y - pr.point.y) / pr.dist) * push;
        }
      }
    }
  }

  /** Moves the walker (mm per call); exposed for tests. */
  step(forward: number, strafe: number): void {
    const { yaw } = this.walk;
    const dx = Math.cos(yaw) * forward - Math.sin(yaw) * strafe;
    const dy = Math.sin(yaw) * forward + Math.cos(yaw) * strafe;
    // Sub-steps no longer than 100 mm so a slow frame can't tunnel through a wall.
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 100));
    for (let i = 0; i < n; i++) {
      this.walk.x += dx / n;
      this.walk.y += dy / n;
      this.collide();
    }
    this.placeWalkCamera();
    this.requestRender();
  }

  get walkerPosition(): Vec2 {
    return { x: this.walk.x, y: this.walk.y };
  }

  private loop = (t: number): void => {
    const w = this.walk;
    if (this.cameraMode !== 'walk') {
      w.running = false;
      return;
    }
    const dt = Math.min(0.05, (t - (w.last || t)) / 1000);
    w.last = t;
    const k = w.keys;
    let f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) - w.joy.y;
    let s = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0) + w.joy.x;
    if (k.has('arrowleft')) w.yaw -= dt * 1.8;
    if (k.has('arrowright')) w.yaw += dt * 1.8;
    const len = Math.hypot(f, s);
    if (len > 1) {
      f /= len;
      s /= len;
    }
    const speed = (k.has('shift') ? 3000 : 1400) * dt;
    if (f || s || k.has('arrowleft') || k.has('arrowright')) this.step(f * speed, s * speed);
    if (k.size || w.joy.x || w.joy.y) requestAnimationFrame(this.loop);
    else {
      w.running = false;
      w.last = 0;
    }
  };

  private kick(): void {
    if (this.walk.running) return;
    this.walk.running = true;
    this.walk.last = 0;
    requestAnimationFrame(this.loop);
  }

  private bindWalkInput(): void {
    const keys = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
    this.canvas.addEventListener('keydown', (e) => {
      if (this.cameraMode !== 'walk') return;
      const k = e.key.toLowerCase();
      if (!keys.includes(k)) return;
      e.preventDefault();
      e.stopPropagation();
      this.walk.keys.add(k);
      this.kick();
    });
    this.canvas.addEventListener('keyup', (e) => {
      this.walk.keys.delete(e.key.toLowerCase());
    });
    this.canvas.addEventListener('blur', () => this.walk.keys.clear());
    let drag: { x: number; y: number; id: number } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.focus({ preventScroll: true });
      if (this.cameraMode !== 'walk') return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId || this.cameraMode !== 'walk') return;
      this.walk.yaw += (e.clientX - drag.x) * 0.005;
      this.walk.pitch = Math.max(-1.2, Math.min(1.2, this.walk.pitch - (e.clientY - drag.y) * 0.004));
      drag = { ...drag, x: e.clientX, y: e.clientY };
      this.placeWalkCamera();
      this.requestRender();
    });
    const end = (e: PointerEvent) => {
      if (drag?.id === e.pointerId) drag = null;
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);

    // On-screen joystick for touch (shown in walk mode).
    const joy = document.createElement('div');
    joy.className = 'walk-joystick';
    joy.hidden = true;
    joy.innerHTML = '<div class="knob"></div>';
    joy.setAttribute('aria-label', 'Walk joystick');
    this.host.appendChild(joy);
    this.joystick = joy;
    const knob = joy.firstElementChild as HTMLDivElement;
    let jid: number | null = null;
    const R = 46;
    const setFrom = (e: PointerEvent) => {
      const r = joy.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > R) {
        dx = (dx / l) * R;
        dy = (dy / l) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.walk.joy = { x: dx / R, y: dy / R };
      this.kick();
    };
    joy.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      jid = e.pointerId;
      joy.setPointerCapture(e.pointerId);
      setFrom(e);
    });
    joy.addEventListener('pointermove', (e) => {
      if (jid === e.pointerId) setFrom(e);
    });
    const jend = (e: PointerEvent) => {
      if (jid !== e.pointerId) return;
      jid = null;
      knob.style.transform = '';
      this.walk.joy = { x: 0, y: 0 };
    };
    joy.addEventListener('pointerup', jend);
    joy.addEventListener('pointercancel', jend);
  }

  // ------------------------------------------------------------ introspection
  stats(): { walls: number; items: number; meshes: number; calls: number; cut: number } {
    let meshes = 0;
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh && o.visible) meshes++;
    });
    return {
      walls: this.walls.length,
      items: this.items.size,
      meshes,
      calls: this.renderer.info.render.calls,
      cut: this.walls.filter((w) => !w.full.visible).length,
    };
  }
}
