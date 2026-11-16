import { newId } from '../model/ids';
import type { Coll, Entity, EntityOf, Id, Project, Ref, Vec2, Wall, WallNode } from '../model/types';
import { deriveRooms } from '../geometry/rooms';
import { dist, norm, sub } from '../geometry/vec';
import { changeSetOf, Draft, type ChangeSet, type Op } from './ops';
import { normalizeLevel } from './normalize';

/** Every edit is one of these serializable commands. */
export type Command =
  | { type: 'addWalls'; level: Id; points: Vec2[]; closed: boolean; thickness: number; height: number }
  | {
      type: 'addRectRoom';
      level: Id;
      x: number;
      y: number;
      w: number;
      h: number;
      thickness: number;
      height: number;
    }
  | { type: 'setNodePos'; level: Id; id: Id; x: number; y: number }
  | { type: 'setWallLength'; level: Id; id: Id; length: number; anchor: 'a' | 'b' }
  | { type: 'splitWall'; level: Id; id: Id; at: Vec2 }
  | { type: 'add'; level: Id; coll: Coll; values: Entity[] }
  | { type: 'update'; level: Id; coll: Coll; id: Id; patch: Partial<Entity> }
  | { type: 'updateMany'; level: Id; coll: Coll; patches: { id: Id; patch: Partial<Entity> }[] }
  | { type: 'delete'; level: Id; refs: Ref[] }
  | { type: 'moveEntities'; level: Id; refs: Ref[]; dx: number; dy: number }
  | { type: 'paste'; level: Id; clip: Clipboard; dx: number; dy: number }
  | { type: 'setProject'; name?: string; northAngle?: number }
  | { type: 'batch'; label: string; cmds: Command[] };

/** Copied entities with their own nodes, for copy/paste and templates. */
export interface Clipboard {
  nodes: WallNode[];
  walls: Wall[];
  openings: EntityOf['openings'][];
  items: EntityOf['items'][];
  annotations: EntityOf['annotations'][];
}

export interface ExecResult {
  doc: Project;
  ops: Op[];
  inverse: Op[];
  changes: ChangeSet;
}

const GEOMETRY: ReadonlySet<Coll> = new Set<Coll>(['nodes', 'walls', 'openings']);

export function commandLabel(cmd: Command): string {
  switch (cmd.type) {
    case 'addWalls':
      return 'Draw walls';
    case 'addRectRoom':
      return 'Draw room';
    case 'setNodePos':
      return 'Move corner';
    case 'setWallLength':
      return 'Set wall length';
    case 'splitWall':
      return 'Split wall';
    case 'add':
      return `Add ${cmd.coll}`;
    case 'update':
    case 'updateMany':
      return `Edit ${cmd.coll}`;
    case 'delete':
      return 'Delete';
    case 'moveEntities':
      return 'Move';
    case 'paste':
      return 'Paste';
    case 'setProject':
      return 'Edit project';
    case 'batch':
      return cmd.label;
  }
}

function moveNodes(d: Draft, level: Id, ids: Iterable<Id>, dx: number, dy: number): void {
  for (const id of new Set(ids)) {
    const n = d.get(level, 'nodes', id);
    if (n) d.put(level, 'nodes', { ...n, x: n.x + dx, y: n.y + dy });
  }
}

function deleteRefs(d: Draft, level: Id, refs: Ref[]): void {
  const lv = d.level(level);
  const walls = new Set<Id>();
  for (const r of refs) {
    if (r.coll === 'walls') walls.add(r.id);
    else if (r.coll === 'nodes') {
      for (const w of Object.values(lv.walls)) if (w.a === r.id || w.b === r.id) walls.add(w.id);
    } else if (r.coll === 'rooms') {
      // Deleting a room removes its walls that border no other room.
      const rooms = deriveRooms(lv);
      const room = rooms.find((x) => x.id === r.id);
      if (!room) continue;
      for (const wid of room.walls) {
        const shared = rooms.some((o) => o !== room && o.walls.includes(wid));
        if (!shared) walls.add(wid);
      }
    }
  }
  for (const wid of walls) {
    for (const o of d.all(level, 'openings')) if (o.wallId === wid) d.del(level, 'openings', o.id);
    d.del(level, 'walls', wid);
  }
  for (const r of refs)
    if (r.coll !== 'walls' && r.coll !== 'nodes' && r.coll !== 'rooms') d.del(level, r.coll, r.id);
}

