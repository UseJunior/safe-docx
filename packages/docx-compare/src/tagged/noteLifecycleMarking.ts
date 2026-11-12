import { XMLSerializer } from '@xmldom/xmldom';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import { canonicalNoteId } from './ancillaryFieldSafety.js';
import { createRevisionIdState, formatDate } from './revisionMarkup.js';
import { markLifecycleParagraph } from './textBoxRevisionSafety.js';

const serializer = new XMLSerializer();
const RESERVED_NOTE_TYPES = new Set(['separator', 'continuationSeparator', 'continuationNotice']);

type ReferenceLifecycle = 'inserted' | 'deleted' | 'live';

/** Final note IDs (canonical decimal) whose bodies were marked, per kind. */
export type NoteLifecycleMarks = Map<'footnote' | 'endnote', Map<string, 'inserted' | 'deleted'>>;

function isW(node: Node | null, localName: string): node is Element {
  return node !== null && node.nodeType === 1 &&
    (node as Element).namespaceURI === OOXML.W_NS && (node as Element).localName === localName;
}

/**
 * Whether an anchor disappears on Reject All (`inserted`), on Accept All
 * (`deleted`), or survives at least one projection in a way that keeps its
 * definition shared (`live`). A run-level `w:ins`/`w:del` ancestor or a
 * row-level insertion/deletion marker (`w:trPr/w:ins`, `w:trPr/w:del`)
 * decides it. A moved anchor, or one both inserted and deleted, is `live`:
 * its definition is not the lifecycle of one side.
 */
function referenceLifecycle(reference: Element): ReferenceLifecycle {
  let inserted = false;
  let deleted = false;
  for (let node = reference.parentNode; node; node = node.parentNode) {
    if (isW(node, 'ins')) inserted = true;
    else if (isW(node, 'del')) deleted = true;
    else if (isW(node, 'moveFrom') || isW(node, 'moveTo')) return 'live';
    else if (isW(node, 'tr')) {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (!isW(child, 'trPr')) continue;
        for (let marker = child.firstChild; marker; marker = marker.nextSibling) {
          if (isW(marker, 'ins')) inserted = true;
          else if (isW(marker, 'del')) deleted = true;
        }
      }
    }
  }
  if (inserted === deleted) return 'live';
  return inserted ? 'inserted' : 'deleted';
}

/**
 * Mark the body of every footnote and endnote whose anchors are all tracked
 * insertions as inserted, and of every note whose anchors are all tracked
 * deletions as deleted: each run, including the note's own reference mark,
 * is wrapped in `w:ins`/`w:del` (`w:t` becomes `w:delText` and `w:instrText`
 * becomes `w:delInstrText` on the deletion side), so an added note's text no
 * longer reads as if it had always been there and a removed note's text
 * visibly goes with its anchor. Paragraph marks are not marked; see below. A definition still referenced by
 * an unmarked or moved anchor, or by anchors of both kinds, stays as it is.
 * Runs already inside a revision wrapper keep their existing revision, and a
 * note whose source anchors already carry the same tracked lifecycle (a note
 * inserted or deleted with track changes on before the comparison) keeps the
 * body markup its source gave it.
 *
 * The note's paragraph marks are left alone because the note story is
 * resolved with its anchor, and because LibreOffice, measured on Word-shaped
 * notes (`w:pStyle` on every paragraph), joins the anchor's body paragraph to
 * the next body paragraph on Accept or Reject whenever a note paragraph mark
 * carries `w:ins`/`w:del`; run-only marks resolve correctly there.
 *
 * Runs after definitions are merged and repeated references separated, so
 * every definition in the result has its final ID and anchor set. Revision
 * IDs are allocated above every numeric `w:id` already in the package.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.10
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.7
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @see https://github.com/UseJunior/safe-docx/issues/1388
 */
