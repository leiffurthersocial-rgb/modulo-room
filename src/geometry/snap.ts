import type { Id, Level, Vec2 } from '../model/types';
import { add, dist, lineIntersect, mid, norm, projectOnSegment, scale, sub } from './vec';

export type SnapKind =
  'none' | 'node' | 'midpoint' | 'wall' | 'angle+wall' | 'angle+align' | 'angle' | 'align' | 'grid';

export interface Guide {
  /** Infinite-ish guide line through a and b, or a marker at a. */
  kind: 'line' | 'marker';
  a: Vec2;
  b?: Vec2;
}

export interface SnapContext {
  level: Level;
  /** Snap radius in world mm (screen radius / zoom). */
  tol: number;
  /** Previous point while drawing: enables angle and length snapping. */
  anchor?: Vec2 | undefined;
  /** Degrees (15/45/90). 0 disables angle snapping. */
  angleStep: number;
  /** Grid size in mm; 0 disables. */
  grid: number;
  /** Length rounding while drawing (mm). */
  lengthStep: number;
  enabled: boolean;
  excludeNodes?: ReadonlySet<Id>;
  excludeWalls?: ReadonlySet<Id>;
  /** Extra corner targets not yet in the document (e.g. the chain being drawn). */
  extraPoints?: readonly Vec2[];
}

export interface SnapResult {
  p: Vec2;
  kind: SnapKind;
  guides: Guide[];
  nodeId?: Id;
  wallId?: Id;
}

interface WallLine {
  id: Id;
  a: Vec2;
  b: Vec2;
}

function walls(ctx: SnapContext): WallLine[] {
  const out: WallLine[] = [];
  for (const w of Object.values(ctx.level.walls)) {
    if (ctx.excludeWalls?.has(w.id)) continue;
    if (ctx.excludeNodes?.has(w.a) || ctx.excludeNodes?.has(w.b)) continue;
    const a = ctx.level.nodes[w.a];
    const b = ctx.level.nodes[w.b];
    if (a && b) out.push({ id: w.id, a, b });
  }
  return out;
}

/**
 * Snaps a world point. Priority: node > midpoint > angle∩wall > wall >
 * angle∩alignment > angle > alignment > grid. Pure and deterministic.
 */
