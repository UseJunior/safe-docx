/**
 * Give both documents an explicit header/footer reference wherever only one
 * of them has one, before the comparison runs.
 *
 * A section that names no header or footer of a type still shows one: the
 * story the previous section shows for that type, or, in the first section, a
 * blank story (ECMA-376 Part 1 §17.10.5 for headers, §17.10.2 for footers;
 * `effectiveStoryBindings.ts`). Attaching a footer to an existing section,
 * dropping one, or pointing a section at its own part where it used to
 * inherit, therefore changes what the section shows without adding or
 * removing a section. Section-reference markup cannot carry that change:
 * `w:sectPrChange` holds a `CT_SectPrBase`, which has no
 * `w:headerReference`/`w:footerReference` (§17.13.5.32, #944).
 *
 * The change is represented as content instead. Where section `k` of one
 * document names a part for a kind and role and section `k` of the other
 * names none, the other document gets a reference there too, to a new part
 * holding exactly what that section already showed: a copy of the inherited
 * part, or a blank story (one empty paragraph). That document shows the same
 * pages as before, so the comparison still compares the caller's documents,
 * but both now select a story in the slot and the slot's two stories pair
 * like any edited header or footer: the redline tracks the shown text as
 * inserted, deleted or replaced, Reject All shows the original's story there
 * and Accept All the revised document's.
 *
 * The published redline keeps the added reference when it was added to the
 * revised document (a footer the revision dropped). Accept All then selects a
 * blank story, or a copy of the inherited one, where the revised document
 * names nothing; a reader shows the same thing in both cases.
 *
 * A story paired with an added blank story is tracked as a whole insertion
 * or deletion (`slotLifecycleStoryInput` in `textBoxRevisionSafety.ts`).
 *
 * Only documents with the same number of sections are normalized, so section
 * `k` is the same position in both. Sections whose `w:sectPr` rides on a
 * tracked paragraph mark, or carries a `w:sectPrChange`, are left alone: their
 * references are not the ones a reader shows on both projections. So are
 * slots that show the same part on both sides (a reference allocation) and
 * slots whose display switch (`w:titlePg`, `w:evenAndOddHeaders`) differs,
 * whose pages the section-aligned pairing redlines (#1390).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @see https://github.com/UseJunior/safe-docx/issues/1394
 * @see https://github.com/UseJunior/safe-docx/issues/944
 */

import { posix } from 'node:path';
import { XMLSerializer } from '@xmldom/xmldom';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import {
  effectiveStorySlot,
  resolveEffectiveStoryBindings,
  STORY_KINDS,
  STORY_ROLES,
  type EffectiveStoryBindings,
  type StoryKind,
  type StoryRole,
} from './effectiveStoryBindings.js';
import { owningRelationshipsPath } from './storyRelationshipIdentity.js';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const DOCUMENT_RELATIONSHIPS_PATH = 'word/_rels/document.xml.rels';
const CONTENT_TYPES_PATH = '[Content_Types].xml';
const SETTINGS_RELATIONSHIP = `${R_NS}/settings`;

const STORY_RELATIONSHIP: Record<StoryKind, string> = {
  header: `${R_NS}/header`,
  footer: `${R_NS}/footer`,
};
const STORY_CONTENT_TYPE: Record<StoryKind, string> = {
  header: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  footer: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
};
const STORY_ROOT: Record<StoryKind, string> = { header: 'hdr', footer: 'ftr' };
const STORY_REFERENCE: Record<StoryKind, string> = {
  header: 'headerReference',
  footer: 'footerReference',
};

/** One slot given an explicit reference on one side. */
export interface NormalizedStorySlot {
  side: 'original' | 'revised';
  sectionOrdinal: number;
  kind: StoryKind;
  role: StoryRole;
  /** The new part. */
  partPath: string;
  /** The part copied into it; `undefined` when the slot showed a blank story. */
  copiedFrom: string | undefined;
}

export interface StorySlotNormalization {
  original: Buffer;
  revised: Buffer;
  slots: NormalizedStorySlot[];
}

interface SideState {
  archive: DocxArchive;
  document: Document;
  sections: Element[];
  relationships: Document;
  bindings: EffectiveStoryBindings;
}

