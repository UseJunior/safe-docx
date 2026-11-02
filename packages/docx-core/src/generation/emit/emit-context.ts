/**
 * Shared state the block emitters thread through paragraph/table recursion.
 *
 * Bundling it in one object keeps emitter signatures stable as features
 * land: numbering binds spec handles to numeric ids, and the drafting-note
 * collector allocates comment ids in document order (absent in stories that
 * cannot carry notes, e.g. headers/footers, and when notes are disabled).
 */

import type { DraftingNoteSpec, FootnoteSpec, ThemeColorSlot } from '../types.js';

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

/**
 * Allocates footnote ids in document order, from 1 (the separator notes hold
 * -1 and 0), and records each note's body for the footnotes part.
 */
export class FootnoteCollector {
  readonly collected: Array<{ id: number; footnote: FootnoteSpec }> = [];
  private nextId = 1;

  allocate(footnote: FootnoteSpec): number {
    const id = this.nextId++;
    this.collected.push({ id, footnote });
    return id;
  }
}

export type BlockEmitContext = {
  numberingIds?: NumberingIdMap;
  /** Present only where drafting notes may anchor (body story, notes enabled). */
  notes?: DraftingNoteCollector;
  /** Present only where footnote references may sit (the body story). */
  footnotes?: FootnoteCollector;
  /** Merged canonical/custom theme colors used as reader fallback values. */
  themeColorValues?: ReadonlyMap<ThemeColorSlot, string>;
};
