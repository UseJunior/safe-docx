/**
 * word/document.xml emitter.
 *
 * Builds the main document part from a namespace-declaring skeleton: the
 * skeleton string carries every namespace the part uses on the root element,
 * and all children are created through the namespace-safe DOM helpers.
 * xmldom's serializer omits the XML declaration, so it is prepended here;
 * the structural validator asserts every part starts with one.
 */

import { createWmlElement } from '../../primitives/dom-helpers.js';
import { OOXML, W } from '../../primitives/namespaces.js';
import { parseXml, serializeXml, XML_DECL } from '../../primitives/xml.js';
import { GenerationInternalError } from '../errors.js';
import type { DocumentSpec } from '../types.js';
import type { NumberingIdMap } from './numbering-part.js';
import { buildSectPr, type SectionHeaderFooterRefs } from './section.js';
import { buildBlock } from './table.js';

const DOCUMENT_SKELETON =
  `<w:document xmlns:w="${OOXML.W_NS}" xmlns:r="${OOXML.R_NS}" xmlns:w14="${OOXML.W14_NS}">` +
  `<w:body/></w:document>`;

/**
 * Compile the body: each section's blocks in order. Every non-final section
 * ends with a dedicated break paragraph whose pPr contains only that
 * section's sectPr (what Word itself emits on Insert → Section Break; it
 * also sidesteps the trailing-table case), and the final section's
 * properties bind as the body's last child.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.17
 */
export function emitDocumentPart(spec: DocumentSpec, refs?: SectionHeaderFooterRefs[], numberingIds?: NumberingIdMap): string {
  const doc = parseXml(DOCUMENT_SKELETON);
  const body = doc.getElementsByTagName('w:body').item(0);
  if (!body) throw new GenerationInternalError('document skeleton lost its w:body');

  spec.sections.forEach((section, index) => {
    for (const block of section.blocks) {
      body.appendChild(buildBlock(doc, block, numberingIds));
    }

    const sectPr = buildSectPr(doc, section, refs?.[index]);
    const isFinal = index === spec.sections.length - 1;
    if (isFinal) {
      // The body must not end with a table (readers treat it as truncated);
      // a final trailing table gets a closing empty paragraph before the
      // body-level sectPr binds. Non-final sections already end with their
      // dedicated break paragraph.
      const lastBlock = section.blocks[section.blocks.length - 1];
      if (lastBlock && lastBlock.kind === 'table') {
        body.appendChild(createWmlElement(doc, W.p));
      }
      body.appendChild(sectPr);
    } else {
      const breakParagraph = createWmlElement(doc, W.p);
      const pPr = createWmlElement(doc, W.pPr);
      pPr.appendChild(sectPr);
      breakParagraph.appendChild(pPr);
      body.appendChild(breakParagraph);
    }
  });

  return XML_DECL + serializeXml(doc);
}
