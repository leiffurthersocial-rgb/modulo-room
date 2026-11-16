import type { Project } from '../model/types';
import { commandLabel, execute, type Command } from './commands';
import { applyOps, changeSetOf, type ChangeSet, type Op } from './ops';

export interface HistoryEntry {
  label: string;
  cmd: Command;
  ops: Op[];
  inverse: Op[];
}

export interface HistoryState {
  doc: Project;
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const HISTORY_LIMIT = 300;

export function initHistory(doc: Project): HistoryState {
  return { doc, past: [], future: [] };
}

/** Executes and records a command. No-op commands (no ops) are not recorded. */
export function commit(h: HistoryState, cmd: Command): { state: HistoryState; changes: ChangeSet } {
  const r = execute(h.doc, cmd);
  if (r.ops.length === 0) return { state: h, changes: r.changes };
  const entry: HistoryEntry = { label: commandLabel(cmd), cmd, ops: r.ops, inverse: r.inverse };
  const past = [...h.past, entry].slice(-HISTORY_LIMIT);
  return { state: { doc: r.doc, past, future: [] }, changes: r.changes };
}

export function undo(h: HistoryState): { state: HistoryState; changes: ChangeSet } | null {
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  return {
    state: { doc: applyOps(h.doc, entry.inverse), past: h.past.slice(0, -1), future: [entry, ...h.future] },
    changes: changeSetOf(entry.inverse),
  };
}

export function redo(h: HistoryState): { state: HistoryState; changes: ChangeSet } | null {
  const entry = h.future[0];
  if (!entry) return null;
  return {
    state: { doc: applyOps(h.doc, entry.ops), past: [...h.past, entry], future: h.future.slice(1) },
    changes: changeSetOf(entry.ops),
  };
}

/** The serializable command log (for debugging / future replay). */
export function commandLog(h: HistoryState): Command[] {
  return h.past.map((e) => e.cmd);
}
