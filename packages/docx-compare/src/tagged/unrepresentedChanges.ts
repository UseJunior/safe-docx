import {
  auditSectPr,
  DocxArchive,
  childElements,
  getLeafText,
  parseXml,
} from '@usejunior/docx-core';
import type {
  UnrepresentedChange,
  UnrepresentedChangeKind,
  UnrepresentedContentControlChange,
} from '../compare-types.js';
import { representative, subtreeSignature, type TaggedNode } from './taggedTree.js';

const REVISION_TAGS = new Set(['sectPrChange']);
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Report aligned content controls whose `w:sdtPr`/`w:sdtEndPr` differ.
 *
 * `CT_SdtPr` admits no revision particle, so tagged construction carries the
 * property element as one opaque node and the serializer publishes the revised
 * properties whole. Nothing in the redline marks that difference; this walk of
 * the constructed tree is the only place it is disclosed. Side-only property
 * elements (a `w:sdtPr` present on one side) are reported the same way.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/1095
 */
export function collectContentControlPropertyChanges(tree: TaggedNode): UnrepresentedChange[] {
  const changes: UnrepresentedChange[] = [];
  let sectionIndex = 0;
  let controlIndex = -1;
  const identity = (properties: Element, index: number): UnrepresentedContentControlChange => {
    const value = (name: string): string | undefined => {
      const child = childElements(properties).find(
        (candidate) => candidate.namespaceURI === W_NS && localName(candidate) === name,
      );
      const attribute = child?.getAttributeNS(W_NS, 'val');
      return attribute === null || attribute === undefined ? undefined : attribute;
    };
    const control: UnrepresentedContentControlChange = { index };
    const id = value('id');
    const tag = value('tag');
    const alias = value('alias');
    if (id !== undefined) control.id = id;
    if (tag !== undefined) control.tag = tag;
    if (alias !== undefined) control.alias = alias;
    return control;
  };
  const visit = (node: TaggedNode): void => {
    const revisedSide = node.tag !== 'original';
    const element = representative(node, revisedSide ? 'revised' : 'original')!;
    if (element.namespaceURI === W_NS) {
      const name = localName(element);
      if (name === 'sdt' && revisedSide) controlIndex++;
      if (name === 'sdtPr' || name === 'sdtEndPr') {
        const kind: UnrepresentedChangeKind | null = node.tag === 'both'
          ? (subtreeSignature(node.original) === subtreeSignature(node.revised) ? null : 'changed')
          : node.tag === 'revised' ? 'added' : 'removed';
        if (kind) {
          changes.push({
            scope: 'contentControl',
            kind,
            sectionIndex,
            contentControl: identity(element, Math.max(controlIndex, 0)),
          });
        }
        return;
      }
      // A paragraph-bound w:sectPr closes the section it sits in; the body-level
      // final w:sectPr follows every block, so counting it changes nothing.
      if (name === 'sectPr' && revisedSide) sectionIndex++;
    }
    node.children.forEach(visit);
  };
  visit(tree);
  return changes;
}

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

async function readSections(archive: DocxArchive): Promise<SectionState[]> {
  const documentXml = await archive.getDocumentXml();
  const relationshipsXml = await archive.getFile('word/_rels/document.xml.rels');
  const document = parseXml(documentXml);
  const audit = auditSectPr(documentXml, relationshipsXml);
  const sections = Array.from(document.getElementsByTagName('*'))
    .filter((element) =>
      localName(element) === 'sectPr' && !hasAncestor(element, 'sectPrChange'),
    );

  return Promise.all(sections.map(async (section, sectionIndex) => {
    const propertyClone = section.cloneNode(true) as Element;
    for (const child of childElements(propertyClone)) {
      const name = localName(child);
      if (name === 'headerReference' || name === 'footerReference') {
        propertyClone.removeChild(child);
      }
    }

    const slots = new Map<string, StorySlot>();
    for (const binding of audit.bindings.filter(
      (candidate) => candidate.sectionOrdinal === sectionIndex,
    )) {
      const storyXml = await archive.getFile(binding.targetPath);
      if (!storyXml) continue;
      const storyRoot = parseXml(storyXml).documentElement;
      slots.set(`${binding.kind}:${binding.role}`, {
        kind: binding.kind,
        role: binding.role,
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
