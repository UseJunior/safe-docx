import { XMLSerializer } from '@xmldom/xmldom';
import { type DocxArchive, parseXml } from '@usejunior/docx-core';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const serialize = (document: Document) => new XMLSerializer().serializeToString(document);

/**
 * A copied reference needs its own definition even when both definitions have
 * identical text. Readers may otherwise discard one reference on import.
 * Sequential IDs also keep unresolved reference order aligned with definition
 * order for LibreOffice; this is a reader workaround, not the display-number
 * contract of the specification. Apply only to copied paragraph references.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.14
 * @see https://github.com/UseJunior/safe-docx/issues/941
 */
export async function separateRepeatedNoteReferences(archive: DocxArchive, xml: string,
  sourceIds: Map<'footnote' | 'endnote', Map<string, string>> = new Map()): Promise<string> {
  const document = parseXml(xml);
  let changed = false;
  for (const kind of ['footnote', 'endnote'] as const) {
    const referenceName = `${kind}Reference`;
    const refs = Array.from(document.getElementsByTagNameNS(W, referenceName));
    const ids = refs.map(ref => ref.getAttributeNS(W, 'id')!);
    if (new Set(ids).size === ids.length) continue;
    const paragraph = (ref: Element): Node | null => {
      let parent = ref.parentNode;
      while (parent && !(parent.nodeType === 1 && (parent as Element).namespaceURI === W && (parent as Element).localName === 'p')) parent = parent.parentNode;
      return parent;
    };
    // Corresponding edited references inside one paragraph deliberately share
    // a tracked definition. This repair targets copied paragraph references.
    if (!ids.some((id, i) => refs.some((ref, j) => j !== i && ids[j] === id && paragraph(ref) !== paragraph(refs[i]!)))) continue;
    const fail = (detail: string): never => { throw new Error(`Unsafe repeated ${kind} reference: ${detail}`); };
    const part = `word/${kind}s.xml`;
    const source = await archive.getFile(part);
    if (!source) fail('missing definitions');
    const notes = parseXml(source!);
    const entries = Array.from(notes.getElementsByTagNameNS(W, kind));
    const byId = new Map(entries.map(note => [note.getAttributeNS(W, 'id')!, note]));
    if (byId.size !== entries.length) fail('duplicate definition IDs');
    // Rewriting only the main story must not invalidate an anchor in another story.
    for (const path of archive.listFiles().filter(path => path.startsWith('word/') && path.endsWith('.xml') && path !== 'word/document.xml')) {
      const other = await archive.getFile(path);
      if (other && parseXml(other).getElementsByTagNameNS(W, referenceName).length) fail('reference outside the main story');
    }
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, count] of counts) {
      const note = byId.get(id);
      if (!note || !Number.isSafeInteger(Number(id)) || Number(id) < 0 ||
          ['separator', 'continuationSeparator', 'continuationNotice'].includes(note.getAttributeNS(W, 'type') ?? '')) fail('invalid referenced definition');
      if (count < 2) continue;
      // Duplicating scoped annotations or fields needs its own identity policy.
      // Do not turn a reader repair into duplicated bookmarks/comments/revisions.
      const safe = new Set(['footnote', 'endnote', 'p', 'pPr', 'r', 'rPr', 't', 'footnoteRef', 'endnoteRef',
        'pStyle', 'rStyle', 'b', 'bCs', 'i', 'iCs', 'u', 'color', 'sz', 'szCs', 'rFonts', 'lang',
        'spacing', 'ind', 'jc', 'keepNext', 'keepLines', 'widowControl', 'tab', 'tabs', 'br',
        'vertAlign', 'position', 'highlight', 'caps', 'smallCaps', 'strike', 'dstrike', 'noProof']);
      for (const element of [note!, ...Array.from(note!.getElementsByTagName('*'))]) {
        if (element.namespaceURI !== W || !safe.has(element.localName)) fail('definition contains unsupported annotations or structure');
        if (Array.from(element.attributes).some(attr => attr.namespaceURI === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')) fail('definition contains relationships');
      }
    }
    const reserved = new Set(entries.filter(note => ['separator', 'continuationSeparator', 'continuationNotice'].includes(note.getAttributeNS(W, 'type') ?? ''))
      .map(note => note.getAttributeNS(W, 'id')!));
    let next = 1;
    const mapping = new Map<string, string>();
    const allocate = () => { while (reserved.has(String(next))) next++; return String(next++); };
    const copies = refs.map((ref, i) => {
      const copy = byId.get(ids[i]!)!.cloneNode(true) as Element;
      if (ids.indexOf(ids[i]!) !== i) {
        // Optional editing identities must not be shared by cloned paragraphs.
        // Scoped annotations that could refer to them were rejected above.
        for (const paragraph of Array.from(copy.getElementsByTagNameNS(W, 'p'))) {
          paragraph.removeAttributeNS(W14, 'paraId');
          paragraph.removeAttributeNS(W14, 'textId');
        }
      }
      const id = allocate();
      mapping.set(id, ids[i]!);
      ref.setAttributeNS(W, 'w:id', id);
      copy.setAttributeNS(W, 'w:id', id);
      return copy;
    });
    // Preserve unreferenced definitions, assigning IDs outside the new references.
    for (const entry of entries) {
      const id = entry.getAttributeNS(W, 'id')!;
      if (reserved.has(id)) continue;
      notes.documentElement.removeChild(entry);
      if (!counts.has(id)) {
        const replacement = allocate();
        mapping.set(replacement, id);
        entry.setAttributeNS(W, 'w:id', replacement);
        copies.push(entry);
      }
    }
    for (const copy of copies) notes.documentElement.appendChild(copy);
    archive.setFile(part, serialize(notes));
    sourceIds.set(kind, mapping);
    changed = true;
  }
  return changed ? serialize(document) : xml;
}
