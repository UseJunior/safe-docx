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
 * Comment ancillary parts have a second collision axis: commentsExtended.xml
 * and commentsIds.xml are keyed by the w14:paraId on comment-content
 * paragraphs, not by w:id. We restamp colliding revised-side comment paraIds
 * before comparison for the same reason: merged ancillary rows must never bind
 * to the other document's comment paragraph.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/107
 * @see https://github.com/UseJunior/safe-docx/issues/448
 */

import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml } from '@usejunior/docx-core';
import type { DocxArchive } from '@usejunior/docx-core';

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

  /** Rewrite matching attributes on every `tag` element per `valueMap`. */
  applyAttributeMap(
    tags: string[],
    attrName: string,
    valueMap: Map<string, string>,
    normalizeKey: (value: string) => string = (value) => value,
  ): void {
    if (valueMap.size === 0) return;
    for (const tag of tags) {
      const elements = this.doc().getElementsByTagName(tag);
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i] as Element;
        const value = el.getAttribute(attrName);
        if (value === null) continue;
        const replacement = valueMap.get(normalizeKey(value));
        if (replacement) {
          el.setAttribute(attrName, replacement);
          this.dirty = true;
        }
      }
    }
  }

  /** Rewrite `w:id` on every `tag` element per `idMap`. */
  applyIdMap(tags: string[], idMap: Map<string, string>): void {
    this.applyAttributeMap(tags, 'w:id', idMap);
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

export interface RestampedCommentParaId {
  fromParaId: string;
  toParaId: string;
}

function normalizeParaId(value: string): string {
  return value.toUpperCase();
}

function collectCommentParaIdOwners(xml: string | null): Map<string, Element[]> {
  const owners = new Map<string, Element[]>();
  if (!xml) return owners;

  const doc = parseXml(xml);
  const comments = doc.getElementsByTagName('w:comment');
  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i] as Element;
    const seenInComment = new Set<string>();
    const paragraphs = comment.getElementsByTagName('w:p');
    for (let j = 0; j < paragraphs.length; j++) {
      const paraId = (paragraphs[j] as Element).getAttribute('w14:paraId');
      if (!paraId) continue;
      const normalized = normalizeParaId(paraId);
      if (seenInComment.has(normalized)) continue;
      seenInComment.add(normalized);
      const entries = owners.get(normalized);
      if (entries) entries.push(comment);
      else owners.set(normalized, [comment]);
    }
  }
  return owners;
}

function collectAttributeValues(xml: string | null, tag: string, attrNames: string[]): Set<string> {
  const values = new Set<string>();
  if (!xml) return values;

  const doc = parseXml(xml);
  const elements = doc.getElementsByTagName(tag);
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as Element;
    for (const attrName of attrNames) {
      const value = el.getAttribute(attrName);
      if (value) values.add(normalizeParaId(value));
    }
  }
  return values;
}

