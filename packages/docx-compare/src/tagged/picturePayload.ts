/**
 * Picture and embedded-object payloads, compared by what they resolve to.
 *
 * A picture (`w:drawing`, `w:pict`) or embedded object (`w:object`) names
 * its image, OLE binary or chart through relationship ids. The comparison
 * reads markup, so a picture whose markup is unchanged but whose payload was
 * replaced — Word rewriting the bytes of `media/image1.png` in place, or the
 * same relationship id pointed at a new part — compares equal and would be
 * carried with no revision and no report (#1430).
 *
 * This module supplies the two halves of the fix:
 *
 * - {@link payloadSwappedRelationshipIds} finds the main-story relationships
 *   whose id and target agree on both sides but whose payload does not, so
 *   `renumberCollidingRelationshipIds` can give the original side a fresh id.
 *   The original picture's markup then differs from the revised one, the
 *   comparison tracks it as a deletion plus an insertion, and the package
 *   import copies the original payload aside under the new id.
 * - {@link auditPicturePayloads} checks every story a reader sees — the main
 *   story, each header/footer slot, the footnotes and the endnotes — after
 *   the comparison: Reject All must resolve every picture to the original's
 *   payload and Accept All to the revised's. A story where that fails (a
 *   header, footer or note story is spliced back through its owner's
 *   relationship table, which cannot hold a second payload under the same
 *   id) is listed in `unrepresentedChanges` with the picture named, instead
 *   of the swap being carried silently.
 *
 * A payload's identity is its bytes plus, recursively, the parts its own
 * relationships reach (a chart's embedded workbook). Part paths are left out
 * on purpose: the import may land the original payload under a new name, and
 * that copy is the same payload.
 *
 * @conformance ECMA-376 edition 5, Part 2 § 6.5.3.4
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.11
 * @see https://github.com/UseJunior/safe-docx/issues/1430
 */

import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { auditSectPr, OOXML, parseXml } from '@usejunior/docx-core';
import type { DocxArchive } from '@usejunior/docx-core';
import type { UnrepresentedChange, UnrepresentedPictureChange } from '../compare-types.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const W_NS = OOXML.W_NS;
const PACKAGE_RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OFFICE_VML_NS = 'urn:schemas-microsoft-com:office:office';
const VML_NS = 'urn:schemas-microsoft-com:vml';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const MAIN_DOCUMENT_PART = 'word/document.xml';
const PICTURE_CONTAINERS: ReadonlySet<string> = new Set(['drawing', 'pict', 'object']);
/** Cheap pre-check: a part with no picture container start tag has no payloads to compare. */
const PICTURE_CONTAINER_TAG = /<(?:[\w.-]+:)?(?:drawing|pict|object)[\s/>]/u;

interface Relationship {
  type: string;
  target: string;
  targetMode: string;
}

/** The OPC relationships part owning `partPath`'s relationships. */
export function relationshipsPartPath(partPath: string): string {
  const directory = posix.dirname(partPath);
  return `${directory === '.' ? '' : `${directory}/`}_rels/${posix.basename(partPath)}.rels`;
}

function resolvePartPath(ownerPartPath: string, target: string): string {
  return target.startsWith('/')
    ? posix.normalize(target).replace(/^\/+/u, '')
    : posix.normalize(posix.join(posix.dirname(ownerPartPath), target));
}

function readRelationships(xml: string | null): Map<string, Relationship> {
  const relationships = new Map<string, Relationship>();
  if (!xml) return relationships;
  for (const element of Array.from(
    parseXml(xml).getElementsByTagNameNS(PACKAGE_RELATIONSHIPS_NS, 'Relationship'),
  )) {
    const id = element.getAttribute('Id');
    if (!id) continue;
    relationships.set(id, {
      type: element.getAttribute('Type') ?? '',
      target: element.getAttribute('Target') ?? '',
      targetMode: element.getAttribute('TargetMode') ?? '',
    });
  }
  return relationships;
}

/**
 * Does this attribute hold a relationship id of its part? Every `r:*`
 * attribute does, and so does `o:relid`, which `v:imagedata` may name its
 * image by (vml-officeDrawing.xsd types it `r:ST_RelationshipId`).
 *
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.11
 */
export function isRelationshipReference(attribute: Attr): boolean {
  return attribute.namespaceURI === RELATIONSHIPS_NS
    || (attribute.namespaceURI === OFFICE_VML_NS && attribute.localName === 'relid');
}

