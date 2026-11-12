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
  return canonicalElement(clone);
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
  let bindings: EffectiveStoryBindings | undefined = resolveEffectiveStoryBindings({
    documentXml: projectedXml,
    relationshipsXml: await source.archive.getFile('word/_rels/document.xml.rels'),
    settingsXml: await source.archive.getFile('word/settings.xml'),
  });
  if (!bindings.ok) bindings = undefined;
  const formatting = storyFormattingDependencies(
    await source.archive.getStylesXml(),
    await source.archive.getNumberingXml(),
    project,
  );
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
          return { absent: false, identity: `${resolved}\n${formatting(projected)}` };
        })();
        identities.set(path, identity);
      }
      return identity;
    },
  };
}

const STYLE_REFERENCES = new Set(['pStyle', 'rStyle', 'tblStyle', 'numStyleLink', 'styleLink']);
const LIST_ID_CHILDREN: ReadonlySet<string> = new Set(['abstractNumId', 'nsid', 'tmpl']);

/**
 * The style and numbering definitions a story's formatting depends on, in a
 * comparable form: the document defaults, the default styles, every style the
 * story names with each style it is based on, and every list it uses with
 * its abstract definition. Two stories with identical XML still look
 * different when a definition they depend on changed in `styles.xml` or
 * `numbering.xml`, which the redline does not track; a part identity without
 * them would read an explicit-versus-inherited reference as allocation only
 * (Codex round 5). Definitions the story does not reach are left out, so
 * styles a comparison adds for other content do not tell two stories apart.
 */
function storyFormattingDependencies(
  stylesXml: string | null,
  numberingXml: string | null,
  project: (xml: string) => string,
): (storyXml: string) => string {
  const projectedOrRaw = (xml: string | null): Document | undefined => {
    if (xml === null) return undefined;
    try {
      return parseXml(project(xml));
    } catch {
      return parseXml(xml);
    }
  };
  const styles = projectedOrRaw(stylesXml);
  const numbering = projectedOrRaw(numberingXml);
  const wChildren = (parent: Element | undefined, name: string): Element[] =>
    parent ? childElements(parent).filter((child) => child.namespaceURI === W_NS && localName(child) === name) : [];
  const wVal = (element: Element): string | null => element.getAttributeNS(W_NS, 'val');
  const styleById = new Map<string, Element>();
  const defaults: string[] = [];
  for (const style of wChildren(styles?.documentElement, 'style')) {
    const id = style.getAttributeNS(W_NS, 'styleId');
    if (id) styleById.set(id, style);
    if (style.getAttributeNS(W_NS, 'default') === '1' || style.getAttributeNS(W_NS, 'default') === 'true') {
      if (id) defaults.push(id);
    }
  }
  const docDefaults = wChildren(styles?.documentElement, 'docDefaults').map(canonicalElement).join('');
  const numById = new Map<string, Element>();
  for (const num of wChildren(numbering?.documentElement, 'num')) {
    const id = num.getAttributeNS(W_NS, 'numId');
    if (id) numById.set(id, num);
  }
  const abstractById = new Map<string, Element>();
  for (const abstract of wChildren(numbering?.documentElement, 'abstractNum')) {
    const id = abstract.getAttributeNS(W_NS, 'abstractNumId');
    if (id) abstractById.set(id, abstract);
  }
  const referencesIn = (root: Element, styleIds: Set<string>, numIds: Set<string>): void => {
    for (const element of Array.from(root.getElementsByTagNameNS(W_NS, '*'))) {
      const name = localName(element);
      const value = wVal(element);
      if (value === null) continue;
      if (STYLE_REFERENCES.has(name)) styleIds.add(value);
      else if (name === 'numId') numIds.add(value);
    }
  };
  return (storyXml) => {
    const styleIds = new Set<string>(defaults);
    const numIds = new Set<string>();
    referencesIn(parseXml(storyXml).documentElement, styleIds, numIds);
    const seenStyles = new Map<string, string>();
    const pending = [...styleIds];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (seenStyles.has(id)) continue;
      const style = styleById.get(id);
      seenStyles.set(id, style ? canonicalElement(style) : 'missing');
      if (!style) continue;
      for (const basedOn of wChildren(style, 'basedOn')) {
        const parent = wVal(basedOn);
        if (parent) pending.push(parent);
      }
      const before = new Set(styleIds);
      referencesIn(style, styleIds, numIds);
      for (const added of styleIds) if (!before.has(added)) pending.push(added);
    }
    const lists = [...numIds].sort().map((id) => {
      const num = numById.get(id);
      if (!num) return `${id}=missing`;
      const abstractId = wChildren(num, 'abstractNumId').map(wVal)[0];
      const abstract = abstractId ? abstractById.get(abstractId) : undefined;
      // List ids (and the abstract list's nsid/tmpl) are allocation details;
      // the level definitions and overrides are what show.
      const definition = (element: Element, skip: ReadonlySet<string>): string => childElements(element)
        .filter((child) => !(child.namespaceURI === W_NS && skip.has(localName(child))))
        .map(canonicalElement)
        .join('');
      return `${definition(num, LIST_ID_CHILDREN)}|${abstract ? definition(abstract, LIST_ID_CHILDREN) : 'missing'}`;
    });
    return `defaults:${docDefaults}\nstyles:${[...seenStyles].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, value]) => `${id}=${value}`).join('\n')}\nlists:${lists.join('\n')}`;
  };
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
