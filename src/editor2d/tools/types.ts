import type { Store, ToolId } from '../../app/store';
import type { Guide, SnapResult } from '../../geometry/snap';
import type { UnitPrefs } from '../../model/units';
import type { Ref, Vec2 } from '../../model/types';
import type { Hit } from '../hit';
import type { Painter } from '../painter';
import type { HotLabel } from '../render';
import type { Viewport } from '../viewport';

export type PointerKind = 'mouse' | 'pen' | 'touch';

export interface PointerInfo {
  world: Vec2;
  screen: Vec2;
  type: PointerKind;
  shift: boolean;
  alt: boolean;
  /** Ctrl or Cmd. */
  mod: boolean;
  button: number;
  /** Hit tolerance in world mm for this pointer type. */
  tol: number;
}

export interface NumericField {
  key: string;
  label: string;
  value: string;
  kind: 'length' | 'angle' | 'text' | 'select';
  options?: { value: string; label: string }[];
}

export interface NumericRequest {
  /** Screen position (CSS px, canvas-relative) to anchor the popover. */
  at: Vec2;
  title: string;
  fields: NumericField[];
  submitLabel?: string;
  /** Character typed to open the popover; replaces the first field's value. */
  initialText?: string | undefined;
  /** Return an error message to keep the popover open. */
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- callbacks may simply return nothing
  onSubmit: (values: Record<string, string>) => string | void;
  onCancel?: () => void;
}

export interface ToolAction {
  label: string;
  run: () => void;
  primary?: boolean;
  danger?: boolean;
}

export interface SnapOpts {
  anchor?: Vec2 | undefined;
  excludeNodes?: ReadonlySet<string>;
  excludeWalls?: ReadonlySet<string>;
  extraPoints?: readonly Vec2[];
  /** Alt held: snapping off. */
  alt?: boolean;
  tol?: number;
}

/** What tools may do to the editor. */
export interface EditorApi {
  readonly store: Store;
  readonly vp: Viewport;
  readonly prefs: UnitPrefs;
  snap(raw: Vec2, opts?: SnapOpts): SnapResult;
  setGuides(g: Guide[]): void;
  hit(p: Vec2, tol: number): Hit | null;
  hotLabelAt(screen: Vec2): HotLabel | null;
  requestRender(): void;
  openNumeric(req: NumericRequest): void;
  closeNumeric(): void;
  numericOpen(): boolean;
  contextMenu(screen: Vec2, hit: Hit | null): void;
  setTool(id: ToolId): void;
  select(refs: Ref[]): void;
  /** Called when the tool's hint or actions change. */
  toolChanged(): void;
  toast(msg: string): void;
  fitView(): void;
}

export interface Tool {
  readonly id: ToolId;
  cursor: string;
  hint(): string;
  actions?(): ToolAction[];
  down(e: PointerInfo): void;
  move(e: PointerInfo, pressed: boolean): void;
  up(e: PointerInfo): void;
  dblclick?(e: PointerInfo): void;
  /** Abort any in-progress interaction (gesture started, tool switched, Esc). */
  cancel(): void;
  /** Return true if the key was handled. */
  key?(e: KeyboardEvent): boolean;
  overlay?(p: Painter): void;
  activate?(): void;
}
