import {
  OOXML,
  classifyFieldInstruction,
  parseXml,
} from '@usejunior/docx-core';

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

/** True for the built-in TOC paragraph style identifiers used by Word. */
export function isTocParagraphStyle(styleId: string | null | undefined): boolean {
  return /^TOC(?:\s*\d+)?$/iu.test(styleId?.trim() ?? '');
}

/**
 * Extract paragraph-delimited text for comparison round-trip invariants while
 * replacing TOC PAGEREF cached results with their stable field instructions.
 *
 * This is intentionally separate from the user-facing plain-text extractor:
 * rendered page numbers remain useful when reading a document, but they are
 * pagination output rather than authored comparison content.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 * @see https://github.com/UseJunior/safe-docx/issues/716
 */
export function extractRoundTripComparisonText(documentXml: string): string {
  const document = parseXml(documentXml);
  const paragraphs = Array.from(
    document.getElementsByTagNameNS(OOXML.W_NS, 'p'),
  );
  const paragraphTexts: string[] = [];

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
          (element.localName === 't' || element.localName === 'delText')
        ) {
          const insidePagerefResult = stack.some(
            (field) =>
              field.separated && field.comparisonIdentity !== undefined,
          );
          if (!insidePagerefResult) {
            const value = element.textContent ?? '';
            if (value) text.push(value);
          }
        }
        walk(element, withinDeletion);
      }
    };
    walk(paragraph, false);
    paragraphTexts.push(text.join(''));
  }

  return paragraphTexts.join('\n');
}
