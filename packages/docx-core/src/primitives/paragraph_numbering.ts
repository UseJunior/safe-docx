import { findParagraphByBookmarkId } from './bookmarks.js';
import { getDirectChildrenByName } from './dom-helpers.js';
import { OOXML, W } from './namespaces.js';
import { parseNumberingXml } from './numbering.js';
import {
  buildPPrChangeElement,
  type RevisionContext,
} from './track-changes-emitter.js';

export type DirectParagraphNumbering = {
  numId: string;
  ilvl: number;
};

export type ParagraphNumberingMutation = {
  paragraphId: string;
  numbering: DirectParagraphNumbering | null;
};

export type ParagraphNumberingMutationResult = {
  paragraphId: string;
  changed: boolean;
  previous: DirectParagraphNumbering | null;
  current: DirectParagraphNumbering | null;
  warning?: string;
};

export type ParagraphNumberingMutationErrorCode =
  | 'PARAGRAPH_NOT_FOUND'
  | 'INCOMPLETE_NUMBERING'
  | 'NUMBERING_PART_MISSING'
  | 'NUMBERING_INSTANCE_NOT_FOUND'
  | 'ABSTRACT_NUMBERING_NOT_FOUND'
  | 'NUMBERING_LEVEL_NOT_FOUND'
  | 'INVALID_NUMBERING_REFERENCE';

export class ParagraphNumberingMutationError extends Error {
  constructor(
    public readonly code: ParagraphNumberingMutationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ParagraphNumberingMutationError';
  }
}

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName)
    || el.getAttribute(`w:${localName}`)
    || el.getAttribute(localName)
    || null;
}

function parseDirectNumberingFromParagraph(
  paragraph: Element,
): { value: DirectParagraphNumbering | null; complete: boolean } {
  const pPr = getDirectChildrenByName(paragraph, W.pPr)[0] ?? null;
  const numPr = pPr ? getDirectChildrenByName(pPr, W.numPr)[0] ?? null : null;
  if (!numPr) return { value: null, complete: true };

  const numIdEl = getDirectChildrenByName(numPr, W.numId)[0] ?? null;
  const ilvlEl = getDirectChildrenByName(numPr, W.ilvl)[0] ?? null;
  const numId = numIdEl ? getWAttr(numIdEl, W.val) : null;
  const ilvlText = ilvlEl ? getWAttr(ilvlEl, W.val) : null;
  const ilvl = ilvlText !== null ? Number(ilvlText) : Number.NaN;

  if (
    numId === null
    || !/^[1-9]\d*$/.test(numId)
    || !Number.isSafeInteger(ilvl)
    || ilvl < 0
  ) {
    return { value: null, complete: false };
  }

  return { value: { numId, ilvl }, complete: true };
}

/**
 * Read only the paragraph's direct `w:numPr`; style-inherited numbering is not
 * considered.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.19
 * @see #653
 */
export function getDirectParagraphNumbering(
  doc: Document,
  paragraphId: string,
): DirectParagraphNumbering | null {
  const paragraph = findParagraphByBookmarkId(doc, paragraphId);
  if (!paragraph) {
    throw new ParagraphNumberingMutationError(
      'PARAGRAPH_NOT_FOUND',
      `Paragraph '${paragraphId}' was not found.`,
    );
  }
  const parsed = parseDirectNumberingFromParagraph(paragraph);
  if (!parsed.complete) {
    throw new ParagraphNumberingMutationError(
      'INCOMPLETE_NUMBERING',
      `Paragraph '${paragraphId}' has an incomplete or invalid direct w:numPr.`,
    );
  }
  return parsed.value;
}

function validateRequestedNumbering(
  numberingDoc: Document | null,
  requested: DirectParagraphNumbering,
): void {
  if (
    !/^[1-9]\d*$/.test(requested.numId)
    || !Number.isSafeInteger(requested.ilvl)
    || requested.ilvl < 0
  ) {
    throw new ParagraphNumberingMutationError(
      'INVALID_NUMBERING_REFERENCE',
      'numId must be a positive decimal string and ilvl must be a non-negative safe integer.',
    );
  }
  if (!numberingDoc) {
    throw new ParagraphNumberingMutationError(
      'NUMBERING_PART_MISSING',
      'The document has no word/numbering.xml part.',
    );
  }

  const model = parseNumberingXml(numberingDoc);
  const instance = model.nums.get(requested.numId);
  if (!instance) {
    throw new ParagraphNumberingMutationError(
      'NUMBERING_INSTANCE_NOT_FOUND',
      `Numbering instance '${requested.numId}' was not found in word/numbering.xml.`,
    );
  }
  const abstract = model.abstractNums.get(instance.abstractNumId);
  if (!abstract) {
    throw new ParagraphNumberingMutationError(
      'ABSTRACT_NUMBERING_NOT_FOUND',
      `Numbering instance '${requested.numId}' references missing abstract numbering '${instance.abstractNumId}'.`,
    );
  }
  if (!abstract.levels.has(requested.ilvl)) {
    throw new ParagraphNumberingMutationError(
      'NUMBERING_LEVEL_NOT_FOUND',
      `Numbering instance '${requested.numId}' has no level ${requested.ilvl}.`,
    );
  }
}

