import {
  OOXML,
  classifyFieldInstruction,
  parseXml,
} from '@usejunior/docx-core';

/**
 * Stable comparison identity for volatile PAGEREF cached results.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 * @see https://github.com/UseJunior/safe-docx/issues/716
 */
export function pagerefComparisonIdentity(instructionText: string): string | undefined {
  const classification = classifyFieldInstruction(instructionText);
  if (
    classification.kind !== 'PAGEREF' ||
    classification.evaluationClass !== 'layout-dependent'
  ) {
    return undefined;
  }
  return `__safe_docx_pageref__|${classification.normalizedInstruction.replace(
    /^PAGEREF/iu,
    'PAGEREF',
  )}`;
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
      instruction: string[];
      separated: boolean;
      comparisonIdentity?: string;
    }> = [];
    const walk = (node: Node): void => {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== 1) continue;
        const element = child as Element;
        if (element.namespaceURI === OOXML.W_NS && element.localName === 'fldChar') {
          const type =
            element.getAttributeNS(OOXML.W_NS, 'fldCharType') ??
            element.getAttribute('w:fldCharType');
          if (type === 'begin') {
            stack.push({
              instruction: [],
              separated: false,
            });
          } else if (type === 'separate' && stack.length > 0) {
            const field = stack[stack.length - 1]!;
            field.separated = true;
            field.comparisonIdentity = suppressPagerefCache
              ? pagerefComparisonIdentity(field.instruction.join(''))
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
          stack[stack.length - 1]!.instruction.push(element.textContent ?? '');
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
        walk(element);
      }
    };
    walk(paragraph);
    paragraphTexts.push(text.join(''));
  }

  return paragraphTexts.join('\n');
}
