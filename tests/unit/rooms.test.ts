import { describe, expect, it } from 'vitest';
import { deriveRooms } from '../../src/geometry/rooms';
import { computeFootprints } from '../../src/geometry/footprints';
import { polygonArea } from '../../src/geometry/vec';
import { fresh, line, lvl, poly, run } from './helpers';

const sq = (x: number, y: number, s: number): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];

describe('room detection', () => {
  it('finds one room in a rectangle with interior (wall-face) dimensions', () => {
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
    const rooms = deriveRooms(lvl(doc));
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.area).toBeCloseTo(4000 * 3000, 0);
    expect(Object.keys(lvl(doc).rooms)).toHaveLength(1);
    expect(Object.values(lvl(doc).rooms)[0]!.name).toBe('Room 1');
  });

  it('addRectRoom takes interior dimensions', () => {
    const doc0 = fresh();
    const doc = run(doc0, {
      type: 'addRectRoom',
      level: lvl(doc0).id,
      x: 0,
      y: 0,
      w: 4000,
      h: 3000,
      thickness: 150,
      height: 2500,
    });
    const r = deriveRooms(lvl(doc));
    expect(r).toHaveLength(1);
    expect(r[0]!.area).toBeCloseTo(12_000_000, 0);
  });

  it('splits into two rooms with a dividing wall (T-junctions are planarised)', () => {
    let doc = poly(fresh(), sq(0, 0, 6000), 100);
    doc = line(
      doc,
      [
        [3000, 0],
        [3000, 6000],
      ],
      100,
    );
    const L = lvl(doc);
    expect(Object.keys(L.walls)).toHaveLength(7); // 4 sides, two split + divider
    const rooms = deriveRooms(L);
    expect(rooms).toHaveLength(2);
    for (const r of rooms) expect(r.area).toBeCloseTo(2900 * 5900, 0);
  });

  it('handles L-shaped rooms', () => {
    const doc = poly(
      fresh(),
      [
        [0, 0],
        [4000, 0],
        [4000, 2000],
        [2000, 2000],
        [2000, 4000],
        [0, 4000],
      ],
      0.001,
    );
    const r = deriveRooms(lvl(doc));
    expect(r).toHaveLength(1);
    expect(r[0]!.area).toBeCloseTo(4000 * 4000 - 2000 * 2000, -2);
  });

  it('ignores dangling walls but keeps the room', () => {
    let doc = poly(fresh(), sq(0, 0, 4000), 100);
    doc = line(
      doc,
      [
        [0, 2000],
        [1500, 2000],
      ],
      100,
    ); // stub wall into the room
    const r = deriveRooms(lvl(doc));
    expect(r).toHaveLength(1);
    // floor area excludes the stub wall footprint (1450 x 100 inside)
    expect(r[0]!.area).toBeCloseTo(3900 * 3900 - 1450 * 100, -2);
  });

  it('crossing walls create a node and four rooms', () => {
    let doc = poly(fresh(), sq(0, 0, 4000), 100);
    doc = line(
      doc,
      [
        [2000, -0],
        [2000, 4000],
      ],
      100,
    );
    doc = line(
      doc,
      [
        [0, 2000],
        [4000, 2000],
      ],
      100,
    );
    expect(deriveRooms(lvl(doc))).toHaveLength(4);
  });

  it('a free-standing island becomes a hole', () => {
    let doc = poly(fresh(), sq(0, 0, 6000), 100);
    doc = poly(doc, sq(2000, 2000, 1000), 100); // chimney / column block
    const rooms = deriveRooms(lvl(doc));
    const big = rooms.reduce((a, b) => (a.cycle.area > b.cycle.area ? a : b));
    expect(big.holes).toHaveLength(1);
    expect(big.area).toBeCloseTo(5900 * 5900 - 1100 * 1100, -2);
    expect(rooms).toHaveLength(2); // inner block also counts as a (tiny) room
  });

  it('merges nearly coincident nodes and removes duplicate walls', () => {
    let doc = line(fresh(), [
      [0, 0],
      [3000, 0],
    ]);
    doc = line(doc, [
      [0.4, 0.3],
      [3000.2, -0.1],
    ]); // same wall drawn twice
    const L = lvl(doc);
    expect(Object.keys(L.walls)).toHaveLength(1);
    expect(Object.keys(L.nodes)).toHaveLength(2);
  });

  it('keeps room identity and name when walls move; splits keep the old id on one side', () => {
    let doc = poly(fresh(), sq(0, 0, 4000), 100);
    let L = lvl(doc);
    const meta = Object.values(L.rooms)[0]!;
    doc = run(doc, { type: 'update', level: L.id, coll: 'rooms', id: meta.id, patch: { name: 'Bedroom' } });
    // move a corner pair: stretch room to the right by 3 m
    L = lvl(doc);
    const right = Object.values(L.nodes).filter((n) => n.x === 4000);
    for (const n of right) doc = run(doc, { type: 'setNodePos', level: L.id, id: n.id, x: 7000, y: n.y });
    L = lvl(doc);
    expect(Object.values(L.rooms).map((m) => m.name)).toEqual(['Bedroom']);
    // divide it
    doc = line(doc, [
      [3500, 0],
      [3500, 4000],
    ]);
    L = lvl(doc);
    const names = deriveRooms(L)
      .map((r) => r.meta?.name)
      .sort();
    expect(names).toEqual(['Bedroom', 'Room 1']);
    expect(deriveRooms(L).some((r) => r.id === meta.id)).toBe(true);
  });

  it('deleting the dividing wall merges rooms and drops the extra meta', () => {
    let doc = poly(fresh(), sq(0, 0, 6000), 100);
    doc = line(doc, [
      [3000, 0],
      [3000, 6000],
    ]);
    let L = lvl(doc);
    expect(Object.keys(L.rooms)).toHaveLength(2);
    const divider = Object.values(L.walls).find((w) => L.nodes[w.a]!.x === 3000 && L.nodes[w.b]!.x === 3000)!;
    doc = run(doc, { type: 'delete', level: L.id, refs: [{ coll: 'walls', id: divider.id }] });
    L = lvl(doc);
    expect(deriveRooms(L)).toHaveLength(1);
    expect(Object.keys(L.rooms)).toHaveLength(1);
  });
});

