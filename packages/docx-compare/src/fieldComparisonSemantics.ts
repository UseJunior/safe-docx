import {
  OOXML,
  classifyFieldInstruction,
  parseXml,
  projectSymbolRun,
} from '@usejunior/docx-core';
import { XMLSerializer } from '@xmldom/xmldom';
import { EMPTIED_CONTAINER_MARKER } from './tagged/emptiedBlockContainers.js';
import { paragraphPropertySignature } from './tagged/paragraphPropertyParity.js';

const PAGEREF_IDENTITY_PREFIX = '__safe_docx_pageref__|';

/**
 * Stable comparison identity for volatile PAGEREF cached results.
 *
 * Suppression here is deliberately more permissive than the evaluation
 * classifier. Evaluation must fail closed on any instruction it cannot fully
 * model, but comparison must fail *open*: an instruction we decline to
 * classify still has a volatile page-number cache, and refusing it an identity
 * republishes pagination churn as an authored revision. Keyword recognition is
 * therefore the floor, matching the behavior this function has always had.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 * @see https://github.com/UseJunior/safe-docx/issues/716
 * @see https://github.com/UseJunior/safe-docx/issues/762
 */
export function pagerefComparisonIdentity(instructionText: string): string | undefined {
  const classification = classifyFieldInstruction(instructionText);
  if (
    classification.kind === 'PAGEREF' &&
    classification.evaluationClass === 'layout-dependent'
  ) {
    return `${PAGEREF_IDENTITY_PREFIX}${classification.normalizedInstruction}`;
  }
  const collapsed = instructionText.trim().replace(/\s+/gu, ' ');
  if (!/^PAGEREF(?:\s|$)/iu.test(collapsed)) return undefined;
  return `${PAGEREF_IDENTITY_PREFIX}${collapsed.replace(/^PAGEREF/iu, 'PAGEREF')}`;
}

/**
 * The instruction a reader would act on: the surviving text, or the deleted
 * text when the whole instruction was struck. Concatenating both views yields a
 * chimera like `PAGEREF _Toc1 \h PAGEREF _Toc1 \h`, which parses as neither.
 */
function fieldInstructionView(field: {
  currentInstruction: string[];
  deletedInstruction: string[];
}): string {
  const current = field.currentInstruction.join('');
  return current.trim().length > 0 ? current : field.deletedInstruction.join('');
}

/**
 * Replace volatile TOC PAGEREF result text with its stable instruction identity.
 *
 * Formatting fidelity uses visible text to align paragraphs and characters.
 * Without this projection, a layout-only cache refresh (for example `3` to
 * `10`) prevents an otherwise identical TOC paragraph from aligning and is
 * incorrectly reported as formatting loss. This helper mutates only a parsed
 * comparison copy; published OOXML is never rewritten by it.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 * @see https://github.com/UseJunior/safe-docx/issues/716
 */
export function normalizeVolatilePagerefCachesForComparison(
  documentXml: string,
): string {
  const document = parseXml(documentXml);
  const paragraphs = Array.from(
    document.getElementsByTagNameNS(OOXML.W_NS, 'p'),
  );

  for (const paragraph of paragraphs) {
    const paragraphStyle = Array.from(
      paragraph.getElementsByTagNameNS(OOXML.W_NS, 'pStyle'),
    )[0];
    const styleId =
      paragraphStyle?.getAttributeNS(OOXML.W_NS, 'val') ??
      paragraphStyle?.getAttribute('w:val');
    if (!isTocParagraphStyle(styleId)) continue;

    const stack: Array<{
      currentInstruction: string[];
      deletedInstruction: string[];
      separated: boolean;
      comparisonIdentity?: string;
      resultTextNodes: Element[];
    }> = [];
    const normalizeField = (field: (typeof stack)[number]): void => {
      if (!field.comparisonIdentity || field.resultTextNodes.length === 0) return;
      field.resultTextNodes[0]!.textContent = field.comparisonIdentity;
      for (const resultNode of field.resultTextNodes.slice(1)) {
        resultNode.textContent = '';
      }
    };
    const walk = (node: Node, deleted: boolean): void => {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== 1) continue;
        const element = child as Element;
        const withinDeletion =
          deleted ||
          (element.namespaceURI === OOXML.W_NS &&
            (element.localName === 'del' || element.localName === 'moveFrom'));
        if (element.namespaceURI === OOXML.W_NS && element.localName === 'fldChar') {
          const type =
            element.getAttributeNS(OOXML.W_NS, 'fldCharType') ??
            element.getAttribute('w:fldCharType');
          if (type === 'begin') {
            stack.push({
              currentInstruction: [],
              deletedInstruction: [],
              separated: false,
              resultTextNodes: [],
            });
          } else if (type === 'separate' && stack.length > 0) {
            const field = stack[stack.length - 1]!;
            field.separated = true;
            field.comparisonIdentity = pagerefComparisonIdentity(
              fieldInstructionView(field),
            );
          } else if (type === 'end' && stack.length > 0) {
            normalizeField(stack.pop()!);
          }
        } else if (
          element.namespaceURI === OOXML.W_NS &&
          (element.localName === 'instrText' ||
            element.localName === 'delInstrText') &&
          stack.length > 0 &&
          !stack[stack.length - 1]!.separated
        ) {
          const field = stack[stack.length - 1]!;
          const target =
            withinDeletion || element.localName === 'delInstrText'
              ? field.deletedInstruction
              : field.currentInstruction;
          target.push(element.textContent ?? '');
        } else if (
          element.namespaceURI === OOXML.W_NS &&
          (element.localName === 't' || element.localName === 'delText') &&
          stack.length > 0 &&
          stack[stack.length - 1]!.separated &&
          stack[stack.length - 1]!.comparisonIdentity
        ) {
          stack[stack.length - 1]!.resultTextNodes.push(element);
        }
        walk(element, withinDeletion);
      }
    };
    walk(paragraph, false);
    for (const field of stack) normalizeField(field);
  }

  return new XMLSerializer().serializeToString(document);
}

