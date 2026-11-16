/**
 * Support for `CompareOptions.date: null`, which publishes the comparison's
 * own revisions without a `w:date` attribute.
 *
 * `w:date` is optional on every CT_TrackChange-derived revision element, so a
 * dateless revision is valid. Rather than threading "no date" through every
 * emitter, the comparison runs with a placeholder timestamp that occurs in
 * neither input package, and the attribute carrying exactly that value is
 * removed from the finished package. Revisions that already existed in an
 * input keep their own dates, because none of them carries the placeholder.
 */

import { DocxArchive } from '@usejunior/docx-core';
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

/** Remove every `w:date` attribute whose value is the placeholder date. */
export async function omitPlaceholderRevisionDates(document: Buffer, placeholder: Date): Promise<Buffer> {
  const stamp = formatDate(placeholder);
  const attribute = new RegExp(`\\s+w:date\\s*=\\s*(?:"${stamp}"|'${stamp}')`, 'g');
  const archive = await DocxArchive.load(document);
  let changed = false;
  for (const { path, xml } of await packageXmlParts(archive)) {
    if (!xml.includes(stamp)) continue;
    archive.setFile(path, xml.replace(attribute, ''));
    changed = true;
  }
  return changed ? archive.save() : document;
}
