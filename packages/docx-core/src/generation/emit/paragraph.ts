/**
 * Paragraph emitter.
 *
 * PR 1 scope: paragraphs of plain text runs with no paragraph properties.
 * pPr emission (style references, alignment, spacing, numbering, and the
 * section-break injection hook) arrives with the formatting and
 * multi-section phases, always routed through PPR_ORDER.
 */

import { createWmlElement } from '../../primitives/dom-helpers.js';
import { W } from '../../primitives/namespaces.js';
import type { ParagraphSpec } from '../types.js';
import { buildInlineRuns } from './run.js';

export function buildParagraph(doc: Document, paragraph: ParagraphSpec): Element {
  const p = createWmlElement(doc, W.p);
  for (const inline of paragraph.runs) {
    for (const run of buildInlineRuns(doc, inline)) {
      p.appendChild(run);
    }
  }
  return p;
}
