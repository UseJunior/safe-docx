import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { XMLSerializer } from '@xmldom/xmldom';
import {
  auditSectPr,
  DocxArchive,
  OOXML,
  parseXml,
  type SectPrBinding,
} from '@usejunior/docx-core';
import { canonicalNode } from './opaquePassthrough.js';
import {
  groupElementsByTagNameNS,
  type MarkupCompatibilityGroup,
} from '../markupCompatibility.js';
import {
  acceptAllChanges,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { parseDocumentXml } from './xmlToWmlElement.js';
import {
  pairTextBoxCandidates,
  textBoxPairingCandidates,
} from './textBoxIdentityPairing.js';
import {
  pageStorySlots,
  effectiveStorySlot,
  isBlankStoryPart,
  resolveEffectiveStoryBindings,
  storySlotKey,
} from './effectiveStoryBindings.js';
import {
  BLANK_STORY_IDENTITY,
  pairStoriesThroughSectionAlignment,
} from './sectionAlignedStoryPairing.js';
import {
  addParagraphMarkRevisionMarker,
  createRevisionIdState,
  formatDate,
  wrapRunWithTrackChange,
} from './revisionMarkup.js';

const WORD_2010_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const VML_NS = 'urn:schemas-microsoft-com:vml';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_VML_NS = 'urn:schemas-microsoft-com:office:office';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const serializer = new XMLSerializer();

export interface TextBoxRevisionChange {
  index: number;
  partPath?: string;
  reason?: string;
  originalParagraphId?: string;
  revisedParagraphId?: string;
}

export class UnsupportedTextBoxRevisionError extends Error {
  readonly changes: TextBoxRevisionChange[];

  constructor(changes: TextBoxRevisionChange[]) {
    const locations = changes
      .map(({ index, partPath, reason, originalParagraphId, revisedParagraphId }) => {
        const paragraphIds = [...new Set(
          [originalParagraphId, revisedParagraphId].filter(
            (value): value is string => value !== undefined,
          ),
        )];
        const locator = `${partPath ?? 'word/document.xml'}#w:txbxContent[${index}]`;
        const paragraphSuffix = paragraphIds.length > 0
          ? ` (paragraph ${paragraphIds.join(' → ')})`
          : '';
        return `${locator}${paragraphSuffix}${reason ? `: ${reason}` : ''}`;
      })
      .join(', ');
    super(
      `The requested w:txbxContent change is outside the comparison engine's ` +
        `supported Word-readable story subset. Changed container(s): ${locations}`,
    );
    this.name = 'UnsupportedTextBoxRevisionError';
    this.changes = changes;
  }
}

export interface TextBoxStoryInput {
  /**
   * Position in the raw `w:txbxContent` sequence. This is a storage address —
   * it addresses one stored copy of a text box and is the key the splice step
   * resolves against. It is not the number to show anybody.
   */
  index: number;
  /**
   * Position in the sequence of text boxes a reader can see, counting one
   * `mc:AlternateContent` as one box. This is the ordinal that goes in a
   * user-facing `#w:txbxContent[N]` locator.
   */
  visualIndex: number;
  partPath: string;
  container: 'textBox' | 'ancillaryPart';
  /**
   * `inserted` and `deleted` are lifecycle stories: the part exists on one
   * side only because the section slot selecting it was added or removed.
   */
  ancillaryMode?: 'ordinary' | 'inserted' | 'deleted';
  /**
   * Original-side section slots a `deleted` story was selected by. The outer
   * comparison decides where the removed part lands in the output, so these
   * slots, not `partPath`, identify the story there
   * (see `deletedAncillaryStoryOutputPaths`).
   */
  selectedSlots?: ReadonlyArray<Pick<SectPrBinding, 'sectionOrdinal' | 'kind' | 'role'>>;
  original: Buffer;
  revised: Buffer;
}

export interface TextBoxStoryComparisonPlan {
  outerOriginal: Buffer;
  outerRevised: Buffer;
  originalDocumentXml: string;
  revisedDocumentXml: string;
  stories: TextBoxStoryInput[];
  validateAncillaryProjection: boolean;
  hasAncillaryTextBoxStories: boolean;
  /**
   * True when a body text box has no counterpart in the other document. The
   * outer comparison tracks its anchor run, and the caller marks its story
   * with `markTrackedTextBoxLifecycles` (#1031).
   */
  hasUnpairedTextBoxes: boolean;
  representedAncillaryChanges: Array<{
    scope: 'header' | 'footer';
    kind: 'added' | 'changed' | 'removed';
    sectionIndex: number;
    role: 'default' | 'first' | 'even';
    partPath: string;
  }>;
}

function textBoxParagraphId(textBox: Element): string | undefined {
  const paragraph = textBox.getElementsByTagNameNS(OOXML.W_NS, 'p').item(0) as Element | null;
  return paragraph?.getAttributeNS(WORD_2010_NS, 'paraId') || undefined;
}

/**
 * One entry per *visual* text box.
 *
 * Word stores a modern text box twice inside one `mc:AlternateContent` — the
 * `mc:Choice` DrawingML spelling and the `mc:Fallback` VML spelling — and
 * renders exactly one of them. An unfiltered `w:txbxContent` scan therefore
 * counts one box as two. Each group carries the rendered copy plus the stored
 * copies nobody sees, so a caller can still inspect every copy while counting
 * and numbering the way a reader does.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @see https://github.com/UseJunior/safe-docx/issues/794
 */
function textBoxGroups(root: Node): MarkupCompatibilityGroup[] {
  return groupElementsByTagNameNS(root, OOXML.W_NS, 'txbxContent');
}

function textBoxes(documentXml: string): MarkupCompatibilityGroup[] {
  return textBoxGroups(parseDocumentXml(documentXml));
}

/** Every stored copy of one visual text box, rendered copy first. */
function allCopies(group: MarkupCompatibilityGroup): Element[] {
  return [group.selected, ...group.unselected];
}

/**
 * Map each raw `w:txbxContent` position to the position of the visual text box
 * that owns it.
 *
 * Comparison, neutralization, and splice-back all address stored copies, so
 * they keep using raw positions; only the ordinal in a diagnostic is
 * translated. Without this, `#w:txbxContent[2]` on a document with twinned
 * boxes names the second stored copy of the *first* box, and a reader sent to
 * find it has nowhere to look.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/794
 */
function visualTextBoxOrdinals(root: Node): number[] {
  const visualByCopy = new Map<Element, number>();
  for (const [visualIndex, group] of textBoxGroups(root).entries()) {
    for (const copy of allCopies(group)) visualByCopy.set(copy, visualIndex);
  }
  return Array.from(
    (root as Element | Document).getElementsByTagNameNS(
      OOXML.W_NS,
      'txbxContent',
    ),
  ).map((copy, rawIndex) => visualByCopy.get(copy as Element) ?? rawIndex);
}

function directChildElements(element: Element): Element[] {
  return Array.from(element.childNodes)
    .filter((child): child is Element => child.nodeType === 1);
}

function replaceChildren(target: Element, source: Element): void {
  while (target.firstChild) target.removeChild(target.firstChild);
  for (const child of Array.from(source.childNodes)) {
    target.appendChild(target.ownerDocument!.importNode(child, true));
  }
}

function placeholderToken(index: number): string {
  return `__safe_docx_text_box_story_${index}__`;
}

function createPlaceholder(textBox: Element, index: number): void {
  while (textBox.firstChild) textBox.removeChild(textBox.firstChild);
  const document = textBox.ownerDocument!;
  const paragraph = document.createElementNS(OOXML.W_NS, 'w:p');
  const run = document.createElementNS(OOXML.W_NS, 'w:r');
  const text = document.createElementNS(OOXML.W_NS, 'w:t');
  text.appendChild(
    document.createTextNode(placeholderToken(index)),
  );
  run.appendChild(text);
  paragraph.appendChild(run);
  textBox.appendChild(paragraph);
}

/**
 * The VML drawing object hosting a story: the parent of the nearest
 * `v:textbox` ancestor, when that parent is itself VML.
 *
 * Derived from the schema rather than matched against a hard-coded element
 * name. `v:textbox` (`CT_Textbox`) is the only declared parent of
 * `w:txbxContent`, and it belongs to `EG_ShapeElements`, which `CT_Shape`
 * shares with `CT_Rect`, `CT_RoundRect`, `CT_Oval`, `CT_Line`, `CT_PolyLine`,
 * `CT_Curve`, `CT_Arc`, `CT_Image`, `CT_Shapetype` and `CT_Group`
 * (`spec-compliance/ecma-376/schemas/transitional/vml-main.xsd`). Matching
 * only `v:shape` would report "no scaffold" for a schema-valid
 * `v:rect`/`v:roundrect`/`v:oval` host and — now that callers fail closed on
 * that — refuse VML the comparison handles perfectly well.
 *
 * Returns `undefined` when there is no VML `v:textbox` ancestor at all, which
 * is how a DrawingML (`wps:txbx`) box presents.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.22
 * @see https://github.com/UseJunior/safe-docx/issues/795
 */
function nearestShape(textBox: Element): Element | undefined {
  let node: Node | null = textBox.parentNode;
  while (node?.nodeType === 1) {
    const element = node as Element;
    if (element.namespaceURI === VML_NS && element.localName === 'textbox') {
      const host = element.parentNode;
      if (host?.nodeType !== 1) return undefined;
      const hostElement = host as Element;
      return hostElement.namespaceURI === VML_NS ? hostElement : undefined;
    }
    node = node.parentNode;
  }
  return undefined;
}

/**
 * Fingerprint the VML scaffold that hosts a story, with the story emptied out.
 *
 * Returns `undefined` when `nearestShape` found **no VML host at all** — as a
 * DrawingML (`wps:txbx`) box does. That is not "an empty scaffold"; it is "no
 * scaffold this function can describe". For a *standalone* DrawingML box it
 * also means the box falls outside the subset `spec-compliance/CONFORMANCE.md`
 * (ECMA-PART4-14-9-1-1) claims to cover, so callers MUST fail closed on
 * `undefined` on either side rather than comparing the two results, exactly as
 * they do for `relationshipClosureFingerprint`: two `undefined`s are the
 * absence of a pairing, never a successful one. The DrawingML half of an
 * `mc:AlternateContent` twin returns `undefined` here too, but it *is* inside
 * the covered subset — `scaffoldPairingReason` below carves it out before this
 * verdict is reached.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.22
 * @see https://github.com/UseJunior/safe-docx/issues/795
 */
function scaffoldFingerprint(textBox: Element): string | undefined {
  const shape = nearestShape(textBox);
  if (!shape) return undefined;
  const clone = shape.cloneNode(true) as Element;
  for (const nested of Array.from(
    clone.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  )) {
    while (nested.firstChild) nested.removeChild(nested.firstChild);
  }
  return canonicalNode(clone);
}

/**
 * Is this copy one spelling of a box Word also stored another way?
 *
 * Word writes a modern text box twice inside a single `mc:AlternateContent` —
 * the `mc:Choice` DrawingML spelling and the `mc:Fallback` VML spelling — and
 * renders one of them. The DrawingML copy of such a pair has no VML host, so
 * fingerprinting it alone reports "no scaffold" for a box whose scaffold is
 * sitting in its twin.
 *
 * Failing closed on that would refuse the ordinary Word text box, so the
 * scaffold guard skips a copy inside `mc:AlternateContent` and leaves it at
 * today's behaviour. Deciding which copy of a twin is the rendered one — and
 * therefore which scaffold governs — is the `mc:AlternateContent`-aware story
 * walk's job, tracked separately in #794; this guard deliberately does not
 * pre-empt it. The exclusion is therefore enforced for a standalone DrawingML
 * box, which is what #795 reports, and the twinned case is left to #794.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/794
 * @see https://github.com/UseJunior/safe-docx/issues/795
 */
function hasTextBoxAncestor(textBox: Element): boolean {
  for (let node = textBox.parentNode; node?.nodeType === 1; node = node.parentNode) {
    const element = node as Element;
    if (element.namespaceURI === OOXML.W_NS && element.localName === 'txbxContent') {
      return true;
    }
  }
  return false;
}

function hasAlternateContentAncestor(textBox: Element): boolean {
  let node: Node | null = textBox.parentNode;
  while (node?.nodeType === 1) {
    const element = node as Element;
    if (
      element.namespaceURI === MC_NS &&
      element.localName === 'AlternateContent'
    ) {
      return true;
    }
    node = node.parentNode;
  }
  return false;
}

/**
 * The scaffold-pairing verdict for one changed story, or `undefined` to admit.
 *
 * Fails closed when either side has no scaffold to fingerprint. Two
 * `undefined`s are the absence of a pairing, never a successful one — the
 * defect in #795 was comparing them with `!==` and reading `false` as "these
 * pair".
 */
function scaffoldPairingReason(
  originalTextBox: Element,
  revisedTextBox: Element,
  reason: string,
): string | undefined {
  if (
    hasAlternateContentAncestor(originalTextBox) ||
    hasAlternateContentAncestor(revisedTextBox)
  ) {
    return undefined;
  }
  const original = scaffoldFingerprint(originalTextBox);
  const revised = scaffoldFingerprint(revisedTextBox);
  if (original === undefined || revised === undefined || original !== revised) {
    return reason;
  }
  return undefined;
}

function unsupportedStoryReason(textBox: Element): string | undefined {
  if (
    textBox.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent').length > 0
  ) {
    return 'nested text boxes are not supported';
  }

  const unsupportedReferences = new Set([
    'commentReference',
    'endnoteReference',
    'footnoteReference',
    'object',
    'pict',
  ]);
  for (const element of Array.from(textBox.getElementsByTagName('*'))) {
    if (
      element.namespaceURI === OOXML.W_NS &&
      unsupportedReferences.has(element.localName)
    ) {
      return `nested ${element.tagName} is not supported in this story slice`;
    }
  }
  return undefined;
}

function relationshipTargets(
  relationshipsXml: string | null,
): ReadonlyMap<string, string> {
  if (!relationshipsXml) return new Map();
  const document = parseXml(relationshipsXml);
  const targets = new Map<string, string>();
  for (const relationship of Array.from(
    document.getElementsByTagName('Relationship'),
  )) {
    const id = relationship.getAttribute('Id');
    if (!id) continue;
    targets.set(
      id,
      [
        relationship.getAttribute('Type') ?? '',
        relationship.getAttribute('Target') ?? '',
        relationship.getAttribute('TargetMode') ?? '',
      ].join('|'),
    );
  }
  return targets;
}

function relationshipClosureFingerprint(
  textBox: Element,
  targets: ReadonlyMap<string, string>,
): string | undefined {
  const references: string[] = [];
  for (const element of [textBox, ...Array.from(textBox.getElementsByTagName('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.namespaceURI !== RELATIONSHIPS_NS) continue;
      const target = targets.get(attribute.value);
      if (!target) return undefined;
      references.push(
        `{${element.namespaceURI ?? ''}}${element.localName}|${attribute.localName}|${target}`,
      );
    }
  }
  return references.join('\n');
}

/**
 * Relationship identifiers are local to their owning OPC part. Nested story
 * comparison temporarily promotes a header/footer text box to document.xml,
 * whose tagged publication may canonicalize an equivalent hyperlink to a
 * different id. Translate those temporary ids back through relationship
 * semantics before splicing the story into its real owner.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @see https://github.com/UseJunior/safe-docx/issues/713
 */
async function remapComparedStoryRelationshipIds(
  storyArchive: DocxArchive,
  outerArchive: DocxArchive,
  ownerPartPath: string,
  storyBody: Element,
  visualIndex: number,
): Promise<void> {
  const [temporaryRelationships, ownerRelationships] = await Promise.all([
    storyArchive.getFile('word/_rels/document.xml.rels'),
    outerArchive.getFile(owningRelationshipsPath(ownerPartPath)),
  ]);
  const temporaryTargets = relationshipTargets(temporaryRelationships);
  const ownerTargets = relationshipTargets(ownerRelationships);
  const ownerIdByTarget = new Map(
    [...ownerTargets].map(([id, target]) => [target, id]),
  );

  for (const element of [storyBody, ...Array.from(storyBody.getElementsByTagName('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.namespaceURI !== RELATIONSHIPS_NS) continue;
      const semantics = temporaryTargets.get(attribute.value);
      const ownerId = semantics ? ownerIdByTarget.get(semantics) : undefined;
      if (!ownerId) {
        throw new UnsupportedTextBoxRevisionError([{
          index: visualIndex,
          partPath: ownerPartPath,
          reason: 'the compared text-box story relationship closure could not be rebound to its owner',
        }]);
      }
      attribute.value = ownerId;
    }
  }
}

function storyDocumentXml(documentXml: string, textBoxIndex: number): string {
  const document = parseXml(documentXml);
  const body = document.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0);
  const textBox = document
    .getElementsByTagNameNS(OOXML.W_NS, 'txbxContent')
    .item(textBoxIndex);
  if (!body || !textBox) {
    throw new Error(`Could not isolate w:txbxContent[${textBoxIndex}]`);
  }
  replaceChildren(body, textBox);
  return serializer.serializeToString(document);
}

function storyDocumentXmlFromPart(
  documentXml: string,
  partXml: string,
  textBoxIndex: number,
): string {
  const document = parseXml(documentXml);
  const body = document.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0);
  const part = parseXml(partXml);
  const textBox = part
    .getElementsByTagNameNS(OOXML.W_NS, 'txbxContent')
    .item(textBoxIndex);
  if (!body || !textBox) {
    throw new Error(`Could not isolate ancillary w:txbxContent[${textBoxIndex}]`);
  }
  replaceChildren(body, textBox);
  return serializer.serializeToString(document);
}

function copyNamespaceDeclarations(source: Element, target: Element): void {
  for (let index = 0; index < source.attributes.length; index += 1) {
    const attribute = source.attributes.item(index);
    if (
      attribute &&
      (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) &&
      !target.hasAttribute(attribute.name)
    ) {
      target.setAttribute(attribute.name, attribute.value);
    }
  }
}

function storyDocumentXmlFromPartRoot(
  documentXml: string,
  partXml: string | null,
): string {
  const document = parseXml(documentXml);
  const body = document.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0);
  if (!body) throw new Error('Could not isolate relationship-selected story');
  while (body.firstChild) body.removeChild(body.firstChild);
  if (partXml) {
    const part = parseXml(partXml);
    copyNamespaceDeclarations(part.documentElement, document.documentElement);
    for (const child of Array.from(part.documentElement.childNodes)) {
      body.appendChild(document.importNode(child, true));
    }
  }
  return serializer.serializeToString(document);
}

function partXmlWithRevisedTextBoxes(
  originalPartXml: string,
  revisedPartXml: string,
): string {
  const original = parseXml(originalPartXml);
  const revised = parseXml(revisedPartXml);
  const originalBoxes = Array.from(
    original.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  );
  const revisedBoxes = Array.from(
    revised.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  );
  if (originalBoxes.length !== revisedBoxes.length) return originalPartXml;
  for (let index = 0; index < originalBoxes.length; index += 1) {
    replaceChildren(originalBoxes[index]!, revisedBoxes[index]!);
  }
  return serializer.serializeToString(original);
}

function owningRelationshipsPath(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  const directory = slash >= 0 ? partPath.slice(0, slash) : '';
  const filename = slash >= 0 ? partPath.slice(slash + 1) : partPath;
  return `${directory ? `${directory}/` : ''}_rels/${filename}.rels`;
}

interface SelectedAncillaryStory {
  targetPath: string;
  kind: 'header' | 'footer';
  bindings: SectPrBinding[];
  xml: string;
  relationshipsXml: string | null;
  textBoxes: Element[];
  canonical: string;
  scaffold: string;
  ordinaryContent: string;
  bindingClosure: string;
}

interface SelectedAncillaryState {
  documentXml: string;
  bindingAuditValid: boolean;
  sectionCount: number;
  settingsSignature: string;
  auditBindings: SectPrBinding[];
  stories: SelectedAncillaryStory[];
}

interface PairedAncillaryStory {
  id: string;
  original: SelectedAncillaryStory;
  revised: SelectedAncillaryStory;
  bindingClosureMatched: boolean;
}

function partTextBoxes(xml: string): Element[] {
  const document = parseXml(xml);
  return Array.from(
    document.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  ) as Element[];
}

function partVisualTextBoxOrdinals(xml: string): number[] {
  return visualTextBoxOrdinals(parseXml(xml));
}

/**
 * The first raw position at which two documents disagree about how their text
 * boxes are stored, or `undefined` when the two storage shapes correspond.
 *
 * Text-box stories are paired by raw position, and the raw-count check alone
 * does not make that pairing sound: two plain VML boxes and one twinned
 * `mc:AlternateContent` box both store two `w:txbxContent` elements, so equal
 * counts can still mean raw position 1 is the second visible box on one side
 * and the unrendered copy of the first on the other. Comparing the raw→visual
 * maps element-wise is exactly the condition that forecloses it.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/794
 */
function divergentStorageShapePosition(
  original: readonly number[],
  revised: readonly number[],
): number | undefined {
  const length = Math.max(original.length, revised.length);
  for (let index = 0; index < length; index += 1) {
    if (original[index] !== revised[index]) return index;
  }
  return undefined;
}

const DIVERGENT_STORAGE_SHAPE_REASON =
  'the text-box storage shape differs between the documents ' +
  '(mc:AlternateContent branches do not correspond)';

function partScaffoldFingerprint(xml: string): string {
  const document = parseXml(xml);
  const root = document.documentElement.cloneNode(true) as Element;
  for (const textBox of Array.from(
    root.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  )) {
    while (textBox.firstChild) textBox.removeChild(textBox.firstChild);
  }
  for (const propertyName of ['rPr', 'pPr']) {
    const properties = Array.from(
      root.getElementsByTagNameNS(OOXML.W_NS, propertyName),
    ).reverse();
    for (const property of properties) {
      if (
        property.attributes.length === 0 &&
        directChildElements(property).length === 0 &&
        !(property.textContent ?? '').trim()
      ) {
        property.parentNode?.removeChild(property);
      }
    }
  }
  return canonicalNode(root);
}

function hasAncestor(element: Element, localName: string): boolean {
  for (let current = element.parentElement; current; current = current.parentElement) {
    if (current.namespaceURI === OOXML.W_NS && current.localName === localName) return true;
  }
  return false;
}

function blankOrdinaryParagraphText(root: Element): void {
  for (const paragraph of Array.from(root.getElementsByTagNameNS(OOXML.W_NS, 'p'))) {
    if (hasAncestor(paragraph, 'txbxContent')) continue;
    let complexFieldDepth = 0;
    for (const element of Array.from(paragraph.getElementsByTagName('*'))) {
      if (element.namespaceURI !== OOXML.W_NS) continue;
      if (element.localName === 'fldChar') {
        const type = element.getAttributeNS(OOXML.W_NS, 'fldCharType')
          ?? element.getAttribute('w:fldCharType')
          ?? element.getAttribute('fldCharType');
        if (type === 'begin') complexFieldDepth += 1;
        else if (type === 'end') complexFieldDepth = Math.max(0, complexFieldDepth - 1);
        continue;
      }
      if (
        (element.localName === 't' || element.localName === 'delText')
        && complexFieldDepth === 0
        && !hasAncestor(element, 'fldSimple')
      ) {
        element.parentNode?.removeChild(element);
      }
    }
    for (const parent of [paragraph, ...Array.from(paragraph.getElementsByTagNameNS(OOXML.W_NS, 'hyperlink'))]) {
      let previousRun: Element | null = null;
      let previousSignature: string | null = null;
      for (const child of directChildElements(parent)) {
        if (child.namespaceURI !== OOXML.W_NS || child.localName !== 'r') {
          previousRun = null;
          previousSignature = null;
          continue;
        }
        const signature = canonicalNode(child);
        if (previousRun && signature === previousSignature) {
          child.parentNode?.removeChild(child);
          continue;
        }
        previousRun = child;
        previousSignature = signature;
      }
    }
  }
}

function admittedPlainParagraphForScaffold(paragraph: Element): boolean {
  const parent = paragraph.parentElement;
  if (
    !parent
    || parent.namespaceURI !== OOXML.W_NS
    || !['hdr', 'ftr', 'tc'].includes(parent.localName)
  ) return false;
  if (parent.localName === 'tc' && hasAncestor(parent, 'tc')) return false;
  const unsupported = new Set([
    'drawing',
    'pict',
    'sdt',
    'txbxContent',
    'object',
    'commentReference',
    'footnoteReference',
    'endnoteReference',
    'fldChar',
    'fldSimple',
    'instrText',
  ]);
  for (const element of Array.from(paragraph.getElementsByTagName('*'))) {
    if (
      (element.namespaceURI === OOXML.W_NS && unsupported.has(element.localName))
      || (element.namespaceURI === MC_NS && element.localName === 'AlternateContent')
    ) return false;
  }
  return true;
}

/**
 * Fingerprint the selected-story structure while excluding only ordinary
 * paragraph text and nested text-box stories, which are compared separately.
 * Field instructions and cached field results remain part of the scaffold.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @see https://github.com/UseJunior/safe-docx/issues/998
 */
function ordinaryStoryScaffoldFingerprint(xml: string): string {
  const document = parseXml(xml);
  const root = document.documentElement.cloneNode(true) as Element;
  removeFormattingWhitespace(root);
  // Markdoc's package-wide _bk_ reservation marks admitted side paragraphs.
  // Exclude matched internal pairs wherever they occur in this selected part;
  // foreign-named bookmarks and all non-bookmark scaffold remain significant.
  const internalBookmarkIds = new Set<string>();
  for (const start of Array.from(root.getElementsByTagNameNS(OOXML.W_NS, 'bookmarkStart'))) {
    const name = start.getAttributeNS(OOXML.W_NS, 'name') ?? start.getAttribute('w:name') ?? '';
    if (!name.startsWith('_bk_')) continue;
    const id = start.getAttributeNS(OOXML.W_NS, 'id') ?? start.getAttribute('w:id');
    if (id) internalBookmarkIds.add(id);
    start.parentNode?.removeChild(start);
  }
  for (const end of Array.from(root.getElementsByTagNameNS(OOXML.W_NS, 'bookmarkEnd'))) {
    const id = end.getAttributeNS(OOXML.W_NS, 'id') ?? end.getAttribute('w:id');
    if (id && internalBookmarkIds.has(id)) end.parentNode?.removeChild(end);
  }
  for (const textBox of Array.from(root.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'))) {
    while (textBox.firstChild) textBox.removeChild(textBox.firstChild);
  }
  for (const paragraph of Array.from(root.getElementsByTagNameNS(OOXML.W_NS, 'p')).reverse()) {
    if (admittedPlainParagraphForScaffold(paragraph)) paragraph.parentNode?.removeChild(paragraph);
  }
  blankOrdinaryParagraphText(root);
  return canonicalNode(root);
}

function removeFormattingWhitespace(root: Element): void {
  const textBearingParents = new Set(['t', 'delText', 'instrText', 'delInstrText']);
  const visit = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (
        child.nodeType === 3
        && !(child.nodeValue ?? '').trim()
        && node.nodeType === 1
        && (node === root || directChildElements(node as Element).length > 0)
        && !(
          (node as Element).namespaceURI === OOXML.W_NS
          && textBearingParents.has((node as Element).localName)
        )
      ) {
        node.removeChild(child);
        continue;
      }
      visit(child);
    }
  };
  visit(root);
}

function ordinaryStoryContentFingerprint(xml: string): string {
  const document = parseXml(xml);
  const root = document.documentElement.cloneNode(true) as Element;
  for (const textBox of Array.from(root.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'))) {
    while (textBox.firstChild) textBox.removeChild(textBox.firstChild);
  }
  return canonicalNode(root);
}

function bindingClosureKey(kind: 'header' | 'footer', bindings: readonly SectPrBinding[]): string {
  return [
    kind,
    ...bindings
      .map((binding) => `${binding.sectionOrdinal}:${binding.kind}:${binding.role}`)
      .sort(),
  ].join('|');
}

function selectedHeaderSettingsSignature(settingsXml: string | null): string {
  if (!settingsXml) return '';
  const document = parseXml(settingsXml);
  const setting = document.getElementsByTagNameNS(OOXML.W_NS, 'evenAndOddHeaders').item(0);
  return setting ? canonicalNode(setting) : '';
}

function unsupportedBindingChanges(
  issues: ReturnType<typeof auditSectPr>['issues'],
): TextBoxRevisionChange[] {
  return issues.map((issue, index) => ({
    index,
    partPath: issue.targetPath ?? 'word/document.xml',
    reason: `invalid relationship-selected story binding (${issue.type})`,
  }));
}

/**
 * Resolve only the header/footer stories that are selected by direct section
 * bindings. Physical package filenames are allocation details and are not used
 * as cross-document story identity.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @see https://github.com/UseJunior/safe-docx/issues/726
 */
async function selectedAncillaryState(
  archive: DocxArchive,
): Promise<SelectedAncillaryState> {
  const documentXml = await archive.getDocumentXml();
  const settingsXml = await archive.getFile('word/settings.xml');
  const settingsSignature = selectedHeaderSettingsSignature(settingsXml);
  const relationshipsXml = await archive.getFile('word/_rels/document.xml.rels');
  const preliminary = auditSectPr(documentXml, relationshipsXml);
  if (!preliminary.ok) {
    // Relationship validation belongs to the package-level ancillary safety
    // boundary. Do not replace its precise, stable diagnostics with the
    // narrower text-box error merely because this preparatory scan runs first.
    return {
      documentXml,
      bindingAuditValid: false,
      sectionCount: 0,
      settingsSignature,
      auditBindings: [],
      stories: [],
    };
  }

  const parts = new Map<string, string>();
  for (const targetPath of new Set(
    preliminary.bindings.map((binding) => binding.targetPath),
  )) {
    const xml = await archive.getFile(targetPath);
    if (xml !== null) parts.set(targetPath, xml);
  }
  const audit = auditSectPr(documentXml, relationshipsXml, parts);
  if (!audit.ok) {
    return {
      documentXml,
      bindingAuditValid: false,
      sectionCount: 0,
      settingsSignature,
      auditBindings: [],
      stories: [],
    };
  }

  const bindingsByTarget = new Map<string, SectPrBinding[]>();
  for (const binding of audit.bindings) {
    const current = bindingsByTarget.get(binding.targetPath);
    if (current) current.push(binding);
    else bindingsByTarget.set(binding.targetPath, [binding]);
  }

  const stories: SelectedAncillaryStory[] = [];
  for (const [targetPath, bindings] of [...bindingsByTarget].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const xml = parts.get(targetPath)!;
    const root = parseXml(xml).documentElement;
    stories.push({
      targetPath,
      kind: bindings[0]!.kind,
      bindings,
      xml,
      relationshipsXml: await archive.getFile(owningRelationshipsPath(targetPath)),
      textBoxes: partTextBoxes(xml),
      canonical: canonicalNode(root),
      scaffold: partScaffoldFingerprint(xml),
      ordinaryContent: ordinaryStoryContentFingerprint(xml),
      bindingClosure: bindingClosureKey(bindings[0]!.kind, bindings),
    });
  }

  return {
    documentXml,
    bindingAuditValid: true,
    sectionCount: audit.stats.totalSectPrCount,
    settingsSignature,
    auditBindings: audit.bindings,
    stories,
  };
}

function bucketStories(
  stories: SelectedAncillaryStory[],
  keyOf: (story: SelectedAncillaryStory) => string,
): Map<string, SelectedAncillaryStory[]> {
  const buckets = new Map<string, SelectedAncillaryStory[]>();
  for (const story of stories) {
    const key = keyOf(story);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(story);
    else buckets.set(key, [story]);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => left.targetPath.localeCompare(right.targetPath));
  }
  return buckets;
}

function pairSelectedAncillaryStories(
  original: SelectedAncillaryStory[],
  revised: SelectedAncillaryStory[],
  pairByBindingClosure: boolean,
): {
  pairs: PairedAncillaryStory[];
  unpairedOriginal: SelectedAncillaryStory[];
  unpairedRevised: SelectedAncillaryStory[];
} {
  const originalCandidates = original;
  const revisedCandidates = revised;
  const matchedOriginal = new Set<SelectedAncillaryStory>();
  const matchedRevised = new Set<SelectedAncillaryStory>();
  const pairs: PairedAncillaryStory[] = [];

  const pair = (
    left: SelectedAncillaryStory,
    right: SelectedAncillaryStory,
    bindingClosureMatched: boolean,
  ): void => {
    matchedOriginal.add(left);
    matchedRevised.add(right);
    pairs.push({
      id: `ancillary-story-${pairs.length}`,
      original: left,
      revised: right,
      bindingClosureMatched,
    });
  };

  if (pairByBindingClosure) {
    const closureOriginal = bucketStories(
      originalCandidates,
      (story) => story.bindingClosure,
    );
    const closureRevised = bucketStories(
      revisedCandidates,
      (story) => story.bindingClosure,
    );
    for (const key of [...closureOriginal.keys()].sort()) {
      const left = closureOriginal.get(key)!;
      const right = closureRevised.get(key) ?? [];
      if (left.length === 1 && right.length === 1) pair(left[0]!, right[0]!, true);
    }
  }

  const exactOriginal = bucketStories(
    originalCandidates.filter((story) => !matchedOriginal.has(story)),
    (story) => `${story.kind}|${story.canonical}`,
  );
  const exactRevised = bucketStories(
    revisedCandidates.filter((story) => !matchedRevised.has(story)),
    (story) => `${story.kind}|${story.canonical}`,
  );
  for (const key of [...exactOriginal.keys()].sort()) {
    const left = exactOriginal.get(key)!;
    const right = exactRevised.get(key) ?? [];
    const count = Math.min(left.length, right.length);
    for (let index = 0; index < count; index += 1) {
      pair(left[index]!, right[index]!, false);
    }
  }

  const remainingOriginal = originalCandidates.filter(
    (story) => !matchedOriginal.has(story),
  );
  const remainingRevised = revisedCandidates.filter(
    (story) => !matchedRevised.has(story),
  );
  const scaffoldOriginal = bucketStories(
    remainingOriginal,
    (story) => `${story.kind}|${story.scaffold}`,
  );
  const scaffoldRevised = bucketStories(
    remainingRevised,
    (story) => `${story.kind}|${story.scaffold}`,
  );
  for (const key of [...scaffoldOriginal.keys()].sort()) {
    const left = scaffoldOriginal.get(key)!;
    const right = scaffoldRevised.get(key) ?? [];
    if (left.length === 1 && right.length === 1) {
      pair(left[0]!, right[0]!, false);
    }
  }

  return {
    pairs,
    unpairedOriginal: originalCandidates.filter(
      (story) => !matchedOriginal.has(story),
    ),
    unpairedRevised: revisedCandidates.filter(
      (story) => !matchedRevised.has(story),
    ),
  };
}

function hasAncestorLocalName(element: Element, name: string): boolean {
  for (let parent = element.parentNode; parent; parent = parent.parentNode) {
    if (
      parent.nodeType === 1 &&
      ((parent as Element).localName ||
        (parent as Element).tagName.replace(/^.*:/u, '')) === name
    ) {
      return true;
    }
  }
  return false;
}

function sectionPropertyFingerprints(documentXml: string): string[] {
  const document = parseXml(documentXml);
  return Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'sectPr'))
    .filter((section) => !hasAncestorLocalName(section, 'sectPrChange'))
    .map((section) => {
      const clone = section.cloneNode(true) as Element;
      for (const child of directChildElements(clone)) {
        if (
          child.namespaceURI === OOXML.W_NS &&
          (child.localName === 'headerReference' ||
            child.localName === 'footerReference' ||
            child.localName === 'sectPrChange')
        ) {
          clone.removeChild(child);
        }
      }
      return canonicalNode(clone);
    });
}

