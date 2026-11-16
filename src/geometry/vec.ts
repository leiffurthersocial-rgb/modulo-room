import type { Vec2 } from '../model/types';

export const EPS = 1e-6;

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const mid = (a: Vec2, b: Vec2): Vec2 => lerp(a, b, 0.5);

export function norm(a: Vec2): Vec2 {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/**
 * Left-hand normal of a direction in plan coordinates (y down): for a direction
 * pointing right (+x) the "left" side is up (-y), as seen walking along it.
 */
export const leftNormal = (d: Vec2): Vec2 => ({ x: d.y, y: -d.x });

export const angleOf = (d: Vec2): number => Math.atan2(d.y, d.x);

export function rotate(p: Vec2, rad: number, around: Vec2 = { x: 0, y: 0 }): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = p.x - around.x;
  const dy = p.y - around.y;
  return { x: around.x + dx * c - dy * s, y: around.y + dx * s + dy * c };
}

/** Projection of p onto segment ab: parameter t (clamped to [0,1]) and the point. */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; point: Vec2; dist: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const point = lerp(a, b, t);
  return { t, point, dist: dist(p, point) };
}

/** Intersection of two infinite lines (p + t·d). Null when (nearly) parallel. */
export function lineIntersect(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-9 * (len(d1) * len(d2) || 1)) return null;
  const t = cross(sub(p2, p1), d2) / den;
  return add(p1, scale(d1, t));
}

/** Proper or touching intersection of segments ab and cd. Returns params on each. */
export function segmentIntersect(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
): { point: Vec2; t: number; u: number } | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { point: add(a, scale(r, t)), t, u };
}

/** Signed area (shoelace). Positive = counter-clockwise in a y-up frame, i.e. clockwise on screen. */
export function signedArea(poly: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Vec2;
    const q = poly[(i + 1) % poly.length] as Vec2;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

export function polygonArea(poly: readonly Vec2[]): number {
  return Math.abs(signedArea(poly));
}

export function centroid(poly: readonly Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Vec2;
    const q = poly[(i + 1) % poly.length] as Vec2;
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < EPS) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Vec2;
    const b = poly[j] as Vec2;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Point inside polygon (with optional holes), preferring the centroid; otherwise the widest scanline gap. */
export function interiorPoint(poly: readonly Vec2[], holes: readonly (readonly Vec2[])[] = []): Vec2 {
  const inside = (p: Vec2) => pointInPolygon(p, poly) && !holes.some((h) => pointInPolygon(p, h));
  const c = centroid(poly);
  if (inside(c)) return c;
  const ys = poly.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  let best: Vec2 = c;
  let bestW = -1;
  for (let k = 1; k < 16; k++) {
    const y = minY + ((maxY - minY) * k) / 16;
    const xs: number[] = [];
    for (const ring of [poly, ...holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i] as Vec2;
        const b = ring[(i + 1) % ring.length] as Vec2;
        if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = (xs[i + 1] as number) - (xs[i] as number);
      if (w > bestW) {
        bestW = w;
        best = { x: ((xs[i] as number) + (xs[i + 1] as number)) / 2, y };
      }
    }
  }
  return best;
}

export function bbox(points: readonly Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return projectOnSegment(p, a, b).dist;
}

export function distToPolygonEdge(p: Vec2, poly: readonly Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    d = Math.min(d, distToSegment(p, poly[i] as Vec2, poly[(i + 1) % poly.length] as Vec2));
  }
  return d;
}
