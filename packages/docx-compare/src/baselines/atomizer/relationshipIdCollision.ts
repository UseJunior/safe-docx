/**
 * Relationship ID Collision Resolution and Import
 *
 * Relationship IDs (`r:id`, `r:embed`, ... — OPC `Relationship/@Id`) are
 * *part-local*: two independently authored documents both number their
 * `word/_rels/document.xml.rels` entries from `rId1`, and the same `rId9`
 * routinely means an image in one document and a header in the other.
 *
 * The comparison output is a clone of one side's package carrying a merged
 * `document.xml` built from *both* sides. Every `r:id` that originated on the
 * non-base side is therefore resolved against the wrong relationship table: it
 * either dangles or, worse, silently resolves to an unrelated part of the wrong
 * type (observed: `w:headerReference` bound to an image relationship).
 *
 * This mirrors the strategy `auxiliaryIdCollision.ts` already established for
 * comment/footnote/endnote `w:id`: renumber one side *before* comparison rather
 * than detect-and-flag, because failing closed would reject any comparison of
 * two independently authored documents — the core use case. Renumbering
 * pre-comparison is what makes it tractable at all: after reconstruction the
 * merged `document.xml` no longer records which side each reference came from,
 * so a colliding id can no longer be attributed to its owner.
 *
 * Two steps, both required:
 *
 * 1. {@link renumberCollidingRelationshipIds} makes the two id spaces disjoint
 *    before anything reads `document.xml`, so a merged reference is never
 *    ambiguous.
 * 2. {@link importReferencedRelationships} runs at package assembly and pulls
 *    every relationship the merged document still references but the base
 *    package lacks, copying target parts (and their own transitive
 *    relationships) and registering content types.
 *
 * IDs that resolve to the same type, target, and mode on both sides are left
 * alone so unchanged references stay byte-stable.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/107 (auxiliary-id precedent)
 * @see https://github.com/UseJunior/safe-docx/issues/582
 */

import { posix } from 'node:path';
import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml } from '@usejunior/docx-core';
import type { DocxArchive } from '@usejunior/docx-core';

const serializer = new XMLSerializer();

const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const CONTENT_TYPES_PATH = '[Content_Types].xml';
const DOCUMENT_PART = 'word/document.xml';

interface RelationshipEntry {
  id: string;
  type: string;
  target: string;
  targetMode: string | null;
}

/** A relationship id rewritten on the merge-source side to clear a collision. */
export interface RenumberedRelationshipId {
  previousId: string;
  nextId: string;
  type: string;
}

function relsPathFor(partPath: string): string {
  const directory = posix.dirname(partPath);
  return `${directory === '.' ? '' : `${directory}/`}_rels/${posix.basename(partPath)}.rels`;
}

/** Resolve an OPC relationship target against its owning part's directory. */
function resolveTarget(ownerPart: string, target: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return target;
  const base = posix.dirname(ownerPart);
  return posix.normalize(posix.join(base === '.' ? '' : base, target)).replace(/^\/+/, '');
}

async function readRelationships(
  archive: DocxArchive,
  partPath: string,
): Promise<Map<string, RelationshipEntry>> {
  const xml = await archive.getFile(relsPathFor(partPath));
  const entries = new Map<string, RelationshipEntry>();
  if (!xml) return entries;
  const document = parseXml(xml);
  for (const element of Array.from(
    document.getElementsByTagNameNS(PACKAGE_REL_NS, 'Relationship'),
  )) {
    const id = element.getAttribute('Id');
    const type = element.getAttribute('Type');
    if (!id || !type) continue;
    entries.set(id, {
      id,
      type,
      target: element.getAttribute('Target') ?? '',
      targetMode: element.hasAttribute('TargetMode') ? element.getAttribute('TargetMode') : null,
    });
  }
  return entries;
}

/** Two entries are interchangeable when type, target, and mode all agree. */
function sameRelationship(left: RelationshipEntry, right: RelationshipEntry): boolean {
  return (
    left.type === right.type &&
    left.target === right.target &&
    left.targetMode === right.targetMode
  );
}