function ordinarySectionTopologyFingerprints(documentXml: string): string[] {
  const document = parseXml(documentXml);
  return Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'sectPr'))
    .filter((section) => !hasAncestorLocalName(section, 'sectPrChange'))
    .map((section) => {
      const clone = section.cloneNode(true) as Element;
      for (const reference of [
        ...Array.from(clone.getElementsByTagNameNS(OOXML.W_NS, 'headerReference')),
        ...Array.from(clone.getElementsByTagNameNS(OOXML.W_NS, 'footerReference')),
      ]) {
        reference.setAttributeNS(RELATIONSHIPS_NS, 'r:id', '__selected_story__');
      }
      return canonicalNode(clone);
    });
}

function bindingSlotSet(state: SelectedAncillaryState): string[] {
  return state.auditBindings
    .map((binding) => `${binding.sectionOrdinal}:${binding.kind}:${binding.role}`)
    .sort();
}

function ordinaryStoryTopologyMatches(
  original: SelectedAncillaryState,
  revised: SelectedAncillaryState,
): boolean {
  return original.sectionCount === revised.sectionCount
    && original.settingsSignature === revised.settingsSignature
    && JSON.stringify(bindingSlotSet(original)) === JSON.stringify(bindingSlotSet(revised))
    && JSON.stringify(ordinarySectionTopologyFingerprints(original.documentXml))
      === JSON.stringify(ordinarySectionTopologyFingerprints(revised.documentXml));
}

