import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CatalogEntry } from '../catalog/catalog';
import type { WallFootprint } from '../geometry/footprints';
import { rightNormal } from '../geometry/rooms';
import { add, dot, leftNormal, norm, scale, sub } from '../geometry/vec';
import type { Item, Level, Opening, Vec2, Wall } from '../model/types';

/** 3D world units are metres; plan (x, y) mm -> world (x/1000, z = y/1000), y up. */
export const MM = 0.001;

/** Accumulates flat-shaded quads/triangles with outward-facing winding. */
class MeshBuilder {
  readonly pos: number[] = [];

  /** Adds a quad (p0..p3 in order around it); flips winding so the normal points along `out`. */
  quad(p: [number, number, number][], out: [number, number, number]): void {
    if (p.length < 3) return;
    const [a, b, c] = p as [[number, number, number], [number, number, number], [number, number, number]];
    const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx] as const;
    const pts = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? [...p].reverse() : p;
    for (let i = 1; i + 1 < pts.length; i++) {
      this.pos.push(...(pts[0] as number[]), ...(pts[i] as number[]), ...(pts[i + 1] as number[]));
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.computeVertexNormals();
    return g;
  }
}

/** Plan point + height (mm) -> world [x, y, z] in metres. */
const P = (p: Vec2, h: number): [number, number, number] => [p.x * MM, h * MM, p.y * MM];
const D3 = (d: Vec2, up = 0): [number, number, number] => [d.x, up, d.y];

export interface WallMeshes {
  /** Side faces, end caps and opening reveals. */
  sides: THREE.BufferGeometry;
  /** Top cap (drawn darker so cut walls read clearly). */
  top: THREE.BufferGeometry;
}

/**
 * Builds a wall from its mitred footprint as exact strips around openings
 * (no CSG): side faces, top, end caps and the reveals (jambs, head, sill)
 * of every door and window. `cut` lowers the wall (cutaway / dollhouse).
 */
export function buildWall(
  level: Level,
  fp: WallFootprint,
  wall: Wall,
  openings: readonly Opening[],
  cut = Infinity,
): WallMeshes {
  const A = fp.axis[0];
  const d = norm(sub(fp.axis[1], fp.axis[0]));
  const L = fp.length;
  const ha = wall.height;
  const hb = wall.heightEnd ?? wall.height;
  const top = (u: number) => Math.min(cut, ha + ((hb - ha) * u) / (L || 1));
  const t = (p: Vec2) => dot(sub(p, A), d);
  const half = wall.thickness / 2;
  const nR = rightNormal(d);
  const nL = leftNormal(d);
  const onFace = (n: Vec2, u: number): Vec2 => add(add(A, scale(d, u)), scale(n, half));
  const sides = new MeshBuilder();
  const caps = new MeshBuilder();

  const holes = openings
    .map((o) => ({
      u0: o.offset - o.width / 2,
      u1: o.offset + o.width / 2,
      v0: o.sill,
      v1: o.sill + o.height,
    }))
    .filter((h) => h.v0 < cut)
    .sort((p, q) => p.u0 - q.u0);

  // Side faces as vertical strips between breakpoints.
  for (const [n, face] of [
    [nR, fp.right],
    [nL, fp.left],
  ] as const) {
    const fu0 = t(face[0]);
    const fu1 = t(face[1]);
    const lo = Math.min(fu0, fu1);
    const hi = Math.max(fu0, fu1);
    const brk = new Set<number>([lo, hi]);
    for (const h of holes) {
      if (h.u0 > lo && h.u0 < hi) brk.add(h.u0);
      if (h.u1 > lo && h.u1 < hi) brk.add(h.u1);
    }
    const us = [...brk].sort((p, q) => p - q);
    const out = D3(n);
    for (let i = 0; i + 1 < us.length; i++) {
      const u0 = us[i] as number;
      const u1 = us[i + 1] as number;
      const mid = (u0 + u1) / 2;
      const hole = holes.find((h) => h.u0 <= mid && h.u1 >= mid);
      const p0 = onFace(n, u0);
      const p1 = onFace(n, u1);
      const spans: [number, number, number, number][] = hole
        ? [
            [0, 0, Math.min(hole.v0, top(u0)), Math.min(hole.v0, top(u1))],
            [Math.min(hole.v1, top(u0)), Math.min(hole.v1, top(u1)), top(u0), top(u1)],
          ]
        : [[0, 0, top(u0), top(u1)]];
      for (const [b0, b1, t0, t1] of spans) {
        if (t0 - b0 < 0.5 && t1 - b1 < 0.5) continue;
        sides.quad([P(p0, b0), P(p1, b1), P(p1, t1), P(p0, t0)], out);
      }
    }
  }

  // Reveals: jambs, head and sill across the wall thickness.
  for (const h of holes) {
    const v1 = Math.min(h.v1, top(h.u0), top(h.u1));
    for (const [u, dirSign] of [
      [h.u0, 1],
      [h.u1, -1],
    ] as const) {
      const r = onFace(nR, u);
      const l = onFace(nL, u);
      sides.quad([P(r, h.v0), P(l, h.v0), P(l, v1), P(r, v1)], D3(scale(d, dirSign)));
    }
    const r0 = onFace(nR, h.u0);
    const r1 = onFace(nR, h.u1);
    const l0 = onFace(nL, h.u0);
    const l1 = onFace(nL, h.u1);
    if (h.v1 < Math.min(top(h.u0), top(h.u1)) - 0.5)
      sides.quad([P(r0, h.v1), P(r1, h.v1), P(l1, h.v1), P(l0, h.v1)], [0, -1, 0]);
    if (h.v0 > 0.5) sides.quad([P(r0, h.v0), P(r1, h.v0), P(l1, h.v0), P(l0, h.v0)], [0, 1, 0]);
  }

  // End caps (hidden inside neighbours at joints, visible at free ends and cuts).
  const [aR, bL, bR, aL] = fp.poly as [Vec2, Vec2, Vec2, Vec2];
  sides.quad([P(aR, 0), P(aL, 0), P(aL, top(t(aL))), P(aR, top(t(aR)))], D3(scale(d, -1)));
  sides.quad([P(bL, 0), P(bR, 0), P(bR, top(t(bR))), P(bL, top(t(bL)))], D3(d));

  // Top cap
  caps.quad([P(aR, top(t(aR))), P(bL, top(t(bL))), P(bR, top(t(bR))), P(aL, top(t(aL)))], [0, 1, 0]);
  void level;
  return { sides: sides.geometry(), top: caps.geometry() };
}

