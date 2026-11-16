import type { Coll, Entity, EntityOf, Id, Level, Patch, Project } from '../model/types';

/**
 * Primitive, serializable document operations. Every command compiles to a list of
 * ops plus the inverse list, which makes undo/redo, change sets and the command log
 * generic.
 */
export type Op =
  | { t: 'put'; level: Id; coll: Coll; value: Entity }
  | { t: 'del'; level: Id; coll: Coll; id: Id }
  | { t: 'levelProps'; level: Id; value: Partial<Omit<Level, Coll | 'id'>> }
  | { t: 'addLevel'; value: Level; index: number }
  | { t: 'removeLevel'; level: Id }
  | { t: 'projectProps'; value: Partial<Pick<Project, 'name' | 'northAngle'>> };

/** Ids touched per collection, per level. Drives incremental redraw / 3D sync. */
export interface ChangeSet {
  levels: Set<Id>;
  entities: Map<Id, Partial<Record<Coll, Set<Id>>>>;
  structural: boolean;
}

export function emptyChangeSet(): ChangeSet {
  return { levels: new Set(), entities: new Map(), structural: false };
}

export function changeSetOf(ops: readonly Op[]): ChangeSet {
  const cs = emptyChangeSet();
  for (const op of ops) {
    if (op.t === 'put' || op.t === 'del') {
      cs.levels.add(op.level);
      let per = cs.entities.get(op.level);
      if (!per) cs.entities.set(op.level, (per = {}));
      const set = (per[op.coll] ??= new Set());
      set.add(op.t === 'put' ? op.value.id : op.id);
    } else {
      cs.structural = true;
      if (op.t !== 'projectProps' && op.t !== 'addLevel') cs.levels.add(op.level);
    }
  }
  return cs;
}

function patchLevel(doc: Project, levelId: Id, f: (l: Level) => Level): Project {
  const idx = doc.levels.findIndex((l) => l.id === levelId);
  if (idx < 0) throw new Error(`Unknown level ${levelId}`);
  const levels = doc.levels.slice();
  levels[idx] = f(levels[idx] as Level);
  return { ...doc, levels };
}

/** Applies ops immutably (structural sharing): untouched levels/collections keep identity. */
export function applyOps(doc: Project, ops: readonly Op[]): Project {
  let out = doc;
  for (const op of ops) {
    switch (op.t) {
      case 'put':
        out = patchLevel(out, op.level, (l) => ({
          ...l,
          [op.coll]: { ...l[op.coll], [op.value.id]: op.value },
        }));
        break;
      case 'del':
        out = patchLevel(out, op.level, (l) => {
          const coll = Object.fromEntries(
            Object.entries(l[op.coll] as Record<Id, Entity>).filter(([k]) => k !== op.id),
          );
          return { ...l, [op.coll]: coll };
        });
        break;
      case 'levelProps':
        out = patchLevel(out, op.level, (l) => ({ ...l, ...op.value }));
        break;
      case 'addLevel': {
        const levels = out.levels.slice();
        levels.splice(op.index, 0, op.value);
        out = { ...out, levels };
        break;
      }
      case 'removeLevel':
        out = { ...out, levels: out.levels.filter((l) => l.id !== op.level) };
        break;
      case 'projectProps':
        out = { ...out, ...op.value };
        break;
    }
  }
  return out;
}

/**
 * Mutable working copy used while a command runs. Reads see earlier writes in the
 * same command. Every write records the forward op and its inverse.
 */
export class Draft {
  doc: Project;
  readonly ops: Op[] = [];
  private readonly inv: Op[] = [];

  constructor(doc: Project) {
    this.doc = doc;
  }

  level(levelId: Id): Level {
    const l = this.doc.levels.find((x) => x.id === levelId);
    if (!l) throw new Error(`Unknown level ${levelId}`);
    return l;
  }

  get<C extends Coll>(levelId: Id, coll: C, id: Id): EntityOf[C] | undefined {
    return (this.level(levelId)[coll] as Record<Id, EntityOf[C]>)[id];
  }

  all<C extends Coll>(levelId: Id, coll: C): EntityOf[C][] {
    return Object.values(this.level(levelId)[coll] as Record<Id, EntityOf[C]>);
  }

  private record(op: Op, inverse: Op): void {
    this.ops.push(op);
    this.inv.unshift(inverse);
    this.doc = applyOps(this.doc, [op]);
  }

  put<C extends Coll>(levelId: Id, coll: C, value: EntityOf[C]): void {
    const prev = this.get(levelId, coll, value.id);
    this.record(
      { t: 'put', level: levelId, coll, value },
      prev
        ? { t: 'put', level: levelId, coll, value: prev }
        : { t: 'del', level: levelId, coll, id: value.id },
    );
  }

  update<C extends Coll>(levelId: Id, coll: C, id: Id, patch: Patch<EntityOf[C]>): EntityOf[C] | undefined {
    const prev = this.get(levelId, coll, id);
    if (!prev) return undefined;
    // `undefined` in a patch removes the field (keeps JSON round-trips exact).
    const next = Object.fromEntries(
      Object.entries({ ...prev, ...patch } as Record<string, unknown>).filter(([, val]) => val !== undefined),
    ) as unknown as EntityOf[C];
    this.put(levelId, coll, next);
    return next;
  }

  del(levelId: Id, coll: Coll, id: Id): void {
    const prev = this.get(levelId, coll, id);
    if (!prev) return;
    this.record({ t: 'del', level: levelId, coll, id }, { t: 'put', level: levelId, coll, value: prev });
  }

  levelProps(levelId: Id, value: Partial<Omit<Level, Coll | 'id'>>): void {
    const l = this.level(levelId);
    const prev: Record<string, unknown> = {};
    for (const k of Object.keys(value)) prev[k] = (l as unknown as Record<string, unknown>)[k];
    this.record({ t: 'levelProps', level: levelId, value }, { t: 'levelProps', level: levelId, value: prev });
  }

  projectProps(value: Partial<Pick<Project, 'name' | 'northAngle'>>): void {
    const prev: Partial<Pick<Project, 'name' | 'northAngle'>> = {};
    if ('name' in value) prev.name = this.doc.name;
    if ('northAngle' in value) prev.northAngle = this.doc.northAngle;
    this.record({ t: 'projectProps', value }, { t: 'projectProps', value: prev });
  }

  addLevel(value: Level, index = this.doc.levels.length): void {
    this.record({ t: 'addLevel', value, index }, { t: 'removeLevel', level: value.id });
  }

  removeLevel(levelId: Id): void {
    const index = this.doc.levels.findIndex((l) => l.id === levelId);
    if (index < 0) return;
    this.record({ t: 'removeLevel', level: levelId }, { t: 'addLevel', value: this.level(levelId), index });
  }

  inverse(): Op[] {
    return this.inv.slice();
  }
}
