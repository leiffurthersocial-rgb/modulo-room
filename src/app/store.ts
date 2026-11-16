import { execute, type Command } from '../commands/commands';
import { commit, initHistory, redo, undo, type HistoryState } from '../commands/history';
import type { ChangeSet } from '../commands/ops';
import { createProject } from '../model/project';
import type { Level, OpeningKind, Project, ProjectSettings, Ref } from '../model/types';
import { derive, type Derived } from './derived';

export type ToolId =
  | 'select'
  | 'wall'
  | 'room'
  | 'door'
  | 'window'
  | 'furniture'
  | 'measure'
  | 'text'
  | 'erase'
  | 'pan'
  | 'calibrate';

export interface ToolOptions {
  doorKind: OpeningKind;
  windowKind: OpeningKind;
  catalogId: string;
  catalogQuery: string;
  catalogCategory: string;
}

export type ChangeReason = 'doc' | 'preview' | 'selection' | 'tool' | 'settings' | 'view' | 'load';

type Listener = (reason: ChangeReason, changes?: ChangeSet) => void;

/**
 * Single source of truth for the running app: document + history, a transient
 * preview (for drags), selection and tool state. UI and canvas subscribe.
 */
export class Store {
  private h: HistoryState;
  private previewDoc: Project | null = null;
  private listeners = new Set<Listener>();
  selection: Ref[] = [];
  levelId: string;
  tool: ToolId = 'select';
  toolOptions: ToolOptions = {
    doorKind: 'door',
    windowKind: 'window',
    catalogId: 'bed-double',
    catalogQuery: '',
    catalogCategory: 'all',
  };
  /** Hover target for UI highlight. */
  hover: Ref | null = null;
  /** Incremented whenever the document changes (for autosave / dirty tracking). */
  revision = 0;

  constructor(doc: Project = createProject()) {
    this.h = initHistory(doc);
    this.levelId = doc.levels[0]?.id ?? '';
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(reason: ChangeReason, changes?: ChangeSet): void {
    for (const l of this.listeners) l(reason, changes);
  }

  /** Committed document (ignores any preview). */
  get committed(): Project {
    return this.h.doc;
  }

  /** What should be displayed: the preview while dragging, else the committed doc. */
  get doc(): Project {
    return this.previewDoc ?? this.h.doc;
  }

  get level(): Level {
    const d = this.doc;
    return d.levels.find((l) => l.id === this.levelId) ?? (d.levels[0] as Level);
  }

  /** Level of the committed document (stable target for snapping and hit tests during drags). */
  get committedLevel(): Level {
    const d = this.h.doc;
    return d.levels.find((l) => l.id === this.levelId) ?? (d.levels[0] as Level);
  }

  get committedDerived(): Derived {
    return derive(this.committedLevel, this.settings.walkwayMin);
  }

  get settings(): ProjectSettings {
    return this.h.doc.settings;
  }

  get derived(): Derived {
    return derive(this.level, this.settings.walkwayMin);
  }

  get canUndo(): boolean {
    return this.h.past.length > 0;
  }
  get canRedo(): boolean {
    return this.h.future.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.h.past[this.h.past.length - 1]?.label;
  }
  get redoLabel(): string | undefined {
    return this.h.future[0]?.label;
  }

  dispatch(cmd: Command): boolean {
    this.previewDoc = null;
    const r = commit(this.h, cmd);
    const changed = r.state !== this.h;
    this.h = r.state;
    if (changed) {
      this.revision++;
      this.pruneSelection();
    }
    this.emit('doc', r.changes);
    return changed;
  }

  /** Shows the result of `cmd` without recording it (live drag feedback). */
  preview(cmd: Command | null): void {
    this.previewDoc = cmd ? execute(this.h.doc, cmd).doc : null;
    this.emit('preview');
  }

  get previewing(): boolean {
    return this.previewDoc !== null;
  }

  undo(): void {
    this.previewDoc = null;
    const r = undo(this.h);
    if (!r) return;
    this.h = r.state;
    this.revision++;
    this.pruneSelection();
    this.emit('doc', r.changes);
  }

  redo(): void {
    this.previewDoc = null;
    const r = redo(this.h);
    if (!r) return;
    this.h = r.state;
    this.revision++;
    this.pruneSelection();
    this.emit('doc', r.changes);
  }

  /** Replaces the whole project (open / new / import). Clears history. */
  load(doc: Project): void {
    this.h = initHistory(doc);
    this.previewDoc = null;
    this.levelId = doc.levels[0]?.id ?? '';
    this.selection = [];
    this.revision++;
    this.emit('load');
  }

  /** Display settings are stored in the project but are not undoable. */
  updateSettings(patch: Partial<ProjectSettings>): void {
    this.h = { ...this.h, doc: { ...this.h.doc, settings: { ...this.h.doc.settings, ...patch } } };
    this.revision++;
    this.emit('settings');
  }

  select(refs: Ref[]): void {
    this.selection = refs;
    this.emit('selection');
  }

  isSelected(ref: Ref): boolean {
    return this.selection.some((r) => r.coll === ref.coll && r.id === ref.id);
  }

  setTool(tool: ToolId): void {
    if (this.tool === tool) return;
    this.previewDoc = null;
    this.tool = tool;
    this.emit('tool');
  }

  setToolOptions(patch: Partial<ToolOptions>): void {
    this.toolOptions = { ...this.toolOptions, ...patch };
    this.emit('tool');
  }

  setHover(ref: Ref | null): void {
    if (ref?.id === this.hover?.id && ref?.coll === this.hover?.coll) return;
    this.hover = ref;
    this.emit('view');
  }

  /** Notifies listeners about view-only changes (zoom, overlays). */
  touchView(): void {
    this.emit('view');
  }

  private pruneSelection(): void {
    const lv = this.level;
    const derived = this.derived;
    const keep = this.selection.filter((r) =>
      r.coll === 'rooms' ? derived.rooms.some((x) => x.id === r.id) : r.id in lv[r.coll],
    );
    if (keep.length !== this.selection.length) this.selection = keep;
  }
}