export function snapPoint(raw: Vec2, ctx: SnapContext): SnapResult {
  if (!ctx.enabled) return { p: raw, kind: 'none', guides: [] };
  const tol = ctx.tol;
  const nodes: { id: Id; x: number; y: number }[] = Object.values(ctx.level.nodes).filter(
    (n) => !ctx.excludeNodes?.has(n.id),
  );
  ctx.extraPoints?.forEach((p, i) => nodes.push({ id: `__extra${i}`, x: p.x, y: p.y }));

  // 1) nodes
  let bestN: { id: Id; p: Vec2; d: number } | undefined;
  for (const n of nodes) {
    const d = dist(raw, n);
    if (d < tol && (!bestN || d < bestN.d)) bestN = { id: n.id, p: { x: n.x, y: n.y }, d };
  }
  if (bestN) {
    const r: SnapResult = { p: bestN.p, kind: 'node', guides: [{ kind: 'marker', a: bestN.p }] };
    if (!bestN.id.startsWith('__extra')) r.nodeId = bestN.id;
    return r;
  }

  const wl = walls(ctx);
  // 2) wall midpoints
  let bestM: { p: Vec2; d: number; id: Id } | undefined;
  for (const w of wl) {
    const m = mid(w.a, w.b);
    const d = dist(raw, m);
    if (d < tol * 0.8 && (!bestM || d < bestM.d)) bestM = { p: m, d, id: w.id };
  }
  if (bestM)
    return { p: bestM.p, kind: 'midpoint', guides: [{ kind: 'marker', a: bestM.p }], wallId: bestM.id };

  // Angle-snapped ray from the anchor.
  let ray: { dir: Vec2; p: Vec2 } | undefined;
  if (ctx.anchor && ctx.angleStep > 0) {
    const d = sub(raw, ctx.anchor);
    const L = Math.hypot(d.x, d.y);
    if (L > 1e-6) {
      const step = (ctx.angleStep * Math.PI) / 180;
      const ang = Math.round(Math.atan2(d.y, d.x) / step) * step;
      const dir = { x: Math.cos(ang), y: Math.sin(ang) };
      const p = add(ctx.anchor, scale(dir, L));
      // Accept when the cursor is near the snapped ray (looser than point snaps).
      if (dist(p, raw) < Math.max(tol * 1.5, L * Math.sin(step / 3))) ray = { dir, p };
    }
  }

  // 3) walls (centreline), possibly intersected with the angle ray
  let bestW: { id: Id; p: Vec2; d: number; w: WallLine } | undefined;
  for (const w of wl) {
    const pr = projectOnSegment(raw, w.a, w.b);
    if (pr.dist < tol && (!bestW || pr.dist < bestW.d)) bestW = { id: w.id, p: pr.point, d: pr.dist, w };
  }
  if (bestW) {
    if (ray && ctx.anchor) {
      const x = lineIntersect(ctx.anchor, ray.dir, bestW.w.a, sub(bestW.w.b, bestW.w.a));
      if (x && dist(x, raw) < tol * 1.5) {
        const pr = projectOnSegment(x, bestW.w.a, bestW.w.b);
        if (pr.dist < 1e-6) {
          return {
            p: x,
            kind: 'angle+wall',
            guides: [
              { kind: 'line', a: ctx.anchor, b: x },
              { kind: 'marker', a: x },
            ],
            wallId: bestW.id,
          };
        }
      }
    }
    return { p: bestW.p, kind: 'wall', guides: [{ kind: 'marker', a: bestW.p }], wallId: bestW.id };
  }

  // 4) alignment with other nodes (horizontal / vertical extension lines)
  let ax: { x: number; src: Vec2; d: number } | undefined;
  let ay: { y: number; src: Vec2; d: number } | undefined;
  for (const n of nodes) {
    const dx = Math.abs(raw.x - n.x);
    const dy = Math.abs(raw.y - n.y);
    if (dx < tol && (!ax || dx < ax.d)) ax = { x: n.x, src: n, d: dx };
    if (dy < tol && (!ay || dy < ay.d)) ay = { y: n.y, src: n, d: dy };
  }

  if (ray && ctx.anchor) {
    const anchor = ctx.anchor;
    // angle ∩ alignment
    const cands: { p: Vec2; src: Vec2 }[] = [];
    if (ax && Math.abs(ray.dir.x) > 1e-6) {
      const x = lineIntersect(anchor, ray.dir, { x: ax.x, y: 0 }, { x: 0, y: 1 });
      if (x) cands.push({ p: x, src: ax.src });
    }
    if (ay && Math.abs(ray.dir.y) > 1e-6) {
      const x = lineIntersect(anchor, ray.dir, { x: 0, y: ay.y }, { x: 1, y: 0 });
      if (x) cands.push({ p: x, src: ay.src });
    }
    const c = cands
      .filter((k) => dist(k.p, raw) < tol * 1.5)
      .sort((p, q) => dist(p.p, raw) - dist(q.p, raw))[0];
    if (c) {
      return {
        p: c.p,
        kind: 'angle+align',
        guides: [
          { kind: 'line', a: anchor, b: c.p },
          { kind: 'line', a: c.src, b: c.p },
        ],
      };
    }
    // angle with rounded length
    const L = dist(anchor, ray.p);
    const Lr =
      ctx.lengthStep > 0 ? Math.max(ctx.lengthStep, Math.round(L / ctx.lengthStep) * ctx.lengthStep) : L;
    const p = add(anchor, scale(ray.dir, Lr));
    return { p, kind: 'angle', guides: [{ kind: 'line', a: anchor, b: p }] };
  }

  if (ax || ay) {
    const p = { x: ax ? ax.x : raw.x, y: ay ? ay.y : raw.y };
    const guides: Guide[] = [];
    if (ax) guides.push({ kind: 'line', a: ax.src, b: p });
    if (ay) guides.push({ kind: 'line', a: ay.src, b: p });
    return { p, kind: 'align', guides };
  }

  // 5) grid (only when not drawing from an anchor)
  if (ctx.grid > 0 && !ctx.anchor) {
    const p = { x: Math.round(raw.x / ctx.grid) * ctx.grid, y: Math.round(raw.y / ctx.grid) * ctx.grid };
    return { p, kind: 'grid', guides: [] };
  }
  if (ctx.anchor && ctx.lengthStep > 0) {
    const d = sub(raw, ctx.anchor);
    const L = Math.hypot(d.x, d.y);
    const Lr = Math.round(L / ctx.lengthStep) * ctx.lengthStep;
    return { p: add(ctx.anchor, scale(norm(d), Lr)), kind: 'none', guides: [] };
  }
  return { p: raw, kind: 'none', guides: [] };
}

/** Snaps an angle in degrees to the nearest multiple of `step`. */
export function snapAngle(deg: number, step: number): number {
  if (step <= 0) return deg;
  return Math.round(deg / step) * step;
}
