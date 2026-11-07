/**
 * word/footnotes.xml emitter.
 *
 * Emitted only when the body story holds a footnote. The part starts from the
 * same separator / continuation-separator template the editing path
 * (`add_footnote`) bootstraps, and each note body is built with the same
 * paragraph emitter as the body. Its first paragraph opens with the
 * auto-numbered `w:footnoteRef` mark and a space, the shape Word and
 * `add_footnote` write, and a paragraph without a `styleId` takes FootnoteText.
 *
 * Determinism: note ids come from the FootnoteCollector in document order
 * (1, 2, 3, …), so identical specs produce byte-identical parts.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.10
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.13
 */

import { createWmlElement } from '../../primitives/dom-helpers.js';
import {
  buildFootnoteMarkSpaceRun,
  buildFootnoteRefMarkRun,
  FOOTNOTE_TEXT_STYLE_ID,
  FOOTNOTES_CONTENT_TYPE,
  FOOTNOTES_REL_TYPE,
  FOOTNOTES_XML_TEMPLATE,
} from '../../primitives/footnote-shapes.js';
import { W } from '../../primitives/namespaces.js';
import { parseXml, serializeXml, XML_DECL } from '../../primitives/xml.js';
import type { CompileContext } from '../context.js';
import { GenerationInternalError } from '../errors.js';
import type { BlockEmitContext, FootnoteCollector } from './emit-context.js';
import { buildParagraph } from './paragraph.js';

/** Emit word/footnotes.xml from the notes collected during body emission. */
export function emitFootnotesPartIfNeeded(
  ctx: CompileContext,
  collector: FootnoteCollector,
  blockCtx: Pick<BlockEmitContext, 'numberingIds' | 'crossReferences' | 'themeColorValues'>,
): void {
  if (collector.collected.length === 0) return;

  ctx.registerPart('word/footnotes.xml', FOOTNOTES_CONTENT_TYPE, FOOTNOTES_REL_TYPE);
  const doc = parseXml(FOOTNOTES_XML_TEMPLATE);
  const root = doc.documentElement!;
  // A note body is its own story: no drafting notes and no nested footnotes
  // (validation rejects both, so neither collector is passed on). It may hold
  // cross-references, resolved by now because the body is complete.
  const noteCtx: BlockEmitContext = {
    numberingIds: blockCtx.numberingIds,
    themeColorValues: blockCtx.themeColorValues,
    ...(blockCtx.crossReferences ? { crossReferences: blockCtx.crossReferences } : {}),
  };
  for (const { id, footnote } of collector.collected) {
    const note = createWmlElement(doc, W.footnote, { 'w:id': String(id) });
    footnote.blocks.forEach((paragraph, index) => {
      const p = buildParagraph(doc, { ...paragraph, styleId: paragraph.styleId ?? FOOTNOTE_TEXT_STYLE_ID }, noteCtx);
      if (index === 0) {
        const pPr = p.firstChild as Element | null;
        if (!pPr || pPr.nodeName !== 'w:pPr') {
          throw new GenerationInternalError('A footnote paragraph was emitted without its paragraph style');
        }
        p.insertBefore(buildFootnoteMarkSpaceRun(doc), pPr.nextSibling);
        p.insertBefore(buildFootnoteRefMarkRun(doc), pPr.nextSibling);
      }
      note.appendChild(p);
    });
    root.appendChild(note);
  }
  const xml = serializeXml(doc);
  ctx.setFileContent('word/footnotes.xml', xml.startsWith('<?xml') ? xml : XML_DECL + xml);
}
