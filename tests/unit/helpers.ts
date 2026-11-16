import { execute, type Command } from '../../src/commands/commands';
import { seedIds } from '../../src/model/ids';
import { createProject } from '../../src/model/project';
import type { Level, Project } from '../../src/model/types';

export function fresh(seed = 1): Project {
  seedIds(seed);
  return createProject('Test', '2026-01-01T00:00:00.000Z');
}

export function lvl(doc: Project): Level {
  return doc.levels[0]!;
}

export function run(doc: Project, ...cmds: Command[]): Project {
  let d = doc;
  for (const c of cmds) d = execute(d, c).doc;
  return d;
}

/** Draws a closed polygon of walls (centreline points). */
export function poly(doc: Project, pts: [number, number][], thickness = 100): Project {
  return run(doc, {
    type: 'addWalls',
    level: lvl(doc).id,
    points: pts.map(([x, y]) => ({ x, y })),
    closed: true,
    thickness,
    height: 2500,
  });
}

export function line(doc: Project, pts: [number, number][], thickness = 100): Project {
  return run(doc, {
    type: 'addWalls',
    level: lvl(doc).id,
    points: pts.map(([x, y]) => ({ x, y })),
    closed: false,
    thickness,
    height: 2500,
  });
}
