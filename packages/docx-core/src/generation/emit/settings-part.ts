/**
 * word/settings.xml emitter.
 *
 * Only emitted when the document actually needs a setting — today that is
 * `w:evenAndOddHeaders`, required for any section declaring an even-page
 * header or footer (without it readers ignore the even-page parts entirely).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.1
 */

import { createWmlElement } from '../../primitives/dom-helpers.js';
import { OOXML, W } from '../../primitives/namespaces.js';
import { parseXml, serializeXml, XML_DECL } from '../../primitives/xml.js';
import type { CompileContext } from '../context.js';
import type { DocumentSpec } from '../types.js';

const SETTINGS_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';
const SETTINGS_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';

export function emitSettingsPartIfNeeded(spec: DocumentSpec, ctx: CompileContext): void {
  const needsEvenOdd = spec.sections.some((s) => s.headers?.even || s.footers?.even);
  if (!needsEvenOdd) return;

  ctx.registerPart('word/settings.xml', SETTINGS_CONTENT_TYPE, SETTINGS_REL_TYPE);
  const doc = parseXml(`<w:settings xmlns:w="${OOXML.W_NS}"/>`);
  doc.documentElement!.appendChild(createWmlElement(doc, W.evenAndOddHeaders));
  ctx.setFileContent('word/settings.xml', XML_DECL + serializeXml(doc));
}