/**
 * Payload fingerprints for one package, memoized per part so a document with
 * many pictures sharing parts hashes each part once.
 *
 * A part's local entry — its bytes and, for each of its own relationships,
 * the id, type, mode and the target's bytes — depends on nothing else and is
 * memoized. A payload fingerprint is then the sorted multiset of local
 * entries over every part reachable from the root, which is the same however
 * the walk reaches it, so relationship cycles cannot truncate it (the defect
 * a recursive per-part memo has; round-3 review of #1380).
 */
export class PayloadFingerprints {
  private readonly bytesDigests = new Map<string, Promise<string>>();
  private readonly localEntries = new Map<string, Promise<{ entry: string; next: string[] }>>();
  private readonly closures = new Map<string, Promise<string>>();
  private readonly relationshipTables = new Map<string, Promise<Map<string, Relationship>>>();

  constructor(private readonly archive: DocxArchive) {}

  /** The relationships `partPath` owns, by id. */
  relationshipsOf(partPath: string): Promise<Map<string, Relationship>> {
    let pending = this.relationshipTables.get(partPath);
    if (!pending) {
      pending = this.archive.getFile(relationshipsPartPath(partPath)).then(readRelationships);
      this.relationshipTables.set(partPath, pending);
    }
    return pending;
  }

  private bytesDigest(partPath: string): Promise<string> {
    let pending = this.bytesDigests.get(partPath);
    if (!pending) {
      pending = this.archive.getFileBuffer(partPath).then((bytes) =>
        bytes ? createHash('sha256').update(bytes).digest('hex') : 'missing');
      this.bytesDigests.set(partPath, pending);
    }
    return pending;
  }

  private localEntry(partPath: string): Promise<{ entry: string; next: string[] }> {
    let pending = this.localEntries.get(partPath);
    if (!pending) {
      pending = (async () => {
        const own = await this.bytesDigest(partPath);
        if (own === 'missing') return { entry: own, next: [] };
        const edges: string[] = [];
        const next: string[] = [];
        for (const [id, relationship] of await this.relationshipsOf(partPath)) {
          if (relationship.targetMode === 'External') {
            edges.push(`${id}|${relationship.type}|External|${relationship.target}`);
            continue;
          }
          const childPath = resolvePartPath(partPath, relationship.target);
          next.push(childPath);
          edges.push(`${id}|${relationship.type}||${await this.bytesDigest(childPath)}`);
        }
        return { entry: `${own}[${edges.sort().join(',')}]`, next };
      })();
      this.localEntries.set(partPath, pending);
    }
    return pending;
  }

  /** The payload fingerprint of the part at `partPath` and everything it reaches. */
  closureOf(partPath: string): Promise<string> {
    let pending = this.closures.get(partPath);
    if (!pending) {
      pending = (async () => {
        const reached = new Map<string, string>();
        const queue = [partPath];
        while (queue.length > 0) {
          const current = queue.pop()!;
          if (reached.has(current)) continue;
          const { entry, next } = await this.localEntry(current);
          reached.set(current, entry);
          queue.push(...next);
        }
        return createHash('sha256').update([...reached.values()].sort().join('\n')).digest('hex');
      })();
      this.closures.set(partPath, pending);
    }
    return pending;
  }

  /** What relationship `id` of `ownerPartPath` resolves to, path-independently. */
  async payloadOf(ownerPartPath: string, id: string): Promise<string> {
    const relationship = (await this.relationshipsOf(ownerPartPath)).get(id);
    if (!relationship) return 'unresolved';
    if (relationship.targetMode === 'External') {
      return `${relationship.type}|External|${relationship.target}`;
    }
    return `${relationship.type}||${await this.closureOf(resolvePartPath(ownerPartPath, relationship.target))}`;
  }
}

function isPictureContainer(element: Element): boolean {
  return element.namespaceURI === W_NS && PICTURE_CONTAINERS.has(element.localName);
}

/** One relationship reference a picture or object makes, in document order. */
interface PictureReference {
  /** The outermost picture container holding the reference. */
  container: Element;
  /** Zero-based ordinal of `container` among the outermost containers of the root. */
  containerIndex: number;
  /** The innermost picture container holding the reference: the picture itself inside a text box. */
  leaf: Element;
  relationshipId: string;
}

/**
 * Every relationship reference made from inside a picture or object, in
 * document order. A text box is itself a `w:drawing`/`w:pict`, so a picture
 * inside a box is attributed to the box's container.
 */