/** True for the built-in TOC paragraph style identifiers used by Word. */
export function isTocParagraphStyle(styleId: string | null | undefined): boolean {
  return /^TOC(?:\s*\d+)?$/iu.test(styleId?.trim() ?? '');
}

/** Options for {@link extractRoundTripComparisonText}. */
export interface RoundTripComparisonTextOptions {
  /**
   * Also project the run-content layout characters `w:tab`, `w:br`, `w:cr`,
   * `w:noBreakHyphen` and `w:softHyphen` (see
   * {@link ROUND_TRIP_LAYOUT_CHARACTERS}). The tagged publication gate opts in;
   * the default stays off so callers that compare against the historical
   * projection keep their identity.
   */
  layoutCharacters?: boolean;
}

/**
 * The character each run-content layout element projects to when
 * {@link RoundTripComparisonTextOptions.layoutCharacters} is set.
 *
 * Tab and the break kinds use the control characters Word's own object model
 * reports for them in `Range.Text` (9, 11, 12 and 14), so a literal tab inside
 * `w:t` and `w:tab` project alike. `w:cr` projects like a `w:br` with no type,
 * because the spec defines it as identical to one. The two hyphens project to
 * their Unicode code points, so a literal U+2011 or U+00AD in `w:t` and the
 * element spelling agree. `w:br/@w:clear` only says where text restarts
 * around floating objects and is outside the projected identity.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.32
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.29
 * @see https://github.com/UseJunior/safe-docx/issues/1026
 */
export const ROUND_TRIP_LAYOUT_CHARACTERS = Object.freeze({
  tab: '\t',
  lineBreak: '\u000B',
  pageBreak: '\u000C',
  columnBreak: '\u000E',
  noBreakHyphen: '‑',
  softHyphen: '­',
});

function layoutCharacter(element: Element): string | undefined {
  if (element.namespaceURI !== OOXML.W_NS) return undefined;
  // Only run content: `w:tab` is also the tab-stop definition inside
  // `w:pPr/w:tabs`, which is paragraph formatting, not a character.
  const parent = element.parentNode as Element | null;
  if (!parent || parent.namespaceURI !== OOXML.W_NS || parent.localName !== 'r') return undefined;
  switch (element.localName) {
    case 'tab':
      return ROUND_TRIP_LAYOUT_CHARACTERS.tab;
    case 'cr':
      return ROUND_TRIP_LAYOUT_CHARACTERS.lineBreak;
    case 'br': {
      const type = element.getAttributeNS(OOXML.W_NS, 'type') || element.getAttribute('w:type');
      if (type === 'page') return ROUND_TRIP_LAYOUT_CHARACTERS.pageBreak;
      if (type === 'column') return ROUND_TRIP_LAYOUT_CHARACTERS.columnBreak;
      return ROUND_TRIP_LAYOUT_CHARACTERS.lineBreak;
    }
    case 'noBreakHyphen':
      return ROUND_TRIP_LAYOUT_CHARACTERS.noBreakHyphen;
    case 'softHyphen':
      return ROUND_TRIP_LAYOUT_CHARACTERS.softHyphen;
    default:
      return undefined;
  }
}

