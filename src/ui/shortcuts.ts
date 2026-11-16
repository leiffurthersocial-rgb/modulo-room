import type { ToolId } from '../app/store';

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  w: 'wall',
  b: 'room',
  d: 'door',
  n: 'window',
  f: 'furniture',
  m: 'measure',
  t: 'text',
  x: 'erase',
  h: 'pan',
};

export function toolForKey(k: string): ToolId | undefined {
  return TOOL_KEYS[k];
}

export const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: 'Tools',
    items: [
      ['V', 'Select & move'],
      ['W', 'Draw walls'],
      ['B', 'Draw room (rectangle)'],
      ['D', 'Door'],
      ['N', 'Window'],
      ['F', 'Furniture'],
      ['M', 'Measure'],
      ['T', 'Text label'],
      ['X', 'Erase'],
      ['H / Space+drag', 'Pan'],
    ],
  },
  {
    group: 'Drawing',
    items: [
      ['digits', 'Type an exact length while drawing'],
      ['Tab', 'Switch between length and angle'],
      ['Enter', 'Apply / finish the wall chain'],
      ['Backspace', 'Remove the last corner'],
      ['Esc', 'Cancel / deselect'],
      ['Alt (hold)', 'Disable snapping'],
      ['Shift', 'Move walls freely · flip door hinge'],
    ],
  },
  {
    group: 'Editing',
    items: [
      ['Ctrl/⌘ Z', 'Undo'],
      ['Ctrl/⌘ ⇧ Z', 'Redo'],
      ['Ctrl/⌘ C / X / V', 'Copy / cut / paste'],
      ['Ctrl/⌘ D', 'Duplicate'],
      ['Ctrl/⌘ A', 'Select all'],
      ['Delete', 'Delete selection'],
      ['Arrows', 'Nudge 10 mm (Shift: 100 mm)'],
      ['R / ⇧R', 'Rotate 90° / −90°'],
      ['Enter', 'Edit size of the selection'],
    ],
  },
  {
    group: 'View & files',
    items: [
      ['0', 'Zoom to fit'],
      ['1 / 2 / 3 / 4', '2D · Split · 3D · Picture-in-picture'],
      ['+ / −', 'Zoom'],
      ['G', 'Grid on/off'],
      ['Ctrl/⌘ S', 'Save project file'],
      ['Ctrl/⌘ O', 'Open project file'],
      ['?', 'This help'],
    ],
  },
  {
    group: '3D view (view only)',
    items: [
      ['Drag', 'Orbit (Orbit/Iso) · look around (Walk)'],
      ['Right-drag / two fingers', 'Pan'],
      ['Wheel / pinch', 'Zoom'],
      ['W A S D / arrows', 'Walk (click the 3D view first)'],
      ['Shift', 'Run'],
    ],
  },
  {
    group: 'Touch & Pencil',
    items: [
      ['Pinch', 'Zoom'],
      ['Two fingers', 'Pan'],
      ['One finger on empty space', 'Pan (select tool)'],
      ['Long-press', 'Context menu'],
      ['Double-tap', 'Edit (wall length, room name, size)'],
      ['Pencil', 'Precise drawing; palm touches are ignored'],
    ],
  },
];
