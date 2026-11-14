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
import { createResolvedStoryReader, owningRelationshipsPath } from './storyRelationshipIdentity.js';
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
  copyIdentityTokens,
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
  allocateRevisionId,
  createRevisionIdState,
  formatDate,
  wrapRunWithTrackChange,
} from './revisionMarkup.js';
import { importRelationshipTarget } from './relationshipIdCollision.js';
import { PayloadFingerprints, resolvePartPath, sectionIndexOf } from './picturePayload.js';
import type { UnrepresentedChange, UnrepresentedDrawingChange } from '../compare-types.js';

const WORD_2010_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const VML_NS = 'urn:schemas-microsoft-com:vml';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_VML_NS = 'urn:schemas-microsoft-com:office:office';
const WORDPROCESSING_DRAWING_NS =
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
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
  /**
   * Set on an `inserted` or `deleted` story whose slot both documents select
   * because `normalizeExplicitStorySlots` gave the side without a reference a
   * blank story there (#1394). Its part stays selected in both projections,
   * so it is written to `partPath` without the reference checks a section
   * lifecycle needs.
   */
  slotLifecycle?: boolean;
  /**
   * The placeholder token a header/footer box compared inside its whole part
   * is found by in the compared part (#1384). Absent for every other story.
   */
  placeholder?: string;
  original: Buffer;
  revised: Buffer;
}

