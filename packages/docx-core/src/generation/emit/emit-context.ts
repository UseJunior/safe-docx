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
import { resolveReferenceNumber, type NumberingModel, type RelativeReferenceContext } from '../../primitives/numbering.js';
import { computeParagraphListLabels, type ParagraphListLabel } from '../../primitives/paragraph_list_numbering.js';
import type { StylesModel } from '../../primitives/styles.js';
import { GenerationInternalError, GenerationSpecError } from '../errors.js';
import type { CrossReferenceSpec, DraftingNoteSpec, FootnoteSpec, ThemeColorSlot } from '../types.js';

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

/** What a cross-reference's cached result depends on: its bookmark, what it shows and its number form. */
export type CrossReferenceTarget = Pick<CrossReferenceSpec, 'bookmark' | 'show' | 'number'>;

/**
 * What the resolver knows of each bookmark's paragraph once the body is
 * built: its list label, and the text runs the bookmark encloses.
 */
type BookmarkTarget = { label: ParagraphListLabel | null; textRuns: Element[] };

/**
 * Bookmarks and cross-reference results for one compile.
 *
 * Body paragraphs get bookmark ids from the shared annotation allocator. A
 * cross-reference's cached result depends on the list numbers of the whole
 * body, so a body reference's result run is recorded empty and filled by
 * {@link resolveBody} once the body is built, before it is serialized.
 * Footnotes are emitted after the body, so their references read the
 * resolved numbers directly.
 *
 * A relative reference's number also depends on where it sits: the last
 * paragraph of its target's list (`w:numId`) at or before the paragraph
 * holding the field, table cells included, in document order. A reference in
 * a footnote has no such position and shows the full number, as Word shows
 * it (scripts/oracle/word/evidence/issue-1258-word-16.114.json).
 */
export class CrossReferenceResolver {
  private readonly pending: Array<{ placeholder: Element; reference: CrossReferenceTarget }> = [];
  private targets: Map<string, BookmarkTarget> | null = null;
  /** Each list's numbered body paragraphs, by `w:numId`, as (document position, label) in document order. */
  private listPositions = new Map<string, Array<{ index: number; label: ParagraphListLabel }>>();
  /** Each body paragraph's document position. */
  private paragraphIndex = new Map<Element, number>();

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
   * The result runs of a REF field. `run` is an empty run carrying the
   * reference's formatting. A number reference's result is that run holding
   * the number. A text reference's result is a copy of each text run its
   * target's bookmark encloses, with that run's own formatting, which is the
   * result Word writes when it updates the field. Before the body is
   * resolved, `run` stands in and is filled or replaced once it is.
   */
  result(run: Element, reference: CrossReferenceTarget): Element[] {
    if (this.targets) return this.resultRuns(run, reference);
    this.pending.push({ placeholder: run, reference });
    return [run];
  }

