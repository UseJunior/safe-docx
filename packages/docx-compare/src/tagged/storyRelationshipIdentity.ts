/**
 * Relationship-aware identity of a header/footer story.
 *
 * A story's identity is its canonical XML plus what each relationship id in
 * it resolves to (ECMA-376 Part 2 §6.5.2.3, §6.5.3.4): two footers with the
 * same markup whose r:id points at different hyperlinks or images are
 * different stories. An internal target also carries its bytes, so a
 * same-named media part whose content differs between packages does not read
 * as the same story.
 *
 * @conformance ECMA-376 edition 5, Part 2 § 6.5.3.4
 * @see https://github.com/UseJunior/safe-docx/issues/1390
 */

import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { canonicalNode } from './opaquePassthrough.js';

const RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_VML_NS = 'urn:schemas-microsoft-com:office:office';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/** `word/_rels/<name>.rels` for `word/<name>`: the part holding `partPath`'s own relationships. */
export function owningRelationshipsPath(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  const directory = slash >= 0 ? partPath.slice(0, slash) : '';
  const filename = slash >= 0 ? partPath.slice(slash + 1) : partPath;
  return `${directory ? `${directory}/` : ''}_rels/${filename}.rels`;
}

/** A story part read through its relationships. */
export interface ResolvedStory {
  /** The part root with every reference replaced by what it resolves to. */
  semantic: string;
  /** Each reference attribute with its resolution, in document order. */
  references: string;
}

/** Reads a story part through its relationships; returns `undefined` when a reference resolves to nothing usable. */
export type ResolvedStoryReader = (
  archive: DocxArchive,
  path: string,
  xml: string,
) => Promise<ResolvedStory | undefined>;

/**
 * A story reader with its own per-package fingerprint cache.
 *
 * What each relationship id owned by `owner` resolves to; undefined means
 * nothing usable (an internal target missing from the package, or a part
 * reached again through a cycle). An internal target is its bytes plus,
 * recursively, what its own relationships resolve to, so a chart whose
 * drawing differs is a different target even when the chart XML is equal.
 * A target's fingerprint does not depend on the path that reached it (any
 * part that can reach a cycle is unresolved from every entry), so it is
 * computed once per package and part.
 */
export function createResolvedStoryReader(): ResolvedStoryReader {
  const targetFingerprints = new Map<DocxArchive, Map<string, Promise<string | undefined>>>();
  const resolveRelationships = async (
    archive: DocxArchive,
    owner: string,
    visiting: ReadonlySet<string>,
  ): Promise<Map<string, string | undefined>> => {
    const relationshipsXml = await archive.getFile(owningRelationshipsPath(owner));
    const resolved = new Map<string, string | undefined>();
    if (!relationshipsXml) return resolved;
    for (const relationship of Array.from(
      parseXml(relationshipsXml).getElementsByTagNameNS(PACKAGE_RELATIONSHIPS_NS, 'Relationship'),
    )) {
      const id = relationship.getAttribute('Id');
      if (!id) continue;
      const type = relationship.getAttribute('Type') ?? '';
      const target = relationship.getAttribute('Target') ?? '';
      if (relationship.getAttribute('TargetMode') === 'External') {
        resolved.set(id, `${type}|external|${target}`);
        continue;
      }
      // A relative target resolves against the source part's directory; a
      // target starting with "/" is package-absolute.
      const targetPath = target.startsWith('/')
        ? posix.normalize(target).replace(/^\/+/u, '')
        : posix.normalize(posix.join(posix.dirname(owner), target));
      const fingerprint = await fingerprintTarget(archive, targetPath, visiting);
      resolved.set(id, fingerprint === undefined ? undefined : `${type}|internal|${fingerprint}`);
    }
    return resolved;
  };
  const fingerprintTarget = (
    archive: DocxArchive,
    targetPath: string,
    visiting: ReadonlySet<string>,
  ): Promise<string | undefined> => {
    if (visiting.has(targetPath)) return Promise.resolve(undefined);
    let cache = targetFingerprints.get(archive);
    if (!cache) targetFingerprints.set(archive, (cache = new Map()));
    let pending = cache.get(targetPath);
    if (!pending) {
      pending = (async () => {
        const bytes = await archive.getFileBuffer(targetPath);
        if (!bytes) return undefined;
        const nested = await resolveRelationships(archive, targetPath, new Set([...visiting, targetPath]));
        if ([...nested.values()].some((value) => value === undefined)) return undefined;
        const digest = createHash('sha256').update(bytes);
        for (const [nestedId, value] of [...nested].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
          digest.update(`\n${nestedId}=${value}`);
        }
        return digest.digest('hex');
      })();
      cache.set(targetPath, pending);
    }
    return pending;
  };

  // A story part read through its relationships: `references` lists, in
  // document order, each reference attribute with what its id resolves to;
  // `semantic` is the part root with every reference replaced by that
  // resolution, so a local id never tells two stories apart. References are
  // r:* attributes and VML's o:relid (vml-main.xsd); any other attribute whose
  // value is one of the part's relationship ids may be a reference this code
  // does not know, so the story is unresolved (undefined) and never matches.
  const resolvedStory = async (
    archive: DocxArchive,
    path: string,
    xml: string,
  ): Promise<ResolvedStory | undefined> => {
    const root = parseXml(xml).documentElement;
    const resolved = await resolveRelationships(archive, path, new Set([path]));
    const semantic = root.cloneNode(true) as Element;
    const references: string[] = [];
    for (const element of [semantic, ...Array.from(semantic.getElementsByTagName('*'))]) {
      for (const attribute of Array.from(element.attributes)) {
        const reference = attribute.namespaceURI === RELATIONSHIPS_NS
          || (attribute.namespaceURI === OFFICE_VML_NS && attribute.localName === 'relid');
        if (!reference) {
          if (resolved.has(attribute.value) && attribute.namespaceURI !== XMLNS_NS) return undefined;
          continue;
        }
        const target = resolved.get(attribute.value);
        if (target === undefined) return undefined;
        element.setAttributeNS(attribute.namespaceURI, attribute.name, target);
        references.push(`{${element.namespaceURI ?? ''}}${element.localName}|{${attribute.namespaceURI}}${attribute.localName}|${target}`);
      }
    }
    return { semantic: canonicalNode(semantic), references: references.join('\n') };
  };
  return resolvedStory;
}
