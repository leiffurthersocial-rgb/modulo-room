/**
 * Modulo: Room document model. PURE TypeScript: no DOM, no three.js.
 * All lengths are millimetres. Plan coordinates: +x right, +y down (screen-like);
 * in 3D, plan x -> world x and plan y -> world z.
 */
export type Id = string;

export interface Vec2 {
  x: number;
  y: number;
}

export interface WallNode {
  id: Id;
  x: number;
  y: number;
}

export interface Wall {
  id: Id;
  a: Id;
  b: Id;
  thickness: number;
  /** Height at node a. */
  height: number;
  /** Height at node b (sloped/knee walls). Defaults to `height`. */
  heightEnd?: number;
  /** When true, editing tools keep this wall's length. */
  lockLength?: boolean;
  /** Per-side colour override (side l = left of a->b, r = right). */
  colorL?: string;
  colorR?: string;
}

export type OpeningKind = 'door' | 'double-door' | 'sliding-door' | 'window' | 'opening';

export interface Opening {
  id: Id;
  wallId: Id;
  kind: OpeningKind;
  /** Distance from wall node `a` to the opening centre, along the wall axis. */
  offset: number;
  width: number;
  height: number;
  /** Bottom of the opening above the floor (0 for doors). */
  sill: number;
  /** Hinge end of the leaf: towards node a or node b. */
  hinge: 'a' | 'b';
  /** Side the leaf swings into: left or right of a->b. */
  side: 'l' | 'r';
}

/** User data for a derived room. The polygon itself is never stored. */
export interface RoomMeta {
  id: Id;
  name: string;
  /** A point inside the room; used to keep identity stable across edits. */
  seed: Vec2;
  /** Boundary wall ids at the last sync (secondary identity hint). */
  walls: Id[];
  color?: string;
  ceilingHeight?: number;
}

export interface Item {
  id: Id;
  catalogId: string;
  name?: string;
  /** Centre of the footprint. */
  x: number;
  y: number;
  /** Degrees, clockwise in plan (y down). */
  rotation: number;
  width: number;
  depth: number;
  height: number;
  elevation: number;
  mirrored?: boolean;
  locked?: boolean;
  color?: string;
}

export type LightKind = 'point' | 'spot' | 'panel' | 'strip';

export interface Light {
  id: Id;
  kind: LightKind;
  x: number;
  y: number;
  z: number;
  kelvin: number;
  intensity: number;
}

export interface DimensionAnnotation {
  id: Id;
  kind: 'dimension';
  a: Vec2;
  b: Vec2;
  /** Perpendicular offset of the dimension line (mm, signed). */
  offset: number;
}

export interface TextAnnotation {
  id: Id;
  kind: 'text';
  x: number;
  y: number;
  text: string;
  /** Text height in mm on the plan. */
  size: number;
}

export type Annotation = DimensionAnnotation | TextAnnotation;

export interface RefImage {
  id: Id;
  /** Key of the image blob in local storage (IndexedDB). Never uploaded. */
  blobKey: string;
  name: string;
  /** Centre of the image in plan mm. */
  x: number;
  y: number;
  widthPx: number;
  heightPx: number;
  mmPerPx: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
}

export interface Level {
  id: Id;
  name: string;
  elevation: number;
  height: number;
  floorThickness: number;
  nodes: Record<Id, WallNode>;
  walls: Record<Id, Wall>;
  openings: Record<Id, Opening>;
  rooms: Record<Id, RoomMeta>;
  items: Record<Id, Item>;
  lights: Record<Id, Light>;
  annotations: Record<Id, Annotation>;
  refImages: Record<Id, RefImage>;
}

export type Coll =
  'nodes' | 'walls' | 'openings' | 'rooms' | 'items' | 'lights' | 'annotations' | 'refImages';

export const COLLS: readonly Coll[] = [
  'nodes',
  'walls',
  'openings',
  'rooms',
  'items',
  'lights',
  'annotations',
  'refImages',
];

export interface EntityOf {
  nodes: WallNode;
  walls: Wall;
  openings: Opening;
  rooms: RoomMeta;
  items: Item;
  lights: Light;
  annotations: Annotation;
  refImages: RefImage;
}

export type Entity = EntityOf[Coll];

export type DisplayUnits = 'metric' | 'imperial';
export type MetricUnit = 'm' | 'cm' | 'mm';

export interface ProjectSettings {
  units: DisplayUnits;
  metricUnit: MetricUnit;
  gridSize: number;
  showGrid: boolean;
  snap: boolean;
  angleStep: 15 | 45 | 90;
  wallThickness: number;
  wallHeight: number;
  walkwayMin: number;
  showDimensions: boolean;
  showClearance: boolean;
  showLabels: boolean;
}

export interface Project {
  format: 'modulo-room';
  schemaVersion: number;
  id: Id;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Angle of north, degrees clockwise from plan "up". */
  northAngle: number;
  settings: ProjectSettings;
  levels: Level[];
}

/** Reference to one entity of a level. */
export interface Ref {
  coll: Coll;
  id: Id;
}

/** Partial update where `undefined` removes a field. */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };
