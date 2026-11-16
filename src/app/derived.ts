import { catalogEntry } from '../catalog/catalog';
import { planWarnings, type PlanWarning } from '../geometry/collide';
import { computeFootprints, type Footprints } from '../geometry/footprints';
import { deriveRooms, type DerivedRoom } from '../geometry/rooms';
import type { Level } from '../model/types';

export interface Derived {
  rooms: DerivedRoom[];
  footprints: Footprints;
  warnings: PlanWarning[];
}

/** Memoised by level object identity (documents are immutable). */
const cache = new WeakMap<Level, Map<number, Derived>>();

export function derive(level: Level, walkwayMin: number): Derived {
  let byWalk = cache.get(level);
  if (!byWalk) cache.set(level, (byWalk = new Map()));
  const hit = byWalk.get(walkwayMin);
  if (hit) return hit;
  const footprints = computeFootprints(level);
  const d: Derived = {
    rooms: deriveRooms(level),
    footprints,
    warnings: planWarnings(level, footprints, catalogEntry, walkwayMin),
  };
  byWalk.set(walkwayMin, d);
  return d;
}
