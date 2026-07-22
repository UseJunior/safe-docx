/**
 * Shared state the block emitters thread through paragraph/table recursion.
 *
 * Bundling it in one object keeps emitter signatures stable as features
 * land: numbering binds spec handles to numeric ids, and the drafting-note
 * collector allocates comment ids in document order (absent in stories that
 * cannot carry notes, e.g. headers/footers, and when notes are disabled).
 */

import type { DraftingNoteSpec, ThemeColorSlot } from '../types.js';

/** Spec-level numbering handle → numeric w:numId value. */
export type NumberingIdMap = ReadonlyMap<string, number>;

/** Allocates deterministic comment ids and records notes in document order. */
export class DraftingNoteCollector {
  readonly collected: Array<{ id: number; note: DraftingNoteSpec }> = [];
  private nextId = 1;

  allocate(note: DraftingNoteSpec): number {
    const id = this.nextId++;
    this.collected.push({ id, note });
    return id;
  }
}

export type BlockEmitContext = {
  numberingIds?: NumberingIdMap;
  /** Present only where drafting notes may anchor (body story, notes enabled). */
  notes?: DraftingNoteCollector;
  /** Merged canonical/custom theme colors used as reader fallback values. */
  themeColorValues?: ReadonlyMap<ThemeColorSlot, string>;
};
