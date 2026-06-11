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
import type { ParagraphSpec } from '../types.js';
import { buildParagraphPropsElement } from './properties.js';
import { buildInlineRuns } from './run.js';

export function buildParagraph(doc: Document, paragraph: ParagraphSpec): Element {
  const p = createWmlElement(doc, W.p);
  const pPr = buildParagraphPropsElement(doc, paragraph);
  if (pPr) p.appendChild(pPr);
  for (const inline of paragraph.runs) {
    for (const run of buildInlineRuns(doc, inline)) {
      p.appendChild(run);
    }
  }
  return p;
}
