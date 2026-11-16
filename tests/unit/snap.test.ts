import { describe, expect, it } from 'vitest';
import { snapPoint, type SnapContext } from '../../src/geometry/snap';
import { fresh, line, lvl } from './helpers';

function ctx(over: Partial<SnapContext> = {}): SnapContext {
  const doc = line(fresh(), [
    [0, 0],
    [4000, 0],
    [4000, 3000],
  ]);
  return { level: lvl(doc), tol: 100, angleStep: 15, grid: 100, lengthStep: 10, enabled: true, ...over };
}

describe('snapping', () => {
  it('snaps to nodes first', () => {
    const r = snapPoint({ x: 3950, y: 40 }, ctx());
    expect(r.kind).toBe('node');
    expect(r.p).toEqual({ x: 4000, y: 0 });
  });
  it('snaps to wall midpoints, then onto walls', () => {
    expect(snapPoint({ x: 2030, y: 20 }, ctx()).p).toEqual({ x: 2000, y: 0 });
    const r = snapPoint({ x: 1234, y: 60 }, ctx());
    expect(r.kind).toBe('wall');
    expect(r.p.x).toBeCloseTo(1234);
    expect(r.p.y).toBeCloseTo(0);
  });
  it('angle-snaps from an anchor and rounds the length', () => {
    const anchor = { x: 0, y: 1500 };
    const r = snapPoint({ x: 1003, y: 513 }, ctx({ anchor, tol: 20 }));
    // ~-44.6° from the anchor -> exactly -45°, length rounded to 10 mm
    expect(r.kind).toBe('angle');
    const ang = (Math.atan2(r.p.y - anchor.y, r.p.x - anchor.x) * 180) / Math.PI;
    expect(ang).toBeCloseTo(-45, 9);
    const L = Math.hypot(r.p.x - anchor.x, r.p.y - anchor.y);
    expect(L % 10).toBeCloseTo(0, 6);
  });
  it('intersects the angle ray with alignment lines from other nodes', () => {
    // horizontal ray from (0,3000) towards x≈4000 aligns with node x=4000? node exists -> node snap. Use x alignment with 4000 at y=2000.
    const r = snapPoint({ x: 3970, y: 2010 }, ctx({ anchor: { x: 0, y: 2000 }, tol: 50 }));
    expect(['angle+wall', 'angle+align']).toContain(r.kind);
    expect(r.p.y).toBeCloseTo(2000, 6);
    expect(r.p.x).toBeCloseTo(4000, 6);
  });
  it('falls back to grid when idle, and to nothing when disabled', () => {
    expect(snapPoint({ x: 1449, y: 2551 }, ctx({ tol: 10 })).p).toEqual({ x: 1400, y: 2600 });
    expect(snapPoint({ x: 1449, y: 2551 }, ctx({ enabled: false })).p).toEqual({ x: 1449, y: 2551 });
  });
  it('excludes the node being dragged', () => {
    const c = ctx();
    const id = Object.values(c.level.nodes).find((n) => n.x === 4000 && n.y === 0)!.id;
    const r = snapPoint({ x: 3990, y: 10 }, { ...c, excludeNodes: new Set([id]) });
    expect(r.kind).not.toBe('node');
  });
});
