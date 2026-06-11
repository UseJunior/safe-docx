/**
 * word/document.xml emitter.
 *
 * Builds the main document part from a namespace-declaring skeleton: the
 * skeleton string carries every namespace the part uses on the root element,
 * and all children are created through the namespace-safe DOM helpers.
 * xmldom's serializer omits the XML declaration, so it is prepended here;
 * the structural validator asserts every part starts with one.
 */

import { OOXML } from '../../primitives/namespaces.js';
import { parseXml, serializeXml } from '../../primitives/xml.js';
import { GenerationInternalError } from '../errors.js';
import type { DocumentSpec } from '../types.js';
import { buildParagraph } from './paragraph.js';
import { buildSectPr } from './section.js';

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const DOCUMENT_SKELETON =
  `<w:document xmlns:w="${OOXML.W_NS}" xmlns:r="${OOXML.R_NS}" xmlns:w14="${OOXML.W14_NS}">` +
  `<w:body/></w:document>`;

/**
 * Compile the body: each section's blocks in order, with the final section's
 * properties bound as the body's last child. Multi-section emission (a
 * dedicated break paragraph whose pPr holds the ending section's sectPr)
 * lands in the multi-section phase.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.17
 */
export function emitDocumentPart(spec: DocumentSpec): string {
  const doc = parseXml(DOCUMENT_SKELETON);
  const body = doc.getElementsByTagName('w:body').item(0);
  if (!body) throw new GenerationInternalError('document skeleton lost its w:body');

  for (const section of spec.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'paragraph') {
        throw new GenerationInternalError(
          `Block kind '${block.kind}' reached the document emitter without a shipped emitter`,
        );
      }
      body.appendChild(buildParagraph(doc, block));
    }
  }

  const finalSection = spec.sections[spec.sections.length - 1]!;
  body.appendChild(buildSectPr(doc, finalSection));

  return XML_DECL + serializeXml(doc);
}
