import { XMLSerializer } from '@xmldom/xmldom';
import { type DocxArchive, parseXml } from '@usejunior/docx-core';
import { AncillaryStorySafetyError, canonicalNoteId } from './ancillaryFieldSafety.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const serialize = (document: Document) => new XMLSerializer().serializeToString(document);

/** Normalize decimal-equivalent note definitions and anchors before collision rewriting.
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.14
 * @see https://github.com/UseJunior/safe-docx/issues/979
 */
export async function canonicalizeNoteArchiveIds(archive: DocxArchive): Promise<void> {
  for (const path of archive.listFiles().filter(p => p.startsWith('word/') && p.endsWith('.xml'))) {
    const xml = await archive.getFile(path);
    if (!xml || !/footnote|endnote/.test(xml)) continue;
    let document: Document;
    try { document = parseXml(xml); } catch { continue; } // Publication diagnoses contributing malformed parts.
    let changed = false;
    for (const local of ['footnote', 'endnote', 'footnoteReference', 'endnoteReference']) {
      for (const element of Array.from(document.getElementsByTagNameNS(W, local))) {
        const id = element.getAttributeNS(W, 'id') ?? '';
        const canonical = canonicalNoteId(id);
        if (canonical !== undefined && canonical !== id) {
          element.setAttributeNS(W, 'w:id', canonical);
          changed = true;
        }
      }
    }
    if (changed) archive.setFile(path, serialize(document));
  }
}

/** IDs reconstructed in multiple paragraphs, rather than paired inline. */
export function copiedParagraphNoteIds(document: Document, kind: 'footnote' | 'endnote'): Set<string> {
  const groups = new Map<string, Set<Node | null>>();
  for (const ref of Array.from(document.getElementsByTagNameNS(W, `${kind}Reference`))) {
    const id = canonicalNoteId(ref.getAttributeNS(W, 'id') ?? '');
    if (id === undefined) continue; // The publication guard diagnoses malformed IDs.
    let parent = ref.parentNode;
    while (parent && !(parent.nodeType === 1 && (parent as Element).namespaceURI === W && (parent as Element).localName === 'p')) parent = parent.parentNode;
    if (!groups.has(id)) groups.set(id, new Set());
    groups.get(id)!.add(parent);
  }
  return new Set([...groups].filter(([, paragraphs]) => paragraphs.size > 1).map(([id]) => id));
}

/**
 * A copied reference needs its own definition even when both definitions have
 * identical text. Readers may otherwise discard one reference on import.
 * Sequential IDs also keep unresolved reference order aligned with definition
 * order for LibreOffice; this is a reader workaround, not the display-number
 * contract of the specification. Apply to copied paragraph references or
 * explicitly reconciled stable inline anchors: a collision-renumbered first
 * anchor followed by unchanged lower IDs also misbinds bodies on reader import.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/941
 */
