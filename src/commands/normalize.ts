import { newId } from '../model/ids';
import type { Id, RoomMeta, Wall } from '../model/types';
import { deriveRooms } from '../geometry/rooms';
import { dist, projectOnSegment, segmentIntersect } from '../geometry/vec';
import type { Draft } from './ops';

/** Nodes closer than this merge; nodes this close to a wall split it. */
export const MERGE_MM = 1;
const MIN_OPENING_WALL = 100;

/** Splits wall `wallId` at existing node `nodeId`; openings follow their centre. Returns the new wall id. */
export function splitWallAtNode(d: Draft, level: Id, wallId: Id, nodeId: Id): Id | null {
  const w = d.get(level, 'walls', wallId);
  const n = d.get(level, 'nodes', nodeId);
  if (!w || !n || w.a === nodeId || w.b === nodeId) return null;
  const a = d.get(level, 'nodes', w.a);
  const b = d.get(level, 'nodes', w.b);
  if (!a || !b) return null;
  const L = dist(a, b);
  const s = dist(a, n);
  const w1: Wall = { ...w, b: nodeId };
  const w2: Wall = { ...w, id: newId('w'), a: nodeId };
  if (w.heightEnd !== undefined) {
    const hn = w.height + ((w.heightEnd - w.height) * s) / (L || 1);
    w1.heightEnd = hn;
    w2.height = hn;
  }
  d.put(level, 'walls', w1);
  d.put(level, 'walls', w2);
  for (const o of d.all(level, 'openings')) {
    if (o.wallId !== wallId) continue;
    if (o.offset > s) d.put(level, 'openings', { ...o, wallId: w2.id, offset: o.offset - s });
  }
  return w2.id;
}

function wallsAt(d: Draft, level: Id, nodeId: Id): Wall[] {
  return d.all(level, 'walls').filter((w) => w.a === nodeId || w.b === nodeId);
}

function deleteWall(d: Draft, level: Id, wallId: Id): void {
  for (const o of d.all(level, 'openings')) if (o.wallId === wallId) d.del(level, 'openings', o.id);
  d.del(level, 'walls', wallId);
}

/** Makes the wall graph planar: merges close nodes, splits T-junctions and crossings, removes degenerate walls. */
export function planarize(d: Draft, level: Id): void {
  let guard = 0;
  let changed = true;
  while (changed && guard++ < 500) {
    changed = false;
    const nodes = d.all(level, 'nodes').sort((p, q) => (p.id < q.id ? -1 : 1));

    // 1) merge nearly coincident nodes (older id survives)
    outer: for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const p = nodes[i];
        const q = nodes[j];
        if (!p || !q || dist(p, q) >= MERGE_MM) continue;
        for (const w of wallsAt(d, level, q.id)) {
          d.put(level, 'walls', { ...w, a: w.a === q.id ? p.id : w.a, b: w.b === q.id ? p.id : w.b });
        }
        d.del(level, 'nodes', q.id);
        changed = true;
        break outer;
      }
    }
    if (changed) continue;

    // 2) degenerate walls and duplicates
    const walls = d.all(level, 'walls').sort((p, q) => (p.id < q.id ? -1 : 1));
    const seen = new Map<string, Wall>();
    for (const w of walls) {
      const a = d.get(level, 'nodes', w.a);
      const b = d.get(level, 'nodes', w.b);
      if (!a || !b || w.a === w.b || dist(a, b) < MERGE_MM) {
        deleteWall(d, level, w.id);
        changed = true;
        continue;
      }
      const k = w.a < w.b ? `${w.a}|${w.b}` : `${w.b}|${w.a}`;
      const keep = seen.get(k);
      if (keep) {
        const reversed = keep.a !== w.a;
        const L = dist(a, b);
        for (const o of d.all(level, 'openings')) {
          if (o.wallId === w.id) {
            d.put(level, 'openings', {
              ...o,
              wallId: keep.id,
              offset: reversed ? L - o.offset : o.offset,
              hinge: reversed ? (o.hinge === 'a' ? 'b' : 'a') : o.hinge,
              side: reversed ? (o.side === 'l' ? 'r' : 'l') : o.side,
            });
          }
        }
        d.del(level, 'walls', w.id);
        changed = true;
      } else seen.set(k, w);
    }
    if (changed) continue;

    // 3) node lying on a wall interior -> split (T-junction)
    const ws = d.all(level, 'walls').sort((p, q) => (p.id < q.id ? -1 : 1));
    tee: for (const n of d.all(level, 'nodes').sort((p, q) => (p.id < q.id ? -1 : 1))) {
      for (const w of ws) {
        if (w.a === n.id || w.b === n.id) continue;
        const a = d.get(level, 'nodes', w.a);
        const b = d.get(level, 'nodes', w.b);
        if (!a || !b) continue;
        const pr = projectOnSegment(n, a, b);
        if (pr.dist < MERGE_MM && pr.t > 0 && pr.t < 1) {
          d.put(level, 'nodes', { ...n, x: pr.point.x, y: pr.point.y });
          splitWallAtNode(d, level, w.id, n.id);
          changed = true;
          break tee;
        }
      }
    }
    if (changed) continue;

    // 4) proper crossings -> new node, split both
    cross: for (let i = 0; i < ws.length; i++) {
      for (let j = i + 1; j < ws.length; j++) {
        const w1 = ws[i] as Wall;
        const w2 = ws[j] as Wall;
        if (w1.a === w2.a || w1.a === w2.b || w1.b === w2.a || w1.b === w2.b) continue;
        const a = d.get(level, 'nodes', w1.a);
        const b = d.get(level, 'nodes', w1.b);
        const c = d.get(level, 'nodes', w2.a);
        const e = d.get(level, 'nodes', w2.b);
        if (!a || !b || !c || !e) continue;
        const hit = segmentIntersect(a, b, c, e);
        if (!hit) continue;
        const L1 = dist(a, b);
        const L2 = dist(c, e);
        const inner1 = hit.t * L1 > MERGE_MM && (1 - hit.t) * L1 > MERGE_MM;
        const inner2 = hit.u * L2 > MERGE_MM && (1 - hit.u) * L2 > MERGE_MM;
        if (!inner1 || !inner2) continue; // touching at an end: handled by step 3
        const nid = newId('n');
        d.put(level, 'nodes', { id: nid, x: hit.point.x, y: hit.point.y });
        splitWallAtNode(d, level, w1.id, nid);
        splitWallAtNode(d, level, w2.id, nid);
        changed = true;
        break cross;
      }
    }
  }

  // 5) orphan nodes
  const used = new Set<Id>();
  for (const w of d.all(level, 'walls')) {
    used.add(w.a);
    used.add(w.b);
  }
  for (const n of d.all(level, 'nodes')) if (!used.has(n.id)) d.del(level, 'nodes', n.id);
}

