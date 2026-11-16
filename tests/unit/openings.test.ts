import { describe, expect, it } from 'vitest';
import { openingFrame } from '../../src/geometry/footprints';
import type { Opening } from '../../src/model/types';
import { fresh, line, lvl, run } from './helpers';

const door = (wallId: string, offset: number, width = 800): Opening => ({
  id: 'o1',
  wallId,
  kind: 'door',
  offset,
  width,
  height: 2000,
  sill: 0,
  hinge: 'a',
  side: 'l',
});

describe('openings', () => {
  it('is clamped inside its wall', () => {
    let doc = line(fresh(), [
      [0, 0],
      [3000, 0],
    ]);
    const L = lvl(doc);
    const wid = Object.keys(L.walls)[0]!;
    doc = run(doc, { type: 'add', level: L.id, coll: 'openings', values: [door(wid, 100)] });
    expect(lvl(doc).openings['o1']!.offset).toBe(400);
    doc = run(doc, { type: 'update', level: L.id, coll: 'openings', id: 'o1', patch: { offset: 99999 } });
    expect(lvl(doc).openings['o1']!.offset).toBe(2600);
  });

  it('follows its wall when the wall is moved and survives a split on the correct side', () => {
    let doc = line(fresh(), [
      [0, 0],
      [4000, 0],
    ]);
    let L = lvl(doc);
    const wid = Object.keys(L.walls)[0]!;
    doc = run(doc, { type: 'add', level: L.id, coll: 'openings', values: [door(wid, 3000)] });
    doc = run(doc, { type: 'moveEntities', level: L.id, refs: [{ coll: 'walls', id: wid }], dx: 0, dy: 500 });
    L = lvl(doc);
    expect(openingFrame(L, L.openings['o1']!)!.center).toEqual({ x: 3000, y: 500 });
    // split the wall at x=2000 with a perpendicular wall: door must land on the right piece at offset 1000
    doc = line(doc, [
      [2000, 500],
      [2000, 3000],
    ]);
    L = lvl(doc);
    const o = L.openings['o1']!;
    expect(o.wallId).not.toBe(wid);
    expect(o.offset).toBeCloseTo(1000, 6);
    expect(openingFrame(L, o)!.center.x).toBeCloseTo(3000, 6);
  });

  it('is removed with its wall and shrinks to fit a shortened wall', () => {
    let doc = line(fresh(), [
      [0, 0],
      [3000, 0],
    ]);
    let L = lvl(doc);
    const wid = Object.keys(L.walls)[0]!;
    doc = run(doc, { type: 'add', level: L.id, coll: 'openings', values: [door(wid, 1500, 900)] });
    doc = run(doc, { type: 'setWallLength', level: L.id, id: wid, length: 700, anchor: 'a' });
    L = lvl(doc);
    expect(L.openings['o1']!.width).toBe(700);
    doc = run(doc, { type: 'delete', level: L.id, refs: [{ coll: 'walls', id: wid }] });
    expect(lvl(doc).openings).toEqual({});
  });
});
