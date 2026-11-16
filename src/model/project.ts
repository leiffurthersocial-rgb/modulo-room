import { newId } from './ids';
import type { Level, Project, ProjectSettings } from './types';

export const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: ProjectSettings = {
  units: 'metric',
  metricUnit: 'm',
  gridSize: 100,
  showGrid: true,
  snap: true,
  angleStep: 15,
  wallThickness: 150,
  wallHeight: 2500,
  walkwayMin: 800,
  showDimensions: true,
  showClearance: false,
  showLabels: true,
};

export const WALL_THICKNESS_PRESETS = [100, 150, 200, 300] as const;

export function createLevel(name = 'Ground floor', height = 2500): Level {
  return {
    id: newId('lvl'),
    name,
    elevation: 0,
    height,
    floorThickness: 200,
    nodes: {},
    walls: {},
    openings: {},
    rooms: {},
    items: {},
    lights: {},
    annotations: {},
    refImages: {},
  };
}

export function createProject(name = 'Untitled room', now = new Date().toISOString()): Project {
  return {
    format: 'modulo-room',
    schemaVersion: SCHEMA_VERSION,
    id: newId('prj'),
    name,
    createdAt: now,
    updatedAt: now,
    northAngle: 0,
    settings: { ...DEFAULT_SETTINGS },
    levels: [createLevel()],
  };
}

export function findLevel(doc: Project, levelId: string): Level | undefined {
  return doc.levels.find((l) => l.id === levelId);
}
