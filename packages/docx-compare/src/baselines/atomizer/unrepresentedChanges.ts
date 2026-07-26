import {
  DocxArchive,
  childElements,
  getLeafText,
  parseXml,
} from '@usejunior/docx-core';
import type {
  UnrepresentedChange,
  UnrepresentedChangeKind,
} from '../../compare-types.js';

const REL_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEADER_REL = `${REL_NS}/header`;
const FOOTER_REL = `${REL_NS}/footer`;
const REVISION_TAGS = new Set(['sectPrChange']);

interface StorySlot {
  kind: 'header' | 'footer';
  role: 'default' | 'first' | 'even';
  content: string;
}

interface SectionState {
  properties: string;
  slots: Map<string, StorySlot>;
}

function localName(element: Element): string {
  return element.localName || element.tagName.replace(/^.*:/, '');
}

function hasAncestor(element: Element, ancestorLocalName: string): boolean {
  for (let parent = element.parentNode; parent; parent = parent.parentNode) {
    if (parent.nodeType === 1 && localName(parent as Element) === ancestorLocalName) {
      return true;
    }
  }
  return false;
}

function canonicalElement(element: Element): string {
  const attrs: string[] = [];
  for (let index = 0; index < element.attributes.length; index++) {
    const attr = element.attributes.item(index);
    if (!attr || attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) continue;
    if (attr.localName?.startsWith('rsid')) continue;
    attrs.push(`${attr.namespaceURI ?? ''}|${attr.localName ?? attr.name}=${attr.value}`);
  }
  attrs.sort();
  const children = childElements(element)
    .filter((child) => !REVISION_TAGS.has(localName(child)))
    .map(canonicalElement);
  return `${element.namespaceURI ?? ''}|${localName(element)}[${attrs.join(',')}]` +
    `{${children.join('')}}(${getLeafText(element) ?? ''})`;
}

function relationshipMap(xml: string | null): Map<string, { type: string; target: string }> {
  const result = new Map<string, { type: string; target: string }>();
  if (!xml) return result;
  const doc = parseXml(xml);
  for (const element of Array.from(doc.getElementsByTagName('*'))) {
    if (localName(element) !== 'Relationship') continue;
    result.set(element.getAttribute('Id') ?? '', {
      type: element.getAttribute('Type') ?? '',
      target: element.getAttribute('Target') ?? '',
    });
  }
  return result;
}

function normalizeWordTarget(target: string): string {
  const segments = `word/${target}`.split('/');
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') normalized.pop();
    else normalized.push(segment);
  }
  return normalized.join('/');
}

async function readSections(archive: DocxArchive): Promise<SectionState[]> {
  const document = parseXml(await archive.getDocumentXml());
  const relationships = relationshipMap(
    await archive.getFile('word/_rels/document.xml.rels'),
  );
  const sections = Array.from(document.getElementsByTagName('*'))
    .filter((element) =>
      localName(element) === 'sectPr' && !hasAncestor(element, 'sectPrChange'),
    );

  return Promise.all(sections.map(async (section) => {
    const propertyClone = section.cloneNode(true) as Element;
    for (const child of childElements(propertyClone)) {
      const name = localName(child);
      if (name === 'headerReference' || name === 'footerReference') {
        propertyClone.removeChild(child);
      }
    }

    const slots = new Map<string, StorySlot>();
    for (const child of childElements(section)) {
      const local = localName(child);
      if (local !== 'headerReference' && local !== 'footerReference') continue;
      const kind = local === 'headerReference' ? 'header' : 'footer';
      const roleValue = child.getAttribute('w:type') || child.getAttribute('type') || 'default';
      if (roleValue !== 'default' && roleValue !== 'first' && roleValue !== 'even') continue;
      const id = child.getAttributeNS(REL_NS, 'id') || child.getAttribute('r:id') || '';
      const relationship = relationships.get(id);
      const expectedType = kind === 'header' ? HEADER_REL : FOOTER_REL;
      if (!relationship || relationship.type !== expectedType) continue;
      const storyXml = await archive.getFile(normalizeWordTarget(relationship.target));
      if (!storyXml) continue;
      const storyRoot = parseXml(storyXml).documentElement;
      slots.set(`${kind}:${roleValue}`, {
        kind,
        role: roleValue,
        content: canonicalElement(storyRoot),
      });
    }
    return { properties: canonicalElement(propertyClone), slots };
  }));
}

function differenceKind(
  original: string | undefined,
  revised: string | undefined,
): UnrepresentedChangeKind | null {
  if (original === revised) return null;
  if (original === undefined) return 'added';
  if (revised === undefined) return 'removed';
  return 'changed';
}

/**
 * Report package changes which are preserved but do not have emitted revision
 * markup in the current comparison pipeline.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @see https://github.com/UseJunior/safe-docx/issues/648
 */
export async function detectUnrepresentedChanges(
  original: DocxArchive,
  revised: DocxArchive,
): Promise<UnrepresentedChange[]> {
  const [originalSections, revisedSections] = await Promise.all([
    readSections(original),
    readSections(revised),
  ]);
  const changes: UnrepresentedChange[] = [];
  const count = Math.max(originalSections.length, revisedSections.length);
  for (let sectionIndex = 0; sectionIndex < count; sectionIndex++) {
    const before = originalSections[sectionIndex];
    const after = revisedSections[sectionIndex];
    const sectionKind = differenceKind(before?.properties, after?.properties);
    if (sectionKind) changes.push({ scope: 'section', kind: sectionKind, sectionIndex });

    const keys = new Set([...(before?.slots.keys() ?? []), ...(after?.slots.keys() ?? [])]);
    for (const key of [...keys].sort()) {
      const originalSlot = before?.slots.get(key);
      const revisedSlot = after?.slots.get(key);
      const kind = differenceKind(originalSlot?.content, revisedSlot?.content);
      if (!kind) continue;
      const slot = revisedSlot ?? originalSlot!;
      changes.push({
        scope: slot.kind,
        kind,
        sectionIndex,
        role: slot.role,
      });
    }
  }
  return changes;
}