export interface TextBoxStoryComparisonPlan {
  outerOriginal: Buffer;
  outerRevised: Buffer;
  /**
   * The original main document as the redline's Reject All shows it: a body
   * box stored differently in the two documents (VML only, DrawingML only,
   * or twinned in `mc:AlternateContent`) carries the revised storage around
   * the original story (#1383).
   */
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
  /**
   * Header and footer parts compared whole because a text box was inserted
   * into or deleted from them; the caller marks those boxes' stories with
   * `markTrackedTextBoxLifecycles` (#1384).
   */
  lifecycleAncillaryPartPaths?: string[];
  representedAncillaryChanges: Array<{
    scope: 'header' | 'footer';
    kind: 'added' | 'changed' | 'removed';
    sectionIndex: number;
    role: 'default' | 'first' | 'even';
    partPath: string;
  }>;
  /**
   * Text boxes whose drawing (size, position, wrap) changed with no revision
   * markup to carry it: listed in `unrepresentedChanges` with the `drawing`
   * scope (#1382).
   */
  drawingChanges?: UnrepresentedChange[];
  /**
   * Header and footer parts whose whole difference is their text-box stories
   * plus the drawings in `drawingChanges`; their header/footer entry is
   * represented by those (#1382). A part with no changed story is the revised
   * part untouched, so its Reject All is the original with exactly those
   * drawings replaced by construction; a part with a changed story is held to
   * that by the projection check.
   */
  drawingAccountedPartPaths?: string[];
  /**
   * The original package with each listed header/footer drawing replaced by
   * the revised drawing around the original stories: what Reject All of the
   * redline must show, for the header/footer projection check (#1382).
   */
  ancillaryProjectionOriginal?: Buffer;
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

function placeholderToken(index: number, prefix = '__safe_docx_text_box_story_'): string {
  return `${prefix}${index}__`;
}

/**
 * A placeholder prefix that occurs in none of `documents`, so a token can
 * never match text a document already holds. The splice reads a box's text
 * as its `textContent`, so the prefix is checked against the parsed text
 * (entities decoded, runs and paragraphs joined) as well as the markup.
 */
function collisionFreePlaceholderPrefix(documents: readonly Document[]): string {
  const haystacks = documents.flatMap((document) => [
    serializer.serializeToString(document),
    document.documentElement.textContent ?? '',
  ]);
  for (let attempt = 0; ; attempt += 1) {
    const prefix = `__safe_docx_text_box_story_${attempt === 0 ? '' : `${attempt}_`}`;
    if (haystacks.every((haystack) => !haystack.includes(prefix))) return prefix;
  }
}

function createPlaceholder(textBox: Element, index: number, token = placeholderToken(index)): void {
  while (textBox.firstChild) textBox.removeChild(textBox.firstChild);
  const document = textBox.ownerDocument!;
  const paragraph = document.createElementNS(OOXML.W_NS, 'w:p');
  const run = document.createElementNS(OOXML.W_NS, 'w:r');
  const text = document.createElementNS(OOXML.W_NS, 'w:t');
  text.appendChild(
    document.createTextNode(token),
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
 * is how a DrawingML (`wps:txbx`) box presents; `nearestDrawingMlShape` finds
 * that box's host.
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

const WORDPROCESSING_SHAPE_NS =
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

/**
 * The DrawingML shape hosting a story: the `wps:wsp` whose `wps:txbx` is the
 * story's parent, as a text box Word writes without a VML twin presents.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 20.4.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/1383
 */
function nearestDrawingMlShape(textBox: Element): Element | undefined {
  const host = textBox.parentNode;
  if (
    host?.nodeType !== 1 ||
    (host as Element).namespaceURI !== WORDPROCESSING_SHAPE_NS ||
    (host as Element).localName !== 'txbx'
  ) {
    return undefined;
  }
  const shape = host.parentNode;
  return shape?.nodeType === 1 &&
    (shape as Element).namespaceURI === WORDPROCESSING_SHAPE_NS &&
    (shape as Element).localName === 'wsp'
    ? shape as Element
    : undefined;
}

/**
 * Fingerprint the shape that hosts a story, with the story emptied out: the
 * VML shape around a `v:textbox`, or the DrawingML `wps:wsp` around a
 * `wps:txbx`.
 *
 * Returns `undefined` when neither host is there. That is not "an empty
 * scaffold"; it is "no scaffold this function can describe", so callers MUST
 * fail closed on `undefined` on either side rather than comparing the two
 * results, exactly as they do for `relationshipClosureFingerprint`: two
 * `undefined`s are the absence of a pairing, never a successful one. A
 * standalone DrawingML box, which Word writes with no VML fallback, has its
 * `wps:wsp` host and is inside the subset (#1383).
 *
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.22
 * @conformance ECMA-376 edition 5, Part 1 § 20.4.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/795
 * @see https://github.com/UseJunior/safe-docx/issues/1383
 */
function scaffoldFingerprint(textBox: Element): string | undefined {
  const shape = nearestShape(textBox) ?? nearestDrawingMlShape(textBox);
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
 * scaffold guard skips a copy inside `mc:AlternateContent`. Deciding which
 * copy of a twin is the rendered one — and therefore which scaffold governs —
 * is the `mc:AlternateContent`-aware story walk's job (#794). A standalone
 * DrawingML box is fingerprinted by its `wps:wsp` host (#1383).
 *
 * @see https://github.com/UseJunior/safe-docx/issues/794
 * @see https://github.com/UseJunior/safe-docx/issues/795
 */
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
 * pair". A scaffold that *differs* is paired: the shape change is carried
 * and reported by `drawingShapeChange` (#1382).
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
  if (
    scaffoldFingerprint(originalTextBox) === undefined ||
    scaffoldFingerprint(revisedTextBox) === undefined
  ) {
    return reason;
  }
  return undefined;
}

const DRAWING_CONTAINER_NAMES = new Set(['drawing', 'pict', 'object']);

/**
 * The run-level drawing container (`w:drawing`, `w:pict` or `w:object`) that
 * hosts a text-box story, whichever vocabulary (VML or DrawingML) sits
 * between the two.
 */
function drawingContainer(textBox: Element): Element | undefined {
  for (let node = textBox.parentNode; node?.nodeType === 1; node = node.parentNode) {
    const element = node as Element;
    if (element.namespaceURI !== OOXML.W_NS) continue;
    if (DRAWING_CONTAINER_NAMES.has(element.localName)) return element;
    if (['txbxContent', 'r', 'p', 'body'].includes(element.localName)) return undefined;
  }
  return undefined;
}

/** The text boxes a drawing container hosts directly, not those nested in their stories. */
function ownTextBoxes(container: Element): Element[] {
  return Array.from(container.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'))
    .filter((textBox) => {
      for (let node = textBox.parentNode; node && node !== container; node = node.parentNode) {
        const element = node as Element;
        if (element.namespaceURI === OOXML.W_NS && element.localName === 'txbxContent') return false;
      }
      return true;
    });
}

const DRAWING_GROUP_NAMES = new Set(['group', 'wgp', 'grpSp', 'wpc', 'lockedCanvas']);
const DRAWINGML_MAIN_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

/**
 * Is the text box's shape the only shape its drawing draws? Anything else
 * the drawing holds — a VML or DrawingML group or canvas, another VML shape
 * beside the host (a `v:shapetype` template aside), a second `wp:anchor` or
 * `wp:inline`, or a second graphic object — is geometry a note naming this
 * box would not describe. Shapes inside the box's own story are its story's
 * business and do not count.
 */
function isSoleDrawingShape(textBox: Element, container: Element): boolean {
  for (let node = textBox.parentNode; node && node !== container; node = node.parentNode) {
    if (node.nodeType === 1 && DRAWING_GROUP_NAMES.has((node as Element).localName)) return false;
  }
  const children = directChildElements(container);
  if (container.localName === 'pict') {
    const host = nearestShape(textBox);
    return host !== undefined && host.parentNode === container &&
      children.every((child) =>
        child === host || (child.namespaceURI === VML_NS && child.localName === 'shapetype'));
  }
  if (container.localName !== 'drawing' || children.length !== 1) return false;
  const outsideStories = (element: Element): boolean => {
    for (let node = element.parentNode; node && node !== container; node = node.parentNode) {
      const ancestor = node as Element;
      if (ancestor.namespaceURI === OOXML.W_NS && ancestor.localName === 'txbxContent') return false;
    }
    return true;
  };
  const graphicData = Array.from(container.getElementsByTagNameNS(DRAWINGML_MAIN_NS, 'graphicData'))
    .filter(outsideStories);
  return graphicData.length === 1 && directChildElements(graphicData[0]!).length === 1;
}

/**
 * Do the drawings carry the same VML shape templates (`v:shapetype`)? A
 * template is shared by every shape whose `type` names it, inside the drawing
 * or anywhere else in the part, so carrying a changed template would reshape
 * boxes a note naming this box does not describe.
 */
function shapeTemplatesAgree(originalContainer: Element, revisedContainer: Element): boolean {
  const templates = (container: Element): string[] =>
    Array.from(container.getElementsByTagNameNS(VML_NS, 'shapetype')).map((template) => canonicalNode(template));
  const original = templates(originalContainer);
  const revised = templates(revisedContainer);
  return original.length === revised.length && original.every((template, index) => template === revised[index]);
}

const WORDPROCESSING_DRAWING_2010_NS =
  'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing';

/**
 * Editing-session identifiers Word rewrites without changing what a reader
 * sees: the DrawingML `wp14:anchorId`/`wp14:editId` and the VML `o:spid`.
 */
function isEditingSessionId(attribute: Attr): boolean {
  return (attribute.namespaceURI === WORDPROCESSING_DRAWING_2010_NS &&
      (attribute.localName === 'anchorId' || attribute.localName === 'editId')) ||
    (attribute.namespaceURI === OFFICE_VML_NS && attribute.localName === 'spid');
}

/**
 * The drawing with every story emptied: its shape, position, wrap and other
 * geometry, optionally without editing-session identifiers.
 */
function drawingShapeFingerprint(
  container: Element,
  { withoutEditingSessionIds = false }: { withoutEditingSessionIds?: boolean } = {},
): string {
  const clone = container.cloneNode(true) as Element;
  for (const textBox of Array.from(clone.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'))) {
    while (textBox.firstChild) textBox.removeChild(textBox.firstChild);
  }
  if (withoutEditingSessionIds) {
    for (const element of [clone, ...Array.from(clone.getElementsByTagName('*'))]) {
      for (const attribute of Array.from(element.attributes)) {
        if (isEditingSessionId(attribute)) element.removeAttributeNode(attribute);
      }
    }
  }
  return canonicalNode(clone);
}

interface DrawingShapeChange {
  originalContainer: Element;
  revisedContainer: Element;
  element: UnrepresentedDrawingChange['element'];
  name?: string;
  /**
   * False when the drawings differ only in editing-session identifiers: the
   * revised drawing is carried as for any shape change, but there is no
   * shape change to report.
   */
  visible: boolean;
}

/**
 * The shape change of a paired text box's drawing, or `undefined` when its
 * drawing (the run-level container with every story emptied) is unchanged.
 *
 * A text box's size, position and wrap live in its drawing — `wp:extent`,
 * `wp:positionH`/`wp:positionV` and the `wp:wrap*` choice of a DrawingML
 * `wp:anchor` or `wp:inline`, or the `style` and `w10:wrap` of a VML shape.
 * WordprocessingML defines revision markup for run, paragraph, section,
 * table and numbering properties only, so none of these can be tracked. When
 * the box's text also changed, the comparison tracks the text inside the box,
 * carries the revised drawing, and lists the drawing in
 * `unrepresentedChanges` (`drawing` scope).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @conformance ECMA-376 edition 5, Part 1 § 20.4.2.38
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.22
 * @see https://github.com/UseJunior/safe-docx/issues/1382
 */
function drawingShapeChange(
  originalTextBox: Element,
  revisedTextBox: Element,
): DrawingShapeChange | undefined {
  const originalContainer = drawingContainer(originalTextBox);
  const revisedContainer = drawingContainer(revisedTextBox);
  if (!originalContainer || !revisedContainer) return undefined;
  if (drawingShapeFingerprint(originalContainer) === drawingShapeFingerprint(revisedContainer)) {
    return undefined;
  }
  const name = drawingName(revisedTextBox, revisedContainer);
  const visible =
    drawingShapeFingerprint(originalContainer, { withoutEditingSessionIds: true }) !==
    drawingShapeFingerprint(revisedContainer, { withoutEditingSessionIds: true });
  return {
    originalContainer,
    revisedContainer,
    element: revisedContainer.localName as UnrepresentedDrawingChange['element'],
    ...(name ? { name } : {}),
    visible,
  };
}

/**
 * `revisedContainer`'s drawing holding `originalContainer`'s stories, built in
 * the original's document, or `undefined` when the two host a different
 * number of text boxes.
 */
function originalStoriesInRevisedDrawing(
  originalContainer: Element,
  revisedContainer: Element,
): Element | undefined {
  const originalBoxes = ownTextBoxes(originalContainer);
  const aligned = originalContainer.ownerDocument!.importNode(revisedContainer, true) as Element;
  const alignedBoxes = ownTextBoxes(aligned);
  if (originalBoxes.length !== alignedBoxes.length) return undefined;
  alignedBoxes.forEach((textBox, index) => replaceChildren(textBox, originalBoxes[index]!));
  return aligned;
}

/**
 * Do the relationship ids the revised drawing names outside its stories mean
 * the same thing in the original document? Only then can the original side
 * carry the revised drawing without rebinding it.
 */
function drawingRelationshipsAgree(
  revisedContainer: Element,
  originalTargets: ReadonlyMap<string, string>,
  revisedTargets: ReadonlyMap<string, string>,
): boolean {
  const visit = (element: Element): boolean => {
    if (element.namespaceURI === OOXML.W_NS && element.localName === 'txbxContent') return true;
    for (const attribute of Array.from(element.attributes)) {
      if (!isRelationshipReference(attribute)) continue;
      const target = revisedTargets.get(attribute.value);
      if (target === undefined || originalTargets.get(attribute.value) !== target) return false;
    }
    return directChildElements(element).every(visit);
  };
  return visit(revisedContainer);
}

/**
 * The run-level element storing every copy of one visual box — its
 * `mc:AlternateContent` when the box is twinned, otherwise its drawing
 * container — or `undefined` when that element stores anything else: another
 * box, a second shape beside the box, or an `mc:AlternateContent` branch that
 * holds more than the box's drawing.
 */
function textBoxStorageRoot(copies: readonly Element[]): Element | undefined {
  let root: Element | undefined;
  for (const copy of copies) {
    const container = drawingContainer(copy);
    if (!container || ownTextBoxes(container).length !== 1 || !isSoleDrawingShape(copy, container)) {
      return undefined;
    }
    const branch = container.parentNode as Element | null;
    let candidate = container;
    if (
      branch?.nodeType === 1 &&
      branch.namespaceURI === MC_NS &&
      (branch.localName === 'Choice' || branch.localName === 'Fallback')
    ) {
      const alternate = branch.parentNode as Element | null;
      if (
        alternate?.nodeType !== 1 ||
        alternate.namespaceURI !== MC_NS ||
        alternate.localName !== 'AlternateContent'
      ) {
        return undefined;
      }
      candidate = alternate;
    }
    if (root !== undefined && root !== candidate) return undefined;
    root = candidate;
  }
  if (!root) return undefined;
  const stored = ownTextBoxes(root);
  if (stored.length !== copies.length || !stored.every((copy) => copies.includes(copy))) return undefined;
  if (root.namespaceURI === MC_NS) {
    const branchesHoldOnlyTheBox = directChildElements(root).every((branch) => {
      const children = directChildElements(branch);
      return branch.namespaceURI === MC_NS &&
        (branch.localName === 'Choice' || branch.localName === 'Fallback') &&
        children.length === 1 &&
        copies.some((copy) => drawingContainer(copy) === children[0]);
    });
    if (!branchesHoldOnlyTheBox) return undefined;
  }
  return root;
}

/** The drawing vocabulary a stored copy is written in: `drawing`, `pict` or `object`. */
function storageVocabulary(copy: Element): string | undefined {
  return drawingContainer(copy)?.localName;
}

/** The name a reader sees for a box's drawing: its DrawingML `wp:docPr/@name`, else its VML shape `id`. */
function drawingName(textBox: Element, container: Element): string | undefined {
  const insideStory = (element: Element): boolean => {
    for (let node = element.parentNode; node && node !== container; node = node.parentNode) {
      const ancestor = node as Element;
      if (ancestor.namespaceURI === OOXML.W_NS && ancestor.localName === 'txbxContent') return true;
    }
    return false;
  };
  const docPr = Array.from(
    container.getElementsByTagNameNS(WORDPROCESSING_DRAWING_NS, 'docPr'),
  ).find((candidate) => !insideStory(candidate));
  return docPr?.getAttribute('name') || nearestShape(textBox)?.getAttribute('id') || undefined;
}

/**
 * Can the original document carry `revisedRoot`'s VML shape templates? A
 * template the two drawings share must read the same, because every shape
 * whose `type` names it takes its geometry from it; a template only the
 * revised drawing defines must not redefine one the original defines
 * elsewhere.
 */
function storageTemplatesCarry(originalRoot: Element, revisedRoot: Element): boolean {
  const originalTemplates = Array.from(originalRoot.getElementsByTagNameNS(VML_NS, 'shapetype'));
  const revisedTemplates = Array.from(revisedRoot.getElementsByTagNameNS(VML_NS, 'shapetype'));
  const originalById = new Map(originalTemplates.map((template) => [template.getAttribute('id') ?? '', canonicalNode(template)]));
  const elsewhere = new Set(
    Array.from(originalRoot.ownerDocument!.getElementsByTagNameNS(VML_NS, 'shapetype'))
      .filter((template) => !originalTemplates.includes(template))
      .map((template) => template.getAttribute('id') ?? ''),
  );
  const revisedById = new Map(revisedTemplates.map((template) => [template.getAttribute('id') ?? '', canonicalNode(template)]));
  // A template the original drawing defines and the revised one drops must
  // not be named by any shape outside the drawing, which would lose its
  // geometry once the drawing is replaced.
  const namedOutside = new Set(
    Array.from(originalRoot.ownerDocument!.getElementsByTagName('*'))
      .filter((element) => !isWithinElement(element, originalRoot))
      .map((element) => element.getAttribute('type') ?? '')
      .filter((type) => type.startsWith('#'))
      .map((type) => type.slice(1)),
  );
  return revisedTemplates.every((template) => {
    const id = template.getAttribute('id') ?? '';
    const shared = originalById.get(id);
    return shared !== undefined ? shared === canonicalNode(template) : !elsewhere.has(id);
  }) && [...originalById].every(([id, template]) =>
    revisedById.get(id) === template || !namedOutside.has(id));
}

function isWithinElement(element: Element, container: Element): boolean {
  for (let node: Node | null = element; node; node = node.parentNode) {
    if (node === container) return true;
  }
  return false;
}


interface TextBoxStorageAlignment {
  /**
   * Put the revised storage around the original stories in the original
   * document: every stored copy takes the story of the original copy written
   * in the same vocabulary, or the original's only copy.
   */
  apply(): void;
  /** Every stored copy already reads the same on both sides. */
  textUnchanged: boolean;
  /**
   * A copy written in a vocabulary both sides store has a different drawing
   * (size, position, wrap), beyond Word's editing-session ids.
   */
  sharedChanged: boolean;
  /**
   * The drawing may read differently: `sharedChanged`, or a spelling (the
   * DrawingML or the VML one) was added or dropped, which nothing on the
   * other side can be compared with. Reported with the `drawing` scope.
   */
  visible: boolean;
  /** The revised drawing a reader sees, for a `drawing` entry. */
  renderedContainer: Element;
  name?: string;
}

/**
 * Align a box stored differently on the two sides — VML only, DrawingML only,
 * or both inside `mc:AlternateContent` — or `undefined` when its storage
 * cannot be carried across.
 *
 * Word reads the `mc:Choice` DrawingML copy and an older reader the
 * `mc:Fallback` VML copy, so a box that gained or lost a spelling is still one
 * box. The original side takes the revised storage around its own story, so
 * the outer comparison sees one unchanged anchor and every stored copy of the
 * box is compared with the original text: Word and an older reader show the
 * same tracked text. The storage moves only when it stores this box alone,
 * names relationships that mean the same in the original, neither brings nor
 * takes away a VML template another box relies on, and every stored copy on
 * each side says the same thing. A drawing change is `visible` when the
 * spelling both sides store changed, or when a spelling was added or dropped,
 * since the reader of that spelling may see a different drawing.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 1 § 20.4.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/1383
 */
function textBoxStorageAlignment(
  originalCopies: readonly Element[],
  revisedCopies: readonly Element[],
  renderedRevisedCopy: Element,
  originalTargets: ReadonlyMap<string, string>,
  revisedTargets: ReadonlyMap<string, string>,
): TextBoxStorageAlignment | undefined {
  const originalRoot = textBoxStorageRoot(originalCopies);
  const revisedRoot = textBoxStorageRoot(revisedCopies);
  if (!originalRoot || !revisedRoot) return undefined;
  if (!drawingRelationshipsAgree(revisedRoot, originalTargets, revisedTargets)) return undefined;
  if (!storageTemplatesCarry(originalRoot, revisedRoot)) return undefined;
  // Copies of one box that say different things are different boxes to
  // different readers; carrying one copy's story into the other spelling
  // would change what one of them showed.
  const consistent = (copies: readonly Element[]): boolean =>
    new Set(copies.map((copy) => canonicalNode(copy))).size === 1;
  if (!consistent(originalCopies) || !consistent(revisedCopies)) return undefined;
  const sameVocabulary = (revisedCopy: Element): Element | undefined =>
    originalCopies.find((copy) => storageVocabulary(copy) === storageVocabulary(revisedCopy));
  if (!revisedCopies.some((copy) => sameVocabulary(copy) !== undefined)) return undefined;
  const source = (revisedCopy: Element): Element =>
    sameVocabulary(revisedCopy) ?? originalCopies[0]!;
  const textUnchanged = revisedCopies.every((copy) =>
    canonicalNode(copy) === canonicalNode(source(copy)) &&
    relationshipClosureFingerprint(copy, revisedTargets) ===
      relationshipClosureFingerprint(source(copy), originalTargets));
  // The spelling both sides store is compared directly. A spelling only one
  // side stores cannot be compared with anything: no rule maps every
  // DrawingML property (placement, z-order, rotation, fill, ...) onto VML, so
  // the reader that renders it may see a different drawing. Gaining or
  // losing a spelling is therefore reported as a drawing change, never
  // assumed to be a faithful re-save.
  const sharedChanged = revisedCopies.some((copy) => {
    const original = sameVocabulary(copy);
    return original !== undefined &&
      drawingShapeFingerprint(drawingContainer(original)!, { withoutEditingSessionIds: true }) !==
        drawingShapeFingerprint(drawingContainer(copy)!, { withoutEditingSessionIds: true });
  });
  const vocabularies = (copies: readonly Element[]): string =>
    [...new Set(copies.map((copy) => storageVocabulary(copy)))].sort().join('|');
  const spellingChanged = vocabularies(originalCopies) !== vocabularies(revisedCopies);
  const renderedContainer = drawingContainer(renderedRevisedCopy)!;
  const name = drawingName(renderedRevisedCopy, renderedContainer) ??
    revisedCopies.map((copy) => drawingName(copy, drawingContainer(copy)!)).find((candidate) => candidate);
  return {
    apply: () => {
      const document = originalRoot.ownerDocument!;
      const aligned = document.importNode(revisedRoot, true) as Element;
      const alignedCopies = ownTextBoxes(aligned);
      alignedCopies.forEach((copy, index) => replaceChildren(copy, source(revisedCopies[index]!)));
      copyNamespaceDeclarations(revisedRoot.ownerDocument!.documentElement, document.documentElement);
      originalRoot.parentNode!.replaceChild(aligned, originalRoot);
    },
    textUnchanged,
    sharedChanged,
    visible: sharedChanged || spellingChanged,
    renderedContainer,
    ...(name ? { name } : {}),
  };
}

/**
 * Why a text-box story cannot be compared as a story, or `undefined` to admit.
 *
 * Pictures (`w:pict`, `w:drawing`) and embedded objects (`w:object`) inside a
 * story are admitted: the story comparison carries each one as an atomic leaf,
 * so an unchanged picture passes through untouched and a changed one is a
 * tracked deletion plus insertion of its run, like any other atomic leaf
 * (#1380). A body story holding a nested text box is admitted too: the nested
 * box is compared as a story of its own (see `prepareTextBoxStoryComparison`).
 * Part 4 § 14.9.1.1 and Part 1 § 20.4.2.38 call such nesting non-conformant,
 * but a document that carries it still deserves a redline rather than an
 * abort. A header or footer story still refuses nesting, because its stories
 * are spliced back by raw position, which a nested box would shift.
 *
 * References to the comment, footnote and endnote stories stay refused here;
 * they are tracked separately (#1385).
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 1 § 20.4.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/1380
 */
function unsupportedStoryReason(
  textBox: Element,
  { allowNestedTextBoxes = false }: { allowNestedTextBoxes?: boolean } = {},
): string | undefined {
  if (
    !allowNestedTextBoxes &&
    textBox.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent').length > 0
  ) {
    return 'nested text boxes are not supported';
  }

  const unsupportedReferences = new Set([
    'commentReference',
    'endnoteReference',
    'footnoteReference',
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

interface RelationshipEntry {
  type: string;
  target: string;
  targetMode: string;
}

function relationshipEntries(
  relationshipsXml: string | null,
): Map<string, RelationshipEntry> {
  const entries = new Map<string, RelationshipEntry>();
  if (!relationshipsXml) return entries;
  const document = parseXml(relationshipsXml);
  // By namespace and local name, as a package reader resolves them: a
  // prefixed `<pr:Relationship>` is as real as an unprefixed one, and missing
  // it would leave a reachable payload out of the closure (round-4 review of
  // #1380).
  for (const relationship of Array.from(
    document.getElementsByTagNameNS(PACKAGE_RELATIONSHIPS_NS, 'Relationship'),
  )) {
    const id = relationship.getAttribute('Id');
    if (!id) continue;
    entries.set(id, {
      type: relationship.getAttribute('Type') ?? '',
      target: relationship.getAttribute('Target') ?? '',
      targetMode: relationship.getAttribute('TargetMode') ?? '',
    });
  }
  return entries;
}

function relationshipSemantics({ type, target, targetMode }: RelationshipEntry): string {
  return [type, target, targetMode].join('|');
}

function relationshipTargets(
  relationshipsXml: string | null,
): Map<string, string> {
  return new Map(
    [...relationshipEntries(relationshipsXml)].map(([id, entry]) => [
      id,
      relationshipSemantics(entry),
    ]),
  );
}

/**
 * Does this attribute hold a relationship id of its part? Every `r:*`
 * attribute does, and so does `o:relid`, the relationship id a VML picture's
 * `v:imagedata` may name its image by (vml-officeDrawing.xsd types it
 * `r:ST_RelationshipId`). A text box may hold such a picture since #1380, so
 * the closure check and the story remap read both spellings; missing
 * `o:relid` would let a picture swap through unseen.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.11
 * @see https://github.com/UseJunior/safe-docx/issues/1380
 */
function isRelationshipReference(attribute: Attr): boolean {
  return attribute.namespaceURI === RELATIONSHIPS_NS
    || (attribute.namespaceURI === OFFICE_VML_NS && attribute.localName === 'relid');
}

function relationshipClosureFingerprint(
  textBox: Element,
  targets: ReadonlyMap<string, string>,
): string | undefined {
  const references: string[] = [];
  for (const element of [textBox, ...Array.from(textBox.getElementsByTagName('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (!isRelationshipReference(attribute)) continue;
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
 * different id. Translate those temporary ids back through what each
 * relationship reaches before splicing the story into its real owner: its
 * type and external target, or for an internal target its payload (the part's
 * bytes and everything its own relationships reach), so a target path that
 * names different bytes in the owner's package is not mistaken for the same
 * picture.
 *
 * A relationship the owner does not yet declare is imported into the owner's
 * own relationship part under an id free there: the original target of a
 * retargeted hyperlink, which only the tracked deletion still names, or a
 * relationship the outer comparison never saw because the story was cut out
 * of it. A footer story's relationships therefore land in the footer's
 * `.rels`, never in `document.xml.rels`. An external target needs only the
 * relationship; an internal one brings its part along.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @conformance ECMA-376 edition 5, Part 2 § 6.5.3.4
 * @conformance ECMA-376 edition 5, Part 2 § 6.5.2.3
 * @see https://github.com/UseJunior/safe-docx/issues/713
 * @see https://github.com/UseJunior/safe-docx/issues/1381
 */
async function remapComparedStoryRelationshipIds(
  storyArchive: DocxArchive,
  outerArchive: DocxArchive,
  ownerPartPath: string,
  storyBody: Element,
  visualIndex: number,
): Promise<void> {
  const ownerRelationshipsPath = owningRelationshipsPath(ownerPartPath);
  const [temporaryRelationships, ownerRelationships] = await Promise.all([
    storyArchive.getFile('word/_rels/document.xml.rels'),
    outerArchive.getFile(ownerRelationshipsPath),
  ]);
  const temporaryEntries = relationshipEntries(temporaryRelationships);
  const ownerEntries = relationshipEntries(ownerRelationships);
  const storyPayloads = new PayloadFingerprints(storyArchive);
  const ownerPayloads = new PayloadFingerprints(outerArchive);
  // Payload key -> owner id, for ids already resolved or imported here.
  const ownerIdByPayload = new Map<string, string>();
  const findOwnerId = async (entry: RelationshipEntry, payload: string): Promise<string | undefined> => {
    const known = ownerIdByPayload.get(payload);
    if (known) return known;
    for (const [id, candidate] of ownerEntries) {
      if (candidate.type !== entry.type) continue;
      if ((candidate.targetMode === 'External') !== (entry.targetMode === 'External')) continue;
      if (await ownerPayloads.payloadOf(ownerPartPath, id) !== payload) continue;
      ownerIdByPayload.set(payload, id);
      return id;
    }
    return undefined;
  };
  let ownerDocument: Document | undefined;
  let nextOrdinal = 1;
  const allocateOwnerId = (): string => {
    let candidate = `rId${nextOrdinal++}`;
    while (ownerEntries.has(candidate)) candidate = `rId${nextOrdinal++}`;
    return candidate;
  };

  for (const element of [storyBody, ...Array.from(storyBody.getElementsByTagName('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (!isRelationshipReference(attribute)) continue;
      const entry = temporaryEntries.get(attribute.value);
      if (!entry) {
        throw new UnsupportedTextBoxRevisionError([{
          index: visualIndex,
          partPath: ownerPartPath,
          reason: 'the compared text-box story relationship closure could not be rebound to its owner',
        }]);
      }
      // The story's relationship table was promoted to word/document.xml with
      // its internal targets rebased onto word/ (`promotedStoryRelationshipsXml`).
      const payload = await storyPayloads.payloadOf('word/document.xml', attribute.value);
      let ownerId = await findOwnerId(entry, payload);
      if (!ownerId) {
        const { type, targetMode } = entry;
        const ownerTarget = await importRelationshipTarget(
          storyArchive,
          'word/document.xml',
          { target: entry.target, targetMode: targetMode || null },
          outerArchive,
          ownerPartPath,
        );
        ownerDocument ??= parseXml(
          ownerRelationships ?? `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`,
        );
        ownerId = allocateOwnerId();
        const relationship = ownerDocument.createElementNS(
          PACKAGE_RELATIONSHIPS_NS,
          'Relationship',
        );
        relationship.setAttribute('Id', ownerId);
        relationship.setAttribute('Type', type);
        relationship.setAttribute('Target', ownerTarget);
        if (targetMode) relationship.setAttribute('TargetMode', targetMode);
        ownerDocument.documentElement.appendChild(relationship);
        ownerEntries.set(ownerId, { type, target: ownerTarget, targetMode });
        ownerIdByPayload.set(payload, ownerId);
      }
      attribute.value = ownerId;
    }
  }
  if (ownerDocument) {
    outerArchive.setFile(ownerRelationshipsPath, serializer.serializeToString(ownerDocument));
  }
}

/**
 * A story document whose body is `textBox`'s current content, inside the
 * scaffold of `documentXml`. The box is read as it stands, so a nested box
 * already replaced by its placeholder stays a placeholder (#1380).
 */
function storyDocumentXmlFromTextBox(documentXml: string, textBox: Element): string {
  const document = parseXml(documentXml);
  const body = document.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0);
  if (!body) throw new Error('Could not isolate a w:txbxContent story');
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

/**
 * `originalPartXml` with the drawing of each listed text box (by raw
 * position) replaced by its revised drawing around the original stories, or
 * `undefined` when a drawing hosts a different number of stories on the two
 * sides.
 */
function partXmlWithRevisedDrawings(
  originalPartXml: string,
  revisedPartXml: string,
  rawIndexes: readonly number[],
): string | undefined {
  const original = parseXml(originalPartXml);
  const revised = parseXml(revisedPartXml);
  for (const rawIndex of rawIndexes) {
    const originalBox = original.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent').item(rawIndex);
    const revisedBox = revised.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent').item(rawIndex);
    const originalContainer = originalBox ? drawingContainer(originalBox) : undefined;
    const revisedContainer = revisedBox ? drawingContainer(revisedBox) : undefined;
    if (!originalContainer || !revisedContainer) return undefined;
    const aligned = originalStoriesInRevisedDrawing(originalContainer, revisedContainer);
    if (!aligned) return undefined;
    originalContainer.parentNode!.replaceChild(aligned, originalContainer);
  }
  return serializer.serializeToString(original);
}

/**
 * `ownerPartPath`'s relationship table as the main document part's, for a
 * story promoted to `word/document.xml` for comparison. Relationship targets
 * are relative to the part that owns them (Part 2 §6.5.3.4), so an internal
 * target of a part stored outside `word/` (`word/headers/footer.xml` naming
 * `../media/logo.png`) is rebased onto `word/` to keep naming the same part
 * inside the story package; parts in `word/` are carried as they are.
 *
 * @conformance ECMA-376 edition 5, Part 2 § 6.5.3.4
 * @see https://github.com/UseJunior/safe-docx/issues/1381
 */
function promotedStoryRelationshipsXml(
  relationshipsXml: string | null,
  ownerPartPath: string,
): string {
  if (!relationshipsXml) return `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`;
  if (posix.dirname(ownerPartPath) === 'word') return relationshipsXml;
  const document = parseXml(relationshipsXml);
  for (const relationship of Array.from(
    document.getElementsByTagNameNS(PACKAGE_RELATIONSHIPS_NS, 'Relationship'),
  )) {
    if (relationship.getAttribute('TargetMode') === 'External') continue;
    const target = relationship.getAttribute('Target');
    if (!target) continue;
    relationship.setAttribute(
      'Target',
      posix.relative('word', resolvePartPath(ownerPartPath, target))
        .split('/')
        .map((segment) => (segment === '..' ? segment : encodeURIComponent(segment)))
        .join('/'),
    );
  }
  return serializer.serializeToString(document);
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
 * With `ignoreTrackableFormatting`, the run and paragraph properties of the
 * paragraphs that stay in the scaffold (those holding a field, a content
 * control or a drawing) are left out too: the story comparison carries a
 * change to them as `w:rPrChange` / `w:pPrChange`, exactly as for a plain
 * paragraph. A paragraph whose mark is already inserted, deleted or moved
 * keeps its properties (see `removeTrackableFormatting`). Only the eligibility gates
 * use it; the projection inventory keeps
 * the properties, so a formatting change the comparison dropped still fails
 * the projection check.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.31
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.29
 * @see https://github.com/UseJunior/safe-docx/issues/998
 * @see https://github.com/UseJunior/safe-docx/issues/1392
 */
function ordinaryStoryScaffoldFingerprint(
  xml: string,
  options: { ignoreTrackableFormatting?: boolean } = {},
): string {
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
  if (options.ignoreTrackableFormatting) removeTrackableFormatting(root);
  removeEmptyFormattingProperties(root);
  blankOrdinaryParagraphText(root);
  return canonicalNode(root);
}

/**
 * Drop `w:rPr` / `w:pPr` elements that hold nothing: an empty property element
 * applies no formatting, so it reads the same as no element. Rejecting a
 * `w:rPrChange` whose recorded properties were empty leaves one behind.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.2.28
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.26
 */
function removeEmptyFormattingProperties(root: Element): void {
  for (const propertyName of ['rPr', 'pPr']) {
    for (const property of Array.from(root.getElementsByTagNameNS(OOXML.W_NS, propertyName)).reverse()) {
      if (property.attributes.length === 0 && property.childNodes.length === 0) {
        property.parentNode?.removeChild(property);
      }
    }
  }
}

/** The eligibility gates' scaffold: formatting the story comparison tracks is not scaffold. */
const trackableFormatting = { ignoreTrackableFormatting: true } as const;

/**
 * Paragraph-mark revision markers: a paragraph whose mark is already inserted,
 * deleted or moved keeps its formatting in the scaffold.
 */
const PARAGRAPH_MARK_REVISION_CHILDREN = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
]);

/**
 * Remove the formatting that `w:rPrChange` (run properties, and the paragraph
 * mark's run properties) and `w:pPrChange` (paragraph properties) can record.
 * Content-control properties (`w:sdtPr`, `w:sdtEndPr`) and table properties
 * are not touched, so a change to them stays a scaffold change.
 *
 * Formatting that already carries a pending `w:rPrChange` / `w:pPrChange` is
 * removed too: the story comparison layers a new formatting revision onto it
 * as one schema-valid record set (see `layeredFormattingRevision.ts`, #1461).
 * A paragraph whose mark is already inserted, deleted or moved keeps all of
 * its formatting, so a change to it stays a scaffold change and is listed.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.31
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.29
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.30
 * @see https://github.com/UseJunior/safe-docx/issues/1461
 */
function removeTrackableFormatting(root: Element): void {
  const isW = (element: Element | null, localName: string): boolean =>
    element !== null && element.namespaceURI === OOXML.W_NS && element.localName === localName;
  for (const paragraph of Array.from(root.getElementsByTagNameNS(OOXML.W_NS, 'p'))) {
    const paragraphProperties = directChildElements(paragraph).find((child) => isW(child, 'pPr'));
    const markProperties = paragraphProperties
      ? directChildElements(paragraphProperties).find((child) => isW(child, 'rPr'))
      : undefined;
    const runProperties = Array.from(paragraph.getElementsByTagNameNS(OOXML.W_NS, 'rPr'))
      .filter((properties) => isW(properties.parentElement, 'r'));
    const markRevised = !!markProperties && directChildElements(markProperties).some(
      (child) => child.namespaceURI === OOXML.W_NS && PARAGRAPH_MARK_REVISION_CHILDREN.has(child.localName),
    );
    if (markRevised) continue;
    for (const element of runProperties) element.parentNode?.removeChild(element);
    if (paragraphProperties) {
      // `w:sectPr` is not formatting `w:pPrChange` records (CT_PPrBase).
      for (const child of directChildElements(paragraphProperties)) {
        if (!isW(child, 'sectPr')) paragraphProperties.removeChild(child);
      }
      if (directChildElements(paragraphProperties).length === 0) paragraph.removeChild(paragraphProperties);
    }
  }
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

/**
 * Drop the white space between a section's property elements. `w:sectPr` has
 * element-only content, so that white space is formatting, not a property,
 * and a reference added or removed by an editor must not change it (#1394).
 */
function withoutFormattingWhitespace(section: Element): Element {
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3 && /^\s*$/u.test(child.nodeValue ?? '')) node.removeChild(child);
      else if (child.nodeType === 1) walk(child);
    }
  };
  walk(section);
  return section;
}

function sectionPropertyFingerprints(documentXml: string): string[] {
  const document = parseXml(documentXml);
  return Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'sectPr'))
    .filter((section) => !hasAncestorLocalName(section, 'sectPrChange'))
    .map((section) => {
      const clone = withoutFormattingWhitespace(section.cloneNode(true) as Element);
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
      const clone = withoutFormattingWhitespace(section.cloneNode(true) as Element);
      const references = [
        ...Array.from(clone.getElementsByTagNameNS(OOXML.W_NS, 'headerReference')),
        ...Array.from(clone.getElementsByTagNameNS(OOXML.W_NS, 'footerReference')),
      ];
      for (const reference of references) {
        reference.setAttributeNS(RELATIONSHIPS_NS, 'r:id', '__selected_story__');
      }
      // The references are one unordered choice group in CT_SectPr, so their
      // order is not part of the topology (#1394).
      const anchor = references.length > 0 ? references[0]! : undefined;
      if (anchor) {
        const placeholder = clone.ownerDocument!.createComment('references');
        clone.insertBefore(placeholder, directChildElements(clone).find((child) => references.includes(child)) ?? anchor);
        for (const reference of references) reference.parentNode?.removeChild(reference);
        const key = (reference: Element): string =>
          `${reference.localName}:${reference.getAttributeNS(OOXML.W_NS, 'type') ?? reference.getAttribute('w:type') ?? ''}`;
        for (const reference of references.sort((left, right) => key(left).localeCompare(key(right)))) {
          clone.insertBefore(reference, placeholder);
        }
        clone.removeChild(placeholder);
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

/**
 * Align every header/footer box the two parts store differently, in the
 * original part. Header and footer boxes pair by visual position; a box that
 * gained or lost a spelling (VML only, DrawingML only, or twinned in
 * `mc:AlternateContent`) and keeps the identity of the spelling both sides
 * store takes the revised storage around its original story, so its text is
 * compared in every stored copy. A header or footer story is spliced into the
 * revised part, so the revised storage is carried whether or not its text
 * changed; a changed shared spelling, or a spelling only one side stores, is
 * reported for the `drawing` scope, as any header/footer drawing change is
 * (#1382). A box that names another identity, or whose storage cannot be
 * carried, is refused: a header or footer cannot track a replaced box (#1384).
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 1 § 20.4.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/1383
 */
function alignAncillaryTextBoxStorage(
  originalXml: string,
  revisedXml: string,
  originalTargets: ReadonlyMap<string, string>,
  revisedTargets: ReadonlyMap<string, string>,
  partPath: string,
): { xml: string; boxes: Array<{ visualIndex: number; visible: boolean; element: UnrepresentedDrawingChange['element']; name?: string }> } {
  const originalDocument = parseXml(originalXml);
  const revisedDocument = parseXml(revisedXml);
  const originalGroups = textBoxGroups(originalDocument);
  const revisedGroups = textBoxGroups(revisedDocument);
  if (originalGroups.length !== revisedGroups.length) return { xml: originalXml, boxes: [] };
  const rawIndexOf = (document: Document): Map<Element, number> =>
    new Map(Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'))
      .map((copy, rawIndex) => [copy, rawIndex]));
  const originalCandidates = textBoxPairingCandidates(originalGroups, rawIndexOf(originalDocument));
  const revisedCandidates = textBoxPairingCandidates(revisedGroups, rawIndexOf(revisedDocument));
  const boxes: Array<{ visualIndex: number; visible: boolean; element: UnrepresentedDrawingChange['element']; name?: string }> = [];
  for (const [visualIndex, revised] of revisedCandidates.entries()) {
    const original = originalCandidates[visualIndex]!;
    if (original.storage === revised.storage) continue;
    const refuse = (reason: string): never => {
      throw new UnsupportedTextBoxRevisionError([{
        index: visualIndex,
        partPath,
        reason,
        originalParagraphId: textBoxParagraphId(original.copies[0]!),
        revisedParagraphId: textBoxParagraphId(revised.copies[0]!),
      }]);
    };
    const [smaller, larger] = (original.tokens ?? []).length <= (revised.tokens ?? []).length
      ? [original.tokens ?? [], revised.tokens ?? []]
      : [revised.tokens ?? [], original.tokens ?? []];
    if (smaller.length === 0 || !smaller.every((token) => larger.includes(token))) {
      refuse('the ancillary text-box scaffold names a different drawing (its anchor identity changed)');
    }
    const rendered = revisedGroups[visualIndex]!.selected;
    const alignment = textBoxStorageAlignment(
      original.copies,
      revised.copies,
      rendered,
      originalTargets,
      revisedTargets,
    );
    if (!alignment) {
      refuse(DIVERGENT_STORAGE_SHAPE_REASON);
      continue;
    }
    alignment.apply();
    boxes.push({
      visualIndex,
      visible: alignment.visible,
      element: alignment.renderedContainer.localName as UnrepresentedDrawingChange['element'],
      ...(alignment.name !== undefined ? { name: alignment.name } : {}),
    });
  }
  return boxes.length > 0
    ? { xml: serializer.serializeToString(originalDocument), boxes }
    : { xml: originalXml, boxes };
}

/** The run that anchors a text box: the nearest `w:r` above its story. */
function anchorRun(textBox: Element): Element | undefined {
  for (let node = textBox.parentNode; node?.nodeType === 1; node = node.parentNode) {
    const element = node as Element;
    if (element.namespaceURI === OOXML.W_NS && element.localName === 'r') return element;
  }
  return undefined;
}

/** The anchor run with every story emptied: the drawing and its run properties. */
function anchorRunFingerprint(textBox: Element): string | undefined {
  const run = anchorRun(textBox);
  if (!run) return undefined;
  const clone = run.cloneNode(true) as Element;
  for (const story of Array.from(clone.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'))) {
    while (story.firstChild) story.removeChild(story.firstChild);
  }
  return canonicalNode(clone);
}

function isInsideAny(element: Element, containers: ReadonlySet<Element>): boolean {
  for (let node = element.parentNode; node?.nodeType === 1; node = node.parentNode) {
    if (containers.has(node as Element)) return true;
  }
  return false;
}

/**
 * The comparison inputs of a header or footer part that gains or loses a text
 * box, or `undefined` when its boxes pair one for one in order (the
 * positional path in `ancillaryStoryInputs` handles those).
 *
 * Boxes pair by anchor identity, as in the body (#1031). A box with no
 * counterpart, one stored differently with no identifier in common (#1383),
 * or one whose drawing changed under the same identity, stays whole in a
 * comparison of the entire part, which tracks its anchor run as inserted or
 * deleted; `markTrackedTextBoxLifecycles` then marks every paragraph of its
 * story the same way. A paired box whose text changed is compared as its own
 * story and found again in the compared part by its placeholder token, since
 * the compared part holds the deleted and the inserted boxes together and
 * raw positions match neither input. Everything else in the part must share
 * the admitted scaffold and relationship closure, as for a topology-matched
 * ordinary story.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @see https://github.com/UseJunior/safe-docx/issues/1384
 */
async function lifecycleAncillaryStoryInputs(
  pair: PairedAncillaryStory,
  topologyMatches: boolean,
  originalArchive: DocxArchive,
  revisedArchive: DocxArchive,
  originalDocumentXml: string,
  revisedDocumentXml: string,
): Promise<TextBoxStoryInput[] | undefined> {
  const originalDocument = parseXml(pair.original.xml);
  const revisedDocument = parseXml(pair.revised.xml);
  const originalCopies = Array.from(originalDocument.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'));
  const revisedCopies = Array.from(revisedDocument.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'));
  const originalRawIndex = new Map(originalCopies.map((copy, rawIndex) => [copy, rawIndex]));
  const revisedRawIndex = new Map(revisedCopies.map((copy, rawIndex) => [copy, rawIndex]));
  const originalCandidates = textBoxPairingCandidates(textBoxGroups(originalDocument), originalRawIndex);
  const revisedCandidates = textBoxPairingCandidates(textBoxGroups(revisedDocument), revisedRawIndex);
  const pairing = pairTextBoxCandidates(originalCandidates, revisedCandidates);
  if (
    originalCandidates.length === revisedCandidates.length &&
    pairing.pairs.length === revisedCandidates.length &&
    pairing.pairs.every(([originalIndex, revisedIndex]) => originalIndex === revisedIndex)
  ) {
    return undefined;
  }
  const partPath = pair.revised.targetPath;
  const originalOrdinals = visualTextBoxOrdinals(originalDocument);
  const revisedOrdinals = visualTextBoxOrdinals(revisedDocument);
  const refuse = (
    side: 'original' | 'revised',
    copy: Element | undefined,
    reason: string,
  ): never => {
    const rawIndex = copy
      ? (side === 'original' ? originalRawIndex : revisedRawIndex).get(copy) ?? 0
      : 0;
    throw new UnsupportedTextBoxRevisionError([{
      index: (side === 'original' ? originalOrdinals : revisedOrdinals)[rawIndex] ?? rawIndex,
      partPath,
      reason,
      ...(copy
        ? side === 'original'
          ? { originalParagraphId: textBoxParagraphId(copy) }
          : { revisedParagraphId: textBoxParagraphId(copy) }
        : {}),
    }]);
  };
  if (pairing.ambiguousStorage) {
    refuse(
      'revised',
      revisedCandidates[pairing.ambiguousStorage.revised]?.copies[0],
      DIVERGENT_STORAGE_SHAPE_REASON,
    );
  }
  const pairedOriginal = new Set(pairing.pairs.map(([originalIndex]) => originalIndex));
  const firstUnpaired = revisedCandidates.find((_, index) =>
    !pairing.pairs.some(([, revisedIndex]) => revisedIndex === index));
  if (!topologyMatches || !pair.bindingClosureMatched) {
    refuse(
      firstUnpaired ? 'revised' : 'original',
      firstUnpaired?.copies[0] ??
        originalCandidates.find((_, index) => !pairedOriginal.has(index))?.copies[0],
      'inserted or deleted ancillary text-box topology is not supported',
    );
  }

  // A pair whose storage or drawing differs is replaced whole, as is every
  // box inside a replaced box's story.
  const kept: Array<[original: Element[], revised: Element[]]> = [];
  for (const [originalIndex, revisedIndex] of pairing.pairs) {
    const original = originalCandidates[originalIndex]!;
    const revised = revisedCandidates[revisedIndex]!;
    if (
      original.storage !== revised.storage ||
      original.copies.some((copy, offset) =>
        anchorRunFingerprint(copy) === undefined ||
        anchorRunFingerprint(copy) !== anchorRunFingerprint(revised.copies[offset]!))
    ) {
      continue;
    }
    kept.push([original.copies, revised.copies]);
  }
  const keptOriginal = new Set(kept.flatMap(([copies]) => copies));
  const keptRevised = new Set(kept.flatMap(([, copies]) => copies));
  const replacedOriginal = new Set(originalCopies.filter((copy) => !keptOriginal.has(copy)));
  const replacedRevised = new Set(revisedCopies.filter((copy) => !keptRevised.has(copy)));
  for (let changed = true; changed;) {
    changed = false;
    for (const [index, [originalGroup, revisedGroup]] of kept.entries()) {
      if (
        originalGroup.some((copy) => isInsideAny(copy, replacedOriginal)) ||
        revisedGroup.some((copy) => isInsideAny(copy, replacedRevised))
      ) {
        for (const copy of originalGroup) replacedOriginal.add(copy);
        for (const copy of revisedGroup) replacedRevised.add(copy);
        kept.splice(index, 1);
        changed = true;
        break;
      }
    }
  }

  const originalTargets = relationshipTargets(pair.original.relationshipsXml);
  const revisedTargets = relationshipTargets(pair.revised.relationshipsXml);
  for (const [side, replaced, targets] of [
    ['original', replacedOriginal, originalTargets],
    ['revised', replacedRevised, revisedTargets],
  ] as const) {
    for (const copy of replaced) {
      if (isInsideAny(copy, replaced)) continue;
      const verb = side === 'original' ? 'deleted' : 'inserted';
      const reason =
        unsupportedStoryReason(copy, { allowNestedTextBoxes: true }) ??
        (anchorRun(copy) === undefined ? 'its drawing has no anchor run' : undefined) ??
        (relationshipClosureFingerprint(copy, targets) === undefined
          ? 'its relationship closure could not be resolved'
          : undefined);
      if (reason) refuse(side, copy, `${verb} ancillary text box: ${reason}`);
    }
  }

  const stories: TextBoxStoryInput[] = [];
  const placeholders: Array<[original: Element, revised: Element, token: string]> = [];
  const placeholderPrefix = collisionFreePlaceholderPrefix([originalDocument, revisedDocument]);
  for (const [originalGroup, revisedGroup] of kept) {
    for (const [offset, originalCopy] of originalGroup.entries()) {
      const revisedCopy = revisedGroup[offset]!;
      const originalClosure = relationshipClosureFingerprint(originalCopy, originalTargets);
      const revisedClosure = relationshipClosureFingerprint(revisedCopy, revisedTargets);
      if (
        canonicalNode(originalCopy) === canonicalNode(revisedCopy) &&
        originalClosure === revisedClosure
      ) {
        continue;
      }
      const reason =
        unsupportedStoryReason(originalCopy) ??
        unsupportedStoryReason(revisedCopy) ??
        (originalClosure === undefined || revisedClosure === undefined
          ? 'the ancillary text-box relationship closure could not be resolved'
          : undefined) ??
        scaffoldPairingReason(
          originalCopy,
          revisedCopy,
          'the ancillary VML shape scaffold could not be paired',
        );
      if (reason) refuse('revised', revisedCopy, reason);
      const index = revisedRawIndex.get(revisedCopy)!;
      const storyOriginalArchive = await originalArchive.clone();
      const storyRevisedArchive = await revisedArchive.clone();
      storyOriginalArchive.setDocumentXml(storyDocumentXmlFromPart(
        originalDocumentXml,
        pair.original.xml,
        originalRawIndex.get(originalCopy)!,
      ));
      storyRevisedArchive.setDocumentXml(storyDocumentXmlFromPart(
        revisedDocumentXml,
        pair.revised.xml,
        index,
      ));
      storyOriginalArchive.setFile(
        'word/_rels/document.xml.rels',
        promotedStoryRelationshipsXml(pair.original.relationshipsXml, pair.original.targetPath),
      );
      storyRevisedArchive.setFile(
        'word/_rels/document.xml.rels',
        promotedStoryRelationshipsXml(pair.revised.relationshipsXml, partPath),
      );
      const placeholder = placeholderToken(index, placeholderPrefix);
      stories.push({
        index,
        visualIndex: revisedOrdinals[index] ?? index,
        partPath,
        container: 'textBox',
        placeholder,
        original: await storyOriginalArchive.save(),
        revised: await storyRevisedArchive.save(),
      });
      placeholders.push([originalCopy, revisedCopy, placeholder]);
    }
  }
  // Both sides carry the revised raw index, so the part comparison sees one
  // unchanged placeholder and the splice finds it by that token.
  for (const [originalCopy, revisedCopy, placeholder] of placeholders) {
    createPlaceholder(originalCopy, 0, placeholder);
    createPlaceholder(revisedCopy, 0, placeholder);
  }

  // Outside the replaced boxes, the part must differ only where an ordinary
  // story may: plain paragraph text under the same relationships.
  const withoutReplacedAnchors = (document: Document, replaced: ReadonlySet<Element>): Document => {
    const clone = parseXml(serializer.serializeToString(document));
    const cloneCopies = Array.from(clone.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'));
    const sourceCopies = Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'));
    const runs = new Set<Element>();
    for (const [rawIndex, copy] of sourceCopies.entries()) {
      if (!replaced.has(copy) || isInsideAny(copy, replaced)) continue;
      const run = anchorRun(cloneCopies[rawIndex]!);
      if (run) runs.add(run);
    }
    for (const run of runs) {
      // A wrapper the anchor alone filled (a box already tracked in the
      // source) goes with it, so it does not read as a scaffold change.
      let parent = run.parentNode as Element | null;
      parent?.removeChild(run);
      while (
        parent &&
        parent.namespaceURI === OOXML.W_NS &&
        REVISION_WRAPPER_NAMES.has(parent.localName) &&
        directChildElements(parent).length === 0
      ) {
        const next = parent.parentNode as Element | null;
        next?.removeChild(parent);
        parent = next;
      }
    }
    return clone;
  };
  const originalRest = withoutReplacedAnchors(originalDocument, replacedOriginal);
  const revisedRest = withoutReplacedAnchors(revisedDocument, replacedRevised);
  const originalRestClosure = relationshipClosureFingerprint(originalRest.documentElement, originalTargets);
  const revisedRestClosure = relationshipClosureFingerprint(revisedRest.documentElement, revisedTargets);
  if (
    ordinaryStoryScaffoldFingerprint(serializer.serializeToString(originalRest), trackableFormatting) !==
      ordinaryStoryScaffoldFingerprint(serializer.serializeToString(revisedRest), trackableFormatting) ||
    originalRestClosure === undefined ||
    originalRestClosure !== revisedRestClosure
  ) {
    refuse(
      firstUnpaired ? 'revised' : 'original',
      firstUnpaired?.copies[0] ?? [...replacedOriginal][0],
      'the header/footer around an inserted or deleted text box changed outside its plain paragraph text',
    );
  }

  const storyOriginalArchive = await originalArchive.clone();
  const storyRevisedArchive = await revisedArchive.clone();
  storyOriginalArchive.setDocumentXml(storyDocumentXmlFromPartRoot(
    originalDocumentXml,
    serializer.serializeToString(originalDocument),
  ));
  storyRevisedArchive.setDocumentXml(storyDocumentXmlFromPartRoot(
    revisedDocumentXml,
    serializer.serializeToString(revisedDocument),
  ));
  storyOriginalArchive.setFile(
    'word/_rels/document.xml.rels',
    promotedStoryRelationshipsXml(pair.original.relationshipsXml, pair.original.targetPath),
  );
  storyRevisedArchive.setFile(
    'word/_rels/document.xml.rels',
    promotedStoryRelationshipsXml(pair.revised.relationshipsXml, partPath),
  );
  // The part story goes first: the box stories are spliced into its result.
  return [{
    index: 0,
    visualIndex: 0,
    partPath,
    container: 'ancillaryPart',
    ancillaryMode: 'ordinary',
    original: await storyOriginalArchive.save(),
    revised: await storyRevisedArchive.save(),
  }, ...stories];
}

/**
 * Blank stories `normalizeExplicitStorySlots` added, by side and part path:
 * a slot the other document selects a story for, which this side showed
 * blank (#1394).
 */
export interface BlankSlotParts {
  original: ReadonlySet<string>;
  revised: ReadonlySet<string>;
}

const NO_BLANK_SLOT_PARTS: BlankSlotParts = { original: new Set(), revised: new Set() };

/**
 * Whether every block-level child of the story part is a paragraph. Lifecycle
 * marking tracks paragraphs and runs; a block container (`w:sdt`,
 * `w:customXml`) or a table (whose rows it does not track) would leave its
 * own empty paragraph or rows on the side without the story.
 */
function holdsOnlyBodyParagraphs(partXml: string): boolean {
  const root = parseXml(partXml).documentElement;
  if (!root) return false;
  const blocks = directChildElements(root).filter((element) =>
    element.namespaceURI !== OOXML.W_NS ||
    !['bookmarkStart', 'bookmarkEnd', 'permStart', 'permEnd', 'proofErr'].includes(element.localName));
  return blocks.length > 0 &&
    blocks.every((element) => element.namespaceURI === OOXML.W_NS && element.localName === 'p');
}

/**
 * A pair whose one side is a blank slot story is a whole insertion or
 * deletion of the other side's story, whatever its scaffold: the slot shows
 * nothing on the blank side (§17.10.5, §17.10.2). An attached story is
 * marked inserted in its own part; a dropped story is marked deleted and
 * written into the blank part the revised side selects in its place. Only a
 * pair selected by the same slots on both sides qualifies.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @see https://github.com/UseJunior/safe-docx/issues/1394
 */
async function slotLifecycleStoryInput(
  pair: PairedAncillaryStory,
  blankSlotParts: BlankSlotParts,
  originalArchive: DocxArchive,
  revisedArchive: DocxArchive,
  originalDocumentXml: string,
  revisedDocumentXml: string,
): Promise<TextBoxStoryInput | undefined> {
  const originalBlank = blankSlotParts.original.has(pair.original.targetPath);
  const revisedBlank = blankSlotParts.revised.has(pair.revised.targetPath);
  if (originalBlank === revisedBlank) return undefined;
  if (pair.original.bindingClosure !== pair.revised.bindingClosure) return undefined;
  // The story's paragraphs are tracked and its last one is made to read as the
  // blank story. A story with a table or a block container is left to the
  // ordinary pairing and its checks, which report what they cannot carry.
  if (!holdsOnlyBodyParagraphs(originalBlank ? pair.revised.xml : pair.original.xml)) return undefined;
  const storyOriginalArchive = await originalArchive.clone();
  const storyRevisedArchive = await revisedArchive.clone();
  storyOriginalArchive.setDocumentXml(
    storyDocumentXmlFromPartRoot(originalDocumentXml, originalBlank ? null : pair.original.xml),
  );
  storyRevisedArchive.setDocumentXml(
    storyDocumentXmlFromPartRoot(revisedDocumentXml, revisedBlank ? null : pair.revised.xml),
  );
  storyOriginalArchive.setFile(
    'word/_rels/document.xml.rels',
    originalBlank
      ? `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`
      : promotedStoryRelationshipsXml(pair.original.relationshipsXml, pair.original.targetPath),
  );
  storyRevisedArchive.setFile(
    'word/_rels/document.xml.rels',
    revisedBlank
      ? `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`
      : promotedStoryRelationshipsXml(pair.revised.relationshipsXml, pair.revised.targetPath),
  );
  return {
    index: 0,
    visualIndex: 0,
    partPath: pair.revised.targetPath,
    container: 'ancillaryPart',
    ancillaryMode: originalBlank ? 'inserted' : 'deleted',
    slotLifecycle: true,
    original: await storyOriginalArchive.save(),
    revised: await storyRevisedArchive.save(),
  };
}

async function ancillaryStoryInputs(
  originalArchive: DocxArchive,
  revisedArchive: DocxArchive,
  originalDocumentXml: string,
  revisedDocumentXml: string,
  blankSlotParts: BlankSlotParts,
): Promise<{
  stories: TextBoxStoryInput[];
  validateProjection: boolean;
  hasTextBoxStories: boolean;
  representedChanges: TextBoxStoryComparisonPlan['representedAncillaryChanges'];
  drawingChanges: UnrepresentedChange[];
  drawingAccountedPartPaths: string[];
  drawingAlignedOriginalParts: Map<string, string>;
  lifecyclePartPaths: string[];
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
      drawingChanges: [],
      drawingAccountedPartPaths: [],
      drawingAlignedOriginalParts: new Map(),
      lifecyclePartPaths: [],
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
  const drawingChanges: UnrepresentedChange[] = [];
  const drawingAccountedPartPaths: string[] = [];
  const drawingAlignedOriginalParts = new Map<string, string>();
  const lifecyclePartPaths: string[] = [];
  for (const pair of paired.pairs) {
    const slotLifecycle = await slotLifecycleStoryInput(
      pair,
      blankSlotParts,
      originalArchive,
      revisedArchive,
      originalDocumentXml,
      revisedDocumentXml,
    );
    if (slotLifecycle) {
      stories.push(slotLifecycle);
      representedChanges.push(...pair.revised.bindings.map((binding) => ({
        scope: binding.kind,
        kind: 'changed' as const,
        sectionIndex: binding.sectionOrdinal,
        role: binding.role,
        partPath: pair.revised.targetPath,
      })));
      continue;
    }
    const lifecycle = await lifecycleAncillaryStoryInputs(
      pair,
      topologyMatches,
      originalArchive,
      revisedArchive,
      originalDocumentXml,
      revisedDocumentXml,
    );
    if (lifecycle) {
      stories.push(...lifecycle);
      lifecyclePartPaths.push(pair.revised.targetPath);
      representedChanges.push(...pair.revised.bindings.map((binding) => ({
        scope: binding.kind,
        kind: 'changed' as const,
        sectionIndex: binding.sectionOrdinal,
        role: binding.role,
        partPath: pair.revised.targetPath,
      })));
      continue;
    }
    // A box stored differently in the two parts takes the revised storage
    // around its original story before anything is compared (#1383).
    const storage = alignAncillaryTextBoxStorage(
      pair.original.xml,
      pair.revised.xml,
      relationshipTargets(pair.original.relationshipsXml),
      relationshipTargets(pair.revised.relationshipsXml),
      pair.revised.targetPath,
    );
    const original = storage.boxes.length > 0
      ? { ...pair.original, xml: storage.xml, textBoxes: partTextBoxes(storage.xml) }
      : pair.original;
    if (
      topologyMatches
      && pair.bindingClosureMatched
      && original.ordinaryContent !== pair.revised.ordinaryContent
      && ordinaryStoryScaffoldFingerprint(original.xml, trackableFormatting)
        === ordinaryStoryScaffoldFingerprint(pair.revised.xml, trackableFormatting)
    ) {
      const originalTargets = relationshipTargets(original.relationshipsXml);
      const revisedTargets = relationshipTargets(pair.revised.relationshipsXml);
      const originalRoot = parseXml(original.xml).documentElement;
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
          partXmlWithRevisedTextBoxes(original.xml, pair.revised.xml),
        ));
        storyRevisedArchive.setDocumentXml(storyDocumentXmlFromPartRoot(
          revisedDocumentXml,
          pair.revised.xml,
        ));
        storyOriginalArchive.setFile(
          'word/_rels/document.xml.rels',
          promotedStoryRelationshipsXml(original.relationshipsXml, original.targetPath),
        );
        storyRevisedArchive.setFile(
          'word/_rels/document.xml.rels',
          promotedStoryRelationshipsXml(pair.revised.relationshipsXml, pair.revised.targetPath),
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
    const originalVisualOrdinals = partVisualTextBoxOrdinals(original.xml);
    const visualOrdinals = partVisualTextBoxOrdinals(pair.revised.xml);
    if (original.textBoxes.length !== pair.revised.textBoxes.length) {
      const rawIndex = Math.min(
        original.textBoxes.length,
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
    // The closure compares relationship semantics (type, target, mode), which
    // is what rebinding the compared story to its owner needs. A picture or
    // object whose payload changed under the same semantics is admitted: the
    // story comparison carries it, and `auditPicturePayloads` lists it in
    // `unrepresentedChanges` after the comparison, instead of the whole
    // comparison being refused (#1430).
    const originalTargets = relationshipTargets(original.relationshipsXml);
    const revisedTargets = relationshipTargets(pair.revised.relationshipsXml);
    const shapedBoxes: Array<{ index: number; change: DrawingShapeChange }> = [];
    for (let index = 0; index < original.textBoxes.length; index += 1) {
      const originalTextBox = original.textBoxes[index]!;
      const revisedTextBox = pair.revised.textBoxes[index]!;
      // A header or footer story is spliced into the revised part, so its
      // drawing is the revised one whether or not its text changed. Neither
      // can be tracked there, so both are listed (#1382).
      // Boxes reach this path only when identity pairing matched them in
      // order; a box with another identity is replaced by
      // `lifecycleAncillaryStoryInputs` (#1384), so this guards only a pair
      // whose identifiers differ in a way pairing still accepted.
      const shapeChange = drawingShapeChange(originalTextBox, revisedTextBox);
      const replacedDrawing = shapeChange !== undefined &&
        copyIdentityTokens(originalTextBox).join('|') !== copyIdentityTokens(revisedTextBox).join('|');
      if (shapeChange && !replacedDrawing) shapedBoxes.push({ index, change: shapeChange });
      const originalRelationshipClosure = relationshipClosureFingerprint(
        originalTextBox,
        originalTargets,
      );
      const revisedRelationshipClosure = relationshipClosureFingerprint(
        revisedTextBox,
        revisedTargets,
      );
      // As for body boxes: identical markup over a changed closure is a
      // change, and a changed closure is compared, its relationships
      // imported into this part's own `.rels` by the splice (#1381).
      if (
        canonicalNode(originalTextBox) === canonicalNode(revisedTextBox) &&
        originalRelationshipClosure === revisedRelationshipClosure
      ) {
        continue;
      }
      const reason =
        unsupportedStoryReason(originalTextBox) ??
        unsupportedStoryReason(revisedTextBox) ??
        (originalRelationshipClosure === undefined ||
        revisedRelationshipClosure === undefined
          ? 'the ancillary text-box relationship closure could not be resolved'
          : undefined) ??
        scaffoldPairingReason(
          originalTextBox,
          revisedTextBox,
          'the ancillary VML shape scaffold could not be paired',
        ) ??
        (replacedDrawing
          ? 'the ancillary text-box scaffold names a different drawing (its anchor identity changed)'
          : undefined);
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
          original.xml,
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
        promotedStoryRelationshipsXml(original.relationshipsXml, original.targetPath),
      );
      storyRevisedArchive.setFile(
        'word/_rels/document.xml.rels',
        promotedStoryRelationshipsXml(pair.revised.relationshipsXml, pair.revised.targetPath),
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
    if (shapedBoxes.length > 0 || storage.boxes.length > 0) {
      const alignedXml = shapedBoxes.length > 0
        ? partXmlWithRevisedDrawings(
          original.xml,
          pair.revised.xml,
          shapedBoxes.map(({ index }) => index),
        )
        : original.xml;
      if (alignedXml !== undefined) {
        drawingAlignedOriginalParts.set(original.targetPath, alignedXml);
        // The part's entry is represented when its stories and drawings are
        // all it changed: the stories are tracked (and projection-checked),
        // the drawings listed. A drawing that draws more than its box (a
        // group, another shape beside it) keeps the part's own entry too.
        if (
          shapedBoxes.every(({ index, change }) =>
            isSoleDrawingShape(original.textBoxes[index]!, change.originalContainer) &&
            isSoleDrawingShape(pair.revised.textBoxes[index]!, change.revisedContainer) &&
            shapeTemplatesAgree(change.originalContainer, change.revisedContainer)) &&
          canonicalNode(
            parseXml(partXmlWithRevisedTextBoxes(alignedXml, pair.revised.xml)).documentElement,
          ) === pair.revised.canonical
        ) {
          drawingAccountedPartPaths.push(pair.revised.targetPath);
          representedChanges.push(...pair.revised.bindings.map((binding) => ({
            scope: binding.kind,
            kind: 'changed' as const,
            sectionIndex: binding.sectionOrdinal,
            role: binding.role,
            partPath: pair.revised.targetPath,
          })));
        }
      }
      const reports: Array<{ visualIndex: number; element: UnrepresentedDrawingChange['element']; name?: string }> =
        storage.boxes.filter(({ visible }) => visible);
      const reported = new Set(reports.map(({ visualIndex }) => visualIndex));
      for (const { index } of shapedBoxes) {
        const visualIndex = visualOrdinals[index] ?? index;
        if (reported.has(visualIndex)) continue;
        const change = shapedBoxes.find((box) =>
          (visualOrdinals[box.index] ?? box.index) === visualIndex && box.change.visible)?.change;
        if (!change) continue;
        reported.add(visualIndex);
        const name = shapedBoxes
          .filter((box) => (visualOrdinals[box.index] ?? box.index) === visualIndex)
          .map((box) => box.change.name)
          .find((candidate) => candidate !== undefined);
        reports.push({ visualIndex, element: change.element, ...(name !== undefined ? { name } : {}) });
      }
      reports.sort((left, right) => left.visualIndex - right.visualIndex);
      for (const { visualIndex, element, name } of reports) {
        for (const binding of pair.revised.bindings) {
          drawingChanges.push({
            scope: 'drawing',
            kind: 'changed',
            sectionIndex: binding.sectionOrdinal,
            role: binding.role,
            drawing: {
              story: binding.kind,
              partPath: pair.revised.targetPath,
              index: visualIndex,
              element,
              ...(name !== undefined ? { name } : {}),
            },
          });
        }
      }
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
      promotedStoryRelationshipsXml(story.relationshipsXml, story.targetPath),
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
      promotedStoryRelationshipsXml(story.relationshipsXml, story.targetPath),
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
    drawingChanges,
    drawingAccountedPartPaths,
    drawingAlignedOriginalParts,
    lifecyclePartPaths,
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

  const resolvedStory = createResolvedStoryReader();

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
    if (
      ordinaryStoryScaffoldFingerprint(originalStory.xml, trackableFormatting)
        !== ordinaryStoryScaffoldFingerprint(revisedStory.xml, trackableFormatting)
    ) {
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
      promotedStoryRelationshipsXml(originalStory.relationshipsXml, originalPath),
    );
    storyRevisedArchive.setFile(
      'word/_rels/document.xml.rels',
      promotedStoryRelationshipsXml(revisedStory.relationshipsXml, comparedPath),
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
 * Align every paired body box the two documents store differently, in the
 * original document, and say what it changed.
 *
 * A box paired across storage shapes (`sameBoxStoredDifferently`) whose text
 * changed, or whose spelling both sides store did not change, takes the
 * revised storage around its original story (`textBoxStorageAlignment`), so
 * its text is tracked inside the box in every stored copy and a re-save by a
 * newer Word — the same box, now twinned — shows no text revision. The added
 * or dropped spelling is listed with the `drawing` scope, as any drawing the
 * redline carries without markup is (#1382). A box whose shared spelling
 * alone changed, or whose storage cannot be carried, stays a native
 * replacement in the outer comparison.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 1 § 20.4.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/1383
 */
function alignBodyTextBoxStorage(
  originalDocument: Document,
  revisedDocument: Document,
  originalTargets: ReadonlyMap<string, string>,
  revisedTargets: ReadonlyMap<string, string>,
): { aligned: boolean; drawingChanges: UnrepresentedChange[]; originalDocumentXml?: string } {
  const rawIndexOf = (document: Document): Map<Element, number> =>
    new Map(Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'))
      .map((copy, rawIndex) => [copy, rawIndex]));
  const revisedGroups = textBoxGroups(revisedDocument);
  const originalCandidates = textBoxPairingCandidates(
    textBoxGroups(originalDocument),
    rawIndexOf(originalDocument),
  );
  const revisedCandidates = textBoxPairingCandidates(revisedGroups, rawIndexOf(revisedDocument));
  const visualOrdinals = visualTextBoxOrdinals(revisedDocument);
  const revisedRawIndex = rawIndexOf(revisedDocument);
  const drawingChanges: UnrepresentedChange[] = [];
  let aligned = false;
  for (const [originalIndex, revisedIndex] of pairTextBoxCandidates(originalCandidates, revisedCandidates).pairs) {
    const original = originalCandidates[originalIndex]!;
    const revised = revisedCandidates[revisedIndex]!;
    // Only a box the two documents identify as the same box is re-stored;
    // anonymous boxes paired by position alone stay native replacements.
    if (original.storage === revised.storage || !original.tokens?.length || !revised.tokens?.length) continue;
    const rendered = revisedGroups.find((group) => revised.copies.includes(group.selected))?.selected
      ?? revised.copies[0]!;
    const alignment = textBoxStorageAlignment(
      original.copies,
      revised.copies,
      rendered,
      originalTargets,
      revisedTargets,
    );
    if (!alignment || (alignment.textUnchanged && alignment.sharedChanged)) continue;
    alignment.apply();
    aligned = true;
    if (!alignment.visible) continue;
    const rawIndex = revisedRawIndex.get(rendered)!;
    drawingChanges.push({
      scope: 'drawing',
      kind: 'changed',
      sectionIndex: sectionIndexOf(alignment.renderedContainer),
      drawing: {
        story: 'body',
        partPath: 'word/document.xml',
        index: visualOrdinals[rawIndex] ?? rawIndex,
        element: alignment.renderedContainer.localName as UnrepresentedDrawingChange['element'],
        ...(alignment.name !== undefined ? { name: alignment.name } : {}),
      },
    });
  }
  return aligned
    ? { aligned, drawingChanges, originalDocumentXml: serializer.serializeToString(originalDocument) }
    : { aligned, drawingChanges };
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
  blankSlotParts: BlankSlotParts = NO_BLANK_SLOT_PARTS,
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
    blankSlotParts,
  );
  // Relationship semantics only: a payload changed under the same semantics
  // is carried by the story comparison and listed by `auditPicturePayloads`
  // rather than refusing the comparison (#1430).
  const originalRelationshipTargets = relationshipTargets(
    await originalArchive.getFile('word/_rels/document.xml.rels'),
  );
  const revisedRelationshipTargets = relationshipTargets(
    await revisedArchive.getFile('word/_rels/document.xml.rels'),
  );
  const originalDocument = parseXml(originalDocumentXml);
  const revisedDocument = parseXml(revisedDocumentXml);
  const storage = alignBodyTextBoxStorage(
    originalDocument,
    revisedDocument,
    originalRelationshipTargets,
    revisedRelationshipTargets,
  );
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
  const identityPairing = pairTextBoxCandidates(originalCandidates, revisedCandidates);
  // A box still stored differently after `alignBodyTextBoxStorage` keeps its
  // native redline: the outer comparison tracks it as replaced (#1383).
  const pairing = {
    ...identityPairing,
    pairs: identityPairing.pairs.filter(([originalIndex, revisedIndex]) =>
      originalCandidates[originalIndex]!.storage === revisedCandidates[revisedIndex]!.storage),
  };
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
    for (const [offset, originalCopy] of originalCandidate.copies.entries()) {
      pairedCopies.push([originalCopy, revisedCandidate.copies[offset]!]);
    }
  }
  const unpairedTextBoxes =
    pairedCopies.length !== originalTextBoxes.length ||
    pairedCopies.length !== revisedTextBoxes.length;
  // A box with no counterpart is tracked whole, but its story must still be
  // inside the supported subset: a note/comment reference in it would be
  // carried into the redline without its own lifecycle (#1385). Pictures,
  // objects and nested boxes are marked with the box (#1380).
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
        const reason = unsupportedStoryReason(copy, { allowNestedTextBoxes: true });
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
  const shapeChanges: Array<{
    originalIndex: number;
    revisedIndex: number;
    change: DrawingShapeChange;
  }> = [];
  for (const [originalTextBox, revisedTextBox] of pairedCopies) {
    const index = revisedRawIndex.get(revisedTextBox)!;
    const shapeChange = drawingShapeChange(originalTextBox, revisedTextBox);
    if (shapeChange) {
      shapeChanges.push({
        originalIndex: originalRawIndex.get(originalTextBox)!,
        revisedIndex: index,
        change: shapeChange,
      });
    }
    const originalRelationshipClosure = relationshipClosureFingerprint(
      originalTextBox,
      originalRelationshipTargets,
    );
    const revisedRelationshipClosure = relationshipClosureFingerprint(
      revisedTextBox,
      revisedRelationshipTargets,
    );
    // Identical markup is an unchanged box only when every relationship id
    // in it still means the same thing: a hyperlink retargeted under its old
    // id is a change too (#1381).
    if (
      canonicalNode(originalTextBox) === canonicalNode(revisedTextBox) &&
      originalRelationshipClosure === revisedRelationshipClosure
    ) {
      continue;
    }
    // A closure that differs is compared like any other story change: the
    // story comparison tracks the old and the new reference, and the splice
    // imports what the owner lacks (#1381). A reference that resolves to
    // nothing cannot be rebound at all.
    const reason =
      unsupportedStoryReason(originalTextBox, { allowNestedTextBoxes: true }) ??
      unsupportedStoryReason(revisedTextBox, { allowNestedTextBoxes: true }) ??
      (originalRelationshipClosure === undefined ||
      revisedRelationshipClosure === undefined
        ? 'the text-box relationship closure could not be resolved'
        : undefined) ??
      scaffoldPairingReason(
        originalTextBox,
        revisedTextBox,
        'the containing VML shape scaffold could not be paired',
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

  // A box whose text and drawing both changed has its text tracked inside
  // the box and carries the revised drawing, listed in `unrepresentedChanges`
  // (#1382): the original side takes the revised drawing around its own
  // story, so the outer comparison sees one unchanged anchor and the story
  // comparison tracks the text. Every stored copy of the box is aligned, or
  // none is: a copy left behind would make the outer comparison replace the
  // whole box, and the note would describe a shape the redline does track.
  // A drawing whose text did not change stays in the outer comparison, which
  // tracks it as a replaced atomic leaf; so does a box whose drawing cannot
  // move across: a drawing that draws more than the box (a VML or DrawingML
  // group or canvas, or another shape beside it, whose geometry the note
  // would not name), or a relationship id that resolves elsewhere in the
  // original document.
  const changedVisualBoxes = new Set(
    changedCopies.map(({ revisedIndex }) => visualOrdinals[revisedIndex] ?? revisedIndex),
  );
  const shapeChangesByBox = new Map<number, typeof shapeChanges>();
  for (const shapeChange of shapeChanges) {
    const visualIndex = visualOrdinals[shapeChange.revisedIndex] ?? shapeChange.revisedIndex;
    if (!changedVisualBoxes.has(visualIndex)) continue;
    const box = shapeChangesByBox.get(visualIndex);
    if (box) box.push(shapeChange);
    else shapeChangesByBox.set(visualIndex, [shapeChange]);
  }
  const alignedShapeCopies = new Map<number, number>();
  const drawingChanges: UnrepresentedChange[] = [];
  const renderedCopies = new Set(textBoxGroups(revisedDocument).map((group) => group.selected));
  for (const [visualIndex, copies] of shapeChangesByBox) {
    const movable = copies.every(({ originalIndex, revisedIndex, change }) =>
      ownTextBoxes(change.originalContainer).length === 1 &&
      ownTextBoxes(change.revisedContainer).length === 1 &&
      isSoleDrawingShape(originalTextBoxes[originalIndex]!, change.originalContainer) &&
      isSoleDrawingShape(revisedTextBoxes[revisedIndex]!, change.revisedContainer) &&
      shapeTemplatesAgree(change.originalContainer, change.revisedContainer) &&
      drawingRelationshipsAgree(
        change.revisedContainer,
        originalRelationshipTargets,
        revisedRelationshipTargets,
      ));
    if (!movable) continue;
    for (const { originalIndex, revisedIndex } of copies) {
      alignedShapeCopies.set(revisedIndex, originalIndex);
    }
    if (!copies.some(({ change }) => change.visible)) continue;
    const shown = copies.find(({ revisedIndex }) =>
      renderedCopies.has(revisedTextBoxes[revisedIndex]!)) ?? copies[0]!;
    const name = copies.map(({ change }) => change.name).find((candidate) => candidate !== undefined);
    drawingChanges.push({
      scope: 'drawing',
      kind: 'changed',
      sectionIndex: sectionIndexOf(shown.change.revisedContainer),
      drawing: {
        story: 'body',
        partPath: 'word/document.xml',
        index: visualIndex,
        element: shown.change.element,
        ...(name !== undefined ? { name } : {}),
      },
    });
  }
  drawingChanges.sort((left, right) => left.drawing!.index - right.drawing!.index);
  /**
   * Put the revised drawing around `originalIndex`'s current story. The
   * replaced container's boxes are replaced too, so every raw position is
   * rebound to the copy now in the document.
   */
  const alignShape = (originalIndex: number, revisedIndex: number): void => {
    const originalContainer = drawingContainer(originalTextBoxes[originalIndex]!);
    const revisedContainer = drawingContainer(revisedTextBoxes[revisedIndex]!);
    if (!originalContainer || !revisedContainer) return;
    const aligned = originalStoriesInRevisedDrawing(originalContainer, revisedContainer);
    if (!aligned) return;
    const before = Array.from(originalContainer.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'));
    const after = Array.from(aligned.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'));
    originalContainer.parentNode!.replaceChild(aligned, originalContainer);
    for (const [offset, textBox] of before.entries()) {
      const rawIndex = originalTextBoxes.indexOf(textBox);
      if (rawIndex >= 0 && after[offset]) originalTextBoxes[rawIndex] = after[offset]!;
    }
  };

  // Stories are cut innermost first (#1380). A changed box nested in another
  // changed box is replaced by its placeholder before the enclosing box's
  // story is taken, so the enclosing story carries one unchanged placeholder
  // leaf and the nested box's text is compared, with its own revisions, in a
  // story of its own. Raw positions are document order, which visits an
  // enclosing box before the boxes inside it, so descending raw position is
  // innermost first. Splicing runs outermost first: the nested placeholder
  // only exists in the output once the enclosing story is in place. A
  // drawing moved across (#1382) moves at its own position in that order, so
  // an enclosing story is cut with its nested drawings already aligned.
  const bodyStories: TextBoxStoryInput[] = [];
  const changedRevisedIndexes = new Set(changedCopies.map(({ revisedIndex }) => revisedIndex));
  const innermostFirst = [
    ...changedCopies,
    ...[...alignedShapeCopies]
      .filter(([revisedIndex]) => !changedRevisedIndexes.has(revisedIndex))
      .map(([revisedIndex, originalIndex]) => ({ originalIndex, revisedIndex })),
  ].sort((left, right) => right.revisedIndex - left.revisedIndex);
  for (const { originalIndex, revisedIndex: index } of innermostFirst) {
    if (!changedRevisedIndexes.has(index)) {
      alignShape(originalIndex, index);
      continue;
    }
    const storyOriginalArchive = await originalArchive.clone();
    const storyRevisedArchive = await revisedArchive.clone();
    storyOriginalArchive.setDocumentXml(
      storyDocumentXmlFromTextBox(
        originalDocumentXml,
        originalTextBoxes[originalIndex]!,
      ),
    );
    storyRevisedArchive.setDocumentXml(
      storyDocumentXmlFromTextBox(revisedDocumentXml, revisedTextBoxes[index]!),
    );
    bodyStories.unshift({
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
    if (alignedShapeCopies.has(index)) alignShape(originalIndex, index);
  }
  const stories: TextBoxStoryInput[] = [...ancillary.stories, ...bodyStories];
  const allDrawingChanges = [
    ...ancillary.drawingChanges,
    ...[...storage.drawingChanges, ...drawingChanges]
      .sort((left, right) => left.drawing!.index - right.drawing!.index),
  ];

  if (
    stories.length === 0 &&
    !ancillary.validateProjection &&
    !unpairedTextBoxes &&
    allDrawingChanges.length === 0 &&
    !storage.aligned &&
    ancillary.drawingAccountedPartPaths.length === 0
  ) {
    return undefined;
  }

  let ancillaryProjectionOriginal: Buffer | undefined;
  if (ancillary.drawingAlignedOriginalParts.size > 0) {
    const projectionArchive = await originalArchive.clone();
    for (const [partPath, xml] of ancillary.drawingAlignedOriginalParts) {
      projectionArchive.setFile(partPath, xml);
    }
    ancillaryProjectionOriginal = await projectionArchive.save();
  }

  const outerOriginalArchive = await originalArchive.clone();
  const outerRevisedArchive = await revisedArchive.clone();
  outerOriginalArchive.setDocumentXml(serializer.serializeToString(originalDocument));
  outerRevisedArchive.setDocumentXml(serializer.serializeToString(revisedDocument));

  return {
    outerOriginal: await outerOriginalArchive.save(),
    outerRevised: await outerRevisedArchive.save(),
    originalDocumentXml: storage.originalDocumentXml ?? originalDocumentXml,
    revisedDocumentXml,
    stories,
    validateAncillaryProjection: ancillary.validateProjection,
    hasAncillaryTextBoxStories: ancillary.hasTextBoxStories,
    hasUnpairedTextBoxes: unpairedTextBoxes,
    lifecycleAncillaryPartPaths: ancillary.lifecyclePartPaths,
    representedAncillaryChanges: ancillary.representedChanges,
    drawingChanges: allDrawingChanges,
    drawingAccountedPartPaths: ancillary.drawingAccountedPartPaths,
    ...(ancillaryProjectionOriginal ? { ancillaryProjectionOriginal } : {}),
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
    /** The token a header/footer box story is found by (#1384). */
    placeholder?: string;
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
    // A header/footer compared whole around an inserted or deleted box holds
    // its paired boxes as placeholders, found by token like body boxes (#1384).
    if (storyResult.placeholder !== undefined) {
      await spliceBodyTextBoxStory(targetDocument, outerArchive, storyResult, storyBody);
      outerArchive.setFile(
        storyResult.partPath,
        serializer.serializeToString(targetDocument),
      );
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
  { withinStory = false }: { withinStory?: boolean } = {},
): 'ins' | 'del' | 'moveFrom' | 'moveTo' | undefined {
  for (let node = textBox.parentNode; node?.nodeType === 1; node = node.parentNode) {
    const element = node as Element;
    if (element.namespaceURI !== OOXML.W_NS) continue;
    // `withinStory` stops at the enclosing text box: only a wrapper in the
    // story that holds this box's anchor belongs to this box.
    if (withinStory && element.localName === 'txbxContent') return undefined;
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
  partPath: string,
): Promise<Element> {
  const archive = await DocxArchive.load(side);
  const body = parseXml(await archive.getDocumentXml())
    .getElementsByTagNameNS(OOXML.W_NS, 'body')
    .item(0);
  if (!body) throw new Error('A text-box story document has no w:body');
  await remapComparedStoryRelationshipIds(
    archive,
    outerArchive,
    partPath,
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
 * Splice one compared text-box story back into the outer comparison, or
 * into a header/footer part compared whole around an inserted or deleted
 * box (#1384).
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
    placeholder?: string;
  },
  comparedStoryBody: Element,
): Promise<void> {
  const token = storyResult.placeholder ?? placeholderToken(storyResult.index);
  // A box whose only text is a nested placeholder reads as the token too, so
  // a placeholder is a box with the token and no box inside it (#1380).
  const occurrences = Array.from(
    targetDocument.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  ).filter((textBox) =>
    (textBox.textContent ?? '') === token &&
    textBox.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent').length === 0);
  const kept = occurrences.filter((textBox) => anchorRevisionWrapper(textBox) === undefined);
  const tracked = occurrences.filter((textBox) => anchorRevisionWrapper(textBox) !== undefined);
  const sideBody = async (side: Buffer | undefined): Promise<Element | undefined> =>
    side
      ? reboundSideStoryBody(side, outerArchive, storyResult.visualIndex, storyResult.partPath)
      : undefined;
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
 * tracked as inserted or deleted, and of every such box in a header/footer
 * part listed in `ancillaryPartPaths` (#1384).
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
  ancillaryPartPaths: readonly string[] = [],
): Promise<{ document: Buffer; insertedParagraphs: number; deletedParagraphs: number }> {
  const archive = await DocxArchive.load(compared);
  // A moved anchor carries the same story on both sides of the move, so
  // its story is not an insertion or a deletion and stays unmarked. A
  // nested box is marked when its own anchor, inside the enclosing story,
  // is tracked (#1380); a nested box inside a tracked enclosing box is
  // marked with that box's paragraphs instead.
  const trackedBoxesOf = (document: Document): Element[] => Array.from(
    document.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  ).filter((textBox) => {
    const wrapper = anchorRevisionWrapper(textBox, { withinStory: true });
    return wrapper === 'ins' || wrapper === 'del';
  });
  // The body, and each header/footer part compared whole around an inserted
  // or deleted box (#1384).
  const stories: Array<{ path: string; document: Document; trackedBoxes: Element[] }> = [];
  for (const path of ['word/document.xml', ...ancillaryPartPaths]) {
    const xml = path === 'word/document.xml'
      ? await archive.getDocumentXml()
      : await archive.getFile(path);
    if (xml === null) continue;
    const document = parseXml(xml);
    const trackedBoxes = trackedBoxesOf(document);
    if (trackedBoxes.length > 0) stories.push({ path, document, trackedBoxes });
  }
  if (stories.length === 0) {
    return { document: compared, insertedParagraphs: 0, deletedParagraphs: 0 };
  }
  const preservedRoots: Element[] = [];
  const marked = new Set(stories.map(({ path }) => path));
  for (const path of archive.listFiles()) {
    if (!/^word\/.*\.xml$/u.test(path) || marked.has(path)) continue;
    const xml = await archive.getFile(path);
    if (!xml) continue;
    try {
      preservedRoots.push(parseXml(xml).documentElement);
    } catch {
      // Non-WordprocessingML extension parts are irrelevant to revision IDs.
    }
  }
  const state = createRevisionIdState([
    ...stories.map(({ document }) => document.documentElement),
    ...preservedRoots,
  ]);
  state.nextId = Math.max(state.nextId, minimumRevisionId);
  const dateString = formatDate(date);
  let insertedParagraphs = 0;
  let deletedParagraphs = 0;
  for (const { path, document, trackedBoxes } of stories) {
    const rendered = new Set(textBoxGroups(document).map((group) => group.selected));
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
    const xml = serializer.serializeToString(document);
    if (path === 'word/document.xml') archive.setDocumentXml(xml);
    else archive.setFile(path, xml);
  }
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
 * that does not belong to a nested text box and is not already inside a
 * revision wrapper. A drawing or VML carrier run is wrapped too, as Word
 * tracks a shape inserted or deleted with its anchor run: the story's part can
 * stay selected after Accept All (a removed section's reference carried onto
 * the next section, #1144; a slot lifecycle, #1394), and an unwrapped carrier
 * would still draw the emptied shape's outline and fill there.
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
      !hasRevisionWrapperAncestor(element, paragraph),
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
  options: LifecycleMarkingOptions = {},
): Promise<{ document: Buffer; markedParagraphs: number }> {
  return markLifecycleAncillaryStoryParagraphs(
    storyDocument,
    preservedPackage,
    author,
    date,
    minimumRevisionId,
    'w:ins',
    options,
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
  options: LifecycleMarkingOptions = {},
): Promise<{ document: Buffer; markedParagraphs: number }> {
  return markLifecycleAncillaryStoryParagraphs(
    storyDocument,
    preservedPackage,
    author,
    date,
    minimumRevisionId,
    'w:del',
    options,
  );
}

export interface LifecycleMarkingOptions {
  /**
   * The story's part stays selected on the side without the story (a slot
   * lifecycle, #1394), so its last paragraph, which neither Accept All nor
   * Reject All removes, must read as the blank story there: its paragraph
   * properties are tracked with a `w:pPrChange` against none.
   */
  blankFinalParagraph?: boolean;
}

/**
 * Track the last paragraph's properties against an empty set, so the side
 * without the story keeps a plain empty paragraph: for an insertion the
 * prior properties are empty, for a deletion the current ones are.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.29
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.30
 */
function trackFinalParagraphPropertiesAgainstBlank(
  body: Element,
  markerTag: 'w:ins' | 'w:del',
  author: string,
  dateString: string,
  state: ReturnType<typeof createRevisionIdState>,
): void {
  const paragraphs = directChildElements(body).filter(
    (element) => element.namespaceURI === OOXML.W_NS && element.localName === 'p',
  );
  const paragraph = paragraphs[paragraphs.length - 1];
  if (!paragraph) return;
  const properties = directChildElements(paragraph).find(
    (element) => element.namespaceURI === OOXML.W_NS && element.localName === 'pPr',
  );
  if (!properties) return;
  const document = body.ownerDocument!;
  const isW = (element: Element, ...names: string[]): boolean =>
    element.namespaceURI === OOXML.W_NS && names.includes(element.localName);
  // Moves `formatting` into a `<changeName><priorName/></changeName>` record
  // appended to `container`: for a deletion the current state is blank, for
  // an insertion the prior state is. A record the story already carries keeps
  // its own history on the side that has the story: an insertion's prior
  // state becomes blank, a deletion's current state does.
  const track = (container: Element, formatting: Element[], changeName: string, priorName: string): void => {
    const existing = directChildElements(container).find((element) => isW(element, changeName));
    if (existing) {
      if (markerTag === 'w:del') {
        for (const element of formatting) container.removeChild(element);
        return;
      }
      const prior = directChildElements(existing).find((element) => isW(element, priorName));
      if (prior) {
        while (prior.firstChild) prior.removeChild(prior.firstChild);
      } else {
        existing.appendChild(document.createElementNS(OOXML.W_NS, `w:${priorName}`));
      }
      return;
    }
    if (formatting.length === 0) return;
    const change = document.createElementNS(OOXML.W_NS, `w:${changeName}`);
    change.setAttributeNS(OOXML.W_NS, 'w:id', String(allocateRevisionId(state)));
    change.setAttributeNS(OOXML.W_NS, 'w:author', author);
    change.setAttributeNS(OOXML.W_NS, 'w:date', dateString);
    const prior = document.createElementNS(OOXML.W_NS, `w:${priorName}`);
    if (markerTag === 'w:del') {
      for (const element of formatting) prior.appendChild(element);
    }
    change.appendChild(prior);
    container.appendChild(change);
  };
  // The paragraph mark's character formatting sets an empty line's height
  // too (CT_ParaRPr: revision markers first, w:rPrChange last).
  const markProperties = directChildElements(properties).find((element) => isW(element, 'rPr'));
  if (markProperties) {
    track(
      markProperties,
      directChildElements(markProperties).filter(
        (element) => !isW(element, 'ins', 'del', 'moveFrom', 'moveTo', 'rPrChange'),
      ),
      'rPrChange',
      'rPr',
    );
  }
  // CT_PPrBase: everything but the paragraph mark's w:rPr, w:sectPr and a
  // w:pPrChange.
  track(
    properties,
    directChildElements(properties).filter((element) => !isW(element, 'rPr', 'sectPr', 'pPrChange')),
    'pPrChange',
    'pPr',
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
  options: LifecycleMarkingOptions = {},
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
  if (options.blankFinalParagraph) {
    trackFinalParagraphPropertiesAgainstBlank(body, markerTag, author, dateString, state);
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
 * story changes the inventory. A blank part's pages carry `null` content and
 * are left out of the comparison, so a page showing a story whose content was
 * entirely a tracked insertion (rejected) or deletion (accepted) reads the
 * same as a page with no story at all.
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
): Promise<DisplayedStoryPage[]> {
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
  const projectedParts = new Map<string, string | null>();
  const shown = (targetPath: string): string | null => {
    if (!projectedParts.has(targetPath)) {
      projectedParts.set(targetPath, projectedStoryContent(parts.get(targetPath)!, projection));
    }
    return projectedParts.get(targetPath)!;
  };
  const inventory: DisplayedStoryPage[] = [
    { key: 'sections', content: String(bindings.sectionCount) },
  ];
  for (const { page, slot } of pageStorySlots(bindings)) {
    if (slot.targetPath === undefined) continue;
    inventory.push({
      key: [slot.sectionOrdinal, slot.kind, page].join('|'),
      targetPath: slot.targetPath,
      content: shown(slot.targetPath),
    });
  }
  return inventory;
}

/** One page entry of `displayedStoryProjectionInventory`. */
interface DisplayedStoryPage {
  /** Section ordinal, story kind and kind of page; `sections` for the section count. */
  key: string;
  /** The part the page shows, after inheritance. */
  targetPath?: string;
  /** What the part shows, or `null` when it shows nothing (a blank page reads as no story). */
  content: string | null;
}

/** A projected story part's content, or `null` when it shows nothing. */
function projectedStoryContent(
  partXml: string,
  projection: 'accept' | 'reject',
): string | null {
  const projectedXml = (projection === 'accept' ? acceptAllChanges : rejectAllChanges)(partXml);
  return isBlankStoryPart(projectedXml)
    ? null
    : [
      ordinaryStoryScaffoldFingerprint(projectedXml),
      extractRoundTripComparisonText(projectedXml),
    ].join('|');
}

/**
 * The header/footer parts the comparison left out of the redline: each part a
 * listed `header` or `footer` entry names in the revised package (which the
 * output carries) and no story comparison wrote. The output shows the revised
 * story there in both projections.
 */
function listedUncomparedStoryParts(
  revisedDocumentXml: string,
  revisedRelationshipsXml: string | null,
  unrepresented: UnrepresentedStoryParts,
): Set<string> {
  const bindings = auditSectPr(revisedDocumentXml, revisedRelationshipsXml).bindings;
  const parts = new Set<string>();
  for (const change of unrepresented.changes) {
    if ((change.scope !== 'header' && change.scope !== 'footer') || change.kind === 'removed') continue;
    for (const binding of bindings) {
      if (
        binding.sectionOrdinal === change.sectionIndex &&
        binding.kind === change.scope &&
        binding.role === change.role &&
        !unrepresented.comparedPartPaths.has(binding.targetPath)
      ) {
        parts.add(binding.targetPath);
      }
    }
  }
  return parts;
}

/** The header/footer changes a comparison lists, for the package projection check. */
export interface UnrepresentedStoryParts {
  /** The comparison's `unrepresentedChanges`. */
  changes: readonly UnrepresentedChange[];
  /** Output parts a header/footer story comparison wrote. */
  comparedPartPaths: ReadonlySet<string>;
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
 * A header or footer the comparison lists in `unrepresentedChanges` and does
 * not compare as a story is carried as the revised part, so a page showing it
 * is held to that part's own Reject All rather than the original's; a change
 * left out in one slot no longer refuses the redline of another (#1391). The
 * slot is excluded only while it stays listed.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.1
 * @see https://github.com/UseJunior/safe-docx/issues/726
 * @see https://github.com/UseJunior/safe-docx/issues/1204
 * @see https://github.com/UseJunior/safe-docx/issues/1391
 */
export async function assertAncillaryTextBoxStoryProjection(
  original: Buffer,
  revised: Buffer,
  compared: Buffer,
  unrepresented?: UnrepresentedStoryParts,
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
  // A page showing a listed part no story comparison wrote shows the revised
  // story after Reject All too (#1391): it is held to the revised part's own
  // Reject All instead of the original. Every other page keeps exact parity,
  // and Accept All is held to the revised document everywhere.
  const excludedPartPaths = unrepresented
    ? listedUncomparedStoryParts(
      revisedXml,
      await revisedArchive.getFile('word/_rels/document.xml.rels'),
      unrepresented,
    )
    : new Set<string>();
  // Blank pages stay in the inventory until here, so a listed part that
  // shows nothing still replaces the original's expectation for its pages.
  const expectedRejected = new Map(expectedOriginal.map((page) => [page.key, page.content]));
  for (const page of rejectedCompared) {
    if (page.targetPath === undefined || !excludedPartPaths.has(page.targetPath)) continue;
    const revisedPartXml = await revisedArchive.getFile(page.targetPath);
    expectedRejected.set(
      page.key,
      revisedPartXml === null ? null : projectedStoryContent(revisedPartXml, 'reject'),
    );
  }
  const listed = (pages: Iterable<[string, string | null]>): string[] =>
    [...pages]
      .filter((entry): entry is [string, string] => entry[1] !== null)
      .map(([key, content]) => `${key}|${content}`)
      .sort();
  const expectedRejectedPages = listed(expectedRejected);
  const rejectedComparedPages = listed(rejectedCompared.map((page) => [page.key, page.content]));
  const expectedRevisedPages = listed(expectedRevised.map((page) => [page.key, page.content]));
  const acceptedComparedPages = listed(acceptedCompared.map((page) => [page.key, page.content]));
  if (
    JSON.stringify(expectedRejectedPages) !== JSON.stringify(rejectedComparedPages) ||
    JSON.stringify(expectedRevisedPages) !== JSON.stringify(acceptedComparedPages)
  ) {
    const digest = (items: string[]): string =>
      createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 12);
    throw new UnsupportedTextBoxRevisionError([{
      index: 0,
      partPath: 'word/document.xml',
      reason:
        'assembled relationship-selected stories failed accept/reject package projection validation ' +
        `(original ${digest(expectedRejectedPages)} != ${digest(rejectedComparedPages)}; ` +
        `revised ${digest(expectedRevisedPages)} != ${digest(acceptedComparedPages)})`,
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