function pictureReferences(root: Element): PictureReference[] {
  const references: PictureReference[] = [];
  let containerIndex = -1;
  const visit = (element: Element, container: Element | undefined, leaf: Element | undefined): void => {
    let current = container;
    let innermost = leaf;
    if (isPictureContainer(element)) {
      innermost = element;
      if (!current) {
        current = element;
        containerIndex += 1;
      }
    }
    if (current && innermost) {
      for (const attribute of Array.from(element.attributes)) {
        if (!isRelationshipReference(attribute) || !attribute.value) continue;
        references.push({ container: current, containerIndex, leaf: innermost, relationshipId: attribute.value });
      }
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) visit(child as Element, current, innermost);
    }
  };
  visit(root, undefined, undefined);
  return references;
}

/**
 * Main-story relationship ids that a picture or object references on the
 * original side and that resolve to the same type and target on both sides,
 * but to different payloads. Those are the swaps markup cannot see; giving
 * the original side a fresh id for each makes them visible to the
 * comparison.
 *
 * @conformance ECMA-376 edition 5, Part 2 § 6.5.3.4
 * @see https://github.com/UseJunior/safe-docx/issues/1430
 */
export async function payloadSwappedRelationshipIds(
  originalArchive: DocxArchive,
  revisedArchive: DocxArchive,
): Promise<Set<string>> {
  const swapped = new Set<string>();
  const originalXml = await originalArchive.getDocumentXml();
  if (!PICTURE_CONTAINER_TAG.test(originalXml)) return swapped;
  const root = parseXml(originalXml).documentElement;
  if (!root) return swapped;
  const candidates = new Set(pictureReferences(root).map((reference) => reference.relationshipId));
  if (candidates.size === 0) return swapped;
  const original = new PayloadFingerprints(originalArchive);
  const revised = new PayloadFingerprints(revisedArchive);
  const [originalRelationships, revisedRelationships] = await Promise.all([
    original.relationshipsOf(MAIN_DOCUMENT_PART),
    revised.relationshipsOf(MAIN_DOCUMENT_PART),
  ]);
  for (const id of candidates) {
    const left = originalRelationships.get(id);
    const right = revisedRelationships.get(id);
    if (
      !left || !right ||
      left.targetMode === 'External' ||
      left.type !== right.type ||
      left.target !== right.target ||
      left.targetMode !== right.targetMode
    ) {
      // Absent, external or already meaning something else on the other side
      // (the collision renumbering handles the last).
      continue;
    }
    if (
      await original.payloadOf(MAIN_DOCUMENT_PART, id) !==
      await revised.payloadOf(MAIN_DOCUMENT_PART, id)
    ) {
      swapped.add(id);
    }
  }
  return swapped;
}

// =============================================================================
// Post-comparison audit
// =============================================================================

type PictureStory = UnrepresentedPictureChange['story'];

/** One story as a reader sees it in one projection of one package. */
interface ProjectedStory {
  partPath: string;
  /** Roots to read, in reading order (one per referenced note for notes). */
  roots: Element[];
  fingerprints: PayloadFingerprints;
}

interface ProjectedPicture {
  reference: PictureReference;
  payload: string;
  root: Element;
}

async function projectedPictures(story: ProjectedStory): Promise<ProjectedPicture[]> {
  const pictures: ProjectedPicture[] = [];
  let containerOffset = 0;
  for (const root of story.roots) {
    const references = pictureReferences(root);
    for (const reference of references) {
      pictures.push({
        reference: { ...reference, containerIndex: reference.containerIndex + containerOffset },
        payload: await story.fingerprints.payloadOf(story.partPath, reference.relationshipId),
        root,
      });
    }
    containerOffset += new Set(references.map((reference) => reference.container)).size;
  }
  return pictures;
}

/** A readable name for a picture: its drawing name, VML shape id or OLE ProgID. */
function pictureName(container: Element): string | undefined {
  const docPr = container.getElementsByTagNameNS(DRAWING_NS, 'docPr').item(0);
  const name = docPr?.getAttribute('name');
  if (name) return name;
  const ole = container.getElementsByTagNameNS(OFFICE_VML_NS, 'OLEObject').item(0);
  const progId = ole?.getAttribute('ProgID');
  if (progId) return progId;
  for (const element of Array.from(container.getElementsByTagNameNS(VML_NS, '*'))) {
    const id = element.getAttribute('id');
    if (id) return id;
  }
  return undefined;
}