function sectionSignatures(
  state: SelectedAncillaryState,
  side: 'original' | 'revised',
  pairIdByPath: ReadonlyMap<string, string>,
): string[] {
  const properties = sectionPropertyFingerprints(state.documentXml);
  return properties.map((property, sectionOrdinal) => {
    const bindings = state.auditBindings
      .filter((binding) => binding.sectionOrdinal === sectionOrdinal)
      .sort((left, right) =>
        `${left.kind}:${left.role}`.localeCompare(`${right.kind}:${right.role}`),
      );
    const slots = bindings.map((binding) => {
      const selected = state.stories.find(
        (story) => story.targetPath === binding.targetPath,
      );
      // A paired story carries its pair id on both sides; an unpaired one
      // never matches across sides. This holds for plain stories too, so a
      // removed middle section whose footer is unpaired is not matched to the
      // surviving section that shifted into its position (#754).
      const identity = selected
        ? pairIdByPath.get(binding.targetPath) ??
          `${side}:unpaired:${binding.targetPath}`
        : `plain:${binding.kind}:${binding.role}`;
      return `${binding.kind}:${binding.role}:${identity}`;
    });
    return `${property}\n${slots.join('\n')}`;
  });
}

function unmatchedSequenceOrdinals(
  original: string[],
  revised: string[],
): { original: Set<number>; revised: Set<number> } {
  const lengths = Array.from(
    { length: original.length + 1 },
    () => Array<number>(revised.length + 1).fill(0),
  );
  for (let left = original.length - 1; left >= 0; left -= 1) {
    for (let right = revised.length - 1; right >= 0; right -= 1) {
      lengths[left]![right] = original[left] === revised[right]
        ? 1 + lengths[left + 1]![right + 1]!
        : Math.max(lengths[left + 1]![right]!, lengths[left]![right + 1]!);
    }
  }
  const matchedOriginal = new Set<number>();
  const matchedRevised = new Set<number>();
  let left = 0;
  let right = 0;
  while (left < original.length && right < revised.length) {
    if (original[left] === revised[right]) {
      matchedOriginal.add(left);
      matchedRevised.add(right);
      left += 1;
      right += 1;
    } else if (lengths[left + 1]![right]! >= lengths[left]![right + 1]!) {
      left += 1;
    } else {
      right += 1;
    }
  }
  return {
    original: new Set(
      original.map((_, index) => index).filter((index) => !matchedOriginal.has(index)),
    ),
    revised: new Set(
      revised.map((_, index) => index).filter((index) => !matchedRevised.has(index)),
    ),
  };
}

