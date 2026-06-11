/**
 * Auxiliary Part ID Collision Resolution
 *
 * Auxiliary part IDs (`w:id` on comments, footnotes, endnotes — OOXML
 * ST_DecimalNumber) are document-local: independently authored documents
 * routinely both start at `w:id="1"`. When the original and revised inputs
 * define *different* content under the same ID, the post-reconstruction
 * definition merge used to silently skip the source-side definition ("ID
 * already present"), leaving anchors from one side bound to the other side's
 * content.
 *
 * Strategy decision (issue #107 offered renumber vs. detect-and-flag): we
 * renumber, because detect-and-flag would fail comparisons between any two
 * independently authored commented documents — a core use case — and there is
 * no collision-free fallback mode to flag into. Renumbering happens *before*
 * comparison, on the revised archive, rather than inside the merge step:
 * after reconstruction the merged document.xml no longer records which anchor
 * came from which side, but at load time the revised archive can be rewritten
 * consistently (part definition + every ID-bearing anchor in document.xml,
 * header/footer parts, and the note stories — comments may be anchored on
 * footnote/endnote text). Downstream, colliding anchors then differ by ID, so
 * the LCS emits them as delete/insert pairs and the existing definition merge
 * imports the renumbered definition — each anchor resolves to the content it
 * was authored against, in both reconstruction modes.
 *
 * IDs whose definitions are content-identical on both sides are left alone so
 * their anchors still match as unchanged content (no duplicate definitions),
 * which keeps the common derived-document case byte-stable.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/107
 */

import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml } from '../../primitives/xml.js';
import type { DocxArchive } from '../../shared/docx/DocxArchive.js';

const serializer = new XMLSerializer();

export interface AuxiliaryPartDescriptor {
  label: string;
  partPath: string;
  referenceTag: string;
  entryTag: string;
  rootTag: string;
  contentType: string;
  relationshipType: string;
  /**
   * Every document.xml / header / footer tag that carries this part's `w:id`.
   * Superset of `referenceTag`: comments also anchor via range markers.
   */
  idBearingTags: string[];
}

export const AUXILIARY_PARTS: AuxiliaryPartDescriptor[] = [
  {
    label: 'footnote',
    partPath: 'word/footnotes.xml',
    referenceTag: 'w:footnoteReference',
    entryTag: 'w:footnote',
    rootTag: 'w:footnotes',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
    relationshipType: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes',
    idBearingTags: ['w:footnoteReference'],
  },
  {
    label: 'endnote',
    partPath: 'word/endnotes.xml',
    referenceTag: 'w:endnoteReference',
    entryTag: 'w:endnote',
    rootTag: 'w:endnotes',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml',
    relationshipType: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes',
    idBearingTags: ['w:endnoteReference'],
  },
  {
    label: 'comment',
    partPath: 'word/comments.xml',
    referenceTag: 'w:commentReference',
    entryTag: 'w:comment',
    rootTag: 'w:comments',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
    relationshipType: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
    idBearingTags: ['w:commentReference', 'w:commentRangeStart', 'w:commentRangeEnd'],
  },
];

/**
 * Parse an auxiliary part and extract entry elements by ID.
 */
export function parseEntries(
  xml: string,
  entryTag: string
): { doc: Document; entries: Map<string, Element> } {
  const doc = parseXml(xml);
  const entries = new Map<string, Element>();
  const elements = doc.getElementsByTagName(entryTag);
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as Element;
    const id = el.getAttribute('w:id');
    if (id) entries.set(id, el);
  }
  return { doc, entries };
}

export interface RenumberedAuxiliaryId {
  label: string;
  fromId: string;
  toId: string;
}

/**
 * Footnote/endnote separator entries exist in virtually every document and
 * are never anchored from document.xml; renumbering them would only churn
 * IDs Word expects to find.
 */
function isSeparatorEntry(el: Element): boolean {
  const type = el.getAttribute('w:type');
  return type === 'separator' || type === 'continuationSeparator';
}

function trackMaxNumericId(value: string | null, current: number): number {
  if (!value) return current;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) return current;
  return Math.max(current, parsed);
}

/** Lazily-parsed XML file inside an archive, serialized back only if touched. */
class LazyArchiveXml {
  private parsed: Document | null = null;
  private dirty = false;

  constructor(
    private readonly archive: DocxArchive,
    private readonly path: string,
    private readonly xml: string,
  ) {}

  doc(): Document {
    if (!this.parsed) this.parsed = parseXml(this.xml);
    return this.parsed;
  }

  /** Rewrite `w:id` on every `tag` element per `idMap`. */
  applyIdMap(tags: string[], idMap: Map<string, string>): void {
    for (const tag of tags) {
      const elements = this.doc().getElementsByTagName(tag);
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i] as Element;
        const id = el.getAttribute('w:id');
        if (id !== null && idMap.has(id)) {
          el.setAttribute('w:id', idMap.get(id)!);
          this.dirty = true;
        }
      }
    }
  }

  flush(): void {
    if (!this.dirty || !this.parsed) return;
    // xmldom 0.9 keeps the source's XML declaration as a document child, so
    // plain serialization round-trips it.
    this.archive.setFile(this.path, serializer.serializeToString(this.parsed));
  }
}