interface StoryLocation {
  story: PictureStory;
  sectionIndex: number;
  role?: 'default' | 'first' | 'even';
}

/**
 * The pictures where `actual` (a projection of the comparison output) does
 * not resolve to the payload `expected` (the same projection of a source
 * document) resolves to. Pictures are matched by reading order; a length
 * difference reports the first divergence only, since every later position
 * would be shifted.
 */
async function payloadDivergences(
  expected: ProjectedStory,
  actual: ProjectedStory,
  projection: 'accept' | 'reject',
  location: StoryLocation,
  outputRelationships: Map<string, Relationship>,
): Promise<UnrepresentedChange[]> {
  const [expectedPictures, actualPictures] = await Promise.all([
    projectedPictures(expected),
    projectedPictures(actual),
  ]);
  const changes: UnrepresentedChange[] = [];
  const count = Math.max(expectedPictures.length, actualPictures.length);
  for (let index = 0; index < count; index++) {
    const want = expectedPictures[index];
    const got = actualPictures[index];
    if (want && got && want.payload === got.payload) continue;
    const named = got ?? want!;
    const relationshipId = named.reference.relationshipId;
    const picture: UnrepresentedPictureChange = {
      story: location.story,
      partPath: actual.partPath,
      projection,
      index: named.reference.containerIndex,
      element: named.reference.leaf.localName as UnrepresentedPictureChange['element'],
      relationshipId,
    };
    const name = pictureName(named.reference.leaf);
    if (name !== undefined) picture.name = name;
    const target = got ? outputRelationships.get(relationshipId)?.target : undefined;
    if (target !== undefined) picture.target = target;
    changes.push({
      scope: 'picture',
      kind: 'changed',
      sectionIndex: location.sectionIndex,
      ...(location.role ? { role: location.role } : {}),
      picture,
    });
    if (expectedPictures.length !== actualPictures.length) break;
  }
  return changes;
}

/** Zero-based section of `element` within a projected main story. */
function sectionIndexOf(element: Element): number {
  let topLevel: Node = element;
  while (topLevel.parentNode && !(
    topLevel.parentNode.nodeType === 1 &&
    (topLevel.parentNode as Element).namespaceURI === W_NS &&
    (topLevel.parentNode as Element).localName === 'body'
  )) {
    topLevel = topLevel.parentNode;
  }
  let sectionIndex = 0;
  for (let sibling = topLevel.previousSibling; sibling; sibling = sibling.previousSibling) {
    if (sibling.nodeType !== 1) continue;
    const paragraph = sibling as Element;
    if (paragraph.namespaceURI !== W_NS || paragraph.localName !== 'p') continue;
    for (let child = paragraph.firstChild; child; child = child.nextSibling) {
      const properties = child as Element;
      if (child.nodeType !== 1 || properties.namespaceURI !== W_NS || properties.localName !== 'pPr') continue;
      if (Array.from(properties.childNodes).some((node) =>
        node.nodeType === 1 &&
        (node as Element).namespaceURI === W_NS &&
        (node as Element).localName === 'sectPr')) {
        sectionIndex += 1;
      }
    }
  }
  return sectionIndex;
}

/** One package, with its projections memoized. */
class AuditedPackage {
  readonly fingerprints: PayloadFingerprints;
  private readonly projections = new Map<string, Promise<string | null>>();

  constructor(readonly archive: DocxArchive) {
    this.fingerprints = new PayloadFingerprints(archive);
  }

  /** `partPath` resolved by `projection`, or null when the part is absent. */
  projected(partPath: string, projection: 'accept' | 'reject'): Promise<string | null> {
    const key = `${projection}\0${partPath}`;
    let pending = this.projections.get(key);
    if (!pending) {
      pending = this.archive.getFile(partPath).then((xml) =>
        xml === null ? null : projection === 'accept' ? acceptAllChanges(xml) : rejectAllChanges(xml));
      this.projections.set(key, pending);
    }
    return pending;
  }

  async notesPartPath(kind: 'footnotes' | 'endnotes'): Promise<string | undefined> {
    for (const relationship of (await this.fingerprints.relationshipsOf(MAIN_DOCUMENT_PART)).values()) {
      if (relationship.targetMode !== 'External' && relationship.type === `${RELATIONSHIPS_NS}/${kind}`) {
        return resolvePartPath(MAIN_DOCUMENT_PART, relationship.target);
      }
    }
    return undefined;
  }
}