/**
 * Classify unpaired selected stories by section lifecycle.
 *
 * `inserted` stories exist only on the revised side and are selected
 * exclusively by inserted sections. `deleted` stories exist only on the
 * original side and are selected exclusively by section slots with no
 * revised-side counterpart: the section was removed, or it survived but no
 * longer selects that header/footer role. A slot counts as removed only when
 * no unmatched revised section selects the same header/footer role; when one
 * does, the revision may have rebound the slot to a different part rather
 * than removed it, and the pair stays unrepresented rather than being shown
 * as a deletion with no matching insertion. Both lifecycles are represented
 * by tracking every paragraph of the story. The pipeline still confirms,
 * against the outer comparison, that reject-all reselects a deleted story
 * and accept-all does not (`deletedAncillaryStoryOutputPaths`).
 *
 * Unpaired text-box stories outside those lifecycles are unsupported. On the
 * original side the guard also admits the older, wider rule (the section
 * count fell and the story's sections are unmatched) so that inputs which
 * compared before #754 keep comparing; those stories are left unrepresented.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @see https://github.com/UseJunior/safe-docx/issues/648
 * @see https://github.com/UseJunior/safe-docx/issues/754
 */
function assertLifecycleStoriesAreSectionBound(
  originalState: SelectedAncillaryState,
  revisedState: SelectedAncillaryState,
  pairs: PairedAncillaryStory[],
  unpairedOriginal: SelectedAncillaryStory[],
  unpairedRevised: SelectedAncillaryStory[],
): { inserted: SelectedAncillaryStory[]; deleted: SelectedAncillaryStory[] } {
  if (unpairedOriginal.length === 0 && unpairedRevised.length === 0) {
    return { inserted: [], deleted: [] };
  }
  const originalPairIds = new Map(
    pairs.map((pair) => [pair.original.targetPath, pair.id]),
  );
  const revisedPairIds = new Map(
    pairs.map((pair) => [pair.revised.targetPath, pair.id]),
  );
  const unmatched = unmatchedSequenceOrdinals(
    sectionSignatures(originalState, 'original', originalPairIds),
    sectionSignatures(revisedState, 'revised', revisedPairIds),
  );
  const changes: TextBoxRevisionChange[] = [];
  const isInsertedLifecycle = (story: SelectedAncillaryStory): boolean =>
    revisedState.sectionCount > originalState.sectionCount &&
    story.bindings.every((binding) =>
      unmatched.revised.has(binding.sectionOrdinal),
    );
  const reboundRoles = new Set(
    revisedState.auditBindings
      .filter((binding) => unmatched.revised.has(binding.sectionOrdinal))
      .map((binding) => `${binding.kind}:${binding.role}`),
  );
  const isDeletedLifecycle = (story: SelectedAncillaryStory): boolean =>
    story.bindings.every((binding) =>
      unmatched.original.has(binding.sectionOrdinal) &&
      !reboundRoles.has(`${binding.kind}:${binding.role}`),
    );
  const isRemovedSectionStory = (story: SelectedAncillaryStory): boolean =>
    originalState.sectionCount > revisedState.sectionCount &&
    story.bindings.every((binding) =>
      unmatched.original.has(binding.sectionOrdinal),
    );

  for (const story of unpairedOriginal.filter(
    (candidate) => candidate.textBoxes.length > 0,
  )) {
    if (!isDeletedLifecycle(story) && !isRemovedSectionStory(story)) {
      changes.push({
        index: 0,
        partPath: story.targetPath,
        reason:
          'unpaired ancillary text-box story is not owned exclusively by a removed section slot',
      });
    }
  }
  for (const story of unpairedRevised.filter(
    (candidate) => candidate.textBoxes.length > 0,
  )) {
    if (!isInsertedLifecycle(story)) {
      changes.push({
        index: 0,
        partPath: story.targetPath,
        reason:
          'unpaired ancillary text-box story is not owned exclusively by an inserted section',
      });
    }
  }
  if (changes.length > 0) throw new UnsupportedTextBoxRevisionError(changes);
  return {
    inserted: unpairedRevised.filter(isInsertedLifecycle),
    deleted: unpairedOriginal.filter(isDeletedLifecycle),
  };
}

async function ancillaryStoryInputs(
  originalArchive: DocxArchive,
  revisedArchive: DocxArchive,
  originalDocumentXml: string,
  revisedDocumentXml: string,
): Promise<{
  stories: TextBoxStoryInput[];
  validateProjection: boolean;
  hasTextBoxStories: boolean;
  representedChanges: TextBoxStoryComparisonPlan['representedAncillaryChanges'];
}> {
  const [originalState, revisedState] = await Promise.all([
    selectedAncillaryState(originalArchive),
    selectedAncillaryState(revisedArchive),
  ]);
  if (!originalState.bindingAuditValid || !revisedState.bindingAuditValid) {
    return {
      stories: [],
      validateProjection: false,
      hasTextBoxStories: false,
      representedChanges: [],
    };
  }
  const topologyMatches = ordinaryStoryTopologyMatches(originalState, revisedState);
  const paired = pairSelectedAncillaryStories(
    originalState.stories,
    revisedState.stories,
    topologyMatches,
  );
  const {
    inserted: insertedPartStories,
    deleted: deletedPartStories,
  } = assertLifecycleStoriesAreSectionBound(
    originalState,
    revisedState,
    paired.pairs,
    paired.unpairedOriginal,
    paired.unpairedRevised,
  );

  const stories: TextBoxStoryInput[] = [];
  const representedChanges: TextBoxStoryComparisonPlan['representedAncillaryChanges'] = [];
  for (const pair of paired.pairs) {
    if (
      topologyMatches
      && pair.bindingClosureMatched
      && pair.original.ordinaryContent !== pair.revised.ordinaryContent
      && ordinaryStoryScaffoldFingerprint(pair.original.xml)
        === ordinaryStoryScaffoldFingerprint(pair.revised.xml)
    ) {
      const originalTargets = relationshipTargets(pair.original.relationshipsXml);
      const revisedTargets = relationshipTargets(pair.revised.relationshipsXml);
      const originalRoot = parseXml(pair.original.xml).documentElement;
      const revisedRoot = parseXml(pair.revised.xml).documentElement;
      const originalClosure = relationshipClosureFingerprint(originalRoot, originalTargets);
      const revisedClosure = relationshipClosureFingerprint(revisedRoot, revisedTargets);
      if (
        originalClosure !== undefined
        && revisedClosure !== undefined
        && originalClosure === revisedClosure
      ) {
        const storyOriginalArchive = await originalArchive.clone();
        const storyRevisedArchive = await revisedArchive.clone();
        storyOriginalArchive.setDocumentXml(storyDocumentXmlFromPartRoot(
          originalDocumentXml,
          partXmlWithRevisedTextBoxes(pair.original.xml, pair.revised.xml),
        ));
        storyRevisedArchive.setDocumentXml(storyDocumentXmlFromPartRoot(
          revisedDocumentXml,
          pair.revised.xml,
        ));
        storyOriginalArchive.setFile(
          'word/_rels/document.xml.rels',
          pair.original.relationshipsXml
            ?? `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`,
        );
        storyRevisedArchive.setFile(
          'word/_rels/document.xml.rels',
          pair.revised.relationshipsXml
            ?? `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`,
        );
        stories.push({
          index: 0,
          visualIndex: 0,
          partPath: pair.revised.targetPath,
          container: 'ancillaryPart',
          ancillaryMode: 'ordinary',
          original: await storyOriginalArchive.save(),
          revised: await storyRevisedArchive.save(),
        });
        representedChanges.push(...pair.revised.bindings.map((binding) => ({
          scope: binding.kind,
          kind: 'changed' as const,
          sectionIndex: binding.sectionOrdinal,
          role: binding.role,
          partPath: pair.revised.targetPath,
        })));
      }
    }
    const originalVisualOrdinals = partVisualTextBoxOrdinals(pair.original.xml);
    const visualOrdinals = partVisualTextBoxOrdinals(pair.revised.xml);
    if (pair.original.textBoxes.length !== pair.revised.textBoxes.length) {
      const rawIndex = Math.min(
        pair.original.textBoxes.length,
        pair.revised.textBoxes.length,
      );
      throw new UnsupportedTextBoxRevisionError([{
        index: visualOrdinals[rawIndex] ?? rawIndex,
        partPath: pair.revised.targetPath,
        reason: 'inserted or deleted ancillary text-box topology is not supported',
      }]);
    }

    const divergentPosition = divergentStorageShapePosition(
      originalVisualOrdinals,
      visualOrdinals,
    );
    if (divergentPosition !== undefined) {
      throw new UnsupportedTextBoxRevisionError([{
        index: Math.min(
          originalVisualOrdinals[divergentPosition] ?? divergentPosition,
          visualOrdinals[divergentPosition] ?? divergentPosition,
        ),
        partPath: pair.revised.targetPath,
        reason: DIVERGENT_STORAGE_SHAPE_REASON,
      }]);
    }
    const originalTargets = relationshipTargets(pair.original.relationshipsXml);
    const revisedTargets = relationshipTargets(pair.revised.relationshipsXml);
    for (let index = 0; index < pair.original.textBoxes.length; index += 1) {
      const originalTextBox = pair.original.textBoxes[index]!;
      const revisedTextBox = pair.revised.textBoxes[index]!;
      if (canonicalNode(originalTextBox) === canonicalNode(revisedTextBox)) continue;
      const originalRelationshipClosure = relationshipClosureFingerprint(
        originalTextBox,
        originalTargets,
      );
      const revisedRelationshipClosure = relationshipClosureFingerprint(
        revisedTextBox,
        revisedTargets,
      );
      const reason =
        unsupportedStoryReason(originalTextBox) ??
        unsupportedStoryReason(revisedTextBox) ??
        (originalRelationshipClosure === undefined ||
        revisedRelationshipClosure === undefined ||
        originalRelationshipClosure !== revisedRelationshipClosure
          ? 'the ancillary text-box relationship closure changed or could not be resolved'
          : undefined) ??
        scaffoldPairingReason(
          originalTextBox,
          revisedTextBox,
          'the ancillary VML shape scaffold changed or could not be paired',
        );
      if (reason) {
        throw new UnsupportedTextBoxRevisionError([{
          index: visualOrdinals[index] ?? index,
          partPath: pair.revised.targetPath,
          reason,
          originalParagraphId: textBoxParagraphId(originalTextBox),
          revisedParagraphId: textBoxParagraphId(revisedTextBox),
        }]);
      }

      const storyOriginalArchive = await originalArchive.clone();
      const storyRevisedArchive = await revisedArchive.clone();
      storyOriginalArchive.setDocumentXml(
        storyDocumentXmlFromPart(
          originalDocumentXml,
          pair.original.xml,
          index,
        ),
      );
      storyRevisedArchive.setDocumentXml(
        storyDocumentXmlFromPart(
          revisedDocumentXml,
          pair.revised.xml,
          index,
        ),
      );
      storyOriginalArchive.setFile(
        'word/_rels/document.xml.rels',
        pair.original.relationshipsXml ??
          `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`,
      );
      storyRevisedArchive.setFile(
        'word/_rels/document.xml.rels',
        pair.revised.relationshipsXml ??
          `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`,
      );
      stories.push({
        index,
        visualIndex: visualOrdinals[index] ?? index,
        partPath: pair.revised.targetPath,
        container: 'textBox',
        original: await storyOriginalArchive.save(),
        revised: await storyRevisedArchive.save(),
      });
    }
  }

  for (const story of insertedPartStories) {
    const storyOriginalArchive = await originalArchive.clone();
    const storyRevisedArchive = await revisedArchive.clone();
    storyOriginalArchive.setDocumentXml(
      storyDocumentXmlFromPartRoot(originalDocumentXml, null),
    );
    storyRevisedArchive.setDocumentXml(
      storyDocumentXmlFromPartRoot(revisedDocumentXml, story.xml),
    );
    storyOriginalArchive.setFile(
      'word/_rels/document.xml.rels',
      `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`,
    );
    storyRevisedArchive.setFile(
      'word/_rels/document.xml.rels',
      story.relationshipsXml ??
        `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`,
    );
    stories.push({
      index: 0,
      visualIndex: 0,
      partPath: story.targetPath,
      container: 'ancillaryPart',
      ancillaryMode: 'inserted',
      original: await storyOriginalArchive.save(),
      revised: await storyRevisedArchive.save(),
    });
  }

  for (const story of deletedPartStories) {
    const storyOriginalArchive = await originalArchive.clone();
    const storyRevisedArchive = await revisedArchive.clone();
    storyOriginalArchive.setDocumentXml(
      storyDocumentXmlFromPartRoot(originalDocumentXml, story.xml),
    );
    storyRevisedArchive.setDocumentXml(
      storyDocumentXmlFromPartRoot(revisedDocumentXml, null),
    );
    storyOriginalArchive.setFile(
      'word/_rels/document.xml.rels',
      story.relationshipsXml ??
        `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`,
    );
    storyRevisedArchive.setFile(
      'word/_rels/document.xml.rels',
      `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`,
    );
    stories.push({
      index: 0,
      visualIndex: 0,
      partPath: story.targetPath,
      container: 'ancillaryPart',
      ancillaryMode: 'deleted',
      selectedSlots: story.bindings.map(({ sectionOrdinal, kind, role }) => ({
        sectionOrdinal,
        kind,
        role,
      })),
      original: await storyOriginalArchive.save(),
      revised: await storyRevisedArchive.save(),
    });
  }

  return {
    stories,
    validateProjection:
      paired.pairs.some(
        (pair) =>
          pair.original.textBoxes.length > 0 &&
          pair.original.targetPath !== pair.revised.targetPath,
      ) ||
      paired.unpairedOriginal.some((story) => story.textBoxes.length > 0) ||
      paired.unpairedRevised.some((story) => story.textBoxes.length > 0) ||
      stories.length > 0,
    hasTextBoxStories: stories.some((story) => story.container === 'textBox'),
    representedChanges: [
      ...representedChanges,
      ...insertedPartStories.flatMap((story) =>
        story.bindings.map((binding) => ({
        scope: binding.kind,
        kind: 'added' as const,
        sectionIndex: binding.sectionOrdinal,
        role: binding.role,
        partPath: story.targetPath,
        })),
      ),
      ...deletedPartStories.flatMap((story) =>
        story.bindings.map((binding) => ({
          scope: binding.kind,
          kind: 'removed' as const,
          sectionIndex: binding.sectionOrdinal,
          role: binding.role,
          partPath: story.targetPath,
        })),
      ),
    ],
  };
}