const serializer = new XMLSerializer();

function isW(node: Node | null | undefined, localName: string): node is Element {
  return !!node && node.nodeType === 1 &&
    (node as Element).namespaceURI === OOXML.W_NS &&
    (node as Element).localName === localName;
}

function liveSections(document: Document): Element[] {
  return Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'sectPr')).filter((sectPr) => {
    for (let ancestor = sectPr.parentNode; ancestor; ancestor = ancestor.parentNode) {
      if (isW(ancestor, 'sectPrChange')) return false;
    }
    return true;
  });
}

/** Whether a section's references are not the same on both projections. */
function hasTrackedSectionHistory(sectPr: Element): boolean {
  for (let node = sectPr.firstChild; node; node = node.nextSibling) {
    if (isW(node, 'sectPrChange')) return true;
  }
  const pPr = sectPr.parentNode;
  if (!isW(pPr, 'pPr')) return false;
  for (let node = pPr.firstChild; node; node = node.nextSibling) {
    if (!isW(node, 'rPr')) continue;
    for (let mark = node.firstChild; mark; mark = mark.nextSibling) {
      if (isW(mark, 'ins') || isW(mark, 'del') || isW(mark, 'moveFrom') || isW(mark, 'moveTo')) return true;
    }
  }
  return false;
}

async function settingsXml(archive: DocxArchive, relationships: Document): Promise<string | null> {
  const relationship = Array.from(
    relationships.getElementsByTagNameNS(PACKAGE_RELATIONSHIPS_NS, 'Relationship'),
  ).find((element) => element.getAttribute('Type') === SETTINGS_RELATIONSHIP);
  const target = relationship?.getAttribute('Target');
  const path = target ? posix.normalize(posix.join('word', target)).replace(/^\/+/u, '') : 'word/settings.xml';
  return archive.getFile(path);
}

async function sideState(buffer: Buffer): Promise<SideState | undefined> {
  const archive = await DocxArchive.load(buffer);
  const documentXml = await archive.getDocumentXml();
  // A package with no document relationships binds no story; it gets an
  // empty table the added reference can go into.
  const relationshipsXml = await archive.getFile(DOCUMENT_RELATIONSHIPS_PATH) ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`;
  const relationships = parseXml(relationshipsXml);
  const bindings = resolveEffectiveStoryBindings({
    documentXml,
    relationshipsXml,
    settingsXml: await settingsXml(archive, relationships),
  });
  if (!bindings.ok) return undefined;
  const document = parseXml(documentXml);
  const sections = liveSections(document);
  if (sections.length !== bindings.sectionCount) return undefined;
  return { archive, document, sections, relationships, bindings };
}

/**
 * The blank story a section with no reference shows (§17.10.5, §17.10.2): one
 * empty paragraph, under the root of the story the other document selects in
 * the slot, so its namespace declarations (and `mc:Ignorable`) are in place
 * for that story's content when the redline writes it here.
 */
function blankStoryXml(kind: StoryKind, counterpartXml: string | null): string {
  if (counterpartXml !== null) {
    try {
      const document = parseXml(counterpartXml);
      const root = document.documentElement;
      if (root && isW(root, STORY_ROOT[kind])) {
        while (root.firstChild) root.removeChild(root.firstChild);
        const prefix = root.lookupPrefix(OOXML.W_NS) ?? 'w';
        root.appendChild(document.createElementNS(OOXML.W_NS, `${prefix}:p`));
        return serializer.serializeToString(document);
      }
    } catch {
      // Fall back to a bare blank story.
    }
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:${STORY_ROOT[kind]} xmlns:w="${OOXML.W_NS}"><w:p/></w:${STORY_ROOT[kind]}>`
  );
}

/**
 * A copy of an inherited part. Its `w14:paraId`/`w14:textId` stamps are
 * dropped, so the copy does not repeat the paragraph identities of the part
 * it was copied from in the same package.
 */
function copiedStoryXml(xml: string): string {
  const document = parseXml(xml);
  for (const element of Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'p'))) {
    element.removeAttributeNS(W14_NS, 'paraId');
    element.removeAttributeNS(W14_NS, 'textId');
  }
  return serializer.serializeToString(document);
}