  /**
   * Number the finished body (every paragraph, table cells included, in
   * document order, so each list advances as Word counts it), find each
   * bookmark's paragraph and the text it encloses, and fill the recorded body
   * results.
   */
  resolveBody(body: Element): void {
    const paragraphs = Array.from(body.getElementsByTagNameNS(OOXML.W_NS, W.p));
    const labels = computeParagraphListLabels(paragraphs, this.numbering, this.styles);
    paragraphs.forEach((paragraph, index) => {
      this.paragraphIndex.set(paragraph, index);
      const label = labels.get(paragraph);
      if (!label) return;
      const positions = this.listPositions.get(label.numId) ?? [];
      positions.push({ index, label });
      this.listPositions.set(label.numId, positions);
    });
    this.targets = new Map();
    for (const start of Array.from(body.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkStart))) {
      const paragraph = start.parentNode as Element | null;
      if (!paragraph || paragraph.localName !== W.p) {
        throw new GenerationInternalError('A generated bookmark does not sit directly in its paragraph');
      }
      this.targets.set(start.getAttributeNS(OOXML.W_NS, 'name') ?? '', { label: labels.get(paragraph) ?? null, textRuns: bookmarkedTextRuns(start) });
    }
    for (const { placeholder, reference } of this.pending.splice(0)) {
      const runs = this.resultRuns(placeholder, reference, this.fieldParagraph(placeholder));
      if (runs.length === 1 && runs[0] === placeholder) continue;
      const parent = placeholder.parentNode;
      if (!parent) throw new GenerationInternalError('A cross-reference result run is not in the body');
      for (const run of runs) parent.insertBefore(run, placeholder);
      parent.removeChild(placeholder);
    }
  }

  /** The body paragraph holding a field's result run. */
  private fieldParagraph(run: Element): Element {
    for (let node: Node | null = run.parentNode; node; node = node.parentNode) {
      if (node.nodeType === 1 && (node as Element).localName === W.p && (node as Element).namespaceURI === OOXML.W_NS) return node as Element;
    }
    throw new GenerationInternalError('A cross-reference result run is not in a body paragraph');
  }

  /**
   * Where a relative reference in `paragraph` sits for a target of list
   * `numId`: that list's last paragraph at or before it, or null when none
   * comes before it (and for a reference outside the body).
   */
  private relativeContext(numId: string, paragraph: Element | null): RelativeReferenceContext {
    const at = paragraph === null ? undefined : this.paragraphIndex.get(paragraph);
    if (at === undefined) return null;
    const positions = this.listPositions.get(numId) ?? [];
    let found: ParagraphListLabel | null = null;
    for (const position of positions) {
      if (position.index > at) break;
      found = position.label;
    }
    return found;
  }

  private target(bookmark: string): BookmarkTarget {
    const target = this.targets!.get(bookmark);
    if (target === undefined) {
      throw new GenerationInternalError(`Cross-reference to bookmark '${bookmark}' reached resolution without a target`);
    }
    return target;
  }

  /**
   * Validation admits only text runs and footnote references in a text
   * reference's target and refuses a blank one, and refuses run formatting
   * on the reference itself: Word replaces the result with the target's
   * runs, each keeping its own formatting.
   */
  private resultRuns(run: Element, reference: CrossReferenceTarget, paragraph: Element | null = null): Element[] {
    if (reference.show === 'text') {
      const doc = run.ownerDocument!;
      return this.target(reference.bookmark).textRuns.map((source) => doc.importNode(source, true) as Element);
    }
    run.appendChild(createWmlTextElement(run.ownerDocument!, this.numberFor(reference, paragraph)));
    return [run];
  }

  /** `paragraph` is the body paragraph holding the field, or null in a footnote. */
  private numberFor(reference: CrossReferenceTarget, paragraph: Element | null): string {
    const { bookmark } = reference;
    const { label } = this.target(bookmark);
    const path = `${this.bookmarkPaths.get(bookmark) ?? ''}/bookmark`;
    if (label === null) {
      throw new GenerationSpecError(
        'invalid_value',
        path,
        `Bookmark '${bookmark}' is on a paragraph without a list number, so a cross-reference to it would show 0 in Word`,
      );
    }
    const form = reference.number === 'paragraph' ? 'paragraph' : reference.number === 'relative' ? 'relative' : 'fullContext';
    const context = form === 'relative' ? this.relativeContext(label.numId, paragraph) : null;
    const result = resolveReferenceNumber(this.numbering, label, form, context);
    if ('refused' in result) {
      const reasons: Record<typeof result.refused, string> = {
        unusedLevel:
          `The number of bookmark '${bookmark}' uses a placeholder that names no list level (past %9); ` +
          'what Word shows for it is not measured',
        deeperLevel:
          `The number of bookmark '${bookmark}' uses a level text that names a deeper list level; ` +
          'Word shows no number for such a level, so a cross-reference to it would show 0',
        undefinedLevel: `The list level of bookmark '${bookmark}' is not defined`,
        relativeStartValue:
          `The relative number of bookmark '${bookmark}' depends on a list level shown at its start value ` +
          '(no paragraph has numbered it since it restarted); what Word shows for it is not measured',
      };
      throw new GenerationSpecError('invalid_value', path, reasons[result.refused]);
    }
    const { text } = result;
    if (text.trim().length === 0) {
      throw new GenerationSpecError('invalid_value', path, `The number of bookmark '${bookmark}' renders as empty text`);
    }
    return text;
  }
}

/**
 * The text runs a generated bookmark encloses: the runs holding a `w:t`
 * between its start and its end, which sit in one paragraph. A list label is
 * not paragraph content, and a footnote reference run holds no `w:t`, so
 * neither is part of a text reference's result, as Word leaves both out.
 */
function bookmarkedTextRuns(start: Element): Element[] {
  const id = start.getAttributeNS(OOXML.W_NS, 'id');
  const runs: Element[] = [];
  for (let node = start.nextSibling; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    if (element.localName === W.bookmarkEnd && element.getAttributeNS(OOXML.W_NS, 'id') === id) return runs;
    if (element.localName === W.r && element.getElementsByTagNameNS(OOXML.W_NS, W.t).length > 0) runs.push(element);
  }
  throw new GenerationInternalError('A generated bookmark does not end in its paragraph');
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