/** Extruded junction fill (T/X joints, bevels). */
export function buildHub(poly: readonly Vec2[], height: number): WallMeshes {
  const sides = new MeshBuilder();
  const caps = new MeshBuilder();
  const c = poly.reduce((s, p) => ({ x: s.x + p.x / poly.length, y: s.y + p.y / poly.length }), {
    x: 0,
    y: 0,
  });
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec2;
    const b = poly[(i + 1) % poly.length] as Vec2;
    const m = { x: (a.x + b.x) / 2 - c.x, y: (a.y + b.y) / 2 - c.y };
    sides.quad([P(a, 0), P(b, 0), P(b, height), P(a, height)], D3(m));
  }
  caps.quad(
    poly.map((p) => P(p, height)),
    [0, 1, 0],
  );
  return { sides: sides.geometry(), top: caps.geometry() };
}

/** Floor (facing up) or ceiling (facing down) from a room polygon with holes. */
export function buildSlab(
  polygon: readonly Vec2[],
  holes: readonly (readonly Vec2[])[],
  height: number,
  ceiling = false,
): THREE.BufferGeometry {
  const sign = ceiling ? 1 : -1;
  const shape = new THREE.Shape(polygon.map((p) => new THREE.Vector2(p.x * MM, sign * p.y * MM)));
  for (const h of holes)
    shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x * MM, sign * p.y * MM))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(ceiling ? Math.PI / 2 : -Math.PI / 2);
  g.translate(0, height * MM, 0);
  return g;
}

// ---------------------------------------------------------------- furniture
const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
  sph: new THREE.SphereGeometry(0.5, 20, 14),
  cone: new THREE.ConeGeometry(0.5, 1, 20),
};

const matCache = new Map<string, THREE.MeshStandardMaterial>();

