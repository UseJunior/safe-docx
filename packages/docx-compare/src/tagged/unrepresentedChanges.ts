import { createHash } from 'node:crypto';
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
import { XMLSerializer } from '@xmldom/xmldom';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import {
  effectiveStorySlot,
  pageStorySlots,
  resolveEffectiveStoryBindings,
  type EffectiveStoryBindings,
} from './effectiveStoryBindings.js';
import { createResolvedStoryReader, type ResolvedStoryReader } from './storyRelationshipIdentity.js';

const REVISION_TAGS = new Set(['sectPrChange']);
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/**
 * A markup-compatibility attribute (Requires, Ignorable, ProcessContent,
 * MustUnderstand, ...) names namespaces by prefix, so its value is compared
 * with each prefix resolved: rebinding a prefix changes which mc:Choice Word
 * selects even when no other character differs (Codex round 15).
 */
function isPrefixListAttribute(element: Element, attribute: Attr): boolean {
  if (attribute.namespaceURI === MC_NS) return true;
  // mc:Choice carries Requires unqualified.
  return !attribute.namespaceURI && element.namespaceURI === MC_NS && localName(element) === 'Choice' &&
    (attribute.localName ?? attribute.name) === 'Requires';
}

function resolvedMarkupCompatibilityValue(element: Element, value: string): string {
  return value.trim().split(/\s+/u).filter(Boolean).map((token) => {
    const [prefix = '', ...rest] = token.split(':');
    const uri = element.lookupNamespaceURI(prefix) ?? `unbound:${prefix}`;
    return rest.length > 0 ? `{${uri}}${rest.join(':')}` : `{${uri}}`;
  }).join(' ');
}

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
  type ControlIdentity = Omit<UnrepresentedContentControlChange, 'element'>;
  const changes: UnrepresentedChange[] = [];
  let sectionIndex = 0;
  let controlIndex = -1;
  const isNamed = (candidate: Element, name: string): boolean =>
    candidate.namespaceURI === W_NS && localName(candidate) === name;
  const propertiesOf = (control: Element | undefined): Element | undefined =>
    control && childElements(control).find((candidate) => isNamed(candidate, 'sdtPr'));
  const identity = (control: TaggedNode, index: number): ControlIdentity => {
    // The control's w:sdtPr names it (w:id, w:tag, w:alias); read the revised
    // side first so an w:sdtEndPr change or a removed w:sdtPr still names the
    // control the reader will find in the published document.
    const properties = propertiesOf(representative(control, 'revised'))
      ?? propertiesOf(representative(control, 'original'));
    const value = (name: string): string | undefined => {
      const child = properties && childElements(properties).find((candidate) => isNamed(candidate, name));
      const attribute = child?.getAttributeNS(W_NS, 'val');
      return attribute === null || attribute === undefined ? undefined : attribute;
    };
    const result: ControlIdentity = { index };
    const id = value('id');
    const tag = value('tag');
    const alias = value('alias');
    if (id !== undefined) result.id = id;
    if (tag !== undefined) result.tag = tag;
    if (alias !== undefined) result.alias = alias;
    return result;
  };
  const visit = (node: TaggedNode, control: ControlIdentity | undefined): void => {
    const revisedSide = node.tag !== 'original';
    const element = representative(node, revisedSide ? 'revised' : 'original')!;
    let current = control;
    if (element.namespaceURI === W_NS) {
      const name = localName(element);
      if (name === 'sdt') {
        if (revisedSide) controlIndex++;
        current = identity(node, Math.max(controlIndex, 0));
      }
      if (name === 'sdtPr' || name === 'sdtEndPr') {
        const kind: UnrepresentedChangeKind | null = node.tag === 'both'
          ? (subtreeSignature(node.original) === subtreeSignature(node.revised) ? null : 'changed')
          : node.tag === 'revised' ? 'added' : 'removed';
        if (kind) {
          changes.push({
            scope: 'contentControl',
            kind,
            sectionIndex,
            contentControl: { ...(current ?? { index: Math.max(controlIndex, 0) }), element: name },
          });
        }
        return;
      }
      // A paragraph-bound w:sectPr closes the section it sits in; the body-level
      // final w:sectPr follows every block, so counting it changes nothing.
      if (name === 'sectPr' && revisedSide) sectionIndex++;
    }
    node.children.forEach((child) => visit(child, current));
  };
  visit(tree, undefined);
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
    // Only WordprocessingML editing-session ids; an attribute of another
    // namespace that happens to start with rsid is data (Codex round 12).
    if (attr.namespaceURI === W_NS && attr.localName?.startsWith('rsid')) continue;
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

type PackageChangeScope = 'section' | 'header' | 'footer';

const WORD_2010_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
/** Elements Word writes and drops freely that show nothing on a page. */
const STORY_IDENTITY_NOISE = new Set(['proofErr', 'lastRenderedPageBreak']);
/** Elements whose whitespace-only text is content, not indentation. */
const TEXT_BEARING = new Set(['t', 'delText', 'instrText', 'delInstrText']);

/** One input or projection of a package, as the represented-change check reads it. */
export interface PackageProjectionSource {
  archive: DocxArchive;
  /** `word/document.xml` to read instead of the archive's own, when the caller holds a newer one. */
  documentXml?: string;
}

/** The live `w:sectPr` elements in `auditSectPr` order: every one not inside a `w:sectPrChange` snapshot. */
function liveSectionProperties(document: Document): Element[] {
  return Array.from(document.getElementsByTagNameNS(W_NS, 'sectPr'))
    .filter((section) => !hasAncestor(section, 'sectPrChange'));
}

