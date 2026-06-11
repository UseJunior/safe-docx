/**
 * Header and footer part emitters.
 *
 * Each declared header/footer slot (default / first / even) becomes its own
 * part — word/headerN.xml or word/footerN.xml — registered with a
 * content-type override and a relationship from the main document part. The
 * block content reuses the same paragraph/run emitters as the body, so a
 * footer's "Page X of Y" field compiles through exactly the same five-part
 * field machinery.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.4
 */

import { OOXML } from '../../primitives/namespaces.js';
import { parseXml, serializeXml } from '../../primitives/xml.js';
import { GenerationInternalError } from '../errors.js';
import type { CompileContext } from '../context.js';
import type { DocumentSpec, HeaderFooterSpec, SectionSpec } from '../types.js';
import { XML_DECL } from './document-part.js';
import { buildParagraph } from './paragraph.js';
import type { SectionHeaderFooterRefs } from './section.js';

const HEADER_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const FOOTER_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
const HEADER_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

const SLOT_ORDER = ['first', 'default', 'even'] as const;

/**
 * Allocate and emit every header/footer part, returning per-section
 * reference maps for the sectPr emitter. Runs before the document part so
 * relationship ids exist when sections bind their references.
 */
export function emitHeaderFooterParts(spec: DocumentSpec, ctx: CompileContext): SectionHeaderFooterRefs[] {
  return spec.sections.map((section) => emitForSection(section, ctx));
}

function emitForSection(section: SectionSpec, ctx: CompileContext): SectionHeaderFooterRefs {
  const refs: SectionHeaderFooterRefs = { headers: {}, footers: {} };
  for (const slot of SLOT_ORDER) {
    const header = section.headers?.[slot];
    if (header) {
      refs.headers[slot] = emitPart(header, ctx, 'header');
    }
    const footer = section.footers?.[slot];
    if (footer) {
      refs.footers[slot] = emitPart(footer, ctx, 'footer');
    }
  }
  return refs;
}

/** @conformance ECMA-376 edition 5, Part 1 § 17.10.3 */
function emitPart(content: HeaderFooterSpec, ctx: CompileContext, kind: 'header' | 'footer'): string {
  const isHeader = kind === 'header';
  const partName = isHeader ? ctx.allocateHeaderPartName() : ctx.allocateFooterPartName();
  const part = ctx.registerPart(
    partName,
    isHeader ? HEADER_CONTENT_TYPE : FOOTER_CONTENT_TYPE,
    isHeader ? HEADER_REL_TYPE : FOOTER_REL_TYPE,
  );

  const rootTag = isHeader ? 'w:hdr' : 'w:ftr';
  const doc = parseXml(`<${rootTag} xmlns:w="${OOXML.W_NS}" xmlns:r="${OOXML.R_NS}"/>`);
  const root = doc.documentElement!;
  for (const block of content.blocks) {
    if (block.kind !== 'paragraph') {
      throw new GenerationInternalError(
        `Header/footer block kind '${block.kind}' reached the emitter without a shipped emitter`,
      );
    }
    root.appendChild(buildParagraph(doc, block));
  }

  ctx.setFileContent(partName, XML_DECL + serializeXml(doc));
  return part.documentRel!.rId;
}
