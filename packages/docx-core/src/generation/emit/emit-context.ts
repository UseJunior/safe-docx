/**
 * Shared state the block emitters thread through paragraph/table recursion.
 *
 * Bundling it in one object keeps emitter signatures stable as features
 * land: numbering binds spec handles to numeric ids, and the drafting-note
 * collector allocates comment ids in document order (absent in stories that
 * cannot carry notes, e.g. headers/footers, and when notes are disabled).
 */

import { createWmlTextElement } from '../../primitives/dom-helpers.js';
import { OOXML, W } from '../../primitives/namespaces.js';
import { renderReferenceNumber, type NumberingModel } from '../../primitives/numbering.js';
import { computeParagraphListLabels, type ParagraphListLabel } from '../../primitives/paragraph_list_numbering.js';
import type { StylesModel } from '../../primitives/styles.js';
import { GenerationInternalError, GenerationSpecError } from '../errors.js';
import type { CrossReferenceNumber, DraftingNoteSpec, FootnoteSpec, ThemeColorSlot } from '../types.js';

/** Spec-level numbering handle → numeric w:numId value. */
export type NumberingIdMap = ReadonlyMap<string, number>;

/**
 * Sequential annotation ids shared by comment ranges and bookmarks, so no two
 * annotations of the document part carry the same `w:id` (§ 17.13.4.4 and
 * § 17.13.6.2 both describe it as unique within the document).
 */
export class AnnotationIdAllocator {
  private nextId = 1;

  allocate(): number {
    return this.nextId++;
  }
}

/** Allocates deterministic comment ids and records notes in document order. */
export class DraftingNoteCollector {
  readonly collected: Array<{ id: number; note: DraftingNoteSpec }> = [];

  /** `ids` is shared with bookmarks when the document has any; comment ids then interleave with theirs. */
  constructor(private readonly ids: AnnotationIdAllocator = new AnnotationIdAllocator()) {}

  allocate(note: DraftingNoteSpec): number {
    const id = this.ids.allocate();
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

/**
 * Bookmarks and cross-reference results for one compile.
 *
 * Body paragraphs get bookmark ids from the shared annotation allocator. A
 * cross-reference's cached result depends on the list numbers of the whole
 * body, so a body reference's result run is recorded empty and filled by
 * {@link resolveBody} once the body is built, before it is serialized.
 * Footnotes are emitted after the body, so their references read the
 * resolved numbers directly.
 */
export class CrossReferenceResolver {
  private readonly pending: Array<{ run: Element; bookmark: string; number: CrossReferenceNumber }> = [];
  private targets: Map<string, ParagraphListLabel | null> | null = null;

  constructor(
    readonly ids: AnnotationIdAllocator,
    private readonly numbering: NumberingModel,
    private readonly styles: StylesModel,
    /** Spec path of each bookmark, keyed by name, for error reports. */
    private readonly bookmarkPaths: ReadonlyMap<string, string>,
  ) {}

  allocateBookmarkId(): number {
    return this.ids.allocate();
  }

  /**
   * Put the cached result into `run` (an empty result run of a REF field):
   * now if the body has been resolved, else when it is.
   */
  fill(run: Element, bookmark: string, number: CrossReferenceNumber): void {
    if (this.targets) run.appendChild(createWmlTextElement(run.ownerDocument!, this.resultFor(bookmark, number)));
    else this.pending.push({ run, bookmark, number });
  }

  /**
   * Number the finished body (every paragraph, table cells included, in
   * document order, so each list advances as Word counts it), find each
   * bookmark's paragraph, and fill the recorded body results.
   */
  resolveBody(body: Element): void {
    const paragraphs = Array.from(body.getElementsByTagNameNS(OOXML.W_NS, W.p));
    const labels = computeParagraphListLabels(paragraphs, this.numbering, this.styles);
    this.targets = new Map();
    for (const start of Array.from(body.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkStart))) {
      const paragraph = start.parentNode as Element | null;
      if (!paragraph || paragraph.localName !== W.p) {
        throw new GenerationInternalError('A generated bookmark does not sit directly in its paragraph');
      }
      this.targets.set(start.getAttributeNS(OOXML.W_NS, 'name') ?? '', labels.get(paragraph) ?? null);
    }
    for (const { run, bookmark, number } of this.pending.splice(0)) this.fill(run, bookmark, number);
  }

  private resultFor(bookmark: string, number: CrossReferenceNumber): string {
    const label = this.targets!.get(bookmark);
    if (label === undefined) {
      throw new GenerationInternalError(`Cross-reference to bookmark '${bookmark}' reached resolution without a target`);
    }
    const path = `${this.bookmarkPaths.get(bookmark) ?? ''}/bookmark`;
    if (label === null) {
      throw new GenerationSpecError(
        'invalid_value',
        path,
        `Bookmark '${bookmark}' is on a paragraph without a list number, so a cross-reference to it would show 0 in Word`,
      );
    }
    const text = renderReferenceNumber(this.numbering, label, number === 'paragraph' ? 'paragraph' : 'fullContext');
    if (text === null) {
      throw new GenerationSpecError(
        'invalid_value',
        path,
        `The number of bookmark '${bookmark}' depends on a list level no earlier paragraph uses; ` +
          'Word shows that level at its start value, which generation does not compute, so number that level first',
      );
    }
    if (text.trim().length === 0) {
      throw new GenerationSpecError('invalid_value', path, `The number of bookmark '${bookmark}' renders as empty text`);
    }
    return text;
  }
}

export type BlockEmitContext = {
  numberingIds?: NumberingIdMap;
  /** Present only where drafting notes may anchor (body story, notes enabled). */
  notes?: DraftingNoteCollector;
  /** Present only where footnote references may sit (the body story). */
  footnotes?: FootnoteCollector;
  /** Present in the body and footnote stories of a document with bookmarks or cross-references. */
  crossReferences?: CrossReferenceResolver;
  /** Merged canonical/custom theme colors used as reader fallback values. */
  themeColorValues?: ReadonlyMap<ThemeColorSlot, string>;
};
