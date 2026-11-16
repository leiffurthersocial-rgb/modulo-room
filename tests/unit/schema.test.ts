import { describe, expect, it } from 'vitest';
import { migrate, parseProject, ProjectFormatError, serializeProject } from '../../src/model/schema';
import { SCHEMA_VERSION } from '../../src/model/project';
import { fresh, lvl, poly, run } from './helpers';

describe('serialization', () => {
  it('round-trips a project with walls, rooms, openings and items', () => {
    let doc = poly(fresh(), [
      [0, 0],
      [4000, 0],
      [4000, 3000],
      [0, 3000],
    ]);
    const L = lvl(doc);
    const wallId = Object.keys(L.walls)[0]!;
    doc = run(
      doc,
      {
        type: 'add',
        level: L.id,
        coll: 'openings',
        values: [
          {
            id: 'o1',
            wallId,
            kind: 'door',
            offset: 1000,
            width: 800,
            height: 2000,
            sill: 0,
            hinge: 'a',
            side: 'l',
          },
        ],
      },
      {
        type: 'add',
        level: L.id,
        coll: 'items',
        values: [
          {
            id: 'i1',
            catalogId: 'bed-double',
            x: 2000,
            y: 1500,
            rotation: 0,
            width: 1600,
            depth: 2000,
            height: 450,
            elevation: 0,
          },
        ],
      },
    );
    const back = parseProject(serializeProject(doc));
    expect(back).toEqual(doc);
  });

  it('migrates a v0 document (array collections, thickness_mm)', () => {
    const v0 = {
      format: 'modulo-room',
      schemaVersion: 0,
      id: 'p',
      name: 'Old',
      levels: [
        {
          id: 'l',
          name: 'L',
          nodes: [
            { id: 'a', x: 0, y: 0 },
            { id: 'b', x: 1000, y: 0 },
          ],
          walls: [{ id: 'w', a: 'a', b: 'b', thickness_mm: 120, height: 2400 }],
        },
      ],
    };
    const p = migrate(v0);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.levels[0]!.walls['w']!.thickness).toBe(120);
    expect(p.levels[0]!.items).toEqual({});
    expect(p.settings.units).toBe('metric');
  });

  it('rejects foreign, future and broken files', () => {
    expect(() => parseProject('nope')).toThrow(ProjectFormatError);
    expect(() => migrate({ format: 'other' })).toThrow(ProjectFormatError);
    expect(() => migrate({ format: 'modulo-room', schemaVersion: 999, levels: [] })).toThrow(/newer version/);
    expect(() =>
      migrate({
        format: 'modulo-room',
        schemaVersion: 1,
        levels: [{ id: 'l', nodes: {}, walls: { w: { id: 'w', a: 'x', b: 'y', thickness: 100 } } }],
      }),
    ).toThrow(/missing node/);
  });
});
