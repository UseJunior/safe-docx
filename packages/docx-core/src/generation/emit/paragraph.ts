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
import type { NumberingIdMap } from './numbering-part.js';
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
 */
export function buildParagraph(doc: Document, paragraph: ParagraphSpec, numberingIds?: NumberingIdMap): Element {
  const p = createWmlElement(doc, W.p);
  let extras: Map<string, Element> | undefined;
  if (paragraph.list !== undefined) {
    const numericId = numberingIds?.get(paragraph.list.numId);
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
  for (const inline of paragraph.runs) {
    for (const run of buildInlineRuns(doc, inline)) {
      p.appendChild(run);
    }
  }
  return p;
}