/** Rewrite every relationship-namespace attribute value through `mapping`. */
function remapRelationshipAttributes(root: Element, mapping: ReadonlyMap<string, string>): number {
  let rewrites = 0;
  const visit = (element: Element): void => {
    for (let i = 0; i < element.attributes.length; i++) {
      const attribute = element.attributes.item(i)!;
      if (attribute.namespaceURI !== OFFICE_REL_NS) continue;
      const next = mapping.get(attribute.value);
      if (next === undefined) continue;
      attribute.value = next;
      rewrites++;
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) visit(child as Element);
    }
  };
  visit(root);
  return rewrites;
}

/**
 * Give `rewriteArchive` a relationship id space disjoint from `againstArchive`'s.
 *
 * Only ids that mean *different things* on the two sides are rewritten; an id
 * resolving identically on both is left in place so unchanged references stay
 * byte-stable. Runs before any `document.xml` extraction so every downstream
 * step sees the rewritten archive.
 *
 * Which side to rewrite is not arbitrary: the output package is a clone of the
 * base side, so rewriting the base would renumber the very table the result
 * inherits, churning ids for no benefit. Always pass the side that will be the
 * *merge source* -- the original for in-place output, the revised for rebuild,
 * since each mode clones the opposite package.
 */
export async function renumberCollidingRelationshipIds(
  rewriteArchive: DocxArchive,
  againstArchive: DocxArchive,
): Promise<RenumberedRelationshipId[]> {
  const againstRels = await readRelationships(againstArchive, DOCUMENT_PART);
  const rewriteRels = await readRelationships(rewriteArchive, DOCUMENT_PART);
  if (againstRels.size === 0 || rewriteRels.size === 0) return [];

  const taken = new Set<string>([...againstRels.keys(), ...rewriteRels.keys()]);
  let nextOrdinal = 1;
  const allocateId = (): string => {
    let candidate = `rId${nextOrdinal++}`;
    while (taken.has(candidate)) candidate = `rId${nextOrdinal++}`;
    taken.add(candidate);
    return candidate;
  };

  const renumbered: RenumberedRelationshipId[] = [];
  const mapping = new Map<string, string>();
  for (const [id, entry] of rewriteRels) {
    const counterpart = againstRels.get(id);
    if (!counterpart || sameRelationship(counterpart, entry)) continue;
    const nextId = allocateId();
    mapping.set(id, nextId);
    renumbered.push({ previousId: id, nextId, type: entry.type });
  }
  if (mapping.size === 0) return [];

  // Rewrite the relationship table on the side being renumbered.
  const relsPath = relsPathFor(DOCUMENT_PART);
  const relsXml = await rewriteArchive.getFile(relsPath);
  if (relsXml) {
    const relsDoc = parseXml(relsXml);
    for (const element of Array.from(
      relsDoc.getElementsByTagNameNS(PACKAGE_REL_NS, 'Relationship'),
    )) {
      const id = element.getAttribute('Id');
      const next = id ? mapping.get(id) : undefined;
      if (next) element.setAttribute('Id', next);
    }
    rewriteArchive.setFile(relsPath, serializer.serializeToString(relsDoc));
  }

  // Rewrite every reference in that side's main story.
  const documentXml = await rewriteArchive.getDocumentXml();
  const documentDoc = parseXml(documentXml);
  if (documentDoc.documentElement) {
    remapRelationshipAttributes(documentDoc.documentElement, mapping);
    rewriteArchive.setDocumentXml(serializer.serializeToString(documentDoc));
  }

  return renumbered;
}

