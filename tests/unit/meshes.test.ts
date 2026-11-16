import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { computeFootprints } from '../../src/geometry/footprints';
import { buildItem, buildSlab, buildWall, buildHub } from '../../src/view3d/meshes';
import { catalogEntry } from '../../src/catalog/catalog';
import type { Opening } from '../../src/model/types';
import { fresh, line, lvl, poly, run } from './helpers';

/** Area of triangles whose normal is (nearly) parallel to `n` (world, metres). */
function areaFacing(geo: THREE.BufferGeometry, n: [number, number, number]): number {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.getAttribute('position').array as Float32Array;
  let total = 0;
  for (let i = 0; i < p.length; i += 9) {
    const u = [p[i + 3]! - p[i]!, p[i + 4]! - p[i + 1]!, p[i + 5]! - p[i + 2]!];
    const v = [p[i + 6]! - p[i]!, p[i + 7]! - p[i + 1]!, p[i + 8]! - p[i + 2]!];
    const c = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const len = Math.hypot(c[0]!, c[1]!, c[2]!);
    if (len === 0) continue;
    if ((c[0]! * n[0] + c[1]! * n[1] + c[2]! * n[2]) / len > 0.999) total += len / 2;
  }
  return total;
}

const op = (
  wallId: string,
  kind: Opening['kind'],
  offset: number,
  width: number,
  height: number,
  sill: number,
): Opening => ({
  id: `o${offset}`,
  wallId,
  kind,
  offset,
  width,
  height,
  sill,
  hinge: 'a',
  side: 'l',
});

describe('3D wall geometry', () => {
  // A free-standing 4 m wall along +x: its right side (plan) faces +y -> world +z.
  const doc0 = line(
    fresh(),
    [
      [0, 0],
      [4000, 0],
    ],
    100,
  );
  const L = lvl(doc0);
  const wall = Object.values(L.walls)[0]!;

  it('a plain wall has exact face, cap and top areas', () => {
    const fp = computeFootprints(L).walls.get(wall.id)!;
    const m = buildWall(L, fp, wall, []);
    expect(areaFacing(m.sides, [0, 0, 1])).toBeCloseTo(4 * 2.5, 6);
    expect(areaFacing(m.sides, [0, 0, -1])).toBeCloseTo(4 * 2.5, 6);
    expect(areaFacing(m.sides, [1, 0, 0])).toBeCloseTo(0.1 * 2.5, 6); // end cap
    expect(areaFacing(m.top, [0, 1, 0])).toBeCloseTo(4 * 0.1, 6);
  });

  it('cuts a door and a window out of both faces and adds reveals', () => {
    const doc = run(doc0, {
      type: 'add',
      level: L.id,
      coll: 'openings',
      values: [op(wall.id, 'door', 1000, 800, 2000, 0), op(wall.id, 'window', 3000, 1200, 1200, 900)],
    });
    const lv = lvl(doc);
    const fp = computeFootprints(lv).walls.get(wall.id)!;
    const m = buildWall(lv, fp, wall, Object.values(lv.openings));
    const face = 4 * 2.5 - 0.8 * 2.0 - 1.2 * 1.2;
    expect(areaFacing(m.sides, [0, 0, 1])).toBeCloseTo(face, 6);
    expect(areaFacing(m.sides, [0, 0, -1])).toBeCloseTo(face, 6);
    // window sill faces up (1.2 x 0.1), heads face down (door 0.8 x 0.1 + window 1.2 x 0.1)
    expect(areaFacing(m.sides, [0, 1, 0])).toBeCloseTo(1.2 * 0.1, 6);
    expect(areaFacing(m.sides, [0, -1, 0])).toBeCloseTo(0.8 * 0.1 + 1.2 * 0.1, 6);
  });

  it('cutaway lowers the wall and clips openings', () => {
    const doc = run(doc0, {
      type: 'add',
      level: L.id,
      coll: 'openings',
      values: [op(wall.id, 'door', 1000, 800, 2000, 0), op(wall.id, 'window', 3000, 1200, 1200, 900)],
    });
    const lv = lvl(doc);
    const fp = computeFootprints(lv).walls.get(wall.id)!;
    const m = buildWall(lv, fp, wall, Object.values(lv.openings), 300);
    expect(areaFacing(m.sides, [0, 0, 1])).toBeCloseTo(4 * 0.3 - 0.8 * 0.3, 6); // window starts above the cut
    const top = m.top.getAttribute('position').array as Float32Array;
    for (let i = 1; i < top.length; i += 3) expect(top[i]).toBeCloseTo(0.3, 6);
  });

  it('sloped walls follow start and end height', () => {
    const doc = run(doc0, {
      type: 'update',
      level: L.id,
      coll: 'walls',
      id: wall.id,
      patch: { height: 1000, heightEnd: 3000 },
    });
    const lv = lvl(doc);
    const w = lv.walls[wall.id]!;
    const m = buildWall(lv, computeFootprints(lv).walls.get(wall.id)!, w, []);
    expect(areaFacing(m.sides, [0, 0, 1])).toBeCloseTo(4 * 2, 6); // trapezoid, mean height 2 m
  });

  it('floors, hubs and furniture build at real size', () => {
    const doc = poly(
      fresh(),
      [
        [0, 0],
        [4100, 0],
        [4100, 3100],
        [0, 3100],
      ],
      100,
    );
    const slab = buildSlab(
      [
        { x: 50, y: 50 },
        { x: 4050, y: 50 },
        { x: 4050, y: 3050 },
        { x: 50, y: 3050 },
      ],
      [],
      0,
    );
    expect(areaFacing(slab, [0, 1, 0])).toBeCloseTo(12, 6);
    const ceil = buildSlab(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
        { x: 0, y: 1000 },
      ],
      [],
      2500,
      true,
    );
    expect(areaFacing(ceil, [0, -1, 0])).toBeCloseTo(1, 6);
    const hub = buildHub(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 80 },
      ],
      2500,
    );
    expect(areaFacing(hub.top, [0, 1, 0])).toBeCloseTo((0.1 * 0.08) / 2, 9);
    const bedEntry = catalogEntry('bed-double')!;
    const g = buildItem(
      {
        id: 'b',
        catalogId: 'bed-double',
        x: 2000,
        y: 1500,
        rotation: 90,
        width: 1600,
        depth: 2000,
        height: 500,
        elevation: 0,
      },
      bedEntry,
      false,
    );
    // parts merged per shade: at most 2 meshes per item
    expect(g.children.length).toBeLessThanOrEqual(2);
    expect(g.children.length).toBeGreaterThan(0);
    expect(g.position.x).toBeCloseTo(2);
    expect(g.position.z).toBeCloseTo(1.5);
    expect(g.rotation.y).toBeCloseTo(-Math.PI / 2);
    void doc;
  });
});