/** Section properties without the header/footer references, which the story slots account for. */
function sectionPropertySignature(section: Element): string {
  const clone = section.cloneNode(true) as Element;
  for (const child of childElements(clone)) {
    const name = localName(child);
    if (name === 'headerReference' || name === 'footerReference') clone.removeChild(child);
  }
  // A detached clone loses the namespace declarations of its ancestors, so
  // markup-compatibility prefixes are resolved on the live element (Codex
  // round 16).
  const compatibility = [section, ...Array.from(section.getElementsByTagName('*'))]
    .filter((element) => !hasAncestorElement(element, section, (ancestor) =>
      ancestor.namespaceURI === W_NS && (localName(ancestor) === 'headerReference' || localName(ancestor) === 'footerReference')))
    .flatMap((element) => Array.from(element.attributes)
      .filter((attribute) => isPrefixListAttribute(element, attribute))
      .map((attribute) => `${localName(element)}@${attribute.localName ?? attribute.name}=${resolvedMarkupCompatibilityValue(element, attribute.value)}`));
  // Ignorable, ProcessContent and MustUnderstand declared on an ancestor
  // (w:document, w:body) govern how the section's markup is processed too
  // (Codex round 20).
  for (let ancestor = section.parentNode; ancestor && ancestor.nodeType === 1; ancestor = ancestor.parentNode) {
    const element = ancestor as Element;
    for (const attribute of Array.from(element.attributes)) {
      if (!isPrefixListAttribute(element, attribute)) continue;
      compatibility.push(`^${localName(element)}@${attribute.localName ?? attribute.name}=${resolvedMarkupCompatibilityValue(element, attribute.value)}`);
    }
  }
  return `${canonicalElement(clone)}${compatibility.length > 0 ? `|mc:${compatibility.join(';')}` : ''}`;
}

/** Whether `element` has an ancestor matching `test` below `root`. */
function hasAncestorElement(element: Element, root: Element, test: (ancestor: Element) => boolean): boolean {
  for (let parent = element.parentNode; parent && parent !== root; parent = parent.parentNode) {
    if (parent.nodeType === 1 && test(parent as Element)) return true;
  }
  return false;
}

/**
 * Whether Word's Reject All restores every live property a `w:sectPrChange`
 * snapshot is meant to undo. Word applies the snapshot property by property
 * and attribute by attribute, keeping any live property the snapshot omits
 * (a `w:pgSz` without `w:orient` leaves a landscape page landscape; a
 * snapshot without `w:titlePg` keeps a revised title page), while
 * `rejectAllChanges` replaces the properties whole. A snapshot that omits a
 * live element or attribute is therefore not trusted to represent the change.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @see https://github.com/UseJunior/safe-docx/issues/1181
 */
function snapshotCoversLiveProperties(live: Element, snapshot: Element): boolean {
  const covers = (current: Element, prior: Element): boolean => {
    for (let index = 0; index < current.attributes.length; index++) {
      const attribute = current.attributes.item(index)!;
      if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) continue;
      if (attribute.localName?.startsWith('rsid')) continue;
      if (!prior.hasAttributeNS(attribute.namespaceURI, attribute.localName ?? attribute.name)) return false;
    }
    const used = new Map<string, number>();
    for (const child of childElements(current)) {
      const key = `${child.namespaceURI ?? ''}|${localName(child)}`;
      const ordinal = used.get(key) ?? 0;
      used.set(key, ordinal + 1);
      const counterpart = childElements(prior).filter(
        (candidate) => `${candidate.namespaceURI ?? ''}|${localName(candidate)}` === key,
      )[ordinal];
      if (!counterpart || !covers(child, counterpart)) return false;
    }
    return true;
  };
  return childElements(live).every((child) => {
    const name = localName(child);
    if (name === 'headerReference' || name === 'footerReference' || name === 'sectPrChange') return true;
    const key = `${child.namespaceURI ?? ''}|${name}`;
    const siblings = childElements(live).filter(
      (candidate) => `${candidate.namespaceURI ?? ''}|${localName(candidate)}` === key,
    );
    const counterpart = childElements(snapshot).filter(
      (candidate) => `${candidate.namespaceURI ?? ''}|${localName(candidate)}` === key,
    )[siblings.indexOf(child)];
    return counterpart !== undefined && covers(child, counterpart);
  });
}

function everySnapshotIsWordSafe(document: Document): boolean {
  return liveSectionProperties(document).every((section) => {
    const change = childElements(section).find((child) => localName(child) === 'sectPrChange');
    if (!change) return true;
    const snapshot = childElements(change).find((child) => localName(child) === 'sectPr');
    return snapshot !== undefined && snapshotCoversLiveProperties(section, snapshot);
  });
}

const XML_WHITESPACE = new Set([' ', '\t', '\r', '\n']);

/** Strips leading and trailing XML white space (S production), not every Unicode space. */
function trimXmlWhitespace(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && XML_WHITESPACE.has(text[start]!)) start += 1;
  while (end > start && XML_WHITESPACE.has(text[end - 1]!)) end -= 1;
  return text.slice(start, end);
}

/**
 * Story XML in a form that does not depend on how the comparison split runs:
 * revision-session ids (`w:rsid*`, `w14:paraId`, `w14:textId`), `xml:space`
 * on WordprocessingML text (once the white space Word drops is trimmed),
 * proofing marks and indentation between WordprocessingML elements are
 * dropped, adjacent runs with the same
 * properties are joined and adjacent text in a run is merged. Every property,
 * field, drawing and bookmark stays, so a formatting or structural difference
 * still tells two stories apart.
 */
