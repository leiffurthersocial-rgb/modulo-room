import { catalogEntry } from '../catalog/catalog';
import { execute, type Command } from '../commands/commands';
import { deriveRooms } from '../geometry/rooms';
import { newId } from '../model/ids';
import { createProject } from '../model/project';
import type { Item, Level, Opening, OpeningKind, Project, Wall } from '../model/types';

function item(catalogId: string, x: number, y: number, rotation = 0, extra: Partial<Item> = {}): Item {
  const e = catalogEntry(catalogId);
  if (!e) throw new Error(`unknown catalog id ${catalogId}`);
  return {
    id: newId('i'),
    catalogId,
    x,
    y,
    rotation,
    width: e.dims.width,
    depth: e.dims.depth,
    height: e.dims.height,
    elevation: e.elevation,
    ...extra,
  };
}

/** Finds the wall whose centreline contains point (x, y). */
function wallAt(lv: Level, x: number, y: number): Wall {
  for (const w of Object.values(lv.walls)) {
    const a = lv.nodes[w.a];
    const b = lv.nodes[w.b];
    if (!a || !b) continue;
    const minX = Math.min(a.x, b.x) - 1;
    const maxX = Math.max(a.x, b.x) + 1;
    const minY = Math.min(a.y, b.y) - 1;
    const maxY = Math.max(a.y, b.y) + 1;
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (
      x >= minX &&
      x <= maxX &&
      y >= minY &&
      y <= maxY &&
      Math.abs(cross) < 1e-3 * Math.hypot(b.x - a.x, b.y - a.y)
    )
      return w;
  }
  throw new Error(`no wall at ${x},${y}`);
}

function opening(
  lv: Level,
  kind: OpeningKind,
  x: number,
  y: number,
  width: number,
  side: 'in' | 'out',
  hinge: 'a' | 'b' = 'a',
): Opening {
  const w = wallAt(lv, x, y);
  const a = lv.nodes[w.a] as { x: number; y: number };
  const b = lv.nodes[w.b] as { x: number; y: number };
  const offset = Math.hypot(x - a.x, y - a.y);
  // "in" = towards the larger room side: decided by the caller via the wall's left side.
  const dirx = (b.x - a.x) / Math.hypot(b.x - a.x, b.y - a.y);
  const diry = (b.y - a.y) / Math.hypot(b.x - a.x, b.y - a.y);
  const left = { x: diry, y: -dirx };
  const centre = { x: 3500, y: 2500 };
  const towardsCentre = (centre.x - x) * left.x + (centre.y - y) * left.y > 0;
  const sideLeft = side === 'in' ? towardsCentre : !towardsCentre;
  const isWindow = kind === 'window';
  return {
    id: newId('o'),
    wallId: w.id,
    kind,
    offset,
    width,
    height: isWindow ? 1300 : 2000,
    sill: isWindow ? 850 : 0,
    hinge,
    side: sideLeft ? 'l' : 'r',
  };
}

/** A furnished two-room flat used for the "Load sample" button and screenshots. */
export function buildSampleProject(): Project {
  let doc = createProject('Sample flat');
  const L = doc.levels[0]?.id ?? '';
  const run = (c: Command) => {
    doc = execute(doc, c).doc;
  };
  run({ type: 'addRectRoom', level: L, x: 0, y: 0, w: 7000, h: 5000, thickness: 200, height: 2500 });
  run({
    type: 'addWalls',
    level: L,
    points: [
      { x: 4200, y: -100 },
      { x: 4200, y: 5100 },
    ],
    closed: false,
    thickness: 100,
    height: 2500,
  });
  // bathroom in the bedroom's lower corner
  run({
    type: 'addWalls',
    level: L,
    points: [
      { x: 4200, y: 3200 },
      { x: 5900, y: 3200 },
      { x: 5900, y: 5100 },
    ],
    closed: false,
    thickness: 100,
    height: 2500,
  });
  let lv = doc.levels[0] as Level;
  const ops: Opening[] = [
    opening(lv, 'door', 1100, 5100, 900, 'in', 'a'),
    opening(lv, 'window', 1500, -100, 1400, 'in'),
    opening(lv, 'window', 3300, -100, 1000, 'in'),
    opening(lv, 'window', 5600, -100, 1400, 'in'),
    opening(lv, 'window', 7100, 1500, 1200, 'in'),
    opening(lv, 'door', 4200, 2500, 800, 'out', 'b'),
    opening(lv, 'door', 4650, 3200, 700, 'out', 'a'),
  ];
  run({ type: 'add', level: L, coll: 'openings', values: ops });
  const items: Item[] = [
    // living / dining
    item('rug', 1650, 2150, 90, { width: 2000, depth: 2600 }),
    item('sofa-3', 1650, 3300, 180),
    item('table-coffee', 1650, 2250),
    item('tv-unit', 1650, 225, 0),
    item('tv', 1650, 40, 0),
    item('armchair', 3200, 2200, 90),
    item('plant-fiddle', 300, 300),
    item('plant-palm', 3650, 550),
    item('table-dining', 3350, 4350, 90, { width: 1300, depth: 800 }),
    item('chair-dining', 2690, 4050, 270),
    item('chair-dining', 2690, 4650, 270),
    item('lamp-floor', 350, 4600),
    // bedroom
    item('bed-double', 5525, 1025, 0, { width: 1650 }),
    item('table-side', 4475, 225),
    item('lamp-table', 4475, 225, 0, { elevation: 500 }),
    item('table-side', 6575, 225),
    item('wardrobe-2', 6600, 2600, 90),
    item('plant-snake', 6725, 700),
    // bathroom
    item('shower', 4700, 4550),
    item('toilet', 5550, 4660, 180),
    item('washbasin', 5550, 3480, 0),
  ];
  run({ type: 'add', level: L, coll: 'items', values: items });
  lv = doc.levels[0] as Level;
  const names: [number, number, string][] = [
    [1500, 2000, 'Living room'],
    [5600, 1500, 'Bedroom'],
    [5000, 4300, 'Bathroom'],
  ];
  const cmds: Command[] = [];
  for (const r of deriveRooms(lv)) {
    const hit = names.find(([x, y]) => {
      const xs = r.polygon.map((p) => p.x);
      const ys = r.polygon.map((p) => p.y);
      return x > Math.min(...xs) && x < Math.max(...xs) && y > Math.min(...ys) && y < Math.max(...ys);
    });
    if (hit && r.meta)
      cmds.push({ type: 'update', level: L, coll: 'rooms', id: r.meta.id, patch: { name: hit[2] } });
  }
  run({ type: 'batch', label: 'Name rooms', cmds });
  return doc;
}