function run(d: Draft, cmd: Command): void {
  switch (cmd.type) {
    case 'addWalls': {
      const ids = cmd.points.map((p) => {
        const id = newId('n');
        d.put(cmd.level, 'nodes', { id, x: p.x, y: p.y });
        return id;
      });
      const n = ids.length;
      const segs = cmd.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        d.put(cmd.level, 'walls', {
          id: newId('w'),
          a: ids[i] as Id,
          b: ids[(i + 1) % n] as Id,
          thickness: cmd.thickness,
          height: cmd.height,
        });
      }
      return;
    }
    case 'addRectRoom': {
      // x,y,w,h describe the INTERIOR; wall centrelines sit half a thickness outside.
      const t = cmd.thickness / 2;
      const x0 = Math.min(cmd.x, cmd.x + cmd.w) - t;
      const y0 = Math.min(cmd.y, cmd.y + cmd.h) - t;
      const x1 = Math.max(cmd.x, cmd.x + cmd.w) + t;
      const y1 = Math.max(cmd.y, cmd.y + cmd.h) + t;
      run(d, {
        type: 'addWalls',
        level: cmd.level,
        points: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
        closed: true,
        thickness: cmd.thickness,
        height: cmd.height,
      });
      return;
    }
    case 'setNodePos': {
      const n = d.get(cmd.level, 'nodes', cmd.id);
      if (n) d.put(cmd.level, 'nodes', { ...n, x: cmd.x, y: cmd.y });
      return;
    }
    case 'setWallLength': {
      const w = d.get(cmd.level, 'walls', cmd.id);
      if (!w || !(cmd.length > 0)) return;
      const fixed = d.get(cmd.level, 'nodes', cmd.anchor === 'a' ? w.a : w.b);
      const moving = d.get(cmd.level, 'nodes', cmd.anchor === 'a' ? w.b : w.a);
      if (!fixed || !moving) return;
      const dir = norm(sub(moving, fixed));
      d.put(cmd.level, 'nodes', {
        ...moving,
        x: fixed.x + dir.x * cmd.length,
        y: fixed.y + dir.y * cmd.length,
      });
      return;
    }
    case 'splitWall': {
      const w = d.get(cmd.level, 'walls', cmd.id);
      if (!w) return;
      const nid = newId('n');
      d.put(cmd.level, 'nodes', { id: nid, x: cmd.at.x, y: cmd.at.y });
      return; // planarize splits the wall at the new node
    }
    case 'add':
      for (const v of cmd.values) d.put(cmd.level, cmd.coll, v as EntityOf[typeof cmd.coll]);
      return;
    case 'update':
      d.update(cmd.level, cmd.coll, cmd.id, cmd.patch as Partial<EntityOf[typeof cmd.coll]>);
      return;
    case 'updateMany':
      for (const p of cmd.patches)
        d.update(cmd.level, cmd.coll, p.id, p.patch as Partial<EntityOf[typeof cmd.coll]>);
      return;
    case 'delete':
      deleteRefs(d, cmd.level, cmd.refs);
      return;
    case 'moveEntities': {
      const nodeIds: Id[] = [];
      for (const r of cmd.refs) {
        if (r.coll === 'nodes') nodeIds.push(r.id);
        else if (r.coll === 'walls') {
          const w = d.get(cmd.level, 'walls', r.id);
          if (w) nodeIds.push(w.a, w.b);
        } else if (r.coll === 'items' || r.coll === 'lights' || r.coll === 'refImages') {
          const e = d.get(cmd.level, r.coll, r.id);
          if (e) d.put(cmd.level, r.coll, { ...e, x: e.x + cmd.dx, y: e.y + cmd.dy } as never);
        } else if (r.coll === 'annotations') {
          const e = d.get(cmd.level, 'annotations', r.id);
          if (e?.kind === 'text') d.put(cmd.level, 'annotations', { ...e, x: e.x + cmd.dx, y: e.y + cmd.dy });
          else if (e?.kind === 'dimension') {
            d.put(cmd.level, 'annotations', {
              ...e,
              a: { x: e.a.x + cmd.dx, y: e.a.y + cmd.dy },
              b: { x: e.b.x + cmd.dx, y: e.b.y + cmd.dy },
            });
          }
        }
      }
      moveNodes(d, cmd.level, nodeIds, cmd.dx, cmd.dy);
      return;
    }
    case 'paste': {
      const map = new Map<Id, Id>();
      const remap = (id: Id, prefix: string) => {
        let n = map.get(id);
        if (!n) map.set(id, (n = newId(prefix)));
        return n;
      };
      for (const n of cmd.clip.nodes)
        d.put(cmd.level, 'nodes', { id: remap(n.id, 'n'), x: n.x + cmd.dx, y: n.y + cmd.dy });
      for (const w of cmd.clip.walls)
        d.put(cmd.level, 'walls', { ...w, id: remap(w.id, 'w'), a: remap(w.a, 'n'), b: remap(w.b, 'n') });
      for (const o of cmd.clip.openings)
        d.put(cmd.level, 'openings', { ...o, id: remap(o.id, 'o'), wallId: remap(o.wallId, 'w') });
      for (const it of cmd.clip.items)
        d.put(cmd.level, 'items', { ...it, id: remap(it.id, 'i'), x: it.x + cmd.dx, y: it.y + cmd.dy });
      for (const an of cmd.clip.annotations) {
        const id = remap(an.id, 'a');
        if (an.kind === 'text')
          d.put(cmd.level, 'annotations', { ...an, id, x: an.x + cmd.dx, y: an.y + cmd.dy });
        else
          d.put(cmd.level, 'annotations', {
            ...an,
            id,
            a: { x: an.a.x + cmd.dx, y: an.a.y + cmd.dy },
            b: { x: an.b.x + cmd.dx, y: an.b.y + cmd.dy },
          });
      }
      return;
    }
    case 'setProject': {
      const v: { name?: string; northAngle?: number } = {};
      if (cmd.name !== undefined) v.name = cmd.name;
      if (cmd.northAngle !== undefined) v.northAngle = cmd.northAngle;
      d.projectProps(v);
      return;
    }
    case 'batch':
      for (const c of cmd.cmds) run(d, c);
      return;
  }
}