function normalizedStoryXml(xml: string): string {
  const document = parseXml(xml);
  const root = document.documentElement;
  const visit = (element: Element): void => {
    // Without xml:space="preserve", Word drops a text element's leading and
    // trailing XML white space (space, tab, CR, LF), so only the text it shows
    // is compared. A no-break or other Unicode space is text and stays.
    const wordText = element.namespaceURI === W_NS && TEXT_BEARING.has(localName(element));
    if (wordText && element.getAttributeNS(XML_NS, 'space') !== 'preserve') {
      element.textContent = trimXmlWhitespace(element.textContent ?? '');
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.localName ?? attribute.name;
      if (
        (attribute.namespaceURI === W_NS && name.startsWith('rsid')) ||
        (attribute.namespaceURI === WORD_2010_NS && (name === 'paraId' || name === 'textId')) ||
        (wordText && attribute.namespaceURI === XML_NS && name === 'space')
      ) {
        element.removeAttributeNode(attribute);
      }
    }
    for (const attribute of Array.from(element.attributes)) {
      if (!isPrefixListAttribute(element, attribute)) continue;
      attribute.value = resolvedMarkupCompatibilityValue(element, attribute.value);
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 1) {
        const childElement = child as Element;
        if (childElement.namespaceURI === W_NS && STORY_IDENTITY_NOISE.has(localName(childElement))) {
          element.removeChild(child);
          continue;
        }
        visit(childElement);
      } else if (
        child.nodeType === 3 &&
        trimXmlWhitespace(child.nodeValue ?? '') === '' &&
        // Only indentation between WordprocessingML structure is dropped;
        // white space inside any other vocabulary (Office Math m:t, DrawingML
        // a:t, VML) may be shown text and stays.
        element.namespaceURI === W_NS && !wordText
      ) {
        element.removeChild(child);
      }
    }
    const isW = (node: Element, name: string): boolean =>
      node.namespaceURI === W_NS && localName(node) === name;
    // Empty property containers say nothing.
    for (const child of childElements(element)) {
      if ((isW(child, 'rPr') || isW(child, 'pPr')) && child.attributes.length === 0 && childElements(child).length === 0) {
        element.removeChild(child);
      }
    }
    if (isW(element, 'r')) {
      let previous: Element | undefined;
      for (const child of childElements(element)) {
        if (previous && isW(previous, 't') && isW(child, 't')) {
          previous.textContent = (previous.textContent ?? '') + (child.textContent ?? '');
          element.removeChild(child);
          continue;
        }
        previous = child;
      }
      return;
    }
    let previousRun: Element | undefined;
    let previousProperties: string | undefined;
    for (const child of childElements(element)) {
      if (!isW(child, 'r')) {
        previousRun = undefined;
        continue;
      }
      const properties = childElements(child).find((candidate) => isW(candidate, 'rPr'));
      // Runs join only when their own attributes and properties agree.
      const runAttributes = Array.from(child.attributes)
        .map((attribute) => `${attribute.namespaceURI ?? ''}|${attribute.localName ?? attribute.name}=${attribute.value}`)
        .sort()
        .join(',');
      const signature = `${runAttributes}#${properties ? canonicalElement(properties) : ''}`;
      const content = childElements(child).filter((candidate) => candidate !== properties);
      if (content.length === 0) {
        element.removeChild(child);
        continue;
      }
      if (previousRun && previousProperties === signature) {
        for (const node of content) previousRun.appendChild(node);
        element.removeChild(child);
        let previousText: Element | undefined;
        for (const node of childElements(previousRun)) {
          if (previousText && isW(node, 't')) {
            previousText.textContent = (previousText.textContent ?? '') + (node.textContent ?? '');
            previousRun.removeChild(node);
            continue;
          }
          previousText = isW(node, 't') ? node : undefined;
        }
        continue;
      }
      previousRun = child;
      previousProperties = signature;
    }
  };
  visit(root);
  return new XMLSerializer().serializeToString(document);
}

/** What a slot shows: no part at all, or a projected part. */
interface StoryIdentity {
  absent: boolean;
  identity: string;
}

const ABSENT_STORY: StoryIdentity = { absent: true, identity: 'absent' };

/**
 * Whether two slots show the same story. A missing part matches only a
 * missing part: a part that shows no text can still take up room (empty
 * paragraphs with height or spacing, an empty text box) and push the body
 * down, so it never stands in for no part. Two parts are the same only when
 * their normalized, relationship-resolved projections are.
 */
function sameStory(left: StoryIdentity, right: StoryIdentity): boolean {
  if (left.absent || right.absent) return left.absent && right.absent;
  return left.identity === right.identity;
}

interface PackageProjectionView {
  rawSectionCount: number;
  sections: string[];
  snapshotsWordSafe: boolean;
  bindings: EffectiveStoryBindings | undefined;
  storyIdentity: (path: string | undefined) => Promise<StoryIdentity>;
}

async function packageProjectionView(
  source: PackageProjectionSource,
  project: (xml: string) => string,
  label: string,
  readStory: ResolvedStoryReader,
): Promise<PackageProjectionView> {
  const rawXml = source.documentXml ?? await source.archive.getDocumentXml();
  const projectedXml = project(rawXml);
  const rawDocument = parseXml(rawXml);
  const projectedDocument = parseXml(projectedXml);
  const documentRelationships = await documentRelationshipList(source.archive);
  const settingsPath = documentRelationships.find((relationship) => relationship.type === SETTINGS_RELATIONSHIP)?.path
    ?? 'word/settings.xml';
  let bindings: EffectiveStoryBindings | undefined = resolveEffectiveStoryBindings({
    documentXml: projectedXml,
    relationshipsXml: await source.archive.getFile('word/_rels/document.xml.rels'),
    settingsXml: await source.archive.getFile(settingsPath),
  });
  if (!bindings.ok) bindings = undefined;
  const formatting = await storyFormattingEnvironment(source.archive, project, rawDocument, documentRelationships, settingsPath);
  const identities = new Map<string, Promise<StoryIdentity>>();
  return {
    rawSectionCount: liveSectionProperties(rawDocument).length,
    sections: liveSectionProperties(projectedDocument).map(sectionPropertySignature),
    snapshotsWordSafe: everySnapshotIsWordSafe(rawDocument),
    bindings,
    storyIdentity: (path) => {
      if (path === undefined) return Promise.resolve(ABSENT_STORY);
      let identity = identities.get(path);
      if (!identity) {
        identity = (async (): Promise<StoryIdentity> => {
          const xml = await source.archive.getFile(path);
          if (xml === null) return ABSENT_STORY;
          const projected = project(xml);
          // An unresolvable reference gets an identity nothing else has.
          const resolved = (await readStory(source.archive, path, normalizedStoryXml(projected)))?.semantic
            ?? `unresolved:${label}:${path}`;
          return { absent: false, identity: `${resolved}\nformatting:${formatting}` };
        })();
        identities.set(path, identity);
      }
      return identity;
    },
  };
}