/** Shared flat greybox material per colour (selected items get an emissive variant). */
export function material(
  color: string,
  selected = false,
  opts: { opacity?: number } = {},
): THREE.MeshStandardMaterial {
  const key = `${color}|${selected ? 1 : 0}|${opts.opacity ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0 });
    if (selected) {
      m.emissive = new THREE.Color('#2f6fec');
      m.emissiveIntensity = 0.35;
    }
    if (opts.opacity !== undefined && opts.opacity < 1) {
      m.transparent = true;
      m.opacity = opts.opacity;
      m.depthWrite = false;
    }
    matCache.set(key, m);
  }
  return m;
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

/**
 * Furniture item at real size. Parts are merged per colour into one mesh each,
 * so an item costs 1-2 draw calls regardless of how many primitives it has.
 */
export function buildItem(it: Item, entry: CatalogEntry | undefined, selected: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = `item:${it.id}`;
  g.position.set(it.x * MM, it.elevation * MM, it.y * MM);
  g.rotation.y = (-it.rotation * Math.PI) / 180;
  const base = it.color ?? entry?.color ?? '#c9c3b6';
  const parts = entry?.parts ?? [['box', 0, 0, 0, 1, 1, 1] as const];
  const mx = it.mirrored ? -1 : 1;
  const byColor = new Map<string, THREE.BufferGeometry[]>();
  const m = new THREE.Matrix4();
  parts.forEach((part, i) => {
    const [shape, x0, y0, z0, x1, y1, z1] = part;
    const w = (x1 - x0) * it.width * MM;
    const dd = (y1 - y0) * it.depth * MM;
    const h = (z1 - z0) * it.height * MM;
    if (w <= 0 || dd <= 0 || h <= 0) return;
    // Slight per-part shading so stacked greybox parts stay readable.
    const color = shade(base, i % 2 ? 0.9 : 1);
    m.compose(
      new THREE.Vector3(
        ((x0 + x1) / 2 - 0.5) * it.width * MM * mx,
        ((z0 + z1) / 2) * it.height * MM,
        ((y0 + y1) / 2 - 0.5) * it.depth * MM,
      ),
      new THREE.Quaternion(),
      new THREE.Vector3(w, h, dd),
    );
    const geo = UNIT[shape].clone().applyMatrix4(m);
    const list = byColor.get(color) ?? [];
    list.push(geo);
    byColor.set(color, list);
  });
  const rug = entry?.category === 'rug';
  for (const [color, geos] of byColor) {
    const merged = geos.length === 1 ? (geos[0] as THREE.BufferGeometry) : mergeGeometries(geos, false);
    if (geos.length > 1) geos.forEach((x) => x.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material(color, selected));
    mesh.castShadow = !rug;
    mesh.receiveShadow = true;
    mesh.userData['owned'] = true;
    g.add(mesh);
  }
  return g;
}

// ---------------------------------------------------------------- doors & windows
const GLASS = '#9fc3d6';
const FRAME = '#d9d6cf';
const LEAF = '#cbbfa9';

function boxAt(
  center: Vec2,
  h0: number,
  h1: number,
  len: number,
  thick: number,
  dir: Vec2,
  color: string,
  opacity?: number,
): THREE.Mesh {
  const m = new THREE.Mesh(UNIT.box, material(color, false, opacity === undefined ? {} : { opacity }));
  m.scale.set(len * MM, (h1 - h0) * MM, thick * MM);
  m.position.set(center.x * MM, ((h0 + h1) / 2) * MM, center.y * MM);
  m.rotation.y = -Math.atan2(dir.y, dir.x);
  m.castShadow = opacity === undefined;
  return m;
}

/** Greybox door leaves (open 90°, matching the 2D swing) and window panes with frames. */
export function buildOpening(level: Level, o: Opening, cut = Infinity): THREE.Group {
  const g = new THREE.Group();
  const w = level.walls[o.wallId];
  const a = w && level.nodes[w.a];
  const b = w && level.nodes[w.b];
  if (!w || !a || !b) return g;
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const dir = norm(sub(b, a));
  const center = add(a, scale(dir, o.offset));
  const nrm = leftNormal(dir);
  const sideN = o.side === 'l' ? nrm : scale(nrm, -1);
  const t = w.thickness;
  const top = Math.min(o.sill + o.height, cut);
  if (top <= o.sill) return g;
  void L;
  if (o.kind === 'window') {
    g.add(boxAt(center, o.sill, top, o.width - 20, 12, dir, GLASS, 0.35));
    const fr = 50;
    g.add(boxAt(center, o.sill, o.sill + fr, o.width, t * 0.6, dir, FRAME));
    if (top === o.sill + o.height) g.add(boxAt(center, top - fr, top, o.width, t * 0.6, dir, FRAME));
    for (const s of [-1, 1])
      g.add(boxAt(add(center, scale(dir, (s * (o.width - fr)) / 2)), o.sill, top, fr, t * 0.6, dir, FRAME));
  } else if (o.kind === 'sliding-door') {
    for (const s of [-1, 1]) {
      const c = add(add(center, scale(dir, (s * o.width) / 4)), scale(nrm, (s * t) / 6));
      g.add(boxAt(c, 0, top, o.width / 2 + 40, 25, dir, GLASS, 0.4));
      g.add(boxAt(add(c, scale(dir, (s * o.width) / 4)), 0, top, 40, 40, dir, FRAME));
    }
  } else if (o.kind === 'door' || o.kind === 'double-door') {
    const face = add(center, scale(sideN, t / 2));
    const leaves =
      o.kind === 'double-door'
        ? [
            { hinge: sub(face, scale(dir, o.width / 2)), r: o.width / 2 },
            { hinge: add(face, scale(dir, o.width / 2)), r: o.width / 2 },
          ]
        : [
            {
              hinge:
                o.hinge === 'a' ? sub(face, scale(dir, o.width / 2)) : add(face, scale(dir, o.width / 2)),
              r: o.width,
            },
          ];
    for (const l of leaves) {
      const c = add(l.hinge, scale(sideN, l.r / 2));
      g.add(boxAt(c, 0, top - 10, l.r - 10, 40, sideN, LEAF));
    }
  }
  return g;
}