/**
 * Ordinary header/footer stories paired through the section alignment the
 * outer comparison emitted (`sectionAlignedStoryPairing.ts`), for every part
 * the topology-matched pass in `ancillaryStoryInputs` left alone.
 *
 * A story's identity is its effective slot (section × kind × role after
 * inheritance), not its part name or whether a section names it or inherits
 * it. Reject All of `compared` has the original's sections and Accept All the
 * revised document's, so a section added or removed, a page-size or
 * orientation change, or a `w:titlePg` / `w:evenAndOddHeaders` switch no
 * longer stops a header/footer text edit from being tracked.
 *
 * Only plain stories qualify: neither side may hold a text box (those keep the
 * #1204 checks), the compared part must still be the revised part as the outer
 * comparison left it, and the two stories must share the admitted scaffold and
 * relationship closure, as for topology-matched stories. `handledOutputPaths`
 * names compared parts another story (text box, lifecycle, topology-matched)
 * already writes.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.1
 * @see https://github.com/UseJunior/safe-docx/issues/1390
 */
export async function sectionAlignedOrdinaryStoryInputs(
  original: Buffer,
  revised: Buffer,
  compared: Buffer,
  handledOutputPaths: ReadonlySet<string>,
): Promise<{
  stories: TextBoxStoryInput[];
  representedSectionKinds: Array<{ sectionIndex: number; kind: 'header' | 'footer' }>;
}> {
  const none = { stories: [], representedSectionKinds: [] };
  const [originalArchive, revisedArchive, comparedArchive] = await Promise.all([
    DocxArchive.load(original),
    DocxArchive.load(revised),
    DocxArchive.load(compared),
  ]);
  const [originalState, revisedState] = await Promise.all([
    selectedAncillaryState(originalArchive),
    selectedAncillaryState(revisedArchive),
  ]);
  if (!originalState.bindingAuditValid || !revisedState.bindingAuditValid) return none;
  // Nothing to pair when every revised story has an identical original one
  // and both documents show the same stories on the same pages.
  const canonicalByPath = (state: SelectedAncillaryState): Map<string, string> =>
    new Map(state.stories.map((story) => [story.targetPath, story.canonical]));
  const pageInventory = async (archive: DocxArchive, state: SelectedAncillaryState): Promise<string> => {
    const canonical = canonicalByPath(state);
    const bindings = resolveEffectiveStoryBindings({
      documentXml: state.documentXml,
      relationshipsXml: await archive.getFile('word/_rels/document.xml.rels'),
      settingsXml: await archive.getFile('word/settings.xml'),
    });
    return JSON.stringify([
      ...bindings.slots.map((slot) => [slot.displayed, slot.targetPath && canonical.get(slot.targetPath)]),
      ...pageStorySlots(bindings).map(({ slot }) => slot.targetPath && canonical.get(slot.targetPath)),
    ]);
  };
  if (await pageInventory(originalArchive, originalState) === await pageInventory(revisedArchive, revisedState)) {
    return none;
  }

  const bindingsOf = async (
    archive: DocxArchive,
    project: (xml: string) => string,
  ): Promise<ReturnType<typeof resolveEffectiveStoryBindings>> =>
    resolveEffectiveStoryBindings({
      documentXml: project(await archive.getDocumentXml()),
      relationshipsXml: await archive.getFile('word/_rels/document.xml.rels'),
      settingsXml: await archive.getFile('word/settings.xml'),
    });
  const [originalBindings, revisedBindings, rejectedBindings, acceptedBindings] = await Promise.all([
    bindingsOf(originalArchive, rejectAllChanges),
    bindingsOf(revisedArchive, acceptAllChanges),
    bindingsOf(comparedArchive, rejectAllChanges),
    bindingsOf(comparedArchive, acceptAllChanges),
  ]);
  if (![originalBindings, revisedBindings, rejectedBindings, acceptedBindings].every((bindings) => bindings.ok)) {
    return none;
  }

  // A story's identity is its canonical XML plus what each relationship id in
  // it resolves to (ECMA-376 Part 2 §6.5.2.3, §6.5.3.4): two footers with the same markup
  // whose r:id points at different hyperlinks or images are different stories.
  // An internal target also carries its bytes, so a same-named media part
  // whose content differs between packages does not read as the same story.
  // What each relationship id owned by `owner` resolves to; undefined means
  // nothing usable (an internal target missing from the package, or a part
  // reached again through a cycle). An internal target is its bytes plus,
  // recursively, what its own relationships resolve to, so a chart whose
  // drawing differs is a different target even when the chart XML is equal.
  // A target's fingerprint does not depend on the path that reached it (any
  // part that can reach a cycle is unresolved from every entry), so it is
  // computed once per package and part.
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
  ): Promise<{ semantic: string; references: string } | undefined> => {
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

  const storyIdentities = async (
    label: string,
    archive: DocxArchive,
    bindings: ReturnType<typeof resolveEffectiveStoryBindings>[],
  ): Promise<Map<string, string>> => {
    const identities = new Map<string, string>();
    for (const path of new Set(bindings.flatMap((entry) => entry.slots.map((slot) => slot.targetPath)))) {
      if (path === undefined) continue;
      const xml = await archive.getFile(path);
      if (xml === null || isBlankStoryPart(xml)) {
        identities.set(path, BLANK_STORY_IDENTITY);
        continue;
      }
      // An unresolvable reference never matches anything, so no slot showing
      // it is treated as represented.
      identities.set(path, (await resolvedStory(archive, path, xml))?.semantic ?? `unresolved:${label}:${path}`);
    }
    return identities;
  };
  const [originalParts, revisedParts, comparedParts] = await Promise.all([
    storyIdentities('original', originalArchive, [originalBindings]),
    storyIdentities('revised', revisedArchive, [revisedBindings]),
    storyIdentities('compared', comparedArchive, [rejectedBindings, acceptedBindings]),
  ]);
  const identityOf = (identities: ReadonlyMap<string, string>): ((path: string | undefined) => string) =>
    (path) => (path === undefined ? BLANK_STORY_IDENTITY : identities.get(path) ?? BLANK_STORY_IDENTITY);
  const originalStories = new Map(originalState.stories.map((story) => [story.targetPath, story]));
  const revisedStories = new Map(revisedState.stories.map((story) => [story.targetPath, story]));
  const comparedIdentity = identityOf(comparedParts);
  const revisedIdentity = identityOf(revisedParts);

  // What each story's references resolve to, in document order. The story
  // comparison carries the original's references into the Reject All view
  // only when the two stories reference the same things in the same order.
  const referencesOf = async (
    archive: DocxArchive,
    stories: ReadonlyMap<string, { xml: string }>,
  ): Promise<Map<string, string | undefined>> => {
    const references = new Map<string, string | undefined>();
    for (const [path, story] of stories) references.set(path, (await resolvedStory(archive, path, story.xml))?.references);
    return references;
  };
  const [originalReferences, revisedReferences] = await Promise.all([
    referencesOf(originalArchive, originalStories),
    referencesOf(revisedArchive, revisedStories),
  ]);

  const eligible = (comparedPath: string, originalPath: string): boolean => {
    const originalStory = originalStories.get(originalPath);
    const revisedStory = revisedStories.get(comparedPath);
    if (!originalStory || !revisedStory || handledOutputPaths.has(comparedPath)) return false;
    if (originalStory.kind !== revisedStory.kind) return false;
    if (originalStory.textBoxes.length > 0 || revisedStory.textBoxes.length > 0) return false;
    // The compared part must still be the revised part: the redline goes there.
    if (comparedIdentity(comparedPath) !== revisedIdentity(comparedPath)) return false;
    if (originalStory.ordinaryContent === revisedStory.ordinaryContent) return false;
    if (ordinaryStoryScaffoldFingerprint(originalStory.xml) !== ordinaryStoryScaffoldFingerprint(revisedStory.xml)) {
      return false;
    }
    // Both stories must reference the same resolved targets (internal
    // targets by content, VML o:relid included) ...
    const originalResolved = originalReferences.get(originalPath);
    if (originalResolved === undefined || originalResolved !== revisedReferences.get(comparedPath)) return false;
    // ... and the relationship closure the story splice remaps (#713) must
    // read them too; it reads unprefixed relationship parts only.
    const originalClosure = relationshipClosureFingerprint(
      parseXml(originalStory.xml).documentElement,
      relationshipTargets(originalStory.relationshipsXml),
    );
    const revisedClosure = relationshipClosureFingerprint(
      parseXml(revisedStory.xml).documentElement,
      relationshipTargets(revisedStory.relationshipsXml),
    );
    return originalClosure !== undefined && originalClosure === revisedClosure;
  };

  const pairing = pairStoriesThroughSectionAlignment({
    rejected: rejectedBindings,
    original: originalBindings,
    accepted: acceptedBindings,
    revised: revisedBindings,
    originalIdentity: identityOf(originalParts),
    revisedIdentity,
    comparedIdentity,
    eligible,
  });
  if (pairing.pairs.size === 0) return none;

  const originalDocumentXml = await originalArchive.getDocumentXml();
  const revisedDocumentXml = await revisedArchive.getDocumentXml();
  const stories: TextBoxStoryInput[] = [];
  for (const [comparedPath, originalPath] of pairing.pairs) {
    const originalStory = originalStories.get(originalPath)!;
    const revisedStory = revisedStories.get(comparedPath)!;
    const storyOriginalArchive = await originalArchive.clone();
    const storyRevisedArchive = await revisedArchive.clone();
    storyOriginalArchive.setDocumentXml(storyDocumentXmlFromPartRoot(originalDocumentXml, originalStory.xml));
    storyRevisedArchive.setDocumentXml(storyDocumentXmlFromPartRoot(revisedDocumentXml, revisedStory.xml));
    storyOriginalArchive.setFile(
      'word/_rels/document.xml.rels',
      originalStory.relationshipsXml ?? `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`,
    );
    storyRevisedArchive.setFile(
      'word/_rels/document.xml.rels',
      revisedStory.relationshipsXml ?? `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`,
    );
    stories.push({
      index: 0,
      visualIndex: 0,
      partPath: comparedPath,
      container: 'ancillaryPart',
      ancillaryMode: 'ordinary',
      original: await storyOriginalArchive.save(),
      revised: await storyRevisedArchive.save(),
    });
  }
  return { stories, representedSectionKinds: pairing.representedSectionKinds };
}

