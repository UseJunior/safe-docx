/**
 * Paragraph emitter.
 *
 * Shipped: paragraphs with style references and direct formatting
 * (alignment, spacing, indentation, tabs, keepNext, pageBreakBefore), all
 * routed through the shared pPr builder and PPR_ORDER. The section-break
 * injection hook (a pPr-only sectPr) arrives with the multi-section phase.
 */

import { createWmlElement } from '../../primitives/dom-helpers.js';
import { W } from '../../primitives/namespaces.js';
import { GenerationInternalError } from '../errors.js';
import type { ParagraphSpec } from '../types.js';
import type { BlockEmitContext } from './emit-context.js';
import { buildParagraphPropsElement } from './properties.js';
import { buildInlineRuns } from './run.js';

/**
 * List paragraphs reference their numbering definition through w:numPr
 * (w:ilvl then w:numId, per CT_NumPr); the numeric id comes from the
 * numbering part's deterministic handle map.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.19
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.5
 */
export function buildParagraph(doc: Document, paragraph: ParagraphSpec, ctx?: BlockEmitContext): Element {
  const p = createWmlElement(doc, W.p);
  let extras: Map<string, Element> | undefined;
  if (paragraph.list !== undefined) {
    const numericId = ctx?.numberingIds?.get(paragraph.list.numId);
    if (numericId === undefined) {
      throw new GenerationInternalError(
        `List paragraph references numbering handle '${paragraph.list.numId}' with no allocated numeric id`,
      );
    }
    const numPr = createWmlElement(doc, W.numPr);
    numPr.appendChild(createWmlElement(doc, W.ilvl, { 'w:val': String(paragraph.list.ilvl) }));
    numPr.appendChild(createWmlElement(doc, W.numId, { 'w:val': String(numericId) }));
    extras = new Map([[W.numPr, numPr]]);
  }
  const pPr = buildParagraphPropsElement(doc, paragraph, extras);
  if (pPr) p.appendChild(pPr);

  // Drafting-note anchors: range markers bracket the paragraph's content and
  // the reference run trails it (§ 17.13.4.4 / .3 / .5). Absent a collector
  // (notes disabled, or a story that cannot carry them) the paragraph
  // serializes without any trace of the note.
  const noteId = paragraph.note !== undefined && ctx?.notes ? ctx.notes.allocate(paragraph.note) : undefined;
  if (noteId !== undefined) {
    p.appendChild(createWmlElement(doc, W.commentRangeStart, { 'w:id': String(noteId) }));
  }
  for (const inline of paragraph.runs) {
    for (const run of buildInlineRuns(doc, inline, ctx)) {
      p.appendChild(run);
    }
  }
  if (noteId !== undefined) {
    p.appendChild(createWmlElement(doc, W.commentRangeEnd, { 'w:id': String(noteId) }));
    const referenceRun = createWmlElement(doc, W.r);
    referenceRun.appendChild(createWmlElement(doc, W.commentReference, { 'w:id': String(noteId) }));
    p.appendChild(referenceRun);
  }
  return p;
}