/** Runs a command against a document. Pure: the input document is not modified. */
export function execute(doc: Project, cmd: Command): ExecResult {
  const d = new Draft(doc);
  run(d, cmd);
  const geomLevels = new Set<Id>();
  for (const op of d.ops)
    if ((op.t === 'put' || op.t === 'del') && GEOMETRY.has(op.coll)) geomLevels.add(op.level);
  for (const l of geomLevels) normalizeLevel(d, l);
  return { doc: d.doc, ops: d.ops, inverse: d.inverse(), changes: changeSetOf(d.ops) };
}

/** Copies the given refs (plus nodes of copied walls) into a clipboard payload. */
export function copyRefs(doc: Project, level: Id, refs: Ref[]): Clipboard {
  const lv = doc.levels.find((l) => l.id === level);
  const clip: Clipboard = { nodes: [], walls: [], openings: [], items: [], annotations: [] };
  if (!lv) return clip;
  const wallIds = new Set(refs.filter((r) => r.coll === 'walls').map((r) => r.id));
  for (const r of refs) {
    if (r.coll === 'rooms') {
      const room = deriveRooms(lv).find((x) => x.id === r.id);
      room?.walls.forEach((w) => wallIds.add(w));
    }
  }
  const nodeIds = new Set<Id>();
  for (const id of wallIds) {
    const w = lv.walls[id];
    if (!w) continue;
    clip.walls.push(w);
    nodeIds.add(w.a);
    nodeIds.add(w.b);
  }
  for (const id of nodeIds) {
    const n = lv.nodes[id];
    if (n) clip.nodes.push(n);
  }
  for (const o of Object.values(lv.openings)) if (wallIds.has(o.wallId)) clip.openings.push(o);
  for (const r of refs) {
    if (r.coll === 'items' && lv.items[r.id]) clip.items.push(lv.items[r.id] as EntityOf['items']);
    if (r.coll === 'annotations' && lv.annotations[r.id])
      clip.annotations.push(lv.annotations[r.id] as EntityOf['annotations']);
  }
  return clip;
}

/** Distance helper for tools that need the current wall length. */
export function currentWallLength(doc: Project, level: Id, wallId: Id): number {
  const lv = doc.levels.find((l) => l.id === level);
  const w = lv?.walls[wallId];
  const a = w && lv?.nodes[w.a];
  const b = w && lv?.nodes[w.b];
  return a && b ? dist(a, b) : 0;
}