/** Register a content type for a copied part, carrying the source override. */
async function ensureContentType(
  sourceArchive: DocxArchive,
  resultArchive: DocxArchive,
  partPath: string,
  registerAs: string = partPath,
): Promise<void> {
  const resultXml = await resultArchive.getFile(CONTENT_TYPES_PATH);
  if (!resultXml) return;
  const resultDoc = parseXml(resultXml);
  const partName = `/${registerAs}`;
  const overrides = Array.from(resultDoc.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Override'));
  if (overrides.some((element) => element.getAttribute('PartName') === partName)) return;

  const sourceXml = await sourceArchive.getFile(CONTENT_TYPES_PATH);
  if (!sourceXml) return;
  const sourceDoc = parseXml(sourceXml);
  const sourceOverride = Array.from(
    sourceDoc.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Override'),
  ).find((element) => element.getAttribute('PartName') === `/${partPath}`);

  if (sourceOverride) {
    const element = resultDoc.createElementNS(CONTENT_TYPES_NS, 'Override');
    element.setAttribute('PartName', partName);
    element.setAttribute('ContentType', sourceOverride.getAttribute('ContentType') ?? '');
    resultDoc.documentElement?.appendChild(element);
    resultArchive.setFile(CONTENT_TYPES_PATH, serializer.serializeToString(resultDoc));
    return;
  }

  // No override: the part is typed by extension, so carry the Default across.
  const extension = posix.extname(registerAs).replace(/^\./, '').toLowerCase();
  if (!extension) return;
  const defaults = Array.from(resultDoc.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Default'));
  if (defaults.some((element) => element.getAttribute('Extension')?.toLowerCase() === extension)) {
    return;
  }
  const sourceDefault = Array.from(
    sourceDoc.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Default'),
  ).find((element) => element.getAttribute('Extension')?.toLowerCase() === extension);
  if (!sourceDefault) return;
  const element = resultDoc.createElementNS(CONTENT_TYPES_NS, 'Default');
  element.setAttribute('Extension', extension);
  element.setAttribute('ContentType', sourceDefault.getAttribute('ContentType') ?? '');
  resultDoc.documentElement?.insertBefore(element, resultDoc.documentElement.firstChild);
  resultArchive.setFile(CONTENT_TYPES_PATH, serializer.serializeToString(resultDoc));
}

/** Pick a package part path that is free in `resultArchive`. */
function allocatePartPath(resultArchive: DocxArchive, partPath: string): string {
  const extension = posix.extname(partPath);
  const stem = partPath.slice(0, partPath.length - extension.length);
  for (let ordinal = 1; ; ordinal++) {
    const candidate = `${stem}_merged${ordinal}${extension}`;
    if (!resultArchive.hasFile(candidate)) return candidate;
  }
}

/**
 * Copy a part and, transitively, every part its own relationships reach.
 *
 * Returns the path the part actually landed on. The two packages number their
 * parts independently, so the source's `word/header7.xml` and the base's are
 * routinely unrelated documents under one name. Reusing an occupied path
 * because the name matches would bind the imported relationship to the base's
 * content -- the same silent mis-binding this module exists to prevent -- so a
 * conflicting name is copied aside and the caller retargets to the new path.
 */
async function copyPartClosure(
  sourceArchive: DocxArchive,
  resultArchive: DocxArchive,
  partPath: string,
  copiedAs: Map<string, string>,
): Promise<string> {
  const already = copiedAs.get(partPath);
  if (already !== undefined) return already;

  const bytes = await sourceArchive.getFileBuffer(partPath);
  if (!bytes) {
    copiedAs.set(partPath, partPath);
    return partPath;
  }

  let targetPath = partPath;
  const existing = resultArchive.hasFile(partPath)
    ? await resultArchive.getFileBuffer(partPath)
    : null;
  if (existing === null) {
    resultArchive.setFile(partPath, bytes);
    await ensureContentType(sourceArchive, resultArchive, partPath);
  } else if (!existing.equals(bytes)) {
    targetPath = allocatePartPath(resultArchive, partPath);
    resultArchive.setFile(targetPath, bytes);
    await ensureContentType(sourceArchive, resultArchive, partPath, targetPath);
  }
  // Identical bytes: the base already carries this exact part, so reuse it.
  copiedAs.set(partPath, targetPath);

  const nested = await readRelationships(sourceArchive, partPath);
  if (nested.size === 0) return targetPath;

  // Recurse first: a nested target may itself be copied aside, and this part's
  // own rels must then point at wherever it actually landed.
  const nestedRewrites = new Map<string, string>();
  for (const entry of nested.values()) {
    if (entry.targetMode === 'External') continue;
    const sourceTarget = resolveTarget(partPath, entry.target);
    const landedTarget = await copyPartClosure(
      sourceArchive,
      resultArchive,
      sourceTarget,
      copiedAs,
    );
    if (landedTarget !== sourceTarget) {
      nestedRewrites.set(entry.id, posix.relative(posix.dirname(targetPath), landedTarget));
    }
  }

  const nestedRelsPath = relsPathFor(targetPath);
  if (!resultArchive.hasFile(nestedRelsPath)) {
    const nestedRelsXml = await sourceArchive.getFile(relsPathFor(partPath));
    if (nestedRelsXml) {
      if (nestedRewrites.size === 0) {
        resultArchive.setFile(nestedRelsPath, nestedRelsXml);
      } else {
        const relsDoc = parseXml(nestedRelsXml);
        for (const element of Array.from(
          relsDoc.getElementsByTagNameNS(PACKAGE_REL_NS, 'Relationship'),
        )) {
          const rewritten = nestedRewrites.get(element.getAttribute('Id') ?? '');
          if (rewritten) element.setAttribute('Target', rewritten);
        }
        resultArchive.setFile(nestedRelsPath, serializer.serializeToString(relsDoc));
      }
    }
  }
  return targetPath;
}

export interface ImportedRelationship {
  id: string;
  type: string;
  target: string;
}

/**
 * Pull every relationship the merged document references but the base package
 * lacks, copying target parts and registering their content types.
 *
 * The merged `document.xml` carries references from both sides, but the result
 * archive is a clone of one side only. Without this import, a reference that
 * originated on the other side dangles.
 */
export async function importReferencedRelationships(
  mergeSourceArchive: DocxArchive,
  resultArchive: DocxArchive,
  mergedDocumentXml: string,
): Promise<ImportedRelationship[]> {
  const document = parseXml(mergedDocumentXml);
  const root = document.documentElement;
  if (!root) return [];

  const referenced = new Set<string>();
  const collect = (element: Element): void => {
    for (let i = 0; i < element.attributes.length; i++) {
      const attribute = element.attributes.item(i)!;
      if (attribute.namespaceURI === OFFICE_REL_NS && attribute.value) {
        referenced.add(attribute.value);
      }
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) collect(child as Element);
    }
  };
  collect(root);
  if (referenced.size === 0) return [];

  const resultRels = await readRelationships(resultArchive, DOCUMENT_PART);
  const sourceRels = await readRelationships(mergeSourceArchive, DOCUMENT_PART);

  // An id already present in the result is only satisfied if it means the same
  // thing there. Renumbering plus reserving hyperlink ids against both tables
  // should make a genuine conflict unreachable; if one survives, importing
  // would be wrong and skipping would silently mis-bind, so say so rather than
  // pick one.
  for (const id of referenced) {
    const held = resultRels.get(id);
    const source = sourceRels.get(id);
    if (held && source && !sameRelationship(held, source)) {
      throw new Error(
        `Relationship id ${id} means different things in the base ` +
        `(${held.type} -> ${held.target}) and the merge source ` +
        `(${source.type} -> ${source.target}); id spaces failed to stay disjoint.`,
      );
    }
  }

  const missing = [...referenced].filter((id) => !resultRels.has(id));
  if (missing.length === 0) return [];

  const importable = missing
    .map((id) => sourceRels.get(id))
    .filter((entry): entry is RelationshipEntry => entry !== undefined);
  if (importable.length === 0) return [];

  const relsPath = relsPathFor(DOCUMENT_PART);
  const relsXml = await resultArchive.getFile(relsPath);
  const relsDoc = relsXml
    ? parseXml(relsXml)
    : parseXml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="${PACKAGE_REL_NS}"></Relationships>`,
      );
  const relsRoot = relsDoc.documentElement;
  if (!relsRoot) return [];

  const copiedAs = new Map<string, string>();
  const imported: ImportedRelationship[] = [];
  for (const entry of importable) {
    let target = entry.target;
    if (entry.targetMode !== 'External') {
      const sourceTarget = resolveTarget(DOCUMENT_PART, entry.target);
      const landedTarget = await copyPartClosure(
        mergeSourceArchive,
        resultArchive,
        sourceTarget,
        copiedAs,
      );
      // The part may have been copied aside to dodge a name collision; point
      // the relationship at where it actually landed, not where it came from.
      if (landedTarget !== sourceTarget) {
        target = posix.relative(posix.dirname(DOCUMENT_PART), landedTarget);
      }
    }
    const element = relsDoc.createElementNS(PACKAGE_REL_NS, 'Relationship');
    element.setAttribute('Id', entry.id);
    element.setAttribute('Type', entry.type);
    element.setAttribute('Target', target);
    if (entry.targetMode) element.setAttribute('TargetMode', entry.targetMode);
    relsRoot.appendChild(element);
    imported.push({ id: entry.id, type: entry.type, target });
  }
  resultArchive.setFile(relsPath, serializer.serializeToString(relsDoc));
  return imported;
}