async function partMayHoldPictures(archive: DocxArchive, partPath: string | undefined): Promise<boolean> {
  if (partPath === undefined) return false;
  const xml = await archive.getFile(partPath);
  return xml !== null && PICTURE_CONTAINER_TAG.test(xml);
}

/**
 * Notes as a reader meets them: each note the projected main story
 * references, in reference order.
 */
async function projectedNotes(
  pkg: AuditedPackage,
  kind: 'footnote' | 'endnote',
  projection: 'accept' | 'reject',
  mainStory: Document,
): Promise<{ story: ProjectedStory; sectionIndexes: number[] } | undefined> {
  const partPath = await pkg.notesPartPath(`${kind}s`);
  if (partPath === undefined) return undefined;
  const xml = await pkg.projected(partPath, projection);
  if (xml === null) return undefined;
  const notes = new Map<string, Element>();
  for (const note of Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, kind))) {
    const id = note.getAttributeNS(W_NS, 'id') || note.getAttribute('w:id');
    if (id) notes.set(id, note);
  }
  const roots: Element[] = [];
  const sectionIndexes: number[] = [];
  for (const reference of Array.from(mainStory.getElementsByTagNameNS(W_NS, `${kind}Reference`))) {
    const note = notes.get(reference.getAttributeNS(W_NS, 'id') || reference.getAttribute('w:id') || '');
    if (!note) continue;
    roots.push(note);
    sectionIndexes.push(sectionIndexOf(reference));
  }
  return { story: { partPath, roots, fingerprints: pkg.fingerprints }, sectionIndexes };
}

/**
 * Check that every picture and object a reader sees after Reject All resolves
 * to the original's payload, and after Accept All to the revised's, in the
 * main story, every header/footer slot, the footnotes and the endnotes.
 * Each picture that does not is returned as an `unrepresentedChanges` entry
 * naming its story and the picture.
 *
 * A header/footer slot already listed as a changed, added or removed story is
 * skipped: the whole story is reported, and its pictures with it.
 *
 * @conformance ECMA-376 edition 5, Part 2 § 6.5.3.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.10
 * @see https://github.com/UseJunior/safe-docx/issues/1430
 */