const PACKAGE_RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SETTINGS_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';

interface PartRelationship {
  id: string;
  type: string;
  /** Resolved part name, or the raw target of an external relationship. */
  path: string;
  external: boolean;
}

/** A relationship target resolved against the folder of the part that owns it (OPC part names). */
function resolveRelationshipTarget(ownerFolder: string, target: string): string {
  const segments = target.startsWith('/') ? [] : ownerFolder.split('/').filter(Boolean);
  for (const segment of target.replace(/^\/+/u, '').split('/')) {
    if (segment === '..') segments.pop();
    else if (segment !== '.' && segment !== '') segments.push(segment);
  }
  return segments.join('/');
}

/** The relationships of the part whose relationship part is `relsPath`, namespace-aware. */
async function relationshipList(archive: DocxArchive, relsPath: string, ownerFolder: string): Promise<PartRelationship[] | undefined> {
  const xml = await archive.getFile(relsPath);
  if (xml === null) return [];
  try {
    return Array.from(parseXml(xml).getElementsByTagNameNS(PACKAGE_RELATIONSHIPS_NS, 'Relationship')).map((relationship) => {
      const external = relationship.getAttribute('TargetMode') === 'External';
      const target = relationship.getAttribute('Target') ?? '';
      return {
        id: relationship.getAttribute('Id') ?? '',
        type: relationship.getAttribute('Type') ?? '',
        path: external ? target : resolveRelationshipTarget(ownerFolder, target),
        external,
      };
    });
  } catch {
    return undefined;
  }
}

async function documentRelationshipList(archive: DocxArchive): Promise<PartRelationship[]> {
  return await relationshipList(archive, 'word/_rels/document.xml.rels', 'word') ?? [];
}
const STORY_RELATIONSHIP_TYPES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
]);
/**
 * Package paths outside the environment: the content-type index, the main
 * story (compared through its projections) and relationship parts (digested
 * separately).
 */
const ENVIRONMENT_EXCLUDED = [
  /^\[Content_Types\]\.xml$/u,
  /^word\/document\.xml$/u,
  /(^|\/)_rels\//u,
];
const OFFICE_RELATIONSHIP_BASES = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/',
];
/** Relationship type URIs for the named Office roles, Transitional and Strict, plus any extension URIs given whole. */
function officeRelationshipTypes(names: readonly string[], extensions: readonly string[] = []): ReadonlySet<string> {
  return new Set([...OFFICE_RELATIONSHIP_BASES.flatMap((base) => names.map((name) => `${base}${name}`)), ...extensions]);
}
const STYLES_WITH_EFFECTS = 'http://schemas.microsoft.com/office/2007/relationships/stylesWithEffects';
/**
 * Relationship types whose target is compared elsewhere (header/footer
 * stories, slot by slot) or annotates the document without changing how a
 * header or footer looks (comments, people, notes). A part is left out only
 * when every relationship naming it has one of these types: a role is read
 * from the relationships, never from the part's name (Codex round 13).
 */
const ENVIRONMENT_EXCLUDED_ROLE = officeRelationshipTypes(['header', 'footer', 'comments', 'footnotes', 'endnotes'], [
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended',
  'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds',
  'http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible',
  'http://schemas.microsoft.com/office/2011/relationships/people',
]);
/** Document relationship types whose WordprocessingML parts carry editing-session ids (`w:rsid*`). */
const SESSION_ID_ROLE = officeRelationshipTypes(['styles', 'numbering', 'settings', 'fontTable', 'webSettings'], [STYLES_WITH_EFFECTS]);
/** Document relationship types whose parts may carry tracked property changes that Accept/Reject All resolves. */
const REVISION_ROLE = officeRelationshipTypes(['styles', 'numbering'], [STYLES_WITH_EFFECTS]);
const STYLES_ROLE = officeRelationshipTypes(['styles'], [STYLES_WITH_EFFECTS]);
/** Package relationship types of the core and extended document properties. */
const DOCUMENT_PROPERTIES_ROLE = officeRelationshipTypes(['extended-properties', 'metadata/core-properties'], [
  'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
]);
/**
 * Roles whose parts are compared in a normalized form. A part is normalized
 * only when every relationship naming it has one of these exact types, so an
 * extension relationship or an added custom XML role keeps its stored bytes
 * (Codex round 19).
 */
const NORMALIZING_ROLE = new Set([...SESSION_ID_ROLE, ...DOCUMENT_PROPERTIES_ROLE]);
/**
 * Document-property entries every save rewrites (save time, revision count,
 * editing time, statistics, the application that saved). They are left out
 * of the digest only while no header/footer field can show them
 * (`VOLATILE_PROPERTY_FIELDS`); the properties a field can always show
 * (title, author, company, custom properties) stay in.
 */
