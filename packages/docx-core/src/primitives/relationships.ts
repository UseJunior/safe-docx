// Parser for word/_rels/document.xml.rels — extracts external hyperlink relationships.

import { OOXML } from './namespaces.js';
import { parseXml, serializeXml } from './xml.js';
import type { DocxZip } from './zip.js';

export type RelsMap = Map<string, string>;

export interface RelationshipEntry {
  id: string;
  type: string | null;
  target: string | null;
  targetMode: string | null;
}

/** OPC package-relationships namespace (parts almost always use it unprefixed). */
const OPC_RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/package/2006/relationships';

/**
 * Collect `<Relationship>` elements namespace-aware, matching both the common
 * default-namespace form and a (valid) prefixed form such as `<pr:Relationship>`.
 * A raw `getElementsByTagName('Relationship')` would silently miss the prefixed
 * form; mirrors the namespace-aware lookup the OPC-metadata writer already uses.
 */
function relationshipElements(relsDoc: Document): HTMLCollectionOf<Element> {
  return relsDoc.getElementsByTagNameNS(OPC_RELATIONSHIPS_NS, 'Relationship');
}

/** Parse every declared relationship keyed by its part-local identifier. */
export function parseRelationshipEntries(
  relsDoc: Document | null,
): Map<string, RelationshipEntry> {
  const entries = new Map<string, RelationshipEntry>();
  if (!relsDoc) return entries;
  const relationships = relationshipElements(relsDoc);
  for (let i = 0; i < relationships.length; i++) {
    const relationship = relationships.item(i)!;
    const id = relationship.getAttribute('Id');
    if (!id) continue;
    entries.set(id, {
      id,
      type: relationship.getAttribute('Type'),
      target: relationship.getAttribute('Target'),
      targetMode: relationship.getAttribute('TargetMode'),
    });
  }
  return entries;
}

/** Return the OPC Relationships-part path owned by one source part. */
export function relationshipPartPath(sourcePartPath: string): string {
  const separator = sourcePartPath.lastIndexOf('/');
  const directory = separator < 0 ? '' : sourcePartPath.slice(0, separator + 1);
  const fileName = separator < 0 ? sourcePartPath : sourcePartPath.slice(separator + 1);
  return `${directory}_rels/${fileName}.rels`;
}

/**
 * Ensure external hyperlink relationships owned by a source part and return
 * the destination-to-rId mapping used to emit that part's `w:hyperlink`s.
 * Existing relationships of every type reserve their identifiers; repeated
 * destinations reuse one external hyperlink relationship deterministically.
 *
 * @conformance ECMA-376 edition 5, Part 2 § 6.5.2.3
 * @conformance ECMA-376 edition 5, Part 2 § 6.5.3.4
 * @see https://github.com/UseJunior/safe-docx/issues/956
 */
