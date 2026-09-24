/**
 * WordprocessingML conformance-class gate.
 *
 * Safe Docx consumes WML Transitional packages only. A package whose main
 * document part is in the Strict namespace ("WML Strict", ISO/IEC 29500
 * Strict) uses a different namespace URI for every element, so the
 * Transitional-only document model would silently read it as empty. The gate
 * refuses such a package at load with a typed error that names the
 * conformance class, instead of returning near-empty content.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 2.1
 * @see https://github.com/UseJunior/safe-docx/issues/1025
 */
import { SafeDocxError } from './errors.js';
import { OOXML } from './namespaces.js';

/** Main WordprocessingML namespace of the Strict conformance class. */
export const WML_STRICT_NS = 'http://purl.oclc.org/ooxml/wordprocessingml/main';

export type WmlConformanceClass = 'transitional' | 'strict';

export type ConformanceGateContext = {
  /** Package part that was inspected. Defaults to `word/document.xml`. */
  partPath?: string;
  /** Which comparison input the part belongs to, when the caller has two. */
  side?: 'original' | 'revised';
};

export class UnsupportedConformanceClassError extends SafeDocxError {
  readonly conformanceClass: 'strict';
  readonly namespaceUri: string;
  readonly partPath: string;
  readonly side?: 'original' | 'revised';

  constructor(context: ConformanceGateContext = {}) {
    const partPath = context.partPath ?? 'word/document.xml';
    const where = context.side ? `the ${context.side} document's ${partPath}` : partPath;
    super(
      'UNSUPPORTED_CONFORMANCE_CLASS',
      `Unsupported conformance class: WML Strict (ISO/IEC 29500 Strict). ` +
        `The root element of ${where} is in the Strict namespace ${WML_STRICT_NS}; ` +
        `Safe Docx reads WordprocessingML Transitional documents only, and reading this file would return empty text.`,
      'Re-save the document as a Transitional .docx (in Word: Save As, "Word Document (*.docx)", not "Strict Open XML Document"; in LibreOffice: "Word 2007-365 (*.docx)") and open that file instead.',
    );
    this.name = 'UnsupportedConformanceClassError';
    this.conformanceClass = 'strict';
    this.namespaceUri = WML_STRICT_NS;
    this.partPath = partPath;
    if (context.side) this.side = context.side;
  }
}

/**
 * Classify a parsed WordprocessingML part by its root element's namespace.
 * Returns `null` when the root is in neither WML namespace (the caller's
 * existing handling applies; that case is not a conformance-class question).
 */
export function detectWmlConformanceClass(part: Document): WmlConformanceClass | null {
  const root = part.documentElement;
  if (!root) return null;
  if (root.namespaceURI === WML_STRICT_NS) return 'strict';
  if (root.namespaceURI === OOXML.W_NS) return 'transitional';
  return null;
}

/**
 * Throw `UnsupportedConformanceClassError` when the part's root element is in
 * the Strict WordprocessingML namespace. Transitional and unknown roots pass.
 */
export function assertTransitionalWordprocessingML(part: Document, context: ConformanceGateContext = {}): void {
  if (detectWmlConformanceClass(part) === 'strict') {
    throw new UnsupportedConformanceClassError(context);
  }
}
