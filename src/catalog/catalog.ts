import data from './catalog.json';

export type Mount = 'floor' | 'wall' | 'ceiling' | 'surface';
/** [shape, x0, y0, z0, x1, y1, z1] in normalised item space (x: width, y: back→front, z: up). */
export type Part = ['box' | 'cyl', number, number, number, number, number, number];

export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  dims: { width: number; depth: number; height: number };
  mount: Mount;
  elevation: number;
  color: string;
  parts: Part[];
  tags: string[];
  /** Needs a free walkway in front (wardrobes, desks, kitchen units...). */
  access?: boolean;
  /** Free depth needed in front, overriding the project's minimum walkway (mm). */
  clearance?: number;
}

export const CATEGORIES: { id: string; name: string }[] = [
  { id: 'bed', name: 'Beds' },
  { id: 'sofa', name: 'Sofas & chairs' },
  { id: 'table', name: 'Tables' },
  { id: 'chair', name: 'Seating' },
  { id: 'desk', name: 'Desks' },
  { id: 'storage', name: 'Storage' },
  { id: 'kitchen', name: 'Kitchen' },
  { id: 'bathroom', name: 'Bathroom' },
  { id: 'electronics', name: 'Electronics' },
  { id: 'plant', name: 'Plants' },
  { id: 'lamp', name: 'Lamps' },
  { id: 'rug', name: 'Rugs' },
  { id: 'fixture', name: 'Fixtures' },
  { id: 'custom', name: 'Custom' },
];

const MOUNTS: readonly Mount[] = ['floor', 'wall', 'ceiling', 'surface'];

/** Validates catalog data; returns a list of problems (empty = valid). */
export function validateCatalog(raw: unknown): string[] {
  const errs: string[] = [];
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { items?: unknown }).items)) {
    return ['catalog must be { items: [...] }'];
  }
  const ids = new Set<string>();
  const cats = new Set(CATEGORIES.map((c) => c.id));
  for (const [i, e] of ((raw as { items: unknown[] }).items as Record<string, unknown>[]).entries()) {
    const where = `items[${i}] (${String(e['id'])})`;
    if (typeof e['id'] !== 'string' || !/^[a-z0-9-]+$/.test(e['id'])) errs.push(`${where}: bad id`);
    else if (ids.has(e['id'])) errs.push(`${where}: duplicate id`);
    else ids.add(e['id']);
    if (typeof e['name'] !== 'string' || !e['name']) errs.push(`${where}: missing name`);
    if (!cats.has(String(e['category']))) errs.push(`${where}: unknown category`);
    const d = e['dims'] as Record<string, unknown> | undefined;
    for (const k of ['width', 'depth', 'height']) {
      const val = d?.[k];
      if (typeof val !== 'number' || !(val > 0) || val > 10000) errs.push(`${where}: dims.${k} invalid`);
    }
    if (!MOUNTS.includes(e['mount'] as Mount)) errs.push(`${where}: bad mount`);
    if (typeof e['elevation'] !== 'number' || (e['elevation'] as number) < 0)
      errs.push(`${where}: bad elevation`);
    if (
      e['clearance'] !== undefined &&
      (typeof e['clearance'] !== 'number' || (e['clearance'] as number) <= 0)
    )
      errs.push(`${where}: bad clearance`);
    if (typeof e['color'] !== 'string' || !/^#[0-9a-f]{6}$/i.test(e['color']))
      errs.push(`${where}: bad color`);
    const parts = e['parts'];
    if (!Array.isArray(parts) || parts.length === 0) errs.push(`${where}: no parts`);
    else
      for (const p of parts as unknown[]) {
        if (
          !Array.isArray(p) ||
          p.length !== 7 ||
          (p[0] !== 'box' && p[0] !== 'cyl') ||
          p.slice(1).some((n) => typeof n !== 'number' || n < -0.1 || n > 1.1)
        )
          errs.push(`${where}: bad part ${JSON.stringify(p)}`);
      }
  }
  return errs;
}

export const CATALOG: readonly CatalogEntry[] = (data as unknown as { items: CatalogEntry[] }).items;
const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));

export function catalogEntry(id: string): CatalogEntry | undefined {
  return BY_ID.get(id);
}
