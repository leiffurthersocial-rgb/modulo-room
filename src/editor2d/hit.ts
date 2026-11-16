import type { Derived } from '../app/derived';
import { itemCorners } from '../geometry/collide';
import { openingFrame, openingRect } from '../geometry/footprints';
import { add, dist, distToSegment, pointInPolygon, scale } from '../geometry/vec';
import type { Level, Ref, Vec2 } from '../model/types';
import { rotateHandle } from './render';

export type HitPart =
  | 'node'
  | 'wall'
  | 'opening'
  | 'opening-end-a'
  | 'opening-end-b'
  | 'item'
  | 'item-rotate'
  | 'item-corner'
  | 'room'
  | 'annotation'
  | 'refImage';

export interface Hit {
  ref: Ref;
  part: HitPart;
  /** Corner index for item-corner. */
  index?: number;
}

export interface HitOpts {
  /** Hit tolerance in world mm. */
  tol: number;
  pxPerMm: number;
  selection: readonly Ref[];
  /** Include locked reference images. */
  refImages?: boolean;
}

/** Topmost thing under a world point, with handle priority for the current selection. */
export function hitTest(level: Level, d: Derived, p: Vec2, o: HitOpts): Hit | null {
  const tol = o.tol;
  // 1) handles of the selected item / opening
  if (o.selection.length === 1) {
    const s = o.selection[0] as Ref;
    if (s.coll === 'items') {
      const it = level.items[s.id];
      if (it && !it.locked) {
        if (dist(p, rotateHandle(it, o.pxPerMm)) < tol * 1.2) return { ref: s, part: 'item-rotate' };
        const cs = itemCorners(it);
        const k = cs.findIndex((c) => dist(c, p) < tol);
        if (k >= 0) return { ref: s, part: 'item-corner', index: k };
      }
    } else if (s.coll === 'openings') {
      const op = level.openings[s.id];
      const f = op && openingFrame(level, op);
      if (op && f) {
        if (dist(p, add(f.center, scale(f.dir, -op.width / 2))) < tol)
          return { ref: s, part: 'opening-end-a' };
        if (dist(p, add(f.center, scale(f.dir, op.width / 2))) < tol)
          return { ref: s, part: 'opening-end-b' };
      }
    }
  }
  // 2) wall corners (nodes)
  let bestNode: { id: string; d: number } | undefined;
  for (const n of Object.values(level.nodes)) {
    const dd = dist(p, n);
    if (dd < tol && (!bestNode || dd < bestNode.d)) bestNode = { id: n.id, d: dd };
  }
  if (bestNode) return { ref: { coll: 'nodes', id: bestNode.id }, part: 'node' };

  // 3) openings
  for (const op of Object.values(level.openings)) {
    const r = openingRect(level, op);
    if (!r) continue;
    if (
      pointInPolygon(p, r) ||
      r.some((c, i) => distToSegment(p, c, r[(i + 1) % r.length] as Vec2) < tol * 0.5)
    ) {
      return { ref: { coll: 'openings', id: op.id }, part: 'opening' };
    }
  }

  // 4) annotations
  for (const a of Object.values(level.annotations)) {
    if (a.kind === 'text') {
      const halfW = (a.text.length * Math.max(9, a.size * o.pxPerMm) * 0.3) / o.pxPerMm + tol;
      const halfH = Math.max(9, a.size * o.pxPerMm) / o.pxPerMm / 2 + tol;
      if (Math.abs(p.x - a.x) < halfW && Math.abs(p.y - a.y) < halfH)
        return { ref: { coll: 'annotations', id: a.id }, part: 'annotation' };
    } else {
      const dx = a.b.x - a.a.x;
      const dy = a.b.y - a.a.y;
      const L = Math.hypot(dx, dy) || 1;
      const nrm = { x: dy / L, y: -dx / L };
      const a2 = add(a.a, scale(nrm, a.offset));
      const b2 = add(a.b, scale(nrm, a.offset));
      if (distToSegment(p, a2, b2) < tol)
        return { ref: { coll: 'annotations', id: a.id }, part: 'annotation' };
    }
  }

  // 5) items, topmost (highest) first
  const items = Object.values(level.items).sort(
    (a, b) => b.elevation - a.elevation || (a.id < b.id ? 1 : -1),
  );
  for (const it of items) {
    if (pointInPolygon(p, itemCorners(it))) return { ref: { coll: 'items', id: it.id }, part: 'item' };
  }

  // 6) walls
  for (const [id, fp] of d.footprints.walls) {
    if (pointInPolygon(p, fp.poly) || distToSegment(p, fp.axis[0], fp.axis[1]) < Math.max(tol, 1)) {
      const w = level.walls[id];
      if (w && distToSegment(p, fp.axis[0], fp.axis[1]) <= w.thickness / 2 + tol)
        return { ref: { coll: 'walls', id }, part: 'wall' };
    }
  }

  // 7) rooms
  for (const r of [...d.rooms].sort((a, b) => a.area - b.area)) {
    if (pointInPolygon(p, r.polygon) && !r.holes.some((h) => pointInPolygon(p, h))) {
      return { ref: { coll: 'rooms', id: r.id }, part: 'room' };
    }
  }

  // 8) reference images (only when unlocked)
  for (const im of Object.values(level.refImages)) {
    if (!im.visible || (im.locked && !o.refImages)) continue;
    const hw = (im.widthPx * im.mmPerPx) / 2;
    const hh = (im.heightPx * im.mmPerPx) / 2;
    const corners = itemCorners({ x: im.x, y: im.y, width: hw * 2, depth: hh * 2, rotation: im.rotation });
    if (pointInPolygon(p, corners)) return { ref: { coll: 'refImages', id: im.id }, part: 'refImage' };
  }
  return null;
}

/** All selectable refs whose geometry intersects a world rectangle (marquee). */
export function refsInRect(level: Level, d: Derived, a: Vec2, b: Vec2): Ref[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const inside = (q: Vec2) => q.x >= minX && q.x <= maxX && q.y >= minY && q.y <= maxY;
  const out: Ref[] = [];
  for (const w of Object.values(level.walls)) {
    const na = level.nodes[w.a];
    const nb = level.nodes[w.b];
    if (na && nb && inside(na) && inside(nb)) out.push({ coll: 'walls', id: w.id });
  }
  for (const it of Object.values(level.items))
    if (itemCorners(it).every(inside)) out.push({ coll: 'items', id: it.id });
  for (const op of Object.values(level.openings)) {
    const r = openingRect(level, op);
    if (r?.every(inside)) out.push({ coll: 'openings', id: op.id });
  }
  for (const an of Object.values(level.annotations)) {
    const pts = an.kind === 'text' ? [an] : [an.a, an.b];
    if (pts.every(inside)) out.push({ coll: 'annotations', id: an.id });
  }
  void d;
  return out;
}