const BINDING_ORIGIN_NS = 'urn:usejunior:safe-docx:story-binding-origin';
const BINDING_ORIGIN_ATTRIBUTE = 'sdxBindingOrigin:section';

function liveSectionPropertiesInAuditOrder(document: Document): Element[] {
  return Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'sectPr')).filter(
    (sectPr) => !hasAncestorLocalName(sectPr, 'sectPrChange'),
  );
}

function isHeaderFooterReference(element: Element): boolean {
  return element.namespaceURI === OOXML.W_NS &&
    (element.localName === 'headerReference' || element.localName === 'footerReference');
}

/**
 * Records, on a copy of the main document, which section each live
 * `w:sectPr` and each of its header/footer references started in. The
 * appliers clone a removed boundary's references onto the following section
 * (Word's carry, #1144), and a clone keeps the attribute, so after Accept All
 * or Reject All a reference whose origin differs from its section's was
 * carried there. The copy is only ever projected and read, never published.
 */
function withSectionReferenceOrigins(documentXml: string): string {
  const document = parseXml(documentXml);
  for (const [ordinal, sectPr] of liveSectionPropertiesInAuditOrder(document).entries()) {
    sectPr.setAttributeNS(BINDING_ORIGIN_NS, BINDING_ORIGIN_ATTRIBUTE, String(ordinal));
    for (const reference of directChildElements(sectPr).filter(isHeaderFooterReference)) {
      reference.setAttributeNS(BINDING_ORIGIN_NS, BINDING_ORIGIN_ATTRIBUTE, String(ordinal));
    }
  }
  return serializer.serializeToString(document);
}

/**
 * Slots (`section:kind:role`) of a projected, origin-tagged document whose
 * reference was carried onto that section from a removed boundary.
 */
function carriedReferenceSlots(projectedDocumentXml: string): Set<string> {
  const carried = new Set<string>();
  const document = parseXml(projectedDocumentXml);
  for (const [sectionOrdinal, sectPr] of liveSectionPropertiesInAuditOrder(document).entries()) {
    const host = sectPr.getAttributeNS(BINDING_ORIGIN_NS, 'section');
    for (const reference of directChildElements(sectPr).filter(isHeaderFooterReference)) {
      const origin = reference.getAttributeNS(BINDING_ORIGIN_NS, 'section');
      if (!host || !origin || host === origin) continue;
      const role = reference.getAttributeNS(OOXML.W_NS, 'type') || reference.getAttribute('w:type') || '';
      carried.add(`${sectionOrdinal}:${reference.localName === 'headerReference' ? 'header' : 'footer'}:${role}`);
    }
  }
  return carried;
}

/**
 * Part paths that Reject All of `compared` still binds to a section.
 *
 * The projection applies Word's carry (#1144): rejecting an inserted section
 * boundary moves its references onto a following section that has none. With
 * `ignoreCarriedReferences`, those carried references do not count. The
 * comparison passes it for its own output, where an inserted lifecycle story
 * reached only through a carried reference is marked as a whole insertion and
 * so projects to a blank story on that section; what the section then shows is
 * checked against the original by `assertAncillaryTextBoxStoryProjection`. A
 * reference that Reject All keeps in place (a `w:sectPrChange` snapshot cannot
 * remove one, #944) still counts.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @see https://github.com/UseJunior/safe-docx/issues/1204
 */
export async function rejectedSelectedAncillaryStoryPaths(
  compared: Buffer,
  options: { ignoreCarriedReferences?: boolean } = {},
): Promise<Set<string>> {
  const archive = await DocxArchive.load(compared);
  const documentXml = rejectAllChanges(
    withSectionReferenceOrigins(await archive.getDocumentXml()),
  );
  const relationshipsXml = await archive.getFile('word/_rels/document.xml.rels');
  const carried = options.ignoreCarriedReferences
    ? carriedReferenceSlots(documentXml)
    : new Set<string>();
  return new Set(
    auditSectPr(documentXml, relationshipsXml).bindings
      .filter((binding) => !carried.has(storySlotKey(binding)))
      .map((binding) => binding.targetPath),
  );
}

/**
 * Locate each `deleted` lifecycle story in the outer compared package.
 *
 * The outer comparison keeps the removed section's selection reachable from
 * revision markup (a deleted paragraph mark's `w:sectPr`; a `w:sectPrChange`
 * snapshot is `CT_SectPrBase` and cannot carry it, see #944), and imports the
 * selected part wherever the package
 * allocator placed it. A story is representable only when reject-all of the
 * outer document shows one part in every one of its original slots (after
 * inheritance) and accept-all keeps no reference of its own to that part;
 * otherwise a tracked deletion would not project to the original/revised
 * states and the story is left unrepresented. Returns the output part path
 * per representable story.
 *
 * Both projections apply Word's carry (#1144). Accepting the removed boundary
 * can carry its reference onto a following section with none of its own;
 * that reference does not count against the story, whose content is then a
 * whole tracked deletion and projects to a blank story on that section.
 * `assertAncillaryTextBoxStoryProjection` checks what each section shows.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @see https://github.com/UseJunior/safe-docx/issues/754
 * @see https://github.com/UseJunior/safe-docx/issues/1204
 */
export async function deletedAncillaryStoryOutputPaths(
  compared: Buffer,
  stories: readonly TextBoxStoryInput[],
): Promise<Map<TextBoxStoryInput, string>> {
  const resolved = new Map<TextBoxStoryInput, string>();
  const candidates = stories.filter((story) => story.ancillaryMode === 'deleted');
  if (candidates.length === 0) return resolved;
  const archive = await DocxArchive.load(compared);
  const documentXml = withSectionReferenceOrigins(await archive.getDocumentXml());
  const relationshipsXml = await archive.getFile('word/_rels/document.xml.rels');
  const rejected = resolveEffectiveStoryBindings({
    documentXml: rejectAllChanges(documentXml),
    relationshipsXml,
  });
  const acceptedXml = acceptAllChanges(documentXml);
  const carried = carriedReferenceSlots(acceptedXml);
  const acceptedPaths = new Set(
    auditSectPr(acceptedXml, relationshipsXml).bindings
      .filter((binding) => !carried.has(storySlotKey(binding)))
      .map((binding) => binding.targetPath),
  );
  for (const story of candidates) {
    const paths = new Set(
      (story.selectedSlots ?? []).map((slot) => effectiveStorySlot(rejected, slot)?.targetPath),
    );
    const [outputPath] = paths;
    if (
      paths.size !== 1 ||
      outputPath === undefined ||
      acceptedPaths.has(outputPath) ||
      !archive.hasFile(outputPath)
    ) {
      continue;
    }
    resolved.set(story, outputPath);
  }
  return resolved;
}

/**
 * Split supported changed VML text boxes into independent WordprocessingML
 * stories and neutralize them for the outer-body comparison.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.22
 * @see https://github.com/UseJunior/safe-docx/issues/713
 */
export async function prepareTextBoxStoryComparison(
  original: Buffer,
  revised: Buffer,
): Promise<TextBoxStoryComparisonPlan | undefined> {
  const originalArchive = await DocxArchive.load(original);
  const revisedArchive = await DocxArchive.load(revised);
  const originalDocumentXml = await originalArchive.getDocumentXml();
  const revisedDocumentXml = await revisedArchive.getDocumentXml();
  const ancillary = await ancillaryStoryInputs(
    originalArchive,
    revisedArchive,
    originalDocumentXml,
    revisedDocumentXml,
  );
  const originalRelationshipTargets = relationshipTargets(
    await originalArchive.getFile('word/_rels/document.xml.rels'),
  );
  const revisedRelationshipTargets = relationshipTargets(
    await revisedArchive.getFile('word/_rels/document.xml.rels'),
  );
  const originalDocument = parseXml(originalDocumentXml);
  const revisedDocument = parseXml(revisedDocumentXml);
  const originalTextBoxes = Array.from(
    originalDocument.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  );
  const revisedTextBoxes = Array.from(
    revisedDocument.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  );
  const visualOrdinals = visualTextBoxOrdinals(revisedDocument);

  // Pair boxes by anchor identity, not by position (#1031). A box with no
  // counterpart stays whole in the outer comparison, which tracks its anchor
  // run; `markTrackedTextBoxLifecycles` then marks its story.
  const rawIndexOf = (copies: Element[]): Map<Element, number> =>
    new Map(copies.map((copy, rawIndex) => [copy, rawIndex]));
  const originalRawIndex = rawIndexOf(originalTextBoxes);
  const revisedRawIndex = rawIndexOf(revisedTextBoxes);
  const originalCandidates = textBoxPairingCandidates(
    textBoxGroups(originalDocument),
    originalRawIndex,
  );
  const revisedCandidates = textBoxPairingCandidates(
    textBoxGroups(revisedDocument),
    revisedRawIndex,
  );
  const pairing = pairTextBoxCandidates(originalCandidates, revisedCandidates);
  if (pairing.ambiguousStorage) {
    throw new UnsupportedTextBoxRevisionError([{
      index: Math.min(
        pairing.ambiguousStorage.original,
        pairing.ambiguousStorage.revised,
      ),
      partPath: 'word/document.xml',
      reason: DIVERGENT_STORAGE_SHAPE_REASON,
    }]);
  }
  const pairedCopies: Array<[original: Element, revised: Element]> = [];
  for (const [originalIndex, revisedIndex] of pairing.pairs) {
    const originalCandidate = originalCandidates[originalIndex]!;
    const revisedCandidate = revisedCandidates[revisedIndex]!;
    if (originalCandidate.storage !== revisedCandidate.storage) {
      throw new UnsupportedTextBoxRevisionError([{
        index: Math.min(originalIndex, revisedIndex),
        partPath: 'word/document.xml',
        reason: DIVERGENT_STORAGE_SHAPE_REASON,
      }]);
    }
    for (const [offset, originalCopy] of originalCandidate.copies.entries()) {
      pairedCopies.push([originalCopy, revisedCandidate.copies[offset]!]);
    }
  }
  const unpairedTextBoxes =
    pairedCopies.length !== originalTextBoxes.length ||
    pairedCopies.length !== revisedTextBoxes.length;
  // A box with no counterpart is tracked whole, but its story must still be
  // inside the supported subset: a nested box or a note/comment reference in
  // it would be carried into the redline without its own lifecycle (#1380,
  // #1385).
  const sides = [
    {
      side: 'original' as const,
      candidates: originalCandidates,
      paired: new Set(pairing.pairs.map(([original]) => original)),
      rawIndex: originalRawIndex,
      ordinals: visualTextBoxOrdinals(originalDocument),
    },
    {
      side: 'revised' as const,
      candidates: revisedCandidates,
      paired: new Set(pairing.pairs.map(([, revised]) => revised)),
      rawIndex: revisedRawIndex,
      ordinals: visualOrdinals,
    },
  ];
  for (const { side, candidates, paired, rawIndex, ordinals } of sides) {
    for (const [candidateIndex, candidate] of candidates.entries()) {
      if (paired.has(candidateIndex)) continue;
      for (const copy of candidate.copies) {
        const reason = unsupportedStoryReason(copy);
        if (!reason) continue;
        const index = rawIndex.get(copy)!;
        const paragraphId = textBoxParagraphId(copy);
        throw new UnsupportedTextBoxRevisionError([{
          index: ordinals[index] ?? index,
          partPath: 'word/document.xml',
          reason: `${side === 'original' ? 'deleted' : 'inserted'} text box: ${reason}`,
          ...(side === 'original'
            ? { originalParagraphId: paragraphId }
            : { revisedParagraphId: paragraphId }),
        }]);
      }
    }
  }

  const changedCopies: Array<{ originalIndex: number; revisedIndex: number }> = [];
  for (const [originalTextBox, revisedTextBox] of pairedCopies) {
    const index = revisedRawIndex.get(revisedTextBox)!;
    if (canonicalNode(originalTextBox) === canonicalNode(revisedTextBox)) {
      continue;
    }
    const originalRelationshipClosure = relationshipClosureFingerprint(
      originalTextBox,
      originalRelationshipTargets,
    );
    const revisedRelationshipClosure = relationshipClosureFingerprint(
      revisedTextBox,
      revisedRelationshipTargets,
    );
    const reason =
      unsupportedStoryReason(originalTextBox) ??
      unsupportedStoryReason(revisedTextBox) ??
      (hasTextBoxAncestor(originalTextBox) || hasTextBoxAncestor(revisedTextBox)
        ? 'nested text boxes are not supported'
        : undefined) ??
      (originalRelationshipClosure === undefined ||
      revisedRelationshipClosure === undefined ||
      originalRelationshipClosure !== revisedRelationshipClosure
        ? 'the text-box relationship closure changed or could not be resolved'
        : undefined) ??
      scaffoldPairingReason(
        originalTextBox,
        revisedTextBox,
        'the containing VML shape scaffold changed or could not be paired',
      );
    if (reason) {
      throw new UnsupportedTextBoxRevisionError([{
        index: visualOrdinals[index] ?? index,
        partPath: 'word/document.xml',
        reason,
        originalParagraphId: textBoxParagraphId(originalTextBox),
        revisedParagraphId: textBoxParagraphId(revisedTextBox),
      }]);
    }
    changedCopies.push({
      originalIndex: originalRawIndex.get(originalTextBox)!,
      revisedIndex: index,
    });
  }

  const stories: TextBoxStoryInput[] = [...ancillary.stories];
  for (const { originalIndex, revisedIndex: index } of changedCopies) {
    const storyOriginalArchive = await originalArchive.clone();
    const storyRevisedArchive = await revisedArchive.clone();
    storyOriginalArchive.setDocumentXml(
      storyDocumentXml(originalDocumentXml, originalIndex),
    );
    storyRevisedArchive.setDocumentXml(
      storyDocumentXml(revisedDocumentXml, index),
    );
    stories.push({
      index,
      visualIndex: visualOrdinals[index] ?? index,
      partPath: 'word/document.xml',
      container: 'textBox',
      original: await storyOriginalArchive.save(),
      revised: await storyRevisedArchive.save(),
    });
    // Both sides carry the revised raw index, so the outer comparison sees
    // one unchanged placeholder and the splice finds it by that token.
    createPlaceholder(originalTextBoxes[originalIndex]!, index);
    createPlaceholder(revisedTextBoxes[index]!, index);
  }

  if (
    stories.length === 0 &&
    !ancillary.validateProjection &&
    !unpairedTextBoxes
  ) {
    return undefined;
  }

  const outerOriginalArchive = await originalArchive.clone();
  const outerRevisedArchive = await revisedArchive.clone();
  outerOriginalArchive.setDocumentXml(serializer.serializeToString(originalDocument));
  outerRevisedArchive.setDocumentXml(serializer.serializeToString(revisedDocument));

  return {
    outerOriginal: await outerOriginalArchive.save(),
    outerRevised: await outerRevisedArchive.save(),
    originalDocumentXml,
    revisedDocumentXml,
    stories,
    validateAncillaryProjection: ancillary.validateProjection,
    hasAncillaryTextBoxStories: ancillary.hasTextBoxStories,
    hasUnpairedTextBoxes: unpairedTextBoxes,
    representedAncillaryChanges: ancillary.representedChanges,
  };
}

