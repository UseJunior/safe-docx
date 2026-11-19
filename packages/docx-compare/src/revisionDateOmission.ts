/**
 * Support for `CompareOptions.date: null`, which publishes the comparison's
 * own revisions without a `w:date` attribute.
 *
 * `w:date` is optional on every CT_TrackChange-derived revision element, so a
 * dateless revision is valid. The move-range start markers
 * (`w:moveFromRangeStart`, `w:moveToRangeStart`) are the exception: they are
 * CT_MoveBookmark, whose `w:date` is required (ECMA-376 Part 1 transitional
 * wml.xsd: `date use="required"`). Those markers carry the fixed neutral date
 * {@link MOVE_RANGE_NEUTRAL_DATE} instead, so the package stays schema-valid.
 *
 * Rather than threading "no date" through every emitter, the comparison runs with a placeholder timestamp that occurs in
 * neither input package, and the attribute carrying exactly that value is
 * removed from the finished package. Revisions that already existed in an
 * input keep their own dates, because none of them carries the placeholder.
 */

import { DocxArchive, parseXml, serializeXml } from '@usejunior/docx-core';
import { formatDate } from './tagged/revisionMarkup.js';

const XML_PART = /\.(xml|rels)$/i;
const FIRST_PLACEHOLDER_MS = Date.UTC(1901, 0, 1, 0, 0, 0);

async function packageXmlParts(archive: DocxArchive): Promise<Array<{ path: string; xml: string }>> {
  const parts: Array<{ path: string; xml: string }> = [];
  for (const path of archive.listFiles()) {
    if (!XML_PART.test(path)) continue;
    const xml = await archive.getFile(path);
    if (xml !== null && xml !== undefined) parts.push({ path, xml });
  }
  return parts;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decode XML character and predefined entity references, as the parser will. */
function decodeXmlReferences(xml: string): string {
  // Decoding comments/CDATA too only widens the collision search, which is
  // harmless; an out-of-range reference (literal text there) is left as is.
  return xml.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (match, ref: string) => {
    if (!ref.startsWith('#')) return NAMED_ENTITIES[ref]!;
    const code = ref.startsWith('#x') ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Choose a placeholder revision date whose formatted value appears in neither input. */
export async function choosePlaceholderRevisionDate(inputs: readonly Buffer[]): Promise<Date> {
  const texts: string[] = [];
  for (const input of inputs) {
    const archive = await DocxArchive.load(input);
    // Search decoded text too: a reference such as `&#90;` serializes as the
    // literal character, so the encoded form would otherwise hide a collision.
    for (const { xml } of await packageXmlParts(archive)) texts.push(xml, decodeXmlReferences(xml));
  }
  for (let offset = 0; ; offset += 1) {
    const candidate = new Date(FIRST_PLACEHOLDER_MS + offset * 1000);
    const stamp = formatDate(candidate);
    if (!texts.some((xml) => xml.includes(stamp))) return candidate;
  }
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * The date written on move-range start markers under `date: null`, because
 * CT_MoveBookmark requires `w:date`. It is the Unix epoch, so it carries no
 * information about when the comparison ran.
 */
export const MOVE_RANGE_NEUTRAL_DATE = '1970-01-01T00:00:00Z';

/** CT_MoveBookmark elements, whose `w:date` is required by the schema. */
const DATE_REQUIRED_LOCAL_NAMES = new Set(['moveFromRangeStart', 'moveToRangeStart']);
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/**
 * Remove every WordprocessingML `date` attribute whose value is the
 * placeholder, except on move-range start markers, where it becomes
 * {@link MOVE_RANGE_NEUTRAL_DATE}. The part is parsed so only real attributes are touched, never
 * text or another attribute's value that happens to spell the same stamp.
 */
export async function omitPlaceholderRevisionDates(document: Buffer, placeholder: Date): Promise<Buffer> {
  const stamp = formatDate(placeholder);
  const archive = await DocxArchive.load(document);
  let changed = false;
  for (const { path, xml } of await packageXmlParts(archive)) {
    if (!xml.includes(stamp)) continue;
    const doc = parseXml(xml);
    let removed = 0;
    const elements = doc.getElementsByTagName('*');
    for (let index = 0; index < elements.length; index++) {
      const element = elements[index]!;
      if (element.getAttributeNS(W_NS, 'date') === stamp) {
        if (element.namespaceURI === W_NS && DATE_REQUIRED_LOCAL_NAMES.has(element.localName ?? '')) {
          element.setAttributeNS(W_NS, 'w:date', MOVE_RANGE_NEUTRAL_DATE);
        } else {
          element.removeAttributeNS(W_NS, 'date');
        }
        removed += 1;
      }
    }
    if (removed === 0) continue;
    const serialized = serializeXml(doc);
    archive.setFile(path, serialized.startsWith('<?xml') ? serialized : XML_DECLARATION + serialized);
    changed = true;
  }
  return changed ? archive.save() : document;
}
