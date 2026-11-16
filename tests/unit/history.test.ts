import { describe, expect, it } from 'vitest';
import { execute, type Command } from '../../src/commands/commands';
import { commit, initHistory, redo, undo } from '../../src/commands/history';
import { applyOps } from '../../src/commands/ops';
import { fresh, lvl } from './helpers';

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

/** Random but valid command against the current doc. */
function randomCommand(doc: ReturnType<typeof fresh>, r: () => number): Command {
  const L = lvl(doc);
  const nodes = Object.values(L.nodes);
  const walls = Object.values(L.walls);
  const items = Object.values(L.items);
  const k = Math.floor(r() * 7);
  const P = () => ({ x: Math.round(r() * 8000), y: Math.round(r() * 6000) });
  if (k === 0 || nodes.length === 0)
    return {
      type: 'addWalls',
      level: L.id,
      points: [P(), P(), P()],
      closed: r() > 0.5,
      thickness: 100,
      height: 2500,
    };
  if (k === 1)
    return {
      type: 'addRectRoom',
      level: L.id,
      ...P(),
      w: 2000 + r() * 2000,
      h: 2000,
      thickness: 150,
      height: 2500,
    };
  if (k === 2) {
    const n = nodes[Math.floor(r() * nodes.length)]!;
    return { type: 'setNodePos', level: L.id, id: n.id, ...P() };
  }
  if (k === 3 && walls.length) {
    const w = walls[Math.floor(r() * walls.length)]!;
    return { type: 'delete', level: L.id, refs: [{ coll: 'walls', id: w.id }] };
  }
  if (k === 4)
    return {
      type: 'add',
      level: L.id,
      coll: 'items',
      values: [
        {
          id: `i${Math.floor(r() * 1e9)}`,
          catalogId: 'box',
          ...P(),
          rotation: 0,
          width: 500,
          depth: 500,
          height: 500,
          elevation: 0,
        },
      ],
    };
  if (k === 5 && items.length) {
    const it = items[0]!;
    return { type: 'moveEntities', level: L.id, refs: [{ coll: 'items', id: it.id }], dx: 100, dy: -50 };
  }
  if (walls.length) {
    const w = walls[Math.floor(r() * walls.length)]!;
    return {
      type: 'setWallLength',
      level: L.id,
      id: w.id,
      length: 500 + r() * 3000,
      anchor: r() > 0.5 ? 'a' : 'b',
    };
  }
  return { type: 'addWalls', level: L.id, points: [P(), P()], closed: false, thickness: 100, height: 2500 };
}

describe('commands and history', () => {
  it('apply(ops) then apply(inverse) restores the document exactly (property test)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = rng(seed);
      let doc = fresh(seed);
      for (let i = 0; i < 12; i++) {
        const cmd = randomCommand(doc, r);
        const res = execute(doc, cmd);
        expect(applyOps(res.doc, res.inverse)).toEqual(doc);
        expect(applyOps(doc, res.ops)).toEqual(res.doc);
        doc = res.doc;
      }
    }
  });

  it('undo all then redo all returns to the same state', () => {
    const r = rng(7);
    let h = initHistory(fresh(7));
    const start = h.doc;
    for (let i = 0; i < 20; i++) h = commit(h, randomCommand(h.doc, r)).state;
    const end = h.doc;
    while (h.past.length) h = undo(h)!.state;
    expect(h.doc).toEqual(start);
    while (h.future.length) h = redo(h)!.state;
    expect(h.doc).toEqual(end);
  });

  it('a new commit clears the redo stack; no-op commands are not recorded', () => {
    let h = initHistory(fresh());
    const L = lvl(h.doc);
    h = commit(h, {
      type: 'addRectRoom',
      level: L.id,
      x: 0,
      y: 0,
      w: 3000,
      h: 3000,
      thickness: 100,
      height: 2500,
    }).state;
    h = undo(h)!.state;
    expect(h.future).toHaveLength(1);
    h = commit(h, { type: 'delete', level: L.id, refs: [] }).state;
    expect(h.future).toHaveLength(1); // no-op: not recorded
    h = commit(h, { type: 'setProject', name: 'X' }).state;
    expect(h.future).toHaveLength(0);
    expect(undo(initHistory(fresh()))).toBeNull();
  });

  it('records a serializable command log', () => {
    let h = initHistory(fresh());
    h = commit(h, { type: 'setProject', name: 'Flat' }).state;
    expect(JSON.parse(JSON.stringify(h.past.map((e) => e.cmd)))).toEqual([
      { type: 'setProject', name: 'Flat' },
    ]);
    expect(h.past[0]!.label).toBe('Edit project');
  });
});