/**
 * Splice independently compared text-box stories into the preserved outer
 * document scaffold.
 */
export async function assembleTextBoxStoryComparison(
  outerCompared: Buffer,
  storyResults: ReadonlyArray<{
    index: number;
    visualIndex: number;
    partPath: string;
    container: 'textBox' | 'ancillaryPart';
    document: Buffer;
    /** The story's original and revised sides, for a tracked placeholder. */
    original?: Buffer;
    revised?: Buffer;
  }>,
): Promise<Buffer> {
  const outerArchive = await DocxArchive.load(outerCompared);
  const outerDocument = parseXml(await outerArchive.getDocumentXml());

  for (const storyResult of storyResults) {
    let targetDocument = outerDocument;
    if (storyResult.partPath !== 'word/document.xml') {
      const targetXml = await outerArchive.getFile(storyResult.partPath);
      if (targetXml === null) {
        throw new UnsupportedTextBoxRevisionError([{
          index: storyResult.visualIndex,
          partPath: storyResult.partPath,
          reason: 'the selected output story part is missing',
        }]);
      }
      targetDocument = parseXml(targetXml);
    }
    const storyArchive = await DocxArchive.load(storyResult.document);
    const storyDocument = parseXml(await storyArchive.getDocumentXml());
    const storyBody = storyDocument
      .getElementsByTagNameNS(OOXML.W_NS, 'body')
      .item(0);
    if (!storyBody) {
      throw new Error(`Compared nested story ${storyResult.index} has no w:body`);
    }
    await remapComparedStoryRelationshipIds(
      storyArchive,
      outerArchive,
      storyResult.partPath,
      storyBody,
      storyResult.visualIndex,
    );
    if (storyResult.container === 'ancillaryPart') {
      const target = targetDocument.documentElement;
      while (target.firstChild) target.removeChild(target.firstChild);
      for (const child of directChildElements(storyBody)) {
        if (
          child.namespaceURI === OOXML.W_NS &&
          child.localName === 'sectPr'
        ) {
          continue;
        }
        target.appendChild(targetDocument.importNode(child, true));
      }
      outerArchive.setFile(
        storyResult.partPath,
        serializer.serializeToString(targetDocument),
      );
      continue;
    }
    if (storyResult.partPath === 'word/document.xml') {
      await spliceBodyTextBoxStory(targetDocument, outerArchive, storyResult, storyBody);
      continue;
    }
    const target = targetDocument
      .getElementsByTagNameNS(OOXML.W_NS, 'txbxContent')
      .item(storyResult.index);
    if (!target) {
      throw new UnsupportedTextBoxRevisionError([{
        index: storyResult.visualIndex,
        partPath: storyResult.partPath,
        reason: 'the outer comparison changed text-box story topology',
      }]);
    }
    while (target.firstChild) target.removeChild(target.firstChild);
    for (const child of directChildElements(storyBody)) {
      if (
        child.namespaceURI === OOXML.W_NS &&
        child.localName === 'sectPr'
      ) {
        continue;
      }
      target.appendChild(targetDocument.importNode(child, true));
    }
    if (storyResult.partPath !== 'word/document.xml') {
      outerArchive.setFile(
        storyResult.partPath,
        serializer.serializeToString(targetDocument),
      );
    }
  }

  outerArchive.setDocumentXml(serializer.serializeToString(outerDocument));
  return outerArchive.save();
}

/**
 * The run-level revision wrapper around a text box's anchor in the compared
 * body, or `undefined` when the anchor is unchanged.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 */
function anchorRevisionWrapper(
  textBox: Element,
): 'ins' | 'del' | 'moveFrom' | 'moveTo' | undefined {
  for (let node = textBox.parentNode; node?.nodeType === 1; node = node.parentNode) {
    const element = node as Element;
    if (element.namespaceURI !== OOXML.W_NS) continue;
    if (
      element.localName === 'ins' ||
      element.localName === 'del' ||
      element.localName === 'moveFrom' ||
      element.localName === 'moveTo'
    ) {
      return element.localName;
    }
  }
  return undefined;
}

/**
 * One side's story body, with its relationship ids rebound to the compared
 * package. The side story carries its own document's ids, which the compared
 * package (built on the revised relationships) may number differently.
 */
async function reboundSideStoryBody(
  side: Buffer,
  outerArchive: DocxArchive,
  visualIndex: number,
): Promise<Element> {
  const archive = await DocxArchive.load(side);
  const body = parseXml(await archive.getDocumentXml())
    .getElementsByTagNameNS(OOXML.W_NS, 'body')
    .item(0);
  if (!body) throw new Error('A text-box story document has no w:body');
  await remapComparedStoryRelationshipIds(
    archive,
    outerArchive,
    'word/document.xml',
    body,
    visualIndex,
  );
  return body;
}

function replaceStoryContent(target: Element, storyBody: Element): void {
  while (target.firstChild) target.removeChild(target.firstChild);
  for (const child of directChildElements(storyBody)) {
    if (child.namespaceURI === OOXML.W_NS && child.localName === 'sectPr') continue;
    target.appendChild(target.ownerDocument!.importNode(child, true));
  }
}

/**
 * Splice one compared body text-box story back into the outer comparison.
 *
 * The story is found by its placeholder token, not by raw position: once
 * unpaired boxes stay in the outer comparison, the compared body holds the
 * deleted and the inserted boxes together and raw positions no longer match
 * either input (#1031). The outer comparison normally keeps the placeholder
 * once, unchanged, and the compared story goes there. When it instead
 * tracked the anchor as deleted and reinserted (a rewritten anchor
 * paragraph), each tracked copy receives that side's whole story, which
 * `markTrackedTextBoxLifecycles` then marks as deleted or inserted; a moved
 * anchor's two copies receive their sides unmarked.
 */
async function spliceBodyTextBoxStory(
  targetDocument: Document,
  outerArchive: DocxArchive,
  storyResult: {
    index: number;
    visualIndex: number;
    partPath: string;
    original?: Buffer;
    revised?: Buffer;
  },
  comparedStoryBody: Element,
): Promise<void> {
  const token = placeholderToken(storyResult.index);
  const occurrences = Array.from(
    targetDocument.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  ).filter((textBox) => (textBox.textContent ?? '') === token);
  const kept = occurrences.filter((textBox) => anchorRevisionWrapper(textBox) === undefined);
  const tracked = occurrences.filter((textBox) => anchorRevisionWrapper(textBox) !== undefined);
  const sideBody = async (side: Buffer | undefined): Promise<Element | undefined> =>
    side ? reboundSideStoryBody(side, outerArchive, storyResult.visualIndex) : undefined;
  const trackedBodies = new Map<Element, Element | undefined>();
  for (const textBox of tracked) {
    trackedBodies.set(
      textBox,
      await sideBody(
        ['ins', 'moveTo'].includes(anchorRevisionWrapper(textBox)!)
          ? storyResult.revised
          : storyResult.original,
      ),
    );
  }
  if (
    kept.length > 1 ||
    occurrences.length === 0 ||
    [...trackedBodies.values()].some((body) => body === undefined)
  ) {
    throw new UnsupportedTextBoxRevisionError([{
      index: storyResult.visualIndex,
      partPath: storyResult.partPath,
      reason: 'the outer comparison changed text-box story topology',
    }]);
  }
  for (const textBox of kept) replaceStoryContent(textBox, comparedStoryBody);
  for (const [textBox, body] of trackedBodies) replaceStoryContent(textBox, body!);
}

/**
 * Mark the story of every body text box whose anchor the outer comparison
 * tracked as inserted or deleted.
 *
 * A box with no counterpart in the other document stays whole in the outer
 * comparison, which wraps its anchor run in `w:ins` or `w:del`. Its story is a
 * separate story, so the anchor revision does not reach its paragraphs: each
 * story paragraph receives a paragraph-mark revision and each text run a
 * run-level revision of the same kind, the way Word tracks a text box typed
 * or deleted with change tracking on. Accepting or rejecting the anchor then
 * agrees with accepting or rejecting the story. Every stored copy of an
 * `mc:AlternateContent` twin is marked; the count reports visual boxes'
 * paragraphs once.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @see https://github.com/UseJunior/safe-docx/issues/1031
 */
export async function markTrackedTextBoxLifecycles(
  compared: Buffer,
  author: string,
  date: Date,
  minimumRevisionId = 0,
): Promise<{ document: Buffer; insertedParagraphs: number; deletedParagraphs: number }> {
  const archive = await DocxArchive.load(compared);
  const document = parseXml(await archive.getDocumentXml());
  const trackedBoxes = Array.from(
    document.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  ).filter((textBox) => {
    if (hasTextBoxAncestor(textBox)) return false;
    // A moved anchor carries the same story on both sides of the move, so
    // its story is not an insertion or a deletion and stays unmarked.
    const wrapper = anchorRevisionWrapper(textBox);
    return wrapper === 'ins' || wrapper === 'del';
  });
  if (trackedBoxes.length === 0) {
    return { document: compared, insertedParagraphs: 0, deletedParagraphs: 0 };
  }
  const preservedRoots: Element[] = [];
  for (const path of archive.listFiles()) {
    if (!/^word\/.*\.xml$/u.test(path) || path === 'word/document.xml') continue;
    const xml = await archive.getFile(path);
    if (!xml) continue;
    try {
      preservedRoots.push(parseXml(xml).documentElement);
    } catch {
      // Non-WordprocessingML extension parts are irrelevant to revision IDs.
    }
  }
  const state = createRevisionIdState([document.documentElement, ...preservedRoots]);
  state.nextId = Math.max(state.nextId, minimumRevisionId);
  const dateString = formatDate(date);
  const rendered = new Set(textBoxGroups(document).map((group) => group.selected));
  let insertedParagraphs = 0;
  let deletedParagraphs = 0;
  for (const textBox of trackedBoxes) {
    const markerTag = anchorRevisionWrapper(textBox) === 'ins' ? 'w:ins' : 'w:del';
    const paragraphs = Array.from(textBox.getElementsByTagNameNS(OOXML.W_NS, 'p'));
    for (const paragraph of paragraphs) {
      markLifecycleParagraph(paragraph, markerTag, author, dateString, state);
    }
    if (!rendered.has(textBox)) continue;
    if (markerTag === 'w:ins') insertedParagraphs += paragraphs.length;
    else deletedParagraphs += paragraphs.length;
  }
  archive.setDocumentXml(serializer.serializeToString(document));
  return { document: await archive.save(), insertedParagraphs, deletedParagraphs };
}

const REVISION_WRAPPER_NAMES = new Set(['ins', 'del', 'moveFrom', 'moveTo']);

function hasAncestorBelow(element: Element, stopAt: Element, localName: string): boolean {
  for (let current = element.parentElement; current && current !== stopAt; current = current.parentElement) {
    if (current.namespaceURI === OOXML.W_NS && current.localName === localName) return true;
  }
  return false;
}