const VOLATILE_DOCUMENT_PROPERTIES = new Set([
  'modified', 'revision', 'lastModifiedBy', 'lastPrinted',
  'TotalTime', 'Pages', 'Words', 'Characters', 'CharactersWithSpaces', 'Lines', 'Paragraphs',
  'Application', 'AppVersion', 'DocSecurity', 'ScaleCrop', 'LinksUpToDate', 'SharedDoc', 'HyperlinksChanged',
  'HeadingPairs', 'TitlesOfParts',
]);
/** Fields that show a save-rewritten property (LASTSAVEDBY, REVNUM, SAVEDATE, statistics, DOCPROPERTY, INFO). */
const VOLATILE_PROPERTY_FIELDS = /(LASTSAVEDBY|REVNUM|SAVEDATE|PRINTDATE|EDITTIME|NUMWORDS|NUMCHARS|DOCPROPERTY|INFO)/iu;

/**
 * Field keywords whose result depends only on the page, section, clock,
 * document properties or document variables, all of which the environment
 * digest or the page check covers. Any other field (REF, PAGEREF, NOTEREF,
 * STYLEREF, SEQ, a formula, a bare bookmark name, ...) can show content from
 * another story, where an untracked change such as a moved bookmark would not
 * be compared (Codex round 14). Page totals (NUMPAGES, SECTIONPAGES) are
 * left out too: they depend on the layout of every page, including notes and
 * drawings this check does not compare, while PAGE shows each page's own
 * number (Codex round 21). Content statistics (NUMWORDS, NUMCHARS) are left
 * out for the same reason.
 */
/** Document properties a DOCPROPERTY field can show that depend on layout, content statistics or the saved file. */
const LAYOUT_OR_FILE_PROPERTIES = /^(bytes|pages|lines|paragraphs|characters|characterswithspaces|words|filesize|numpages|numwords|numchars|sectionpages)$/iu;
const SELF_CONTAINED_FIELDS = new Set([
  'PAGE', 'SECTION', 'DATE', 'TIME', 'PRINTDATE', 'SAVEDATE', 'CREATEDATE',
  'EDITTIME', 'LASTSAVEDBY', 'REVNUM', 'AUTHOR', 'TITLE', 'SUBJECT', 'KEYWORDS',
  'COMMENTS', 'DOCPROPERTY', 'INFO', 'FILENAME', 'TEMPLATE', 'DOCVARIABLE',
]);

/**
 * Whether any field in the given story parts may show content from another
 * story: a field whose keyword is not self-contained, or field markup that
 * does not nest cleanly (read as unsafe).
 */
