import type { Item, Level, Opening, Ref, Vec2 } from '../model/types';
import type { Footprints } from './footprints';
import { openingFrame } from './footprints';
import { add, dot, rotate, scale, sub } from './vec';

/** Footprint corners of an item, clockwise on screen starting back-left. Local +y = front. */
export function itemCorners(it: Pick<Item, 'x' | 'y' | 'width' | 'depth' | 'rotation'>): Vec2[] {
  const hw = it.width / 2;
  const hd = it.depth / 2;
  const rad = (it.rotation * Math.PI) / 180;
  const c = { x: it.x, y: it.y };
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((p) => add(c, rotate(p, rad)));
}

/** Local -> world for an item frame. */
export function itemToWorld(it: Pick<Item, 'x' | 'y' | 'rotation'>, local: Vec2): Vec2 {
  return add({ x: it.x, y: it.y }, rotate(local, (it.rotation * Math.PI) / 180));
}

export function worldToItem(it: Pick<Item, 'x' | 'y' | 'rotation'>, world: Vec2): Vec2 {
  return rotate(sub(world, { x: it.x, y: it.y }), (-it.rotation * Math.PI) / 180);
}

function axes(poly: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Vec2;
    const q = poly[(i + 1) % poly.length] as Vec2;
    const e = sub(q, p);
    const l = Math.hypot(e.x, e.y);
    if (l > 1e-9) out.push({ x: -e.y / l, y: e.x / l });
  }
  return out;
}

/** Penetration depth of two convex polygons (SAT); <= 0 means separated or touching. */
export function convexPenetration(a: readonly Vec2[], b: readonly Vec2[]): number {
  let min = Infinity;
  for (const ax of [...axes(a), ...axes(b)]) {
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const p of a) {
      const d = dot(p, ax);
      a0 = Math.min(a0, d);
      a1 = Math.max(a1, d);
    }
    for (const p of b) {
      const d = dot(p, ax);
      b0 = Math.min(b0, d);
      b1 = Math.max(b1, d);
    }
    const o = Math.min(a1, b1) - Math.max(a0, b0);
    if (o <= 0) return o;
    min = Math.min(min, o);
  }
  return min;
}

/** Quarter-disc (as a fan polygon) swept by a door leaf. */
export function doorSwing(level: Level, o: Opening, segments = 8): Vec2[] | null {
  if (o.kind !== 'door' && o.kind !== 'double-door') return null;
  const f = openingFrame(level, o);
  if (!f) return null;
  const sideN = o.side === 'l' ? f.normal : scale(f.normal, -1);
  const face = add(f.center, scale(sideN, f.wall.thickness / 2));
  const leaves: { hinge: Vec2; closedDir: Vec2; r: number }[] = [];
  const half = o.width / 2;
  if (o.kind === 'double-door') {
    leaves.push({ hinge: add(face, scale(f.dir, -half)), closedDir: f.dir, r: half });
    leaves.push({ hinge: add(face, scale(f.dir, half)), closedDir: scale(f.dir, -1), r: half });
  } else {
    const towardB = o.hinge === 'a';
    const hinge = add(face, scale(f.dir, towardB ? -half : half));
    leaves.push({ hinge, closedDir: towardB ? f.dir : scale(f.dir, -1), r: o.width });
  }
  const pts: Vec2[] = [];
  for (const l of leaves) {
    pts.push(l.hinge);
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * (Math.PI / 2);
      const dir = add(scale(l.closedDir, Math.cos(t)), scale(sideN, Math.sin(t)));
      pts.push(add(l.hinge, scale(dir, l.r)));
    }
  }
  return pts;
}

export type WarningKind = 'overlap' | 'wall' | 'door' | 'clearance';

export interface PlanWarning {
  kind: WarningKind;
  message: string;
  refs: Ref[];
  /** Area to highlight. */
  area?: Vec2[];
}

export interface CatalogInfo {
  name: string;
  category: string;
  mount: 'floor' | 'wall' | 'ceiling' | 'surface';
  access?: boolean;
}

const PEN = 5; // mm tolerance: touching is fine