describe('wall footprints (mitres)', () => {
  it('mitres a rectangle so outlines meet exactly at corners', () => {
    const doc = poly(fresh(), sq(0, 0, 4000), 200);
    const fp = computeFootprints(lvl(doc));
    expect(fp.walls.size).toBe(4);
    let total = 0;
    for (const w of fp.walls.values()) total += polygonArea(w.poly);
    // ring area between 4200 outer and 3800 inner squares
    expect(total).toBeCloseTo(4200 * 4200 - 3800 * 3800, 0);
    expect(fp.hubs).toHaveLength(0);
  });

  it('caps dangling ends square and fills T-junctions with a hub', () => {
    let doc = line(
      fresh(),
      [
        [0, 0],
        [4000, 0],
      ],
      100,
    );
    doc = line(
      doc,
      [
        [2000, 0],
        [2000, 3000],
      ],
      100,
    );
    const fp = computeFootprints(lvl(doc));
    expect(fp.walls.size).toBe(3);
    expect(fp.hubs.length).toBe(1);
    let total = fp.hubs.reduce((s, h) => s + polygonArea(h), 0);
    for (const w of fp.walls.values()) total += polygonArea(w.poly);
    expect(total).toBeCloseTo(4000 * 100 + 2950 * 100, -1);
  });

  it('applies a miter limit at very sharp angles (no spikes)', () => {
    const doc = line(
      fresh(),
      [
        [0, 0],
        [4000, 0],
        [0, 100],
      ],
      200,
    );
    const fp = computeFootprints(lvl(doc));
    for (const w of fp.walls.values()) for (const p of w.poly) expect(p.x).toBeLessThan(4000 + 4 * 100 + 1);
  });

  it('mixed thicknesses still close', () => {
    let doc = line(
      fresh(),
      [
        [0, 0],
        [3000, 0],
      ],
      300,
    );
    doc = line(
      doc,
      [
        [3000, 0],
        [3000, 3000],
      ],
      100,
    );
    const fp = computeFootprints(lvl(doc));
    const [w1, w2] = [...fp.walls.values()];
    const shared = w1!.poly.filter((p) => w2!.poly.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6));
    expect(shared).toHaveLength(2);
  });
});