function ensureParagraphProperties(paragraph: Element): Element {
  const existing = getDirectChildrenByName(paragraph, W.pPr)[0];
  if (existing) return existing;
  const pPr = paragraph.ownerDocument!.createElementNS(OOXML.W_NS, `w:${W.pPr}`);
  paragraph.insertBefore(pPr, paragraph.firstChild);
  return pPr;
}

function insertNumPrInSchemaOrder(pPr: Element, numPr: Element): void {
  const successors = new Set([
    'suppressLineNumbers',
    'pBdr',
    'shd',
    'tabs',
    'suppressAutoHyphens',
    'kinsoku',
    'wordWrap',
    'overflowPunct',
    'topLinePunct',
    'autoSpaceDE',
    'autoSpaceDN',
    'bidi',
    'adjustRightInd',
    'snapToGrid',
    W.spacing,
    W.ind,
    'contextualSpacing',
    'mirrorIndents',
    'suppressOverlap',
    W.jc,
    'textDirection',
    'textAlignment',
    'textboxTightWrap',
    'outlineLvl',
    'divId',
    'cnfStyle',
    W.rPr,
    W.sectPr,
    'pPrChange',
  ]);
  const successor = Array.from(pPr.children)
    .find((child) => successors.has((child as Element).localName));
  if (successor) pPr.insertBefore(numPr, successor);
  else pPr.appendChild(numPr);
}

/**
 * Mutate one paragraph's direct list reference while preserving the numbering
 * definitions and unrelated paragraph properties.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.19
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.3
 * @see #653
 */
export function setDirectParagraphNumbering(
  documentDoc: Document,
  numberingDoc: Document | null,
  mutation: ParagraphNumberingMutation,
  ctx?: RevisionContext,
): ParagraphNumberingMutationResult {
  const paragraph = findParagraphByBookmarkId(documentDoc, mutation.paragraphId);
  if (!paragraph) {
    throw new ParagraphNumberingMutationError(
      'PARAGRAPH_NOT_FOUND',
      `Paragraph '${mutation.paragraphId}' was not found.`,
    );
  }

  if (mutation.numbering) {
    validateRequestedNumbering(numberingDoc, mutation.numbering);
  }

  const parsedPrevious = parseDirectNumberingFromParagraph(paragraph);
  const existingPPr = getDirectChildrenByName(paragraph, W.pPr)[0] ?? null;
  const existingNumPrs = existingPPr
    ? getDirectChildrenByName(existingPPr, W.numPr)
    : [];

  if (!mutation.numbering && existingNumPrs.length === 0) {
    return {
      paragraphId: mutation.paragraphId,
      changed: false,
      previous: null,
      current: null,
      warning: 'The paragraph has no direct w:numPr; style-inherited numbering was not changed.',
    };
  }

  if (
    mutation.numbering
    && parsedPrevious.complete
    && parsedPrevious.value?.numId === mutation.numbering.numId
    && parsedPrevious.value.ilvl === mutation.numbering.ilvl
    && existingNumPrs.length === 1
  ) {
    return {
      paragraphId: mutation.paragraphId,
      changed: false,
      previous: parsedPrevious.value,
      current: parsedPrevious.value,
    };
  }

  const oldPPr = existingPPr ? existingPPr.cloneNode(true) as Element : null;
  const pPr = mutation.numbering
    ? ensureParagraphProperties(paragraph)
    : existingPPr!;

  for (const stale of getDirectChildrenByName(pPr, W.numPr)) {
    pPr.removeChild(stale);
  }

  if (mutation.numbering) {
    const numPr = documentDoc.createElementNS(OOXML.W_NS, `w:${W.numPr}`);
    const ilvl = documentDoc.createElementNS(OOXML.W_NS, `w:${W.ilvl}`);
    ilvl.setAttributeNS(OOXML.W_NS, `w:${W.val}`, String(mutation.numbering.ilvl));
    const numId = documentDoc.createElementNS(OOXML.W_NS, `w:${W.numId}`);
    numId.setAttributeNS(OOXML.W_NS, `w:${W.val}`, mutation.numbering.numId);
    numPr.appendChild(ilvl);
    numPr.appendChild(numId);
    insertNumPrInSchemaOrder(pPr, numPr);
  }

  if (ctx) {
    for (const stale of getDirectChildrenByName(pPr, 'pPrChange')) {
      pPr.removeChild(stale);
    }
    pPr.appendChild(buildPPrChangeElement(oldPPr, ctx));
  }

  return {
    paragraphId: mutation.paragraphId,
    changed: true,
    previous: parsedPrevious.complete ? parsedPrevious.value : null,
    current: mutation.numbering,
  };
}
