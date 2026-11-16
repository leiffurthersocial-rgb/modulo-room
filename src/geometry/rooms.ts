import type { Id, Level, RoomMeta, Vec2, Wall } from '../model/types';
import {
  add,
  angleOf,
  dist,
  distToPolygonEdge,
  interiorPoint,
  leftNormal,
  lineIntersect,
  norm,
  pointInPolygon,
  polygonArea,
  scale,
  signedArea,
  sub,
} from './vec';

/** A directed traversal of a wall. */
export interface HalfEdge {
  wallId: Id;
  from: Id;
  to: Id;
}

/** A closed walk around a face of the planar wall graph. */
export interface FaceCycle {
  edges: HalfEdge[];
  /** Node positions along the walk (wall centrelines). */
  centerline: Vec2[];
  /** Signed centreline area; > 0 = bounded face (interior on the right of travel). */
  area: number;
  component: number;
}

export interface DerivedRoom {
  /** Stable id: the RoomMeta id when matched, else a deterministic key. */
  id: Id;
  meta: RoomMeta | undefined;
  /** Interior polygon (wall faces), clockwise on screen. */
  polygon: Vec2[];
  holes: Vec2[][];
  /** Net floor area in mm² (polygon minus holes). */
  area: number;
  center: Vec2;
  walls: Id[];
  cycle: FaceCycle;
}

const MIN_ROOM_AREA = 50_000; // 0.05 m² of centreline area: ignore slivers

export const rightNormal = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x });

