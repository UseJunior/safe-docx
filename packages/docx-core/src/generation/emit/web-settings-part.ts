/**
 * word/webSettings.xml emitter.
 *
 * Emitted on every package. Word-authored documents always carry a web-settings
 * part; shipping a minimal one keeps generated output part-for-part comparable to
 * genuine Word output (see issue #482). The body is static, so determinism holds.
 *
 * The root is the WordprocessingML `w:webSettings` element.
 */

import { parseXml, serializeXml, XML_DECL } from '../../primitives/xml.js';
import type { CompileContext } from '../context.js';
import { OOXML } from '../../primitives/namespaces.js';

const WEB_SETTINGS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.webSettings+xml';
const WEB_SETTINGS_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/webSettings';

export function emitWebSettingsPart(ctx: CompileContext): void {
  ctx.registerPart('word/webSettings.xml', WEB_SETTINGS_CONTENT_TYPE, WEB_SETTINGS_REL_TYPE);
  const doc = parseXml(
    `<w:webSettings xmlns:w="${OOXML.W_NS}"><w:optimizeForBrowser/><w:allowPNG/></w:webSettings>`,
  );
  ctx.setFileContent('word/webSettings.xml', XML_DECL + serializeXml(doc));
}
