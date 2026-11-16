import { DEFAULT_SETTINGS, SCHEMA_VERSION } from './project';
import { COLLS, type Level, type Project } from './types';

/** Raised when an imported file is not a usable Modulo: Room project. */
export class ProjectFormatError extends Error {}

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Ordered migrations: MIGRATIONS[n] upgrades a document from version n to n+1.
 * v0 = the pre-release format with array collections and `walls[].thickness_mm`.
 * It exists to prove and test the mechanism; real files start at v1.
 */
export const MIGRATIONS: Record<number, (doc: Json) => Json> = {
  0: (doc) => {
    const levels = Array.isArray(doc['levels']) ? doc['levels'] : [];
    const toRecord = (arr: unknown): Json => {
      const out: Json = {};
      if (Array.isArray(arr))
        for (const e of arr) if (isObj(e) && typeof e['id'] === 'string') out[e['id']] = e;
      return out;
    };
    return {
      ...doc,
      schemaVersion: 1,
      levels: levels.map((l: unknown) => {
        const lv = isObj(l) ? l : {};
        const rec: Json = { ...lv };
        for (const c of COLLS) rec[c] = toRecord(lv[c]);
        const walls = rec['walls'] as Json;
        for (const w of Object.values(walls)) {
          if (isObj(w) && 'thickness_mm' in w) {
            w['thickness'] = w['thickness_mm'];
            delete w['thickness_mm'];
          }
        }
        return rec;
      }),
    };
  },
};

/** Upgrades any supported version to the current schema and fills defaults. */
export function migrate(input: unknown): Project {
  if (!isObj(input) || input['format'] !== 'modulo-room') {
    throw new ProjectFormatError('Not a Modulo: Room project file.');
  }
  let doc: Json = input;
  let v = typeof doc['schemaVersion'] === 'number' ? doc['schemaVersion'] : 0;
  if (v > SCHEMA_VERSION) {
    throw new ProjectFormatError(
      `This file was made with a newer version (schema ${v}). Please update the app.`,
    );
  }
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new ProjectFormatError(`No migration from schema ${v}.`);
    doc = step(doc);
    v++;
  }
  return normalizeProject(doc);
}

/** Validates structure and fills missing optional fields with defaults. */
export function normalizeProject(doc: Json): Project {
  const levelsIn = doc['levels'];
  if (!Array.isArray(levelsIn) || levelsIn.length === 0)
    throw new ProjectFormatError('Project has no levels.');
  const levels: Level[] = levelsIn.map((l: unknown, i) => {
    if (!isObj(l) || typeof l['id'] !== 'string') throw new ProjectFormatError(`Level ${i} is invalid.`);
    const lv: Json = { ...l };
    for (const c of COLLS) if (!isObj(lv[c])) lv[c] = {};
    return {
      id: l['id'],
      name: typeof l['name'] === 'string' ? l['name'] : `Level ${i + 1}`,
      elevation: typeof l['elevation'] === 'number' ? l['elevation'] : 0,
      height: typeof l['height'] === 'number' ? l['height'] : 2500,
      floorThickness: typeof l['floorThickness'] === 'number' ? l['floorThickness'] : 200,
      nodes: lv['nodes'],
      walls: lv['walls'],
      openings: lv['openings'],
      rooms: lv['rooms'],
      items: lv['items'],
      lights: lv['lights'],
      annotations: lv['annotations'],
      refImages: lv['refImages'],
    } as Level;
  });
  // Referential integrity: walls need nodes, openings need walls.
  for (const lv of levels) {
    for (const w of Object.values(lv.walls)) {
      if (!lv.nodes[w.a] || !lv.nodes[w.b])
        throw new ProjectFormatError(`Wall ${w.id} references a missing node.`);
      if (!(w.thickness > 0)) throw new ProjectFormatError(`Wall ${w.id} has an invalid thickness.`);
    }
    for (const o of Object.values(lv.openings)) {
      if (!lv.walls[o.wallId]) throw new ProjectFormatError(`Opening ${o.id} references a missing wall.`);
    }
  }
  const settingsIn = isObj(doc['settings']) ? doc['settings'] : {};
  const now = new Date().toISOString();
  return {
    format: 'modulo-room',
    schemaVersion: SCHEMA_VERSION,
    id: typeof doc['id'] === 'string' ? doc['id'] : 'prj_imported',
    name: typeof doc['name'] === 'string' ? doc['name'] : 'Imported project',
    createdAt: typeof doc['createdAt'] === 'string' ? doc['createdAt'] : now,
    updatedAt: typeof doc['updatedAt'] === 'string' ? doc['updatedAt'] : now,
    northAngle: typeof doc['northAngle'] === 'number' ? doc['northAngle'] : 0,
    settings: { ...DEFAULT_SETTINGS, ...(settingsIn as Partial<Project['settings']>) },
    levels,
  };
}

export function serializeProject(doc: Project): string {
  return JSON.stringify(doc, null, 2);
}

export function parseProject(text: string): Project {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProjectFormatError('The file is not valid JSON.');
  }
  return migrate(json);
}