interface RoundTripParagraphProjection {
  text: string;
  /** The paragraph belongs to a text box story (`w:txbxContent`). */
  insideTextBox: boolean;
  /** The sole paragraph of a block container stamped as emptied. */
  emptiedContainerPlaceholder: boolean;
  /** {@link paragraphPropertySignature} of the paragraph. */
  propertySignature: string;
}

/**
 * The placeholder paragraph a whole inserted or deleted block container keeps
 * in the projection that removes its content, once the candidate has been
 * stamped by `markWholeTrackedContainers`.
 */
function isEmptiedContainerPlaceholderParagraph(paragraph: Element): boolean {
  const parent = paragraph.parentNode as Element | null;
  if (!parent || parent.namespaceURI !== OOXML.W_NS ||
      !['sdtContent', 'customXml'].includes(parent.localName)) return false;
  const container = parent.localName === 'sdtContent' ? parent.parentNode as Element | null : parent;
  if (!container?.getAttribute(EMPTIED_CONTAINER_MARKER)) return false;
  let siblings = 0;
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (node as Element).localName !== 'customXmlPr') siblings++;
  }
  return siblings === 1;
}

function isInsideTextBox(paragraph: Element): boolean {
  for (let node = paragraph.parentNode; node && node.nodeType === 1; node = node.parentNode) {
    const element = node as Element;
    if (element.namespaceURI === OOXML.W_NS && element.localName === 'txbxContent') return true;
  }
  return false;
}

function projectRoundTripParagraphs(
  documentXml: string,
  options: RoundTripComparisonTextOptions,
): RoundTripParagraphProjection[] {
  const document = parseXml(documentXml);
  const paragraphs = Array.from(
    document.getElementsByTagNameNS(OOXML.W_NS, 'p'),
  );
  const projections: RoundTripParagraphProjection[] = [];

  for (const paragraph of paragraphs) {
    const text: string[] = [];
    const paragraphStyle = Array.from(
      paragraph.getElementsByTagNameNS(OOXML.W_NS, 'pStyle'),
    )[0];
    const styleId =
      paragraphStyle?.getAttributeNS(OOXML.W_NS, 'val') ??
      paragraphStyle?.getAttribute('w:val');
    const suppressPagerefCache = isTocParagraphStyle(styleId);
    const stack: Array<{
      currentInstruction: string[];
      deletedInstruction: string[];
      separated: boolean;
      comparisonIdentity?: string;
    }> = [];
    const insidePagerefResult = (): boolean => stack.some(
      (field) => field.separated && field.comparisonIdentity !== undefined,
    );
    const walk = (node: Node, deleted: boolean): void => {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== 1) continue;
        const element = child as Element;
        const withinDeletion =
          deleted ||
          (element.namespaceURI === OOXML.W_NS &&
            (element.localName === 'del' || element.localName === 'moveFrom'));
        if (element.namespaceURI === OOXML.W_NS && element.localName === 'fldChar') {
          const type =
            element.getAttributeNS(OOXML.W_NS, 'fldCharType') ??
            element.getAttribute('w:fldCharType');
          if (type === 'begin') {
            stack.push({
              currentInstruction: [],
              deletedInstruction: [],
              separated: false,
            });
          } else if (type === 'separate' && stack.length > 0) {
            const field = stack[stack.length - 1]!;
            field.separated = true;
            field.comparisonIdentity = suppressPagerefCache
              ? pagerefComparisonIdentity(fieldInstructionView(field))
              : undefined;
            if (field.comparisonIdentity) text.push(field.comparisonIdentity);
          } else if (type === 'end' && stack.length > 0) {
            stack.pop();
          }
        } else if (
          element.namespaceURI === OOXML.W_NS &&
          (element.localName === 'instrText' ||
            element.localName === 'delInstrText') &&
          stack.length > 0 &&
          !stack[stack.length - 1]!.separated
        ) {
          const field = stack[stack.length - 1]!;
          // `w:delInstrText` is the canonical deleted-instruction element, but
          // Word and our own atomizer both also emit plain `w:instrText` inside
          // a `w:del`. Ancestry is the only reliable signal.
          const target =
            withinDeletion || element.localName === 'delInstrText'
              ? field.deletedInstruction
              : field.currentInstruction;
          target.push(element.textContent ?? '');
        } else if (
          element.namespaceURI === OOXML.W_NS &&
          (element.localName === 't' ||
            element.localName === 'delText' ||
            element.localName === 'sym')
        ) {
          if (!insidePagerefResult()) {
            // `w:sym` has no character data of its own; its glyph lives in
            // `@w:char`. Resolving it here is what makes a lost symbol change
            // the projection and the two legal spellings of one glyph agree.
            const value =
              element.localName === 'sym'
                ? projectSymbolRun(element) ?? ''
                : element.textContent ?? '';
            if (value) text.push(value);
          }
        } else if (options.layoutCharacters) {
          const value = layoutCharacter(element);
          if (value !== undefined) {
            if (!insidePagerefResult()) text.push(value);
            continue;
          }
        }
        walk(element, withinDeletion);
      }
    };
    walk(paragraph, false);
    projections.push({
      text: text.join(''),
      insideTextBox: isInsideTextBox(paragraph),
      emptiedContainerPlaceholder: isEmptiedContainerPlaceholderParagraph(paragraph),
      propertySignature: paragraphPropertySignature(paragraph),
    });
  }

  return projections;
}

