import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { migrate, ProjectFormatError, serializeProject } from '../model/schema';
import type { Project } from '../model/types';

interface MrDB extends DBSchema {
  projects: { key: string; value: { id: string; name: string; updatedAt: string; data: Project } };
  blobs: { key: string; value: Blob };
  meta: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<MrDB>> | null = null;

function db(): Promise<IDBPDatabase<MrDB>> {
  dbp ??= openDB<MrDB>('modulo-room', 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' });
      d.createObjectStore('blobs');
      d.createObjectStore('meta');
    },
  });
  return dbp;
}

export async function saveProject(p: Project): Promise<void> {
  const d = await db();
  await d.put('projects', { id: p.id, name: p.name, updatedAt: new Date().toISOString(), data: p });
  await d.put('meta', p.id, 'lastProjectId');
}

export async function loadLastProject(): Promise<Project | null> {
  const d = await db();
  const id = await d.get('meta', 'lastProjectId');
  if (typeof id !== 'string') return null;
  const rec = await d.get('projects', id);
  if (!rec) return null;
  try {
    return migrate(rec.data);
  } catch (e) {
    if (e instanceof ProjectFormatError) return null;
    throw e;
  }
}

export async function listProjects(): Promise<{ id: string; name: string; updatedAt: string }[]> {
  const d = await db();
  const all = await d.getAll('projects');
  return all
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function loadProject(id: string): Promise<Project | null> {
  const rec = await (await db()).get('projects', id);
  return rec ? migrate(rec.data) : null;
}

export async function deleteProject(id: string): Promise<void> {
  await (await db()).delete('projects', id);
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await (await db()).put('blobs', blob, key);
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  return (await db()).get('blobs', key);
}

/** Asks the browser to keep our data (Safari may otherwise evict it). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

/** Project file with reference images embedded so it is self-contained. */
export async function exportProjectFile(p: Project): Promise<string> {
  const blobs: Record<string, string> = {};
  for (const lv of p.levels) {
    for (const im of Object.values(lv.refImages)) {
      const b = await getBlob(im.blobKey);
      if (b) blobs[im.blobKey] = await blobToDataUrl(b);
    }
  }
  const json = JSON.parse(serializeProject(p)) as Record<string, unknown>;
  if (Object.keys(blobs).length) json['embeddedImages'] = blobs;
  return JSON.stringify(json, null, 2);
}

/** Parses a project file, storing embedded images locally. */
export async function importProjectFile(text: string): Promise<Project> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProjectFormatError('The file is not valid JSON.');
  }
  const emb = (json as { embeddedImages?: Record<string, string> }).embeddedImages;
  if (emb && typeof emb === 'object') {
    for (const [k, url] of Object.entries(emb)) {
      if (typeof url !== 'string' || !url.startsWith('data:image/')) continue;
      const blob = await (await fetch(url)).blob();
      await putBlob(k, blob);
    }
  }
  return migrate(json);
}