export async function markLifecycleNoteBodies(options: {
  archive: DocxArchive;
  documentXml: string;
  /** The revised main story, whose notes an inserted anchor brings in. */
  revisedDocumentXml: string;
  /** The original main story, whose notes a deleted anchor takes out. */
  originalDocumentXml: string;
  /** Result note ID to pre-separation ID, per kind, for copied references. */
  noteReferenceSourceIds?: ReadonlyMap<'footnote' | 'endnote', ReadonlyMap<string, string>>;
  author: string;
  date: Date;
  minimumRevisionId?: number;
}): Promise<NoteLifecycleMarks> {
  const document = parseXml(options.documentXml);
  const sourceDocuments = {
    inserted: parseXml(options.revisedDocumentXml),
    deleted: parseXml(options.originalDocumentXml),
  };
  const marks: NoteLifecycleMarks = new Map();
  const targets: Array<{ kind: 'footnote' | 'endnote'; part: string; notes: Document; entries: Array<[Element, 'w:ins' | 'w:del', string]> }> = [];
  for (const kind of ['footnote', 'endnote'] as const) {
    const lifecycles = new Map<string, Set<ReferenceLifecycle>>();
    for (const reference of Array.from(document.getElementsByTagNameNS(OOXML.W_NS, `${kind}Reference`))) {
      const id = canonicalNoteId(reference.getAttributeNS(OOXML.W_NS, 'id') ?? '');
      if (id === undefined) continue;
      if (!lifecycles.has(id)) lifecycles.set(id, new Set());
      lifecycles.get(id)!.add(referenceLifecycle(reference));
    }
    const part = `word/${kind}s.xml`;
    const xml = lifecycles.size > 0 ? await options.archive.getFile(part) : null;
    if (!xml) continue;
    const notes = parseXml(xml);
    const entries: Array<[Element, 'w:ins' | 'w:del', string]> = [];
    for (const entry of Array.from(notes.getElementsByTagNameNS(OOXML.W_NS, kind))) {
      if (RESERVED_NOTE_TYPES.has(entry.getAttributeNS(OOXML.W_NS, 'type') ?? '')) continue;
      const id = canonicalNoteId(entry.getAttributeNS(OOXML.W_NS, 'id') ?? '');
      const seen = id === undefined ? undefined : lifecycles.get(id);
      if (!seen || seen.size !== 1) continue;
      const [lifecycle] = seen;
      if (lifecycle === 'live') continue;
      // A source that already tracks this anchor the same way (for example a
      // note added with track changes on) owns its note's revision history.
      const sourceId = options.noteReferenceSourceIds?.get(kind)?.get(id!) ?? id!;
      const sourceReferences = Array.from(sourceDocuments[lifecycle!].getElementsByTagNameNS(OOXML.W_NS, `${kind}Reference`))
        .filter(reference => canonicalNoteId(reference.getAttributeNS(OOXML.W_NS, 'id') ?? '') === canonicalNoteId(sourceId));
      if (sourceReferences.length > 0 && sourceReferences.every(reference => referenceLifecycle(reference) === lifecycle)) continue;
      entries.push([entry, lifecycle === 'inserted' ? 'w:ins' : 'w:del', id!]);
    }
    if (entries.length > 0) targets.push({ kind, part, notes, entries });
  }
  if (targets.length === 0) return marks;

  const preservedRoots: Element[] = [document.documentElement];
  for (const path of options.archive.listFiles()) {
    if (!/^word\/.*\.xml$/u.test(path) || path === 'word/document.xml') continue;
    const target = targets.find(candidate => candidate.part === path);
    if (target) {
      preservedRoots.push(target.notes.documentElement);
      continue;
    }
    const xml = await options.archive.getFile(path);
    if (!xml) continue;
    try {
      preservedRoots.push(parseXml(xml).documentElement);
    } catch {
      // Non-WordprocessingML extension parts are irrelevant to revision IDs.
    }
  }
  const state = createRevisionIdState(preservedRoots);
  state.nextId = Math.max(state.nextId, options.minimumRevisionId ?? 0);
  const dateString = formatDate(options.date);
  for (const target of targets) {
    const marked = new Map<string, 'inserted' | 'deleted'>();
    marks.set(target.kind, marked);
    for (const [entry, markerTag, id] of target.entries) {
      // Paragraph marks stay unmarked: the note story is resolved with its
      // anchor (Word removes the whole note with it, docx-core prunes an
      // orphaned footnote), and LibreOffice merges the anchor's body paragraph
      // into the next one on Accept/Reject when a styled note paragraph's mark
      // carries the revision. Runs of nested text-box paragraphs are marked
      // with those paragraphs.
      for (const paragraph of Array.from(entry.getElementsByTagNameNS(OOXML.W_NS, 'p'))) {
        markLifecycleParagraph(paragraph, markerTag, options.author, dateString, state, false);
      }
      marked.set(id, markerTag === 'w:ins' ? 'inserted' : 'deleted');
    }
    options.archive.setFile(target.part, serializer.serializeToString(target.notes));
  }
  return marks;
}