export async function ensureExternalHyperlinkRelationships(
  zip: DocxZip,
  sourcePartPath: string,
  destinations: Iterable<string>,
): Promise<Map<string, string>> {
  const orderedDestinations = [...new Set(destinations)];
  const result = new Map<string, string>();
  if (orderedDestinations.length === 0) return result;
  if (orderedDestinations.some((destination) => destination.length === 0)) {
    throw new Error('External hyperlink destinations must be non-empty');
  }

  const relsPath = relationshipPartPath(sourcePartPath);
  const existingXml = await zip.readTextOrNull(relsPath);
  const relsDoc = parseXml(existingXml ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${OPC_RELATIONSHIPS_NS}"/>`);
  const root = relsDoc.documentElement;
  const relationships = Array.from(relationshipElements(relsDoc)) as Element[];
  const usedIds = new Set<string>();
  for (const relationship of relationships) {
    const id = relationship.getAttribute('Id');
    if (id) usedIds.add(id);
    if (relationship.getAttribute('Type') !== OOXML.HYPERLINK_REL_TYPE
      || relationship.getAttribute('TargetMode') !== 'External') continue;
    const target = relationship.getAttribute('Target');
    if (id && target && !result.has(target)) result.set(target, id);
  }

  let changed = false;
  let candidate = 1;
  for (const destination of orderedDestinations) {
    if (result.has(destination)) continue;
    while (usedIds.has(`rId${candidate}`)) candidate++;
    const id = `rId${candidate++}`;
    usedIds.add(id);
    const relationship = relsDoc.createElementNS(OPC_RELATIONSHIPS_NS, 'Relationship');
    relationship.setAttribute('Id', id);
    relationship.setAttribute('Type', OOXML.HYPERLINK_REL_TYPE);
    relationship.setAttribute('Target', destination);
    relationship.setAttribute('TargetMode', 'External');
    root.appendChild(relationship);
    result.set(destination, id);
    changed = true;
  }

  if (changed || existingXml === null) zip.writeText(relsPath, serializeXml(relsDoc));
  return new Map(orderedDestinations.map((destination) => [destination, result.get(destination)!]));
}

/**
 * Parse a document.xml.rels DOM and return a Map<rId, targetUrl> for external hyperlinks only.
 * Returns an empty map when the rels document is null (e.g. file missing from the DOCX archive).
 */
export function parseDocumentRels(relsDoc: Document | null): RelsMap {
  const map: RelsMap = new Map();
  if (!relsDoc) return map;

  const relationships = relationshipElements(relsDoc);
  for (let i = 0; i < relationships.length; i++) {
    const rel = relationships.item(i)!;
    const type = rel.getAttribute('Type');
    const targetMode = rel.getAttribute('TargetMode');
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');

    if (type === OOXML.HYPERLINK_REL_TYPE && targetMode === 'External' && id && target) {
      map.set(id, target);
    }
  }
  return map;
}

/**
 * Parse a document.xml.rels DOM into a Map<rId, logicalTarget> covering every
 * hyperlink relationship — external URLs and internal (same-package) targets
 * alike. The value folds in the target mode so an external and an internal
 * relationship that happen to share a target string never collide.
 *
 * Used to salt atom identity with a hyperlink's *resolved* destination rather
 * than its raw r:id: Word keeps the same relationship id when a link's target
 * is edited in place (only the rels Target changes), so hashing the r:id alone
 * would miss the retarget.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.22
 * @see https://github.com/UseJunior/safe-docx/issues/376
 */
export function parseHyperlinkRelTargets(relsDoc: Document | null): RelsMap {
  const map: RelsMap = new Map();
  if (!relsDoc) return map;

  const relationships = relationshipElements(relsDoc);
  for (let i = 0; i < relationships.length; i++) {
    const rel = relationships.item(i)!;
    if (rel.getAttribute('Type') !== OOXML.HYPERLINK_REL_TYPE) continue;
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (!id || !target) continue;
    // 'External' is the common case; internal hyperlinks omit TargetMode.
    const mode = rel.getAttribute('TargetMode') ?? 'Internal';
    map.set(id, `${mode}:${target}`);
  }
  return map;
}

/** A hyperlink relationship's shippable destination. */
export interface HyperlinkRelEntry {
  target: string;
  /** True for `TargetMode="External"` (URLs); false for internal targets. */
  external: boolean;
}

/**
 * Parse hyperlink relationships into structured entries keyed by rId, retaining
 * the target and its mode so a relationship can be re-emitted verbatim into a
 * merged package (issue #376, piece 2).
 */
export function parseHyperlinkRelEntries(
  relsDoc: Document | null
): Map<string, HyperlinkRelEntry> {
  const map = new Map<string, HyperlinkRelEntry>();
  if (!relsDoc) return map;
  const relationships = relationshipElements(relsDoc);
  for (let i = 0; i < relationships.length; i++) {
    const rel = relationships.item(i)!;
    if (rel.getAttribute('Type') !== OOXML.HYPERLINK_REL_TYPE) continue;
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (!id || !target) continue;
    map.set(id, { target, external: rel.getAttribute('TargetMode') === 'External' });
  }
  return map;
}

/**
 * Collect every relationship id declared in a document.xml.rels DOM, so a
 * freshly-allocated id can be guaranteed collision-free against ALL existing
 * relationships (not just hyperlinks). Returns an empty set for a null doc.
 */
export function listRelationshipIds(relsDoc: Document | null): Set<string> {
  const ids = new Set<string>();
  if (!relsDoc) return ids;
  const relationships = relationshipElements(relsDoc);
  for (let i = 0; i < relationships.length; i++) {
    const id = relationships.item(i)!.getAttribute('Id');
    if (id) ids.add(id);
  }
  return ids;
}
