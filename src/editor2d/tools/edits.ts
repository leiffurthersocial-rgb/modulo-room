import { catalogEntry } from '../../catalog/catalog';
import type { Command } from '../../commands/commands';
import { openingFrame } from '../../geometry/footprints';
import { dist, mid, norm, sub } from '../../geometry/vec';
import { lengthToInput, parseAngle, parseLength } from '../../model/units';
import type { OpeningKind, Vec2 } from '../../model/types';
import { OPENING_DEFAULTS } from './place';
import type { EditorApi } from './types';

const BAD_LENGTH = 'Enter a length like 3.2 m, 320 cm, 3200 mm or 10\' 6"';

/** Edit the centreline length of a wall, keeping one end fixed. */
export function editWallLength(api: EditorApi, wallId: string): void {
  const s = api.store;
  const lv = s.committedLevel;
  const w = lv.walls[wallId];
  const a = w && lv.nodes[w.a];
  const b = w && lv.nodes[w.b];
  if (!w || !a || !b) return;
  if (w.lockLength) return api.toast('This wall’s length is locked (unlock it in the inspector).');
  const L = dist(a, b);
  const fp = s.committedDerived.footprints.walls.get(wallId);
  const inner = fp ? Math.min(dist(...fp.left), dist(...fp.right)) : L;
  api.openNumeric({
    at: api.vp.toScreen(mid(a, b)),
    title: 'Wall length (centreline)',
    fields: [
      { key: 'len', label: 'Length', value: lengthToInput(L, api.prefs), kind: 'length' },
      {
        key: 'anchor',
        label: 'Keep fixed',
        value: 'a',
        kind: 'select',
        options: [
          { value: 'a', label: 'Start corner' },
          { value: 'b', label: 'End corner' },
        ],
      },
    ],
    submitLabel: `Apply (inside: ${lengthToInput(inner, api.prefs)})`,
    onSubmit: (v) => {
      const len = parseLength(v['len'] ?? '', api.prefs);
      if (!len || len <= 0) return BAD_LENGTH;
      s.dispatch({
        type: 'setWallLength',
        level: s.levelId,
        id: wallId,
        length: len,
        anchor: v['anchor'] === 'b' ? 'b' : 'a',
      });
    },
  });
}

/**
 * Edit an INTERIOR room dimension. The wall at the chosen end of the edge moves
 * parallel to itself (Floorplanner-style), so rectangles stay rectangular.
 */
export function editRoomEdge(api: EditorApi, roomId: string, edge: number, at: Vec2): void {
  const s = api.store;
  const room = s.committedDerived.rooms.find((r) => r.id === roomId);
  if (!room) return;
  const n = room.polygon.length;
  const p0 = room.polygon[edge] as Vec2;
  const p1 = room.polygon[(edge + 1) % n] as Vec2;
  const ei = room.edgeIdx[edge];
  if (ei === null || ei === undefined) return;
  const L = dist(p0, p1);
  const dir = norm(sub(p1, p0));
  const edges = room.cycle.edges;
  const m = edges.length;
  const nextWall = edges[(ei + 1) % m]?.wallId;
  const prevWall = edges[(ei - 1 + m) % m]?.wallId;
  api.openNumeric({
    at,
    title: `${room.meta?.name ?? 'Room'}: inside length`,
    fields: [
      { key: 'len', label: 'Length', value: lengthToInput(L, api.prefs), kind: 'length' },
      {
        key: 'move',
        label: 'Move',
        value: 'end',
        kind: 'select',
        options: [
          { value: 'end', label: 'Wall at the end ▶' },
          { value: 'start', label: '◀ Wall at the start' },
          { value: 'both', label: '◀ Both ▶' },
        ],
      },
    ],
    submitLabel: 'Apply',
    onSubmit: (v) => {
      const len = parseLength(v['len'] ?? '', api.prefs);
      if (!len || len <= 0) return BAD_LENGTH;
      const delta = len - L;
      if (Math.abs(delta) < 0.01) return;
      const mv = (wallId: string | undefined, k: number): Command[] =>
        wallId
          ? [
              {
                type: 'moveEntities',
                level: s.levelId,
                refs: [{ coll: 'walls', id: wallId }],
                dx: dir.x * k,
                dy: dir.y * k,
              },
            ]
          : [];
      const how = v['move'];
      const cmds =
        how === 'start'
          ? mv(prevWall, -delta)
          : how === 'both'
            ? [...mv(nextWall, delta / 2), ...mv(prevWall, -delta / 2)]
            : mv(nextWall, delta);
      s.dispatch({ type: 'batch', label: 'Set room size', cmds });
    },
  });
}

