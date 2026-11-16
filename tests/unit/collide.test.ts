import { describe, expect, it } from 'vitest';
import { convexPenetration, doorSwing, itemCorners, planWarnings } from '../../src/geometry/collide';
import { computeFootprints } from '../../src/geometry/footprints';
import { catalogEntry, CATALOG, validateCatalog } from '../../src/catalog/catalog';
import data from '../../src/catalog/catalog.json';
import type { Item } from '../../src/model/types';
import { fresh, lvl, poly, run } from './helpers';

const item = (id: string, catalogId: string, x: number, y: number, rotation = 0): Item => {
  const e = catalogEntry(catalogId)!;
  return {
    id,
    catalogId,
    x,
    y,
    rotation,
    width: e.dims.width,
    depth: e.dims.depth,
    height: e.dims.height,
    elevation: e.elevation,
  };
};

const info = (id: string) => catalogEntry(id);

describe('catalog', () => {
  it('is valid and covers every required category', () => {
    expect(validateCatalog(data)).toEqual([]);
    const cats = new Set(CATALOG.map((e) => e.category));
    for (const c of [
      'bed',
      'sofa',
      'table',
      'chair',
      'storage',
      'desk',
      'kitchen',
      'bathroom',
      'plant',
      'lamp',
      'rug',
      'custom',
    ])
      expect(cats.has(c)).toBe(true);
  });
  it('has a broad greybox range including plants', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(100);
    expect(CATALOG.filter((e) => e.category === 'plant').length).toBeGreaterThanOrEqual(10);
    for (const c of ['kids', 'leisure', 'fixture']) expect(CATALOG.some((e) => e.category === c)).toBe(true);
    // every plant has a pot/stem and foliage (at least 2 parts)
    for (const e of CATALOG.filter((x) => x.category === 'plant'))
      expect(e.parts.length).toBeGreaterThanOrEqual(2);
  });
  it('rejects bad entries', () => {
    expect(validateCatalog({ items: [{ id: 'X Y', dims: { width: -1 } }] }).length).toBeGreaterThan(3);
    expect(validateCatalog(null)).toHaveLength(1);
  });
});

describe('collisions and clearance', () => {
  it('rotates item corners clockwise in plan', () => {
    const c = itemCorners({ x: 0, y: 0, width: 2000, depth: 1000, rotation: 90 });
    expect(c[0]!.x).toBeCloseTo(500);
    expect(c[0]!.y).toBeCloseTo(-1000);
  });
  it('SAT penetration', () => {
    const a = itemCorners({ x: 0, y: 0, width: 1000, depth: 1000, rotation: 0 });
    expect(
      convexPenetration(a, itemCorners({ x: 900, y: 0, width: 1000, depth: 1000, rotation: 0 })),
    ).toBeCloseTo(100);
    expect(
      convexPenetration(a, itemCorners({ x: 1000, y: 0, width: 1000, depth: 1000, rotation: 0 })),
    ).toBeLessThanOrEqual(0);
    expect(
      convexPenetration(a, itemCorners({ x: 1300, y: 0, width: 1000, depth: 1000, rotation: 45 })),
    ).toBeLessThanOrEqual(0);
  });
  it('warns on overlaps, wall cuts, blocked doors and front clearance; ignores rugs and stacking', () => {
    let doc = poly(
      fresh(),
      [
        [0, 0],
        [5100, 0],
        [5100, 4100],
        [0, 4100],
      ],
      100,
    );
    const L = lvl(doc);
    const bottom = Object.values(L.walls).find((w) => L.nodes[w.a]!.y === 4100 && L.nodes[w.b]!.y === 4100)!;
    doc = run(
      doc,
      {
        type: 'add',
        level: L.id,
        coll: 'openings',
        // bottom wall runs right->left (a at x=5100): door at its a-end, side 'r' swings up into the room
        values: [
          {
            id: 'd',
            wallId: bottom.id,
            kind: 'door',
            offset: 0,
            width: 800,
            height: 2000,
            sill: 0,
            hinge: 'a',
            side: 'r',
          },
        ],
      },
      {
        type: 'add',
        level: L.id,
        coll: 'items',
        values: [
          item('bed', 'bed-double', 2500, 1100),
          item('desk', 'desk', 2500, 1700), // overlaps the bed
          item('rug', 'rug', 2500, 2000), // rugs never warn
          item('wardrobe', 'wardrobe-2', 4500, 2000, -90), // front faces -x... rotated
          item('chair', 'chair-dining', 4500, 2000), // inside the wardrobe -> overlap
          item('box', 'box', 4900, 3000), // cuts into right wall? x+300 = 5200 > 5050
          item('plant', 'plant-floor', 4700 - 4700 + 4400, 3600),
        ],
      },
    );
    const L2 = lvl(doc);
    const kinds = planWarnings(L2, computeFootprints(L2), info, 800).map(
      (w) => `${w.kind}:${w.refs.map((r) => r.id).join('+')}`,
    );
    expect(kinds).toContain('overlap:bed+desk');
    expect(kinds).toContain('overlap:chair+wardrobe');
    expect(kinds).toContain('wall:box');
    expect(kinds.some((k) => k.includes('rug'))).toBe(false);
    // door centre clamps to x=4700; the leaf hinges at x=5100 and sweeps x≈4300..5100, y≈3250..4050
    doc = run(doc, { type: 'add', level: L.id, coll: 'items', values: [item('stool', 'stool', 4800, 3800)] });
    const L3 = lvl(doc);
    const w3 = planWarnings(L3, computeFootprints(L3), info, 800);
    expect(w3.some((w) => w.kind === 'door' && w.refs.some((r) => r.id === 'stool'))).toBe(true);
    expect(doorSwing(L3, L3.openings['d']!)!.length).toBeGreaterThan(5);
    // stacking a lamp on the side table is not an overlap
    doc = run(doc, {
      type: 'add',
      level: L.id,
      coll: 'items',
      values: [
        item('t', 'table-side', 1000, 1000),
        { ...item('l', 'lamp-table', 1000, 1000), elevation: 500 },
      ],
    });
    const L4 = lvl(doc);
    expect(
      planWarnings(L4, computeFootprints(L4), info, 800).some((w) => w.refs.some((r) => r.id === 'l')),
    ).toBe(false);
  });
  it('flags missing front clearance for access items', () => {
    let doc = poly(
      fresh(),
      [
        [0, 0],
        [4100, 0],
        [4100, 4100],
        [0, 4100],
      ],
      100,
    );
    const L = lvl(doc);
    doc = run(doc, {
      type: 'add',
      level: L.id,
      coll: 'items',
      values: [item('wr', 'wardrobe-2', 2000, 350), item('bed', 'bed-single', 2000, 1500)],
    });
    const L2 = lvl(doc);
    const w = planWarnings(L2, computeFootprints(L2), info, 800);
    expect(w.some((x) => x.kind === 'clearance' && x.refs[0]!.id === 'wr')).toBe(true);
  });
});