function collectUsedParaIds(xml: string | null, used: Set<string>): void {
  if (!xml) return;
  const paraIdAttrPattern =
    /(?:w14:paraId|w15:paraId|w15:paraIdParent|w16cid:paraId)\s*=\s*["']([0-9A-Fa-f]{1,8})["']/g;
  for (const match of xml.matchAll(paraIdAttrPattern)) {
    used.add(normalizeParaId(match[1]!));
  }
}

/**
 * Restamp revised-side comment paragraph paraIds when they collide with
 * original-side comment paraIds that belong to different comment content.
 *
 * This pass intentionally matches literal Word prefixes (`w14`, `w15`, and
 * `w16cid`) for both DOM lookup and raw allocation scans, consistent with the
 * rest of this module's prefix-literal auxiliary part handling. Mutates
 * `revisedArchive` in place and returns the applied restamps.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/448
 */
export async function restampCollidingCommentParaIds(
  originalArchive: DocxArchive,
  revisedArchive: DocxArchive,
): Promise<RestampedCommentParaId[]> {
  const [
    originalCommentsXml,
    revisedCommentsXml,
    revisedCommentsExtendedXml,
    revisedCommentsIdsXml,
  ] = await Promise.all([
    originalArchive.getFile('word/comments.xml'),
    revisedArchive.getFile('word/comments.xml'),
    revisedArchive.getFile('word/commentsExtended.xml'),
    revisedArchive.getFile('word/commentsIds.xml'),
  ]);

  if (!originalCommentsXml) return [];

  const originalOwners = collectCommentParaIdOwners(originalCommentsXml);
  if (originalOwners.size === 0) return [];

  const revisedOwners = collectCommentParaIdOwners(revisedCommentsXml);
  const collidingParaIds = new Set<string>();
  for (const [paraId, revisedOwnerEntries] of revisedOwners) {
    const originalOwnerEntries = originalOwners.get(paraId);
    if (!originalOwnerEntries) continue;

    if (
      originalOwnerEntries.length === 1 &&
      revisedOwnerEntries.length === 1 &&
      serializer.serializeToString(originalOwnerEntries[0]!) ===
        serializer.serializeToString(revisedOwnerEntries[0]!)
    ) {
      continue;
    }

    collidingParaIds.add(paraId);
  }

  const revisedBackedParaIds = new Set(revisedOwners.keys());
  const revisedAncillaryParaIds = new Set<string>();
  for (const value of collectAttributeValues(
    revisedCommentsExtendedXml,
    'w15:commentEx',
    ['w15:paraId', 'w15:paraIdParent'],
  )) {
    revisedAncillaryParaIds.add(value);
  }
  for (const value of collectAttributeValues(
    revisedCommentsIdsXml,
    'w16cid:commentId',
    ['w16cid:paraId'],
  )) {
    revisedAncillaryParaIds.add(value);
  }

  for (const paraId of revisedAncillaryParaIds) {
    if (!revisedBackedParaIds.has(paraId) && originalOwners.has(paraId)) {
      collidingParaIds.add(paraId);
    }
  }

  if (collidingParaIds.size === 0) return [];

  const usedParaIds = new Set<string>();
  const allocationScanPaths = [
    'word/comments.xml',
    'word/commentsExtended.xml',
    'word/commentsIds.xml',
    'word/document.xml',
  ];
  for (const archive of [originalArchive, revisedArchive]) {
    await Promise.all(
      allocationScanPaths.map(async (path) => {
        collectUsedParaIds(await archive.getFile(path), usedParaIds);
      }),
    );
  }

  const valueMap = new Map<string, string>();
  let next = 1;
  for (const fromParaId of [...collidingParaIds].sort()) {
    let toParaId: string;
    do {
      toParaId = next.toString(16).toUpperCase().padStart(8, '0');
      next++;
    } while (usedParaIds.has(toParaId) || toParaId === '00000000');
    usedParaIds.add(toParaId);
    valueMap.set(fromParaId, toParaId);
  }

  const rewriteFiles = new Map<string, LazyArchiveXml>();
  for (const path of ['word/comments.xml', 'word/commentsExtended.xml', 'word/commentsIds.xml']) {
    const xml = await revisedArchive.getFile(path);
    if (xml) rewriteFiles.set(path, new LazyArchiveXml(revisedArchive, path, xml));
  }

  rewriteFiles
    .get('word/comments.xml')
    ?.applyAttributeMap(['w:p'], 'w14:paraId', valueMap, normalizeParaId);
  rewriteFiles
    .get('word/commentsExtended.xml')
    ?.applyAttributeMap(['w15:commentEx'], 'w15:paraId', valueMap, normalizeParaId);
  rewriteFiles
    .get('word/commentsExtended.xml')
    ?.applyAttributeMap(['w15:commentEx'], 'w15:paraIdParent', valueMap, normalizeParaId);
  rewriteFiles
    .get('word/commentsIds.xml')
    ?.applyAttributeMap(['w16cid:commentId'], 'w16cid:paraId', valueMap, normalizeParaId);

  for (const file of rewriteFiles.values()) file.flush();

  return [...valueMap].map(([fromParaId, toParaId]) => ({ fromParaId, toParaId }));
}