function relationshipIds(document: Document): Set<string> {
  return new Set(
    Array.from(document.getElementsByTagNameNS(PACKAGE_RELATIONSHIPS_NS, 'Relationship'))
      .map((element) => element.getAttribute('Id') ?? ''),
  );
}

/** Insert a reference where CT_SectPr wants it: after the leading references. */
function insertStoryReference(
  sectPr: Element,
  kind: StoryKind,
  role: StoryRole,
  relationshipId: string,
): void {
  const document = sectPr.ownerDocument!;
  const prefix = sectPr.lookupPrefix(OOXML.W_NS) ?? 'w';
  const reference = document.createElementNS(OOXML.W_NS, `${prefix}:${STORY_REFERENCE[kind]}`);
  reference.setAttributeNS(OOXML.W_NS, `${prefix}:type`, role);
  const relationshipPrefix = sectPr.lookupPrefix(R_NS);
  if (relationshipPrefix) {
    reference.setAttributeNS(R_NS, `${relationshipPrefix}:id`, relationshipId);
  } else {
    reference.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:r', R_NS);
    reference.setAttributeNS(R_NS, 'r:id', relationshipId);
  }
  let before: Node | null = sectPr.firstChild;
  while (
    before &&
    (before.nodeType !== 1 || isW(before, 'headerReference') || isW(before, 'footerReference'))
  ) {
    before = before.nextSibling;
  }
  sectPr.insertBefore(reference, before);
}

function addContentTypeOverride(contentTypesXml: string, partPath: string, kind: StoryKind): string {
  const document = parseXml(contentTypesXml);
  const override = document.createElementNS(CONTENT_TYPES_NS, 'Override');
  override.setAttribute('PartName', `/${partPath}`);
  override.setAttribute('ContentType', STORY_CONTENT_TYPE[kind]);
  document.documentElement!.appendChild(override);
  return serializer.serializeToString(document);
}

/**
 * Add, on each side, an explicit reference for every slot that only the
 * other side names, to a part showing what the slot already showed. Returns
 * the inputs unchanged when nothing needs it or the documents cannot be
 * aligned by section position.
 */
export async function normalizeExplicitStorySlots(
  original: Buffer,
  revised: Buffer,
): Promise<StorySlotNormalization> {
  try {
    return await normalizeReadableStorySlots(original, revised);
  } catch {
    // An input this pass cannot read is left as it is, so the comparison
    // reports it with its own typed error.
    return { original, revised, slots: [] };
  }
}