export async function separateRepeatedNoteReferences(archive: DocxArchive, xml: string,
  sourceIds: Map<'footnote' | 'endnote', Map<string, string>> = new Map(),
  stabilizedKinds: ReadonlySet<'footnote' | 'endnote'> = new Set()): Promise<string> {
  const document = parseXml(xml);
  let changed = false;
  for (const kind of ['footnote', 'endnote'] as const) {
    const part = `word/${kind}s.xml` as const;
    const fail = (detail: string, entryId?: string): never => {
      throw new AncillaryStorySafetyError([{
        category: 'canonical_evidence', code: 'NOTE_REFERENCE_IDENTITY_UNSAFE',
        detail: `Unsafe repeated ${kind} reference: ${detail}`,
        locator: entryId === undefined
          ? { locatorType: 'package_part', normalizedPartPath: part }
          : { locatorType: 'note_entry', normalizedPartPath: part, entryId },
      }]);
    };
    const parse = (source: string): Document => {
      try { return parseXml(source); } catch { return fail('malformed note or referencing story XML'); }
    };
    const referenceName = `${kind}Reference`;
    const refs = Array.from(document.getElementsByTagNameNS(W, referenceName));
    const ids = refs.map(ref => canonicalNoteId(ref.getAttributeNS(W, 'id') ?? '') ?? fail('invalid reference ID'));
    const uniqueReferences = new Set(ids).size === ids.length;
    // A lone collision-safe anchor already imports correctly. Preserve its
    // established ID; the failure requires a changed anchor beside other IDs.
    const normalizeStableAnchors = uniqueReferences && ids.length > 1 && stabilizedKinds.has(kind);
    if (uniqueReferences && !normalizeStableAnchors) continue;
    // This pass handles copied paragraph references. Inline side-paired edited
    // anchors already received distinct definitions during reconciliation.
    const copiedIds = copiedParagraphNoteIds(document, kind);
    if (copiedIds.size === 0 && !normalizeStableAnchors) continue;
    const source = await archive.getFile(part);
    if (!source) fail('missing definitions');
    const notes = parse(source!);
    if (notes.documentElement.namespaceURI !== W || notes.documentElement.localName !== `${kind}s`) fail('invalid definitions root');
    const entries = Array.from(notes.getElementsByTagNameNS(W, kind));
    if (entries.some(entry => entry.parentNode !== notes.documentElement)) fail('nested note definition');
    const entryIds = new Map(entries.map(note => [note, canonicalNoteId(note.getAttributeNS(W, 'id') ?? '') ?? fail('invalid definition ID')]));
    const byId = new Map(entries.map(note => [entryIds.get(note)!, note]));
    if (byId.size !== entries.length) fail('duplicate definition IDs');
    // Rewriting only the main story must not invalidate an anchor in another story.
    for (const path of archive.listFiles().filter(path => path.startsWith('word/') && path.endsWith('.xml') && path !== 'word/document.xml')) {
      const other = await archive.getFile(path);
      if (other && parse(other).getElementsByTagNameNS(W, referenceName).length) fail('reference outside the main story');
    }
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const id of counts.keys()) {
      const note = byId.get(id);
      if (!note || BigInt(id) < 0n ||
          ['separator', 'continuationSeparator', 'continuationNotice'].includes(note.getAttributeNS(W, 'type') ?? '')) fail('invalid referenced definition', id);
      if (!copiedIds.has(id)) continue;
      // Duplicating scoped annotations or fields needs its own identity policy.
      // Do not turn a reader repair into duplicated bookmarks/comments/revisions.
      const safe = new Set(['footnote', 'endnote', 'p', 'pPr', 'r', 'rPr', 't', 'footnoteRef', 'endnoteRef',
        'tab', 'ptab', 'br', 'cr', 'noBreakHyphen', 'softHyphen', 'sym', 'proofErr', 'lastRenderedPageBreak']);
      const scoped = /^(?:bookmark|comment|perm|move|customXml|sdt|fld|instrText|delInstrText|ins$|del$|delText$|drawing$|pict$|object$|hyperlink$|footnoteReference$|endnoteReference$|sectPr$|annotationRef$)|Change$/u;
      for (const element of [note!, ...Array.from(note!.getElementsByTagName('*'))]) {
        let property = false;
        for (let node: Node | null = element; node && node !== note; node = node.parentNode) {
          if (node.nodeType === 1 && (node as Element).namespaceURI === W && ['pPr', 'rPr'].includes((node as Element).localName)) property = true;
        }
        if (element.namespaceURI !== W || scoped.test(element.localName) || (!safe.has(element.localName) && !property)) fail('definition contains unsupported annotations or structure', id);
        if (Array.from(element.attributes).some(attr => attr.namespaceURI === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')) fail('definition contains relationships', id);
      }
    }
    const reserved = new Set(entries.filter(note => ['separator', 'continuationSeparator', 'continuationNotice'].includes(note.getAttributeNS(W, 'type') ?? ''))
      .map(note => entryIds.get(note)!));
    let next = 1n;
    const mapping = new Map<string, string>();
    const allocate = () => { while (reserved.has(String(next))) next++; return String(next++); };
    const sharedIds = new Map<string, string>();
    const seen = new Set<string>();
    const copies: Element[] = [];
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i]!;
      const sourceId = ids[i]!;
      const shared = sharedIds.get(sourceId);
      if (shared !== undefined) {
        ref.setAttributeNS(W, 'w:id', shared);
        continue;
      }
      const copy = byId.get(ids[i]!)!.cloneNode(true) as Element;
      if (seen.has(sourceId)) {
        // Optional editing identities must not be shared by cloned paragraphs.
        // Scoped annotations that could refer to them were rejected above.
        for (const paragraph of Array.from(copy.getElementsByTagNameNS(W, 'p'))) {
          paragraph.removeAttributeNS(W14, 'paraId');
          paragraph.removeAttributeNS(W14, 'textId');
        }
      }
      seen.add(sourceId);
      const id = allocate();
      // Normalize identifiers consistently for reader import, but never clone
      // an inline-edited group's shared tracked definition or revision history.
      if (!copiedIds.has(sourceId)) sharedIds.set(sourceId, id);
      mapping.set(id, ids[i]!);
      ref.setAttributeNS(W, 'w:id', id);
      copy.setAttributeNS(W, 'w:id', id);
      copies.push(copy);
    }
    // Preserve unreferenced definitions, assigning IDs outside the new references.
    for (const entry of entries) {
      const id = entryIds.get(entry)!;
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