/**
 * Detect auxiliary `w:id` values defined with different content on both
 * sides and renumber the revised side's definitions and anchors into a fresh
 * ID space, so the comparison never binds an anchor to the other document's
 * content. Mutates `revisedArchive` in place; the originals' IDs are kept so
 * the comparison base (rebuild mode clones the original archive) stays
 * untouched.
 *
 * Anchors are rewritten in every revised-side story that can carry them:
 * document.xml, header/footer parts, and the auxiliary parts themselves —
 * Word allows comments anchored on footnote/endnote text, so a renumbered
 * comment's anchor may live inside footnotes.xml/endnotes.xml.
 *
 * Returns the applied renumberings (empty on the no-collision fast path).
 */
export async function renumberCollidingAuxiliaryIds(
  originalArchive: DocxArchive,
  revisedArchive: DocxArchive,
): Promise<RenumberedAuxiliaryId[]> {
  // Phase 1: detect collisions per descriptor (read-only).
  const plans: Array<{ descriptor: AuxiliaryPartDescriptor; collidingIds: string[] }> = [];
  const originalEntryIds = new Map<string, Set<string>>();
  for (const descriptor of AUXILIARY_PARTS) {
    const [originalPartXml, revisedPartXml] = await Promise.all([
      originalArchive.getFile(descriptor.partPath),
      revisedArchive.getFile(descriptor.partPath),
    ]);
    // A collision needs a definition on both sides.
    if (!originalPartXml || !revisedPartXml) continue;

    const originalParsed = parseEntries(originalPartXml, descriptor.entryTag);
    const revisedParsed = parseEntries(revisedPartXml, descriptor.entryTag);
    originalEntryIds.set(descriptor.label, new Set(originalParsed.entries.keys()));

    const collidingIds: string[] = [];
    for (const [id, revisedEntry] of revisedParsed.entries) {
      const originalEntry = originalParsed.entries.get(id);
      if (!originalEntry) continue;
      if (isSeparatorEntry(originalEntry) || isSeparatorEntry(revisedEntry)) continue;
      // Both parts went through the same parse, so serialization is a
      // canonical-enough content identity. xmldom preserves source attribute
      // order, so two byte-different but semantically identical entries DO
      // mismatch — intentionally accepted: a false mismatch only costs an
      // unnecessary renumber (both definitions ship as a delete/insert
      // anchor pair), never a wrong binding.
      if (serializer.serializeToString(originalEntry) === serializer.serializeToString(revisedEntry)) {
        continue;
      }
      collidingIds.push(id);
    }
    if (collidingIds.length > 0) plans.push({ descriptor, collidingIds });
  }
  if (plans.length === 0) return [];

  // Phase 2: rewrite. Load every revised-side story file that can define or
  // anchor auxiliary content; each descriptor's definitions AND anchors are
  // rewritten through this one set of parsed docs so later descriptors can't
  // clobber earlier rewrites of the same file.
  const rewriteFiles = new Map<string, LazyArchiveXml>();
  const rewritePaths = [
    'word/document.xml',
    ...revisedArchive.listFiles().filter((p) => /^word\/(?:header|footer)\d*\.xml$/.test(p)),
    ...AUXILIARY_PARTS.map((d) => d.partPath),
  ];
  for (const path of rewritePaths) {
    const xml = await revisedArchive.getFile(path);
    if (xml) rewriteFiles.set(path, new LazyArchiveXml(revisedArchive, path, xml));
  }
  const originalDocumentDoc = parseXml(await originalArchive.getDocumentXml());

  const renumbered: RenumberedAuxiliaryId[] = [];
  for (const { descriptor, collidingIds } of plans) {
    // Fresh IDs must clear every ID either side defines or references —
    // the merged output part will contain the union of both sides.
    let maxUsedId = 0;
    const revisedPart = rewriteFiles.get(descriptor.partPath)!;
    const entryElements = revisedPart.doc().getElementsByTagName(descriptor.entryTag);
    for (let i = 0; i < entryElements.length; i++) {
      maxUsedId = trackMaxNumericId((entryElements[i] as Element).getAttribute('w:id'), maxUsedId);
    }
    for (const id of originalEntryIds.get(descriptor.label) ?? []) {
      maxUsedId = trackMaxNumericId(id, maxUsedId);
    }
    const anchorDocs = [originalDocumentDoc, ...Array.from(rewriteFiles.values(), (f) => f.doc())];
    for (const doc of anchorDocs) {
      for (const tag of descriptor.idBearingTags) {
        const refs = doc.getElementsByTagName(tag);
        for (let i = 0; i < refs.length; i++) {
          maxUsedId = trackMaxNumericId((refs[i] as Element).getAttribute('w:id'), maxUsedId);
        }
      }
    }

    let nextId = maxUsedId + 1;
    const idMap = new Map<string, string>();
    for (const fromId of collidingIds) {
      const toId = String(nextId++);
      idMap.set(fromId, toId);
      renumbered.push({ label: descriptor.label, fromId, toId });
    }

    // Rewrite the revised part's definitions and every revised-side anchor
    // that carries the part's IDs (the definition rewrite is safe as an
    // id-map application: separator entries never enter the map).
    revisedPart.applyIdMap([descriptor.entryTag], idMap);
    for (const file of rewriteFiles.values()) {
      file.applyIdMap(descriptor.idBearingTags, idMap);
    }
  }

  for (const file of rewriteFiles.values()) file.flush();

  return renumbered;
}
