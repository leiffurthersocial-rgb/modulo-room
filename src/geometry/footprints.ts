import type { Id, Level, Opening, Vec2, Wall } from '../model/types';
import { add, angleOf, dist, leftNormal, lerp, lineIntersect, norm, scale, sub } from './vec';
import { rightNormal } from './rooms';

/** Outline of one wall with mitred ends. */
export interface WallFootprint {
  wallId: Id;
  /** Polygon: aRight, bLeft, bRight, aLeft (right/left as seen walking a -> b). */
  poly: Vec2[];
  /** Face on the right of a->b (from a to b) and on the left. */
  right: [Vec2, Vec2];
  left: [Vec2, Vec2];
  axis: [Vec2, Vec2];
  length: number;
}

export interface Footprints {
  walls: Map<Id, WallFootprint>;
  /** Fill polygons at junctions (T/X joins, bevels) that wall outlines leave open. */
  hubs: Vec2[][];
  /** Node id of each hub (parallel to `hubs`). */
  hubNodes: Id[];
}

interface EndCorners {
  /** Corner on the visual left of the outgoing direction at this node. */
  left: Vec2;
  right: Vec2;
}

const MITER_LIMIT = 4;

export function computeFootprints(level: Level): Footprints {
  const incident = new Map<Id, { wall: Wall; dir: Vec2; angle: number }[]>();
  for (const w of Object.values(level.walls)) {
    const a = level.nodes[w.a];
    const b = level.nodes[w.b];
    if (!a || !b) continue;
    const d = norm(sub(b, a));
    if (d.x === 0 && d.y === 0) continue;
    const back = { x: -d.x, y: -d.y };
    (incident.get(w.a) ?? incident.set(w.a, []).get(w.a))?.push({ wall: w, dir: d, angle: angleOf(d) });
    (incident.get(w.b) ?? incident.set(w.b, []).get(w.b))?.push({ wall: w, dir: back, angle: angleOf(back) });
  }

  const ends = new Map<string, EndCorners>();
  const hubs: Vec2[][] = [];
  const hubNodes: Id[] = [];
  for (const [nodeId, list] of incident) {
    const n = level.nodes[nodeId];
    if (!n) continue;
    list.sort((p, q) => p.angle - q.angle);
    const k = list.length;
    let beveled = false;
    const cornerPts: Vec2[] = [];
    for (let i = 0; i < k; i++) {
      const cur = list[i] as (typeof list)[number];
      const t = cur.wall.thickness / 2;
      const perpL = add(n, scale(leftNormal(cur.dir), t));
      const perpR = add(n, scale(rightNormal(cur.dir), t));
      let left = perpL;
      let right = perpR;
      if (k > 1) {
        const next = list[(i + 1) % k] as (typeof list)[number];
        const prev = list[(i - 1 + k) % k] as (typeof list)[number];
        // Right side of `cur` meets the left side of the next wall clockwise.
        const cr = lineIntersect(
          perpR,
          cur.dir,
          add(n, scale(leftNormal(next.dir), next.wall.thickness / 2)),
          next.dir,
        );
        const cl = lineIntersect(
          perpL,
          cur.dir,
          add(n, scale(rightNormal(prev.dir), prev.wall.thickness / 2)),
          prev.dir,
        );
        const lim = MITER_LIMIT * Math.max(t, 1);
        if (cr && dist(cr, n) <= lim) right = cr;
        else if (cr) beveled = true;
        if (cl && dist(cl, n) <= lim) left = cl;
        else if (cl) beveled = true;
      }
      ends.set(`${cur.wall.id}|${nodeId}`, { left, right });
      cornerPts.push(left, right);
    }
    if (k >= 3 || beveled) {
      const uniq: Vec2[] = [];
      for (const p of cornerPts) if (!uniq.some((u) => dist(u, p) < 1e-3)) uniq.push(p);
      uniq.sort((p, q) => angleOf(sub(p, n)) - angleOf(sub(q, n)));
      if (uniq.length >= 3) {
        hubs.push(uniq);
        hubNodes.push(nodeId);
      }
    }
  }

  const walls = new Map<Id, WallFootprint>();
  for (const w of Object.values(level.walls)) {
    const a = level.nodes[w.a];
    const b = level.nodes[w.b];
    const ea = ends.get(`${w.id}|${w.a}`);
    const eb = ends.get(`${w.id}|${w.b}`);
    if (!a || !b || !ea || !eb) continue;
    // At node b the outgoing direction is reversed, so its "left" is a->b's right.
    walls.set(w.id, {
      wallId: w.id,
      poly: [ea.right, eb.left, eb.right, ea.left],
      right: [ea.right, eb.left],
      left: [ea.left, eb.right],
      axis: [
        { x: a.x, y: a.y },
        { x: b.x, y: b.y },
      ],
      length: dist(a, b),
    });
  }
  return { walls, hubs, hubNodes };
}

export function wallLength(level: Level, w: Wall): number {
  const a = level.nodes[w.a];
  const b = level.nodes[w.b];
  return a && b ? dist(a, b) : 0;
}

/** Frame of an opening: centre point, unit direction along the wall, left normal. */
export function openingFrame(
  level: Level,
  o: Opening,
): { center: Vec2; dir: Vec2; normal: Vec2; wall: Wall } | null {
  const w = level.walls[o.wallId];
  if (!w) return null;
  const a = level.nodes[w.a];
  const b = level.nodes[w.b];
  if (!a || !b) return null;
  const L = dist(a, b);
  if (L <= 0) return null;
  const dir = norm(sub(b, a));
  return { center: lerp(a, b, o.offset / L), dir, normal: leftNormal(dir), wall: w };
}

/** The four corners of the opening's cut through the wall. */
export function openingRect(level: Level, o: Opening): Vec2[] | null {
  const f = openingFrame(level, o);
  if (!f) return null;
  const hw = o.width / 2;
  const ht = f.wall.thickness / 2;
  const along = scale(f.dir, hw);
  const across = scale(f.normal, ht);
  return [
    add(sub(f.center, along), across),
    add(add(f.center, along), across),
    sub(add(f.center, along), across),
    sub(sub(f.center, along), across),
  ];
}