async function storyFieldsReadOtherStories(archive: DocxArchive, storyParts: Iterable<string>): Promise<boolean> {
  const unsafe = (instruction: string): boolean => {
    const tokens = instruction.trim().split(/\s+/u).filter(Boolean);
    const keyword = (tokens[0] ?? '').toUpperCase();
    if (keyword === '') return false;
    if (!SELF_CONTAINED_FIELDS.has(keyword)) return true;
    // INFO wraps another document-information field; DOCPROPERTY can name a
    // statistic or file property (Pages, Bytes, ...) that depends on layout
    // or on the saved file (Codex round 22).
    if (keyword === 'INFO') return tokens.length < 2 || unsafe(tokens.slice(1).join(' '));
    if (keyword === 'DOCPROPERTY') {
      const name = (tokens[1] ?? '').replace(/^["']|["']$/gu, '');
      return name === '' || LAYOUT_OR_FILE_PROPERTIES.test(name);
    }
    return false;
  };
  for (const path of storyParts) {
    const xml = await archive.getFile(path);
    if (xml === null) continue;
    let document: Document;
    try {
      document = parseXml(xml);
    } catch {
      return true;
    }
    const open: { instruction: string; collecting: boolean }[] = [];
    for (const element of Array.from(document.getElementsByTagNameNS(W_NS, '*'))) {
      const name = localName(element);
      if (name === 'fldSimple') {
        if (unsafe(element.getAttributeNS(W_NS, 'instr') ?? '')) return true;
      } else if (name === 'fldChar') {
        const type = element.getAttributeNS(W_NS, 'fldCharType');
        if (type === 'begin') open.push({ instruction: '', collecting: true });
        else if (type === 'separate') {
          const field = open[open.length - 1];
          if (!field) return true;
          field.collecting = false;
        } else if (type === 'end') {
          const field = open.pop();
          if (!field || unsafe(field.instruction)) return true;
        }
      } else if (name === 'instrText' || name === 'delInstrText') {
        const field = open[open.length - 1];
        if (!field) return true;
        if (field.collecting) field.instruction += element.textContent ?? '';
      }
    }
    if (open.length > 0) return true;
  }
  return false;
}

/** Whether any field in the given story parts may show a save-rewritten document property. */
async function storyFieldsShowVolatileProperties(archive: DocxArchive, storyParts: Iterable<string>): Promise<boolean> {
  for (const path of storyParts) {
    const xml = await archive.getFile(path);
    if (xml === null) continue;
    let document: Document;
    try {
      document = parseXml(xml);
    } catch {
      return true;
    }
    const instructions = [
      ...Array.from(document.getElementsByTagNameNS(W_NS, 'instrText')).map((element) => element.textContent ?? ''),
      ...Array.from(document.getElementsByTagNameNS(W_NS, 'delInstrText')).map((element) => element.textContent ?? ''),
      ...Array.from(document.getElementsByTagNameNS(W_NS, 'fldSimple')).map((element) => element.getAttributeNS(W_NS, 'instr') ?? ''),
    ];
    // A complex field's instruction may be split anywhere over runs, so the
    // fragments are joined as they are and searched without word boundaries:
    // a false match only keeps entries listed.
    if (VOLATILE_PROPERTY_FIELDS.test(instructions.join(''))) return true;
    // A content control bound to the core or extended properties shows them
    // too; any data binding keeps them, whatever store it names.
    if (Array.from(document.getElementsByTagName('*')).some((element) => localName(element) === 'dataBinding')) {
      return true;
    }
  }
  return false;
}
/**
 * A package part as comparable text: attributes sorted, every child element
 * and text node kept in order. WordprocessingML editing-session ids
 * (`w:rsid*`) are left out only in parts whose role carries them; custom XML
 * is compared as it is, since a bound control can show any attribute or text
 * in it (Codex rounds 12 and 13).
 */
function environmentCanonicalXml(node: Node, dropSessionIds: boolean): string {
  if (node.nodeType === 3 || node.nodeType === 4) return `"${JSON.stringify(node.nodeValue ?? '')}"`;
  if (node.nodeType !== 1) return '';
  const element = node as Element;
  const attrs: string[] = [];
  for (let index = 0; index < element.attributes.length; index++) {
    const attr = element.attributes.item(index);
    if (!attr || attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) continue;
    if (dropSessionIds && attr.namespaceURI === W_NS && attr.localName?.startsWith('rsid')) continue;
    const value = isPrefixListAttribute(element, attr) ? resolvedMarkupCompatibilityValue(element, attr.value) : attr.value;
    attrs.push(`${attr.namespaceURI ?? ''}|${attr.localName ?? attr.name}=${JSON.stringify(value)}`);
  }
  attrs.sort();
  const children = Array.from(element.childNodes).map((child) => environmentCanonicalXml(child, dropSessionIds)).join('');
  return `<${element.namespaceURI ?? ''}|${localName(element)}[${attrs.join(',')}]{${children}}>`;
}

/**
 * Elements that record editing sessions or view state, not appearance.
 * (`w:evenAndOddHeaders` is also left out, but only from the settings part
 * the page check reads it from.)
 */
const SETTINGS_NOISE = new Set(['rsids', 'proofState', 'zoom', 'trackRevisions']);

/**
 * Everything outside its own part that a header/footer story's appearance
 * may depend on, as one comparable digest: every package part except the
 * main story, the header/footer parts themselves (compared slot by slot),
 * notes and comments (document properties count, minus what every save
 * rewrites), plus which part each
 * relationship binds (by type and resolved target, ids left out). That covers
 * styles, numbering, settings (default tab stop, compatibility options), the
 * theme, the font table, custom XML and anything else, wherever the package
 * stores it. XML parts are projected through Accept/Reject All like the
 * story and compared without editing-session ids and view state; other parts
 * by their bytes. The redline tracks none of these, so two identical story
 * parts look the same only where the rest of the package matches too
 * (Codex rounds 5 to 8). A part that cannot be read or parsed makes the
 * digest unique, so nothing is filtered.
 */
async function storyFormattingEnvironment(
  archive: DocxArchive,
  project: (xml: string) => string,
  rawDocument: Document,
  documentRelationships: readonly PartRelationship[],
  settingsPath: string,
): Promise<string> {
  const storyParts = new Set(documentRelationships
    .filter((relationship) => !relationship.external && STORY_RELATIONSHIP_TYPES.has(relationship.type))
    .map((relationship) => relationship.path));
  const keepVolatileProperties = await storyFieldsShowVolatileProperties(archive, storyParts);
  // A header/footer field that reads another story makes this package's
  // environment unique, so no header/footer entry is filtered.
  if (await storyFieldsReadOtherStories(archive, storyParts)) return `cross-story-fields:${Math.random()}`;
  const digest = createHash('sha256');
  // Which part plays which role (styles, theme, settings, ...) is itself part
  // of how a story looks: the document's implicit relationships (those its
  // markup does not name by r:id) are compared by type and resolved target
  // (their ids are allocation), and every other non-story relationship part
  // by id, type and resolved target, since its owner names them by id.
  const referencedIds = new Set<string>();
  for (const element of [rawDocument.documentElement, ...Array.from(rawDocument.getElementsByTagName('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.namespaceURI === OFFICE_RELATIONSHIPS_NS) referencedIds.add(attribute.value);
    }
  }
  const bindingLine = (relationship: PartRelationship): string =>
    `${relationship.type}|${relationship.external ? 'external:' : ''}${relationship.path}`;
  digest.update(`document-relationships\n${documentRelationships
    .filter((relationship) => !STORY_RELATIONSHIP_TYPES.has(relationship.type) && !referencedIds.has(relationship.id))
    .map(bindingLine).sort().join('\n')}`);
  // Every role each part plays, from every relationship part in the package.
  const roles = new Map<string, Set<string>>();
  const relsPaths = archive.listFiles().filter((path) => /(^|\/)_rels\/[^/]*\.rels$/u.test(path)).sort();
  const relationshipsByPart = new Map<string, PartRelationship[]>();
  for (const relsPath of relsPaths) {
    const ownerFolder = relsPath.replace(/(^|\/)_rels\/[^/]+$/u, '');
    const relationships = await relationshipList(archive, relsPath, ownerFolder);
    if (!relationships) return `unparseable:${relsPath}:${Math.random()}`;
    relationshipsByPart.set(relsPath, relationships);
    for (const relationship of relationships) {
      if (relationship.external) continue;
      const set = roles.get(relationship.path) ?? new Set<string>();
      set.add(relationship.type);
      roles.set(relationship.path, set);
    }
  }
  const excluded = (path: string): boolean => {
    if (ENVIRONMENT_EXCLUDED.some((pattern) => pattern.test(path))) return true;
    const partRoles = roles.get(path);
    return partRoles !== undefined && partRoles.size > 0 &&
      Array.from(partRoles).every((type) => ENVIRONMENT_EXCLUDED_ROLE.has(type));
  };
  const sessionIdParts = new Set(documentRelationships
    .filter((relationship) => !relationship.external && SESSION_ID_ROLE.has(relationship.type))
    .map((relationship) => relationship.path));
  const revisionParts = new Set(documentRelationships
    .filter((relationship) => !relationship.external && REVISION_ROLE.has(relationship.type))
    .map((relationship) => relationship.path));
  const stylesParts = new Set(documentRelationships
    .filter((relationship) => !relationship.external && STYLES_ROLE.has(relationship.type))
    .map((relationship) => relationship.path));
  // A custom property linked to a bookmark (linkTarget) shows content from
  // the story holding that bookmark, so it is read as a cross-story field.
  for (const relationship of relationshipsByPart.get('_rels/.rels') ?? []) {
    if (relationship.external || !/\/custom-properties$/u.test(relationship.type)) continue;
    const xml = await archive.getFile(relationship.path);
    if (xml !== null && /\blinkTarget\s*=/u.test(xml)) return `linked-properties:${Math.random()}`;
  }
  const propertyParts = new Set((relationshipsByPart.get('_rels/.rels') ?? [])
    .filter((relationship) => !relationship.external && DOCUMENT_PROPERTIES_ROLE.has(relationship.type))
    .map((relationship) => relationship.path));
  for (const relsPath of relsPaths) {
    const ownerFolder = relsPath.replace(/(^|\/)_rels\/[^/]+$/u, '');
    const ownerPath = `${ownerFolder ? `${ownerFolder}/` : ''}${relsPath.replace(/^.*\/_rels\/|^_rels\//u, '').replace(/\.rels$/u, '')}`;
    // The main story's relationships are covered above and by the section
    // bindings; a story part's relationships by the story resolver. The
    // package root's (which part holds the document properties) count.
    if (ownerPath === 'word/document.xml' || (ownerPath !== '' && excluded(ownerPath))) continue;
    const relationships = relationshipsByPart.get(relsPath) ?? [];
    // The owning part names these relationships by id, so each id stays
    // bound to its target (a swap of two same-type targets changes it).
    digest.update(`\n${relsPath}\n${relationships.map((relationship) => `${relationship.id}=${bindingLine(relationship)}`).sort().join('\n')}`);
  }
  const paths = archive.listFiles()
    .filter((path) => !path.endsWith('/'))
    .filter((path) => !excluded(path))
    .sort();
  for (const path of paths) {
    const bytes = await archive.getFileBuffer(path);
    if (bytes === null) return `unreadable:${path}:${Math.random()}`;
    let entry: string;
    // Only parts whose role needs normalizing (settings, styles, numbering
    // and the other WordprocessingML parts that carry session ids, and the
    // document properties while no header/footer shows a save-rewritten one)
    // are compared in canonical form. Every other part, custom XML above all,
    // is compared by its stored bytes: a data binding's XPath can observe
    // prefixes, comments and anything else a canonical form drops (Codex
    // round 18).
    const partRoles = roles.get(path);
    const onlyNormalizingRoles = partRoles !== undefined && partRoles.size > 0 &&
      Array.from(partRoles).every((type) => NORMALIZING_ROLE.has(type));
    const normalized = onlyNormalizingRoles && (revisionParts.has(path) || sessionIdParts.has(path) || stylesParts.has(path) ||
      path === settingsPath || (propertyParts.has(path) && !keepVolatileProperties));
    if (normalized) {
      const xml = bytes.toString('utf8');
      let text = xml;
      // Accept/Reject All applies only where WordprocessingML revisions
      // live; elsewhere (custom XML) a w:ins element is data (Codex round 17).
      if (revisionParts.has(path)) {
        try {
          text = project(xml);
        } catch {
          text = xml;
        }
      }
      try {
        const root = parseXml(text).documentElement;
        // Editing-session and view state is left out only of the part whose
        // role holds it (settings, styles), as direct children of its root.
        // w:evenAndOddHeaders is judged by the page check, which reads it
        // from the settings part the document's relationship names.
        if (root.namespaceURI === W_NS) {
          for (const element of childElements(root)) {
            if (element.namespaceURI !== W_NS) continue;
            const name = localName(element);
            if ((path === settingsPath && (SETTINGS_NOISE.has(name) || name === 'evenAndOddHeaders')) ||
              (stylesParts.has(path) && name === 'latentStyles')) {
              root.removeChild(element);
            }
          }
        }
        if (sessionIdParts.has(path)) {
          for (const element of Array.from(root.getElementsByTagNameNS(W_NS, 'rsid'))) element.parentNode?.removeChild(element);
        }
        if (propertyParts.has(path) && !keepVolatileProperties) {
          for (const element of childElements(root)) {
            if (VOLATILE_DOCUMENT_PROPERTIES.has(localName(element))) root.removeChild(element);
          }
        }
        entry = environmentCanonicalXml(root, sessionIdParts.has(path));
      } catch {
        entry = `bytes:${createHash('sha256').update(bytes).digest('hex')}`;
      }
    } else {
      entry = `bytes:${createHash('sha256').update(bytes).digest('hex')}`;
    }
    digest.update(`\n${path}\n${entry}`);
  }
  return digest.digest('hex');
}

/** Whether `actual` shows what `expected` shows for one section, kind and role. */
async function storySlotMatches(
  actual: PackageProjectionView,
  expected: PackageProjectionView,
  sectionOrdinal: number,
  kind: 'header' | 'footer',
  role: 'default' | 'first' | 'even',
): Promise<boolean> {
  if (!actual.bindings || !expected.bindings) return false;
  const left = effectiveStorySlot(actual.bindings, { sectionOrdinal, kind, role });
  const right = effectiveStorySlot(expected.bindings, { sectionOrdinal, kind, role });
  if (!left || !right) return false;
  if (left.displayed === right.displayed) {
    // Shown or not, the slot's story must match, so a latent part (a first
    // page story without w:titlePg) is not lost either.
    if (!sameStory(await actual.storyIdentity(left.targetPath), await expected.storyIdentity(right.targetPath))) {
      return false;
    }
  } else {
    // A display switch (w:titlePg, w:evenAndOddHeaders) moves pages between
    // slots, and the page check below decides what each page shows. The side
    // that does not show the slot must hold no part there, so no latent
    // story is lost (#1390).
    const [hiddenView, hiddenSlot] = left.displayed ? [expected, right] : [actual, left];
    if (!(await hiddenView.storyIdentity(hiddenSlot.targetPath)).absent) return false;
  }
  // The pages of the section must show the same stories too: a display switch
  // can move a page onto a slot the role comparison does not cover.
  const pagesOf = (bindings: EffectiveStoryBindings) =>
    pageStorySlots(bindings).filter(({ slot }) => slot.sectionOrdinal === sectionOrdinal && slot.kind === kind);
  const actualPages = pagesOf(actual.bindings);
  const expectedPages = pagesOf(expected.bindings);
  if (actualPages.length !== expectedPages.length) return false;
  for (let index = 0; index < actualPages.length; index++) {
    if (
      actualPages[index]!.page !== expectedPages[index]!.page ||
      !sameStory(
        await actual.storyIdentity(actualPages[index]!.slot.targetPath),
        await expected.storyIdentity(expectedPages[index]!.slot.targetPath),
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Drop the section, header and footer entries the compared package already
 * represents.
 *
 * `detectUnrepresentedChanges` pairs sections by index: an entry at section
 * `k` says the original's section `k` and the revised document's section `k`
 * differ in that scope. After a section break is added or removed, every
 * later index pairs sections the comparison never aligned, so the entry may
 * describe a difference the redline carries in full (a tracked paragraph
 * mark holding the break's `w:sectPr`, a `w:sectPrChange`, or a header/footer
 * story redlined through the section alignment).
 *
 * The compared package's Reject All has the original's sections in order and
 * its Accept All has the revised document's (`sectionAlignedStoryPairing.ts`).
 * An entry at section `k` is represented when, at `k`, Reject All reproduces
 * the original and Accept All reproduces the revised document in that scope:
 * the same section properties, or for a header/footer the same displayed
 * story on the same role and pages after inheritance
 * (`effectiveStoryBindings.ts`), compared through the projected story with
 * its relationships resolved. Entries are kept, never dropped, when the
 * projections cannot be aligned (section counts differ, or a story binding is
 * invalid), when a projection differs at `k`, or, for section entries, when a
 * `w:sectPrChange` snapshot leaves live properties Word's Reject All would
 * keep.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @see https://github.com/UseJunior/safe-docx/issues/1427
 * @see https://github.com/UseJunior/safe-docx/issues/1181
 * @see https://github.com/UseJunior/safe-docx/issues/1030
 */
export async function subtractRepresentedPackageChanges(input: {
  original: PackageProjectionSource;
  revised: PackageProjectionSource;
  compared: PackageProjectionSource;
  changes: readonly UnrepresentedChange[];
  scopes: ReadonlySet<PackageChangeScope>;
}): Promise<UnrepresentedChange[]> {
  const inScope = (change: UnrepresentedChange): boolean =>
    (change.scope === 'section' || change.scope === 'header' || change.scope === 'footer') &&
    input.scopes.has(change.scope);
  if (!input.changes.some(inScope)) return [...input.changes];
  const readStory = createResolvedStoryReader();
  const [original, revised, rejected, accepted] = await Promise.all([
    packageProjectionView(input.original, rejectAllChanges, 'original', readStory),
    packageProjectionView(input.revised, acceptAllChanges, 'revised', readStory),
    packageProjectionView(input.compared, rejectAllChanges, 'rejected', readStory),
    packageProjectionView(input.compared, acceptAllChanges, 'accepted', readStory),
  ]);
  // Entries index the raw inputs; projections index their own sections. Both
  // must agree, or no index can be trusted.
  const originalCount = original.sections.length;
  const revisedCount = revised.sections.length;
  if (
    original.rawSectionCount !== originalCount ||
    revised.rawSectionCount !== revisedCount ||
    rejected.sections.length !== originalCount ||
    accepted.sections.length !== revisedCount
  ) {
    return [...input.changes];
  }

  // A section that exists on one side only has no counterpart index on the
  // other: its pages there fold into a neighbouring section. That side must
  // then match in full, every section (and, for a story entry, every slot of
  // that kind), so the entry is not dropped on a vacuous comparison.
  const ROLES = ['default', 'first', 'even'] as const;
  const sideMatches = async (
    actual: PackageProjectionView,
    expected: PackageProjectionView,
    count: number,
    k: number,
    scope: PackageChangeScope,
    role: 'default' | 'first' | 'even' | undefined,
  ): Promise<boolean> => {
    if (scope === 'section') {
      if (k < count) return actual.sections[k] === expected.sections[k];
      return actual.sections.every((section, index) => section === expected.sections[index]);
    }
    if (!role) return false;
    if (k < count) return storySlotMatches(actual, expected, k, scope, role);
    for (let index = 0; index < count; index++) {
      for (const each of ROLES) {
        if (!(await storySlotMatches(actual, expected, index, scope, each))) return false;
      }
    }
    return true;
  };
  const represented = async (change: UnrepresentedChange): Promise<boolean> => {
    const k = change.sectionIndex;
    if (k < 0 || k >= Math.max(originalCount, revisedCount)) return false;
    if (change.scope !== 'section' && change.scope !== 'header' && change.scope !== 'footer') return false;
    if (change.scope === 'section' && !rejected.snapshotsWordSafe) return false;
    return await sideMatches(rejected, original, originalCount, k, change.scope, change.role) &&
      await sideMatches(accepted, revised, revisedCount, k, change.scope, change.role);
  };
  const kept: UnrepresentedChange[] = [];
  for (const change of input.changes) {
    if (!inScope(change) || !(await represented(change))) kept.push(change);
  }
  return kept;
}