async function normalizeReadableStorySlots(
  original: Buffer,
  revised: Buffer,
): Promise<StorySlotNormalization> {
  const unchanged: StorySlotNormalization = { original, revised, slots: [] };
  const [originalState, revisedState] = await Promise.all([sideState(original), sideState(revised)]);
  if (!originalState || !revisedState) return unchanged;
  if (originalState.bindings.sectionCount !== revisedState.bindings.sectionCount) return unchanged;

  const pending: Array<{
    side: 'original' | 'revised';
    sectionOrdinal: number;
    kind: StoryKind;
    role: StoryRole;
    source: string | undefined;
    counterpart: string | undefined;
  }> = [];
  for (let sectionOrdinal = 0; sectionOrdinal < originalState.bindings.sectionCount; sectionOrdinal += 1) {
    if (
      hasTrackedSectionHistory(originalState.sections[sectionOrdinal]!) ||
      hasTrackedSectionHistory(revisedState.sections[sectionOrdinal]!)
    ) {
      continue;
    }
    for (const kind of STORY_KINDS) {
      for (const role of STORY_ROLES) {
        const left = effectiveStorySlot(originalState.bindings, { sectionOrdinal, kind, role })!;
        const right = effectiveStorySlot(revisedState.bindings, { sectionOrdinal, kind, role })!;
        // The same part on both sides is a reference allocation, not a
        // change in what the slot shows; it is left to the story pairing.
        if (left.targetPath === right.targetPath) continue;
        // Where a display switch (w:titlePg, w:evenAndOddHeaders) differs,
        // the slot's pages show another role's story on one side; the
        // section-aligned pairing redlines what those pages showed (#1390).
        if (left.displayed !== right.displayed) continue;
        if (left.explicit && !right.explicit) {
          pending.push({ side: 'revised', sectionOrdinal, kind, role, source: right.targetPath, counterpart: left.targetPath });
        } else if (!left.explicit && right.explicit) {
          pending.push({ side: 'original', sectionOrdinal, kind, role, source: left.targetPath, counterpart: right.targetPath });
        }
      }
    }
  }
  if (pending.length === 0) return unchanged;

  // New part names and relationship ids are free in both packages, so the
  // comparison's own collision planning never has to move them.
  const takenPaths = new Set([
    ...originalState.archive.listFiles(),
    ...revisedState.archive.listFiles(),
  ].map((path) => path.toLowerCase()));
  const takenIds = new Set([
    ...relationshipIds(originalState.relationships),
    ...relationshipIds(revisedState.relationships),
  ]);
  const allocatePath = (kind: StoryKind): string => {
    for (let index = 1; ; index += 1) {
      const path = `word/${kind}${index}.xml`;
      if (!takenPaths.has(path.toLowerCase())) {
        takenPaths.add(path.toLowerCase());
        return path;
      }
    }
  };
  const allocateId = (): string => {
    for (let index = 1; ; index += 1) {
      const id = `rIdSlot${index}`;
      if (!takenIds.has(id)) {
        takenIds.add(id);
        return id;
      }
    }
  };

  const slots: NormalizedStorySlot[] = [];
  for (const slot of pending) {
    const state = slot.side === 'original' ? originalState : revisedState;
    const partPath = allocatePath(slot.kind);
    const relationshipId = allocateId();
    const otherArchive = slot.side === 'original' ? revisedState.archive : originalState.archive;
    let partXml = blankStoryXml(
      slot.kind,
      slot.counterpart === undefined ? null : await otherArchive.getFile(slot.counterpart),
    );
    if (slot.source !== undefined) {
      const sourceXml = await state.archive.getFile(slot.source);
      if (sourceXml === null) return unchanged;
      partXml = copiedStoryXml(sourceXml);
      const sourceRelationships = await state.archive.getFile(owningRelationshipsPath(slot.source));
      // Same folder, so the copied relationships resolve to the same targets.
      if (sourceRelationships !== null && posix.dirname(slot.source) === posix.dirname(partPath)) {
        state.archive.setFile(owningRelationshipsPath(partPath), sourceRelationships);
      } else if (sourceRelationships !== null) {
        return unchanged;
      }
    }
    state.archive.setFile(partPath, partXml);
    const relationship = state.relationships.createElementNS(PACKAGE_RELATIONSHIPS_NS, 'Relationship');
    relationship.setAttribute('Id', relationshipId);
    relationship.setAttribute('Type', STORY_RELATIONSHIP[slot.kind]);
    relationship.setAttribute('Target', posix.relative('word', partPath));
    state.relationships.documentElement!.appendChild(relationship);
    const contentTypesXml = await state.archive.getFile(CONTENT_TYPES_PATH);
    if (contentTypesXml === null) return unchanged;
    state.archive.setFile(CONTENT_TYPES_PATH, addContentTypeOverride(contentTypesXml, partPath, slot.kind));
    insertStoryReference(state.sections[slot.sectionOrdinal]!, slot.kind, slot.role, relationshipId);
    slots.push({
      side: slot.side,
      sectionOrdinal: slot.sectionOrdinal,
      kind: slot.kind,
      role: slot.role,
      partPath,
      copiedFrom: slot.source,
    });
  }

  const finish = async (state: SideState, input: Buffer, side: 'original' | 'revised'): Promise<Buffer> => {
    if (!slots.some((slot) => slot.side === side)) return input;
    state.archive.setDocumentXml(serializer.serializeToString(state.document));
    state.archive.setFile(DOCUMENT_RELATIONSHIPS_PATH, serializer.serializeToString(state.relationships));
    return state.archive.save();
  };
  return {
    original: await finish(originalState, original, 'original'),
    revised: await finish(revisedState, revised, 'revised'),
    slots,
  };
}