export function renameRoom(api: EditorApi, roomId: string): void {
  const s = api.store;
  const room = s.committedDerived.rooms.find((r) => r.id === roomId);
  if (!room?.meta) return;
  const meta = room.meta;
  api.openNumeric({
    at: api.vp.toScreen(room.center),
    title: 'Room name',
    fields: [{ key: 'name', label: 'Name', value: meta.name, kind: 'text' }],
    submitLabel: 'Rename',
    onSubmit: (v) => {
      const name = (v['name'] ?? '').trim();
      if (!name) return 'Enter a name';
      s.dispatch({ type: 'update', level: s.levelId, coll: 'rooms', id: meta.id, patch: { name } });
    },
  });
}

export function editItemSize(api: EditorApi, itemId: string, at: Vec2): void {
  const s = api.store;
  const it = s.committedLevel.items[itemId];
  if (!it) return;
  const p = api.prefs;
  api.openNumeric({
    at,
    title: it.name ?? catalogEntry(it.catalogId)?.name ?? 'Item',
    fields: [
      { key: 'w', label: 'Width', value: lengthToInput(it.width, p), kind: 'length' },
      { key: 'd', label: 'Depth', value: lengthToInput(it.depth, p), kind: 'length' },
      { key: 'h', label: 'Height', value: lengthToInput(it.height, p), kind: 'length' },
      { key: 'r', label: 'Rotation °', value: String(Math.round(it.rotation * 10) / 10), kind: 'angle' },
    ],
    submitLabel: 'Apply',
    onSubmit: (v) => {
      const w = parseLength(v['w'] ?? '', p);
      const d = parseLength(v['d'] ?? '', p);
      const h = parseLength(v['h'] ?? '', p);
      const r = parseAngle(v['r'] ?? '');
      if (!w || !d || !h || w <= 0 || d <= 0 || h <= 0) return BAD_LENGTH;
      if (r === null) return 'Enter a rotation in degrees';
      s.dispatch({
        type: 'update',
        level: s.levelId,
        coll: 'items',
        id: itemId,
        patch: { width: w, depth: d, height: h, rotation: ((r % 360) + 360) % 360 },
      });
    },
  });
}

export function editOpening(api: EditorApi, id: string, at: Vec2): void {
  const s = api.store;
  const lv = s.committedLevel;
  const o = lv.openings[id];
  if (!o || !openingFrame(lv, o)) return;
  const p = api.prefs;
  api.openNumeric({
    at,
    title: OPENING_DEFAULTS[o.kind].label,
    fields: [
      { key: 'w', label: 'Width', value: lengthToInput(o.width, p), kind: 'length' },
      { key: 'h', label: 'Height', value: lengthToInput(o.height, p), kind: 'length' },
      { key: 's', label: 'Sill', value: lengthToInput(o.sill, p), kind: 'length' },
      {
        key: 'k',
        label: 'Type',
        value: o.kind,
        kind: 'select',
        options: (Object.keys(OPENING_DEFAULTS) as OpeningKind[]).map((k) => ({
          value: k,
          label: OPENING_DEFAULTS[k].label,
        })),
      },
    ],
    submitLabel: 'Apply',
    onSubmit: (v) => {
      const w = parseLength(v['w'] ?? '', p);
      const h = parseLength(v['h'] ?? '', p);
      const sill = parseLength(v['s'] ?? '', p);
      if (!w || !h || w <= 0 || h <= 0 || sill === null || sill < 0) return BAD_LENGTH;
      s.dispatch({
        type: 'update',
        level: s.levelId,
        coll: 'openings',
        id,
        patch: { width: w, height: h, sill, kind: (v['k'] ?? o.kind) as OpeningKind },
      });
    },
  });
}

export function editText(api: EditorApi, id: string, at: Vec2): void {
  const s = api.store;
  const a = s.committedLevel.annotations[id];
  if (!a || a.kind !== 'text') return;
  api.openNumeric({
    at,
    title: 'Text label',
    fields: [{ key: 't', label: 'Text', value: a.text, kind: 'text' }],
    submitLabel: 'Apply',
    onSubmit: (v) => {
      const t = (v['t'] ?? '').trim();
      if (!t) return 'Enter some text';
      s.dispatch({ type: 'update', level: s.levelId, coll: 'annotations', id, patch: { text: t } });
    },
  });
}
