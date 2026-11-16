import './style.css';
import { buildSampleProject } from './app/sample';
import { Store } from './app/store';
import { seedIds } from './model/ids';
import { createProject } from './model/project';
import { loadLastProject } from './persistence/db';
import { markReady, params, screenshotMode } from './screenshot-mode';
import { App } from './ui/app';

declare global {
  interface Window {
    __mr?: { store: Store; app: App };
  }
}

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLDivElement>('#app');
  if (!root) throw new Error('#app missing');
  let doc;
  if (screenshotMode) {
    // Deterministic: fixed ids, no storage, optional sample.
    seedIds(42);
    doc = params.has('sample')
      ? buildSampleProject()
      : createProject('Untitled room', '2026-01-01T00:00:00.000Z');
  } else {
    doc =
      (await loadLastProject().catch(() => null)) ??
      (params.has('sample') ? buildSampleProject() : createProject());
  }
  const store = new Store(doc);
  const app = new App(root, store, { autosave: !screenshotMode });
  window.__mr = { store, app };
  requestAnimationFrame(() => {
    app.editor.fitView();
    requestAnimationFrame(() => markReady({ walls: Object.keys(store.level.walls).length }));
  });
}

void boot();