/** Keeps openings inside their wall; removes ones that no longer fit. */
export function clampOpenings(d: Draft, level: Id): void {
  for (const o of d.all(level, 'openings')) {
    const w = d.get(level, 'walls', o.wallId);
    const a = w && d.get(level, 'nodes', w.a);
    const b = w && d.get(level, 'nodes', w.b);
    if (!w || !a || !b) {
      d.del(level, 'openings', o.id);
      continue;
    }
    const L = dist(a, b);
    if (L < MIN_OPENING_WALL) {
      d.del(level, 'openings', o.id);
      continue;
    }
    const width = Math.min(o.width, L);
    const offset = Math.min(Math.max(o.offset, width / 2), L - width / 2);
    if (width !== o.width || Math.abs(offset - o.offset) > 1e-6)
      d.put(level, 'openings', { ...o, width, offset });
  }
}

function nextRoomName(existing: RoomMeta[]): string {
  const used = new Set(existing.map((m) => m.name));
  for (let i = 1; ; i++) if (!used.has(`Room ${i}`)) return `Room ${i}`;
}

/** Creates/updates/deletes RoomMeta so every derived room has stable, stored identity. */
export function syncRooms(d: Draft, level: Id): void {
  const lv = d.level(level);
  const rooms = deriveRooms(lv);
  const keep = new Set<Id>();
  for (const r of rooms) {
    if (r.meta) {
      keep.add(r.meta.id);
      const wallsChanged =
        r.meta.walls.length !== r.walls.length || r.walls.some((w) => !r.meta?.walls.includes(w));
      if (wallsChanged || dist(r.meta.seed, r.center) > 1) {
        d.put(level, 'rooms', { ...r.meta, seed: r.center, walls: r.walls });
      }
    }
  }
  for (const m of Object.values(lv.rooms)) if (!keep.has(m.id)) d.del(level, 'rooms', m.id);
  for (const r of rooms) {
    if (r.meta) continue;
    const meta: RoomMeta = {
      id: newId('room'),
      name: nextRoomName(d.all(level, 'rooms')),
      seed: r.center,
      walls: r.walls,
    };
    d.put(level, 'rooms', meta);
  }
}

/** Full post-processing after geometry edits. */
export function normalizeLevel(d: Draft, level: Id): void {
  planarize(d, level);
  clampOpenings(d, level);
  syncRooms(d, level);
}