function components(level: Level): Map<Id, number> {
  const parent = new Map<Id, Id>();
  const find = (x: Id): Id => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) ?? r;
    parent.set(x, r);
    return r;
  };
  for (const id of Object.keys(level.nodes)) parent.set(id, id);
  for (const w of Object.values(level.walls)) {
    const ra = find(w.a);
    const rb = find(w.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const ids = new Map<Id, number>();
  const out = new Map<Id, number>();
  for (const id of Object.keys(level.nodes)) {
    const r = find(id);
    if (!ids.has(r)) ids.set(r, ids.size);
    out.set(id, ids.get(r) ?? 0);
  }
  return out;
}

/** All face cycles of the wall graph. Assumes the graph is planarised (see normalize). */
export function faceCycles(level: Level): FaceCycle[] {
  const out = new Map<Id, { to: Id; wallId: Id; angle: number }[]>();
  for (const w of Object.values(level.walls)) {
    const a = level.nodes[w.a];
    const b = level.nodes[w.b];
    if (!a || !b || w.a === w.b) continue;
    const ab = angleOf(sub(b, a));
    const ba = angleOf(sub(a, b));
    (out.get(w.a) ?? out.set(w.a, []).get(w.a))?.push({ to: w.b, wallId: w.id, angle: ab });
    (out.get(w.b) ?? out.set(w.b, []).get(w.b))?.push({ to: w.a, wallId: w.id, angle: ba });
  }
  for (const list of out.values()) list.sort((p, q) => p.angle - q.angle || (p.wallId < q.wallId ? -1 : 1));

  const comp = components(level);
  const visited = new Set<string>();
  const key = (wallId: Id, from: Id) => `${wallId}|${from}`;
  const cycles: FaceCycle[] = [];
  const starts = [...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [nodeId, list] of starts) {
    for (const e of list) {
      if (visited.has(key(e.wallId, nodeId))) continue;
      const edges: HalfEdge[] = [];
      let cur: HalfEdge = { wallId: e.wallId, from: nodeId, to: e.to };
      let guard = 0;
      while (!visited.has(key(cur.wallId, cur.from)) && guard++ < 100_000) {
        visited.add(key(cur.wallId, cur.from));
        edges.push(cur);
        const around = out.get(cur.to) ?? [];
        const i = around.findIndex((x) => x.wallId === cur.wallId && x.to === cur.from);
        const next = around[(i - 1 + around.length) % around.length];
        if (!next) break;
        cur = { wallId: next.wallId, from: cur.to, to: next.to };
      }
      const centerline = edges.map((h) => {
        const n = level.nodes[h.from];
        return { x: n?.x ?? 0, y: n?.y ?? 0 };
      });
      cycles.push({ edges, centerline, area: signedArea(centerline), component: comp.get(nodeId) ?? 0 });
    }
  }
  return cycles;
}

/**
 * Offsets a face cycle to the right of travel by each wall's half thickness: the
 * room-side faces of the walls. Mitres at corners; square caps at dead ends.
 */
export function offsetCycle(level: Level, edges: readonly HalfEdge[]): Vec2[] {
  const pts: Vec2[] = [];
  const n = edges.length;
  const half = (w: Wall | undefined) => (w ? w.thickness / 2 : 0);
  for (let i = 0; i < n; i++) {
    const h1 = edges[(i - 1 + n) % n] as HalfEdge;
    const h2 = edges[i] as HalfEdge;
    const v = level.nodes[h2.from];
    const p = level.nodes[h1.from];
    const q = level.nodes[h2.to];
    if (!v || !p || !q) continue;
    const w1 = level.walls[h1.wallId];
    const w2 = level.walls[h2.wallId];
    const d1 = norm(sub(v, p));
    const d2 = norm(sub(q, v));
    const o1 = scale(rightNormal(d1), half(w1));
    const o2 = scale(rightNormal(d2), half(w2));
    const deadEnd = h1.wallId === h2.wallId && h1.from === h2.to;
    const c = deadEnd ? null : lineIntersect(add(p, o1), d1, add(v, o2), d2);
    const limit = 8 * Math.max(half(w1), half(w2), 1);
    if (c && dist(c, v) <= limit) {
      pts.push(c);
    } else {
      pts.push(add(v, o1));
      if (dist(o1, o2) > 1e-6) pts.push(add(v, o2));
    }
  }
  // Remove consecutive duplicates.
  return pts.filter((pt, i) => dist(pt, pts[(i - 1 + pts.length) % pts.length] as Vec2) > 1e-6);
}

function deterministicKey(walls: Id[]): Id {
  const s = [...walls].sort().join(',');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `room_${(h >>> 0).toString(36)}`;
}

/**
 * Derives rooms from the wall graph and attaches stored RoomMeta by seed point
 * (falling back to wall overlap). Pure; result depends only on `level`.
 */
export function deriveRooms(level: Level): DerivedRoom[] {
  const cycles = faceCycles(level);
  const bounded = cycles.filter((c) => c.area > MIN_ROOM_AREA);
  const outers = cycles.filter((c) => c.area < -MIN_ROOM_AREA);
  const rooms: DerivedRoom[] = bounded.map((cycle) => {
    const polygon = offsetCycle(level, cycle.edges);
    const walls = [...new Set(cycle.edges.map((e) => e.wallId))];
    return {
      id: deterministicKey(walls),
      meta: undefined,
      polygon,
      holes: [],
      area: polygonArea(polygon),
      center: cycle.centerline[0] ?? { x: 0, y: 0 },
      walls,
      cycle,
    };
  });
  // Islands: outer boundary of another component inside a room becomes a hole.
  for (const outer of outers) {
    const probe = outer.centerline[0];
    if (!probe) continue;
    let best: DerivedRoom | undefined;
    for (const r of rooms) {
      if (r.cycle.component === outer.component) continue;
      if (!pointInPolygon(probe, r.cycle.centerline)) continue;
      if (!best || r.cycle.area < best.cycle.area) best = r;
    }
    if (best) {
      const hole = offsetCycle(level, outer.edges);
      best.holes.push(hole);
      best.area -= polygonArea(hole);
    }
  }
  for (const r of rooms) r.center = interiorPoint(r.polygon, r.holes);
  attachMeta(level, rooms);
  return rooms;
}

function attachMeta(level: Level, rooms: DerivedRoom[]): void {
  const metas = Object.values(level.rooms).sort((a, b) => (a.id < b.id ? -1 : 1));
  const used = new Set<Id>();
  // 1) seed point inside the room (smallest containing room wins).
  for (const m of metas) {
    let best: DerivedRoom | undefined;
    for (const r of rooms) {
      if (r.meta) continue;
      const inside = pointInPolygon(m.seed, r.polygon) && !r.holes.some((h) => pointInPolygon(m.seed, h));
      if (inside && (!best || r.area < best.area)) best = r;
    }
    if (best) {
      best.meta = m;
      best.id = m.id;
      used.add(m.id);
    }
  }
  // 2) wall overlap for metas whose seed fell outside (e.g. a wall moved across it).
  for (const m of metas) {
    if (used.has(m.id)) continue;
    // Most shared walls wins; ties go to the room closest to the old seed.
    let best: DerivedRoom | undefined;
    let bestShared = 0;
    let bestDist = Infinity;
    for (const r of rooms) {
      if (r.meta) continue;
      const shared = r.walls.filter((w) => m.walls.includes(w)).length;
      if (shared === 0) continue;
      const dd = distToPolygonEdge(m.seed, r.polygon);
      if (shared > bestShared || (shared === bestShared && dd < bestDist)) {
        bestShared = shared;
        bestDist = dd;
        best = r;
      }
    }
    if (best && bestShared >= Math.min(2, m.walls.length)) {
      best.meta = m;
      best.id = m.id;
      used.add(m.id);
    }
  }
}

/** Left/right helper re-exported for callers that orient openings. */
export { leftNormal };