function hasRevisionWrapperAncestor(element: Element, stopAt: Element): boolean {
  for (let current = element.parentElement; current && current !== stopAt; current = current.parentElement) {
    if (current.namespaceURI === OOXML.W_NS && REVISION_WRAPPER_NAMES.has(current.localName)) {
      return true;
    }
  }
  return false;
}

/**
 * Mark one paragraph of a story whose whole lifecycle is an insertion or a
 * deletion: a paragraph-mark revision, plus a run-level wrapper on every run
 * that is not a drawing/VML carrier, does not belong to a nested text box, and
 * is not already inside a revision wrapper.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 */
function markLifecycleParagraph(
  paragraph: Element,
  markerTag: 'w:ins' | 'w:del',
  author: string,
  dateString: string,
  state: ReturnType<typeof createRevisionIdState>,
): void {
  addParagraphMarkRevisionMarker(
    paragraph,
    markerTag,
    author,
    dateString,
    state,
  );
  for (const run of Array.from(
    paragraph.getElementsByTagNameNS(OOXML.W_NS, 'r'),
  ).filter(
    (element) =>
      // Runs of nested text-box paragraphs belong to those paragraphs.
      !hasAncestorBelow(element, paragraph, 'txbxContent') &&
      !hasRevisionWrapperAncestor(element, paragraph) &&
      element.getElementsByTagNameNS(OOXML.W_NS, 'drawing').length === 0 &&
      element.getElementsByTagNameNS(OOXML.W_NS, 'pict').length === 0 &&
      element.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent').length === 0,
  )) {
    wrapRunWithTrackChange({
      run,
      tagName: markerTag,
      author,
      dateStr: dateString,
      state,
      convertTextToDelText: markerTag === 'w:del',
    });
  }
}

/**
 * Mark every paragraph boundary in a relationship-selected story owned by an
 * inserted section. Paragraph-mark revisions make empty paragraphs and
 * drawing/text-box carrier paragraphs visible without wrapping an unchanged
 * VML/DrawingML object in a run-level revision.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @see https://github.com/UseJunior/safe-docx/issues/648
 */
export async function markInsertedAncillaryStoryParagraphs(
  storyDocument: Buffer,
  preservedPackage: Buffer,
  author: string,
  date: Date,
  minimumRevisionId = 0,
): Promise<{ document: Buffer; markedParagraphs: number }> {
  return markLifecycleAncillaryStoryParagraphs(
    storyDocument,
    preservedPackage,
    author,
    date,
    minimumRevisionId,
    'w:ins',
  );
}

/**
 * Mark every paragraph boundary in a relationship-selected story whose
 * selecting section slot was removed, so the story's text is a tracked
 * deletion (`w:del` paragraph marks, `w:delText` runs) rather than plain
 * content that survives accept-all. VML/DrawingML carrier runs are left
 * unwrapped, as on the insertion side.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @see https://github.com/UseJunior/safe-docx/issues/754
 */
export async function markDeletedAncillaryStoryParagraphs(
  storyDocument: Buffer,
  preservedPackage: Buffer,
  author: string,
  date: Date,
  minimumRevisionId = 0,
): Promise<{ document: Buffer; markedParagraphs: number }> {
  return markLifecycleAncillaryStoryParagraphs(
    storyDocument,
    preservedPackage,
    author,
    date,
    minimumRevisionId,
    'w:del',
  );
}

/**
 * Shared marker for lifecycle stories. Every paragraph in the story, including
 * paragraphs inside tables and nested text boxes, receives a paragraph-mark
 * revision; every run that is not a drawing/VML carrier and is not already
 * inside a revision wrapper is wrapped. Runs inside `w:hyperlink`,
 * `w:fldSimple` and run-level `w:sdt` are included, since those containers
 * admit run-level revision elements.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.22
 */
async function markLifecycleAncillaryStoryParagraphs(
  storyDocument: Buffer,
  preservedPackage: Buffer,
  author: string,
  date: Date,
  minimumRevisionId: number,
  markerTag: 'w:ins' | 'w:del',
): Promise<{ document: Buffer; markedParagraphs: number }> {
  const archive = await DocxArchive.load(storyDocument);
  const document = parseXml(await archive.getDocumentXml());
  const body = document.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0);
  if (!body) throw new Error('Compared ancillary story has no w:body');
  const preservedArchive = await DocxArchive.load(preservedPackage);
  const preservedRoots: Element[] = [document.documentElement];
  for (const path of preservedArchive.listFiles()) {
    if (!/^word\/.*\.xml$/u.test(path)) continue;
    const xml = await preservedArchive.getFile(path);
    if (!xml) continue;
    try {
      preservedRoots.push(parseXml(xml).documentElement);
    } catch {
      // Non-WordprocessingML extension parts are irrelevant to revision IDs.
    }
  }
  const state = createRevisionIdState(preservedRoots);
  state.nextId = Math.max(state.nextId, minimumRevisionId);
  const dateString = formatDate(date);
  const markParagraph = (paragraph: Element): void =>
    markLifecycleParagraph(paragraph, markerTag, author, dateString, state);
  // Nested text-box paragraphs are marked on their own; every other paragraph
  // in the story (direct, table cell, block-level sdt) is marked here and
  // counted as one represented range.
  let markedParagraphs = 0;
  for (const paragraph of Array.from(
    body.getElementsByTagNameNS(OOXML.W_NS, 'p'),
  )) {
    if (hasAncestorBelow(paragraph, body, 'txbxContent')) continue;
    markedParagraphs += 1;
    markParagraph(paragraph);
    for (const textBox of Array.from(
      paragraph.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
    )) {
      for (const nestedParagraph of Array.from(
        textBox.getElementsByTagNameNS(OOXML.W_NS, 'p'),
      )) {
        markParagraph(nestedParagraph);
      }
    }
  }
  archive.setDocumentXml(serializer.serializeToString(document));
  return {
    document: await archive.save(),
    markedParagraphs,
  };
}

/**
 * What a projected document shows in its headers and footers: one entry per
 * section, kind and kind of page (first, odd, even), naming the content of the
 * story that page uses after inheritance, with the bound part projected the
 * same way. Keying by page rather than by reference type means a display
 * switch (`w:titlePg`, `w:evenAndOddHeaders`) that moves a page onto another
 * story changes the inventory. Blank parts are left out, so a page showing a
 * story whose content was entirely a tracked insertion (rejected) or deletion
 * (accepted) reads the same as a page with no story at all.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.1
 * @see https://github.com/UseJunior/safe-docx/issues/1204
 */
async function displayedStoryProjectionInventory(
  archive: DocxArchive,
  documentXml: string,
  projection: 'accept' | 'reject',
): Promise<string[]> {
  const relationshipsXml = await archive.getFile('word/_rels/document.xml.rels');
  const preliminary = auditSectPr(documentXml, relationshipsXml);
  if (!preliminary.ok) {
    throw new UnsupportedTextBoxRevisionError(
      unsupportedBindingChanges(preliminary.issues),
    );
  }
  const parts = new Map<string, string>();
  for (const targetPath of new Set(
    preliminary.bindings.map((binding) => binding.targetPath),
  )) {
    const xml = await archive.getFile(targetPath);
    if (xml !== null) parts.set(targetPath, xml);
  }
  const bindings = resolveEffectiveStoryBindings({
    documentXml,
    relationshipsXml,
    settingsXml: await archive.getFile('word/settings.xml'),
    packageParts: parts,
  });
  if (!bindings.ok) {
    throw new UnsupportedTextBoxRevisionError(
      unsupportedBindingChanges(bindings.issues),
    );
  }
  const project = projection === 'accept' ? acceptAllChanges : rejectAllChanges;
  const projectedParts = new Map<string, string | null>();
  const shown = (targetPath: string): string | null => {
    if (!projectedParts.has(targetPath)) {
      const projectedXml = project(parts.get(targetPath)!);
      projectedParts.set(
        targetPath,
        isBlankStoryPart(projectedXml)
          ? null
          : [
            ordinaryStoryScaffoldFingerprint(projectedXml),
            extractRoundTripComparisonText(projectedXml),
          ].join('|'),
      );
    }
    return projectedParts.get(targetPath)!;
  };
  const inventory = [`sections|${bindings.sectionCount}`];
  for (const { page, slot } of pageStorySlots(bindings)) {
    const content = slot.targetPath === undefined ? null : shown(slot.targetPath);
    if (content === null) continue;
    inventory.push([slot.sectionOrdinal, slot.kind, page, content].join('|'));
  }
  return inventory;
}

/**
 * Validate the header/footer stories each section shows after accept-all and
 * reject-all, independent of physical part allocation.
 *
 * Word shows effective bindings, not the literal references: Accept All and
 * Reject All carry a removed section boundary's references onto a following
 * section that has none (#1144), and a section without a reference of some
 * type shows the previous section's story of that type. The check therefore
 * projects with the carry, resolves each section's slots through
 * inheritance, and compares what the first, odd and even pages of each
 * section show (`w:titlePg` and `w:evenAndOddHeaders` decide which story a
 * page uses); a story that projects to blank counts as no story. The
 * compared package carries the revised settings part, so a revision that
 * turns `w:evenAndOddHeaders` on or off is refused when Reject All would
 * leave the original's even pages showing a different story.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.1
 * @see https://github.com/UseJunior/safe-docx/issues/726
 * @see https://github.com/UseJunior/safe-docx/issues/1204
 */
export async function assertAncillaryTextBoxStoryProjection(
  original: Buffer,
  revised: Buffer,
  compared: Buffer,
): Promise<void> {
  const [originalArchive, revisedArchive, comparedArchive] = await Promise.all([
    DocxArchive.load(original),
    DocxArchive.load(revised),
    DocxArchive.load(compared),
  ]);
  const [originalXml, revisedXml, comparedXml] = await Promise.all([
    originalArchive.getDocumentXml(),
    revisedArchive.getDocumentXml(),
    comparedArchive.getDocumentXml(),
  ]);
  const [
    expectedOriginal,
    expectedRevised,
    rejectedCompared,
    acceptedCompared,
  ] = await Promise.all([
    displayedStoryProjectionInventory(
      originalArchive,
      rejectAllChanges(originalXml),
      'reject',
    ),
    displayedStoryProjectionInventory(
      revisedArchive,
      acceptAllChanges(revisedXml),
      'accept',
    ),
    displayedStoryProjectionInventory(
      comparedArchive,
      rejectAllChanges(comparedXml),
      'reject',
    ),
    displayedStoryProjectionInventory(
      comparedArchive,
      acceptAllChanges(comparedXml),
      'accept',
    ),
  ]);
  if (
    JSON.stringify(expectedOriginal) !== JSON.stringify(rejectedCompared) ||
    JSON.stringify(expectedRevised) !== JSON.stringify(acceptedCompared)
  ) {
    const digest = (items: string[]): string =>
      createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 12);
    throw new UnsupportedTextBoxRevisionError([{
      index: 0,
      partPath: 'word/document.xml',
      reason:
        'assembled relationship-selected stories failed accept/reject package projection validation ' +
        `(original ${digest(expectedOriginal)} != ${digest(rejectedCompared)}; ` +
        `revised ${digest(expectedRevised)} != ${digest(acceptedCompared)})`,
    }]);
  }
}

/**
 * Fail closed when a comparison would need to place tracked revision markup
 * inside a text-box story. The atomizer currently treats the containing VML or
 * DrawingML object as atomic, and wrapping the changed object produces a DOCX
 * that Microsoft Word rejects as unreadable.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/647
 */
export function assertTextBoxContentUnchanged(
  originalDocumentXml: string,
  revisedDocumentXml: string,
): void {
  const originalTextBoxes = textBoxes(originalDocumentXml);
  const revisedTextBoxes = textBoxes(revisedDocumentXml);
  const count = Math.max(originalTextBoxes.length, revisedTextBoxes.length);
  const changes: TextBoxRevisionChange[] = [];

  // Hash every stored copy, not only the rendered one: a change confined to an
  // `mc:Fallback` twin is still a change this guard has to refuse. Only the
  // reported ordinal counts visually, so `#w:txbxContent[N]` names a box a
  // reader can actually find.
  const signature = (
    group: MarkupCompatibilityGroup | undefined,
  ): string | undefined =>
    group
      ? createHash('sha256')
          .update(allCopies(group).map(canonicalNode).join('\u0000'))
          .digest('hex')
      : undefined;

  for (let index = 0; index < count; index++) {
    const originalTextBox = originalTextBoxes[index];
    const revisedTextBox = revisedTextBoxes[index];
    if (signature(originalTextBox) === signature(revisedTextBox)) continue;

    changes.push({
      index,
      originalParagraphId: originalTextBox
        ? textBoxParagraphId(originalTextBox.selected)
        : undefined,
      revisedParagraphId: revisedTextBox
        ? textBoxParagraphId(revisedTextBox.selected)
        : undefined,
    });
  }

  if (changes.length > 0) throw new UnsupportedTextBoxRevisionError(changes);
}