export async function auditPicturePayloads(
  originalArchive: DocxArchive,
  revisedArchive: DocxArchive,
  outputArchive: DocxArchive,
  reportedChanges: readonly UnrepresentedChange[] = [],
): Promise<UnrepresentedChange[]> {
  const original = new AuditedPackage(originalArchive);
  const revised = new AuditedPackage(revisedArchive);
  const output = new AuditedPackage(outputArchive);
  const [originalNotes, revisedNotes] = await Promise.all([
    Promise.all([original.notesPartPath('footnotes'), original.notesPartPath('endnotes')]),
    Promise.all([revised.notesPartPath('footnotes'), revised.notesPartPath('endnotes')]),
  ]);
  const candidateParts: Array<[DocxArchive, string | undefined]> = [
    [originalArchive, MAIN_DOCUMENT_PART],
    [revisedArchive, MAIN_DOCUMENT_PART],
    ...originalNotes.map((path) => [originalArchive, path] as [DocxArchive, string | undefined]),
    ...revisedNotes.map((path) => [revisedArchive, path] as [DocxArchive, string | undefined]),
  ];
  for (const [archive, relationships] of [
    [originalArchive, await original.fingerprints.relationshipsOf(MAIN_DOCUMENT_PART)],
    [revisedArchive, await revised.fingerprints.relationshipsOf(MAIN_DOCUMENT_PART)],
  ] as const) {
    for (const relationship of relationships.values()) {
      if (
        relationship.targetMode !== 'External' &&
        (relationship.type === `${RELATIONSHIPS_NS}/header` ||
          relationship.type === `${RELATIONSHIPS_NS}/footer`)
      ) {
        candidateParts.push([archive, resolvePartPath(MAIN_DOCUMENT_PART, relationship.target)]);
      }
    }
  }
  // Nearly every document has no picture anywhere; skip the projections then.
  const holdsPictures = await Promise.all(
    candidateParts.map(([archive, path]) => partMayHoldPictures(archive, path)),
  );
  if (!holdsPictures.some(Boolean)) return [];

  const changes: UnrepresentedChange[] = [];
  const outputRelationships = (partPath: string) => output.fingerprints.relationshipsOf(partPath);
  for (const projection of ['reject', 'accept'] as const) {
    const source = projection === 'reject' ? original : revised;
    const [sourceXml, outputXml] = await Promise.all([
      source.projected(MAIN_DOCUMENT_PART, projection),
      output.projected(MAIN_DOCUMENT_PART, projection),
    ]);
    if (sourceXml === null || outputXml === null) continue;
    const sourceMain = parseXml(sourceXml);
    const outputMain = parseXml(outputXml);

    // The main story, section by section of the output projection.
    const mainChanges = await payloadDivergences(
      { partPath: MAIN_DOCUMENT_PART, roots: [sourceMain.documentElement!], fingerprints: source.fingerprints },
      { partPath: MAIN_DOCUMENT_PART, roots: [outputMain.documentElement!], fingerprints: output.fingerprints },
      projection,
      { story: 'body', sectionIndex: 0 },
      await outputRelationships(MAIN_DOCUMENT_PART),
    );
    for (const change of mainChanges) {
      const container = pictureReferences(outputMain.documentElement!)
        .find((reference) => reference.containerIndex === change.picture!.index)?.container;
      if (container) change.sectionIndex = sectionIndexOf(container);
    }
    changes.push(...mainChanges);

    // Header and footer slots, paired by section, kind and role.
    const [sourceRelationshipsXml, outputRelationshipsXml] = await Promise.all([
      source.archive.getFile(relationshipsPartPath(MAIN_DOCUMENT_PART)),
      output.archive.getFile(relationshipsPartPath(MAIN_DOCUMENT_PART)),
    ]);
    const sourceSlots = new Map(
      auditSectPr(sourceXml, sourceRelationshipsXml).bindings.map((binding) =>
        [`${binding.sectionOrdinal}|${binding.kind}|${binding.role}`, binding.targetPath]),
    );
    for (const binding of auditSectPr(outputXml, outputRelationshipsXml).bindings) {
      const sourcePath = sourceSlots.get(`${binding.sectionOrdinal}|${binding.kind}|${binding.role}`);
      if (sourcePath === undefined) continue;
      const alreadyListed = reportedChanges.some((change) =>
        change.scope === binding.kind &&
        change.sectionIndex === binding.sectionOrdinal &&
        change.role === binding.role);
      if (alreadyListed) continue;
      if (
        !(await partMayHoldPictures(source.archive, sourcePath)) &&
        !(await partMayHoldPictures(output.archive, binding.targetPath))
      ) {
        continue;
      }
      const [sourceStoryXml, outputStoryXml] = await Promise.all([
        source.projected(sourcePath, projection),
        output.projected(binding.targetPath, projection),
      ]);
      if (sourceStoryXml === null || outputStoryXml === null) continue;
      changes.push(...await payloadDivergences(
        { partPath: sourcePath, roots: [parseXml(sourceStoryXml).documentElement!], fingerprints: source.fingerprints },
        { partPath: binding.targetPath, roots: [parseXml(outputStoryXml).documentElement!], fingerprints: output.fingerprints },
        projection,
        { story: binding.kind, sectionIndex: binding.sectionOrdinal, role: binding.role },
        await outputRelationships(binding.targetPath),
      ));
    }

    // Notes, in the order the projected main story references them.
    for (const kind of ['footnote', 'endnote'] as const) {
      const [sourceNotes, outputNotes] = await Promise.all([
        projectedNotes(source, kind, projection, sourceMain),
        projectedNotes(output, kind, projection, outputMain),
      ]);
      if (!sourceNotes || !outputNotes) continue;
      const noteChanges = await payloadDivergences(
        sourceNotes.story,
        outputNotes.story,
        projection,
        { story: kind, sectionIndex: 0 },
        await outputRelationships(outputNotes.story.partPath),
      );
      const pictures = await projectedPictures(outputNotes.story);
      for (const change of noteChanges) {
        const picture = pictures.find((candidate) =>
          candidate.reference.containerIndex === change.picture!.index);
        const noteIndex = picture ? outputNotes.story.roots.indexOf(picture.root) : -1;
        if (noteIndex >= 0) change.sectionIndex = outputNotes.sectionIndexes[noteIndex] ?? 0;
      }
      changes.push(...noteChanges);
    }
  }

  // A picture wrong in both projections is one change, not two.
  const seen = new Set<string>();
  return changes.filter((change) => {
    const picture = change.picture!;
    const key = [picture.story, picture.partPath, change.sectionIndex, picture.relationshipId, picture.name ?? ''].join('\0');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