/**
 * Extract paragraph-delimited text for comparison round-trip invariants while
 * replacing TOC PAGEREF cached results with their stable field instructions.
 *
 * This is intentionally separate from the user-facing plain-text extractor:
 * rendered page numbers remain useful when reading a document, but they are
 * pagination output rather than authored comparison content.
 *
 * Character content is collected from `w:t`, `w:delText` and `w:sym`. `w:sym`
 * is here because it is the one run-content element whose projected characters
 * the spec fixes rather than this engine choosing them: `@w:char` *is* the
 * character. With `layoutCharacters` the run-content layout elements `w:tab`,
 * `w:br`, `w:cr`, `w:noBreakHyphen` and `w:softHyphen` also project, each to
 * the stable character in {@link ROUND_TRIP_LAYOUT_CHARACTERS}; the tagged
 * publication gate compares that projection. Without it they contribute
 * nothing. `w:ptab`, `w:pgNum`, `w:lastRenderedPageBreak`, `w:drawing`,
 * `w:pict` and `w:object` contribute nothing either way, so a round trip that
 * is green over this projection is a claim about those characters, not about
 * every byte of the story: drawings and embedded objects stay outside it.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.30
 * @see https://github.com/UseJunior/safe-docx/issues/716
 * @see https://github.com/UseJunior/safe-docx/issues/793
 * @see https://github.com/UseJunior/safe-docx/issues/1026
 */
export function extractRoundTripComparisonText(
  documentXml: string,
  options: RoundTripComparisonTextOptions = {},
): string {
  return projectRoundTripParagraphs(documentXml, options)
    .map((paragraph) => paragraph.text)
    .join('\n');
}

/**
 * The layout-character projection of every story paragraph, one entry per
 * paragraph in document order, for the publication gate's paragraph-topology
 * check. A text normalizer collapses repeated paragraph breaks, so an empty
 * paragraph is invisible to the text check; this list keeps it.
 *
 * Paragraphs of a text box story (`w:txbxContent`) are left out: text boxes
 * live inside drawings and VML pictures, which stay outside the claim, and an
 * `mc:AlternateContent` choice and fallback carry the same box twice. So is
 * the empty placeholder paragraph of a block container stamped as emptied by
 * `markWholeTrackedContainers`: no revision can wrap a whole inserted or
 * deleted `w:sdt` or `w:customXml`, the projection removing its content keeps
 * that shell, and the comparison reports it as an unrepresented change.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1027
 */
export function extractRoundTripParagraphTopology(documentXml: string): string[] {
  return topologyParagraphs(documentXml).map((paragraph) => paragraph.text);
}

function topologyParagraphs(documentXml: string): RoundTripParagraphProjection[] {
  return projectRoundTripParagraphs(documentXml, { layoutCharacters: true })
    .filter((paragraph) => !paragraph.insideTextBox &&
      !(paragraph.emptiedContainerPlaceholder && paragraph.text.replace(/ +/gu, '') === ''));
}

/**
 * The same paragraphs as {@link extractRoundTripParagraphTopology}, each with
 * its text and its canonical paragraph-property signature, for the
 * publication gate's paragraph-property parity check.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1493
 */
export function extractRoundTripParagraphProperties(
  documentXml: string,
): { texts: string[]; properties: string[] } {
  const paragraphs = topologyParagraphs(documentXml);
  return {
    texts: paragraphs.map((paragraph) => paragraph.text),
    properties: paragraphs.map((paragraph) => paragraph.propertySignature),
  };
}