function zOverlap(a: Item, b: Item): boolean {
  return a.elevation < b.elevation + b.height - PEN && b.elevation < a.elevation + a.height - PEN;
}

/** Plan checks: furniture overlaps, items in walls, blocked door swings, front clearance. */
export function planWarnings(
  level: Level,
  fp: Footprints,
  catalog: (id: string) => CatalogInfo | undefined,
  walkwayMin: number,
): PlanWarning[] {
  const out: PlanWarning[] = [];
  const items = Object.values(level.items).sort((p, q) => (p.id < q.id ? -1 : 1));
  const info = (it: Item) => catalog(it.catalogId);
  const label = (it: Item) => it.name ?? info(it)?.name ?? 'Item';
  const isRug = (it: Item) => info(it)?.category === 'rug';
  const solid = items.filter((it) => !isRug(it) && info(it)?.mount !== 'ceiling');
  const corners = new Map(solid.map((it) => [it.id, itemCorners(it)]));

  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i] as Item;
      const b = solid[j] as Item;
      if (!zOverlap(a, b)) continue;
      const ca = corners.get(a.id) as Vec2[];
      const cb = corners.get(b.id) as Vec2[];
      if (convexPenetration(ca, cb) > PEN) {
        out.push({
          kind: 'overlap',
          message: `${label(a)} overlaps ${label(b)}`,
          refs: [
            { coll: 'items', id: a.id },
            { coll: 'items', id: b.id },
          ],
        });
      }
    }
  }

  for (const it of solid) {
    if (info(it)?.mount === 'wall') continue;
    const c = corners.get(it.id) as Vec2[];
    for (const w of fp.walls.values()) {
      if (convexPenetration(c, w.poly) > PEN) {
        out.push({
          kind: 'wall',
          message: `${label(it)} cuts into a wall`,
          refs: [{ coll: 'items', id: it.id }],
        });
        break;
      }
    }
  }

  for (const o of Object.values(level.openings)) {
    const swing = doorSwing(level, o);
    if (!swing) continue;
    // test the swing as triangles of the fan (convex pieces)
    for (const it of solid) {
      if (it.elevation > o.height) continue;
      const c = corners.get(it.id) as Vec2[];
      let hit = false;
      for (let k = 1; k + 1 < swing.length && !hit; k++) {
        const tri = [swing[0] as Vec2, swing[k] as Vec2, swing[k + 1] as Vec2];
        if (convexPenetration(tri, c) > PEN) hit = true;
      }
      if (hit) {
        out.push({
          kind: 'door',
          message: `${label(it)} blocks a door swing`,
          refs: [
            { coll: 'items', id: it.id },
            { coll: 'openings', id: o.id },
          ],
          area: swing,
        });
      }
    }
  }

  for (const it of solid) {
    if (!info(it)?.access) continue;
    const zone = clearanceZone(it, walkwayMin);
    for (const other of solid) {
      if (other.id === it.id || other.elevation > 1200) continue;
      if (convexPenetration(zone, corners.get(other.id) as Vec2[]) > PEN) {
        out.push({
          kind: 'clearance',
          message: `Less than ${Math.round(walkwayMin)} mm free in front of ${label(it)}`,
          refs: [
            { coll: 'items', id: it.id },
            { coll: 'items', id: other.id },
          ],
          area: zone,
        });
        break;
      }
    }
    for (const w of fp.walls.values()) {
      if (convexPenetration(zone, w.poly) > PEN) {
        out.push({
          kind: 'clearance',
          message: `Less than ${Math.round(walkwayMin)} mm free in front of ${label(it)} (wall)`,
          refs: [{ coll: 'items', id: it.id }],
          area: zone,
        });
        break;
      }
    }
  }
  return out;
}

/** Rectangle in front of an item (local +y side) of depth `depth`. */
export function clearanceZone(it: Item, depth: number): Vec2[] {
  const hw = it.width / 2;
  const hd = it.depth / 2;
  return [
    { x: -hw, y: hd },
    { x: hw, y: hd },
    { x: hw, y: hd + depth },
    { x: -hw, y: hd + depth },
  ].map((p) => itemToWorld(it, p));
}
