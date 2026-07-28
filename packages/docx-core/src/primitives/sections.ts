import { getParagraphBookmarkId } from './bookmarks.js';
import { childElements, createWmlElement, getDirectChildrenByName, isW } from './dom-helpers.js';
import { OOXML, W } from './namespaces.js';
import {
  buildSectPrChangeElement,
  type RevisionContext,
} from './track-changes-emitter.js';

export type SectionBoundaryLocation = 'paragraph' | 'body';

export type SectionReference = {
  type: string | null;
  relationshipId: string | null;
};

export type SectionPageSize = {
  widthTwips: number | null;
  heightTwips: number | null;
  orientation: string | null;
};

export type SectionMargins = {
  topTwips: number | null;
  rightTwips: number | null;
  bottomTwips: number | null;
  leftTwips: number | null;
  headerTwips: number | null;
  footerTwips: number | null;
  gutterTwips: number | null;
};

export type DocumentSection = {
  sectionIndex: number;
  location: SectionBoundaryLocation;
  anchorParagraphId: string | null;
  breakType: string | null;
  pageNumberStart: number | null;
  pageNumberFormat: string | null;
  pageSize: SectionPageSize | null;
  margins: SectionMargins | null;
  headers: SectionReference[];
  footers: SectionReference[];
};

export type SectionPageNumberMutation = {
  sectionIndex: number;
  pageNumberStart: number;
};

export type SectionPageNumberMutationResult = {
  sectionIndex: number;
  changed: boolean;
  previousPageNumberStart: number | null;
  currentPageNumberStart: number;
};

export type SectionPageSizeMutation = {
  widthTwips?: number;
  heightTwips?: number;
  orientation?: 'portrait' | 'landscape';
};

export type SectionMarginsMutation = {
  topTwips?: number;
  rightTwips?: number;
  bottomTwips?: number;
  leftTwips?: number;
  headerTwips?: number;
  footerTwips?: number;
  gutterTwips?: number;
};

export type SectionPropertiesMutation = {
  sectionIndex: number;
  pageNumberStart?: number;
  pageSize?: SectionPageSizeMutation;
  margins?: SectionMarginsMutation;
};

export type SectionPropertiesMutationResult = {
  sectionIndex: number;
  changed: boolean;
  previousSection: DocumentSection;
  currentSection: DocumentSection;
};

export type SectionMutationErrorCode =
  | 'INVALID_SECTION_INDEX'
  | 'SECTION_NOT_FOUND'
  | 'INVALID_PAGE_NUMBER_START'
  | 'EMPTY_SECTION_MUTATION'
  | 'INVALID_PAGE_SIZE'
  | 'INVALID_PAGE_ORIENTATION'
  | 'INCOMPLETE_PAGE_SIZE'
  | 'INVALID_PAGE_MARGINS'
  | 'INCOMPLETE_PAGE_MARGINS';

export class SectionMutationError extends Error {
  constructor(
    public readonly code: SectionMutationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SectionMutationError';
  }
}

type LiveSection = {
  sectPr: Element;
  location: SectionBoundaryLocation;
  paragraph: Element | null;
};

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName)
    || el.getAttribute(`w:${localName}`)
    || null;
}

function getRAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.R_NS, localName)
    || el.getAttribute(`r:${localName}`)
    || null;
}

function decimalAttr(el: Element | null, localName: string): number | null {
  if (!el) return null;
  const raw = getWAttr(el, localName);
  if (raw === null || !/^-?\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Collect the two canonical live section-property placements without
 * descending into `w:sectPrChange` snapshots.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.18
 * @see #654
 */
function collectLiveSections(doc: Document): LiveSection[] {
  const body = doc.getElementsByTagNameNS(OOXML.W_NS, W.body).item(0);
  if (!body) return [];

  const sections: LiveSection[] = [];
  const paragraphs = body.getElementsByTagNameNS(OOXML.W_NS, W.p);
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs.item(i) as Element;
    const pPr = getDirectChildrenByName(paragraph, W.pPr)[0];
    const sectPr = pPr
      ? getDirectChildrenByName(pPr, W.sectPr)[0]
      : undefined;
    if (sectPr) {
      sections.push({ sectPr, location: 'paragraph', paragraph });
    }
  }

  const finalSectPr = childElements(body)
    .find((child) => isW(child, W.sectPr));
  if (finalSectPr) {
    sections.push({ sectPr: finalSectPr, location: 'body', paragraph: null });
  }
  return sections;
}

function projectReferences(sectPr: Element, localName: string): SectionReference[] {
  return getDirectChildrenByName(sectPr, localName).map((reference) => ({
    type: getWAttr(reference, W.type),
    relationshipId: getRAttr(reference, 'id'),
  }));
}

function projectSection(section: LiveSection, sectionIndex: number): DocumentSection {
  const type = getDirectChildrenByName(section.sectPr, W.type)[0] ?? null;
  const pgNumType = getDirectChildrenByName(section.sectPr, W.pgNumType)[0] ?? null;
  const pgSz = getDirectChildrenByName(section.sectPr, W.pgSz)[0] ?? null;
  const pgMar = getDirectChildrenByName(section.sectPr, W.pgMar)[0] ?? null;

  return {
    sectionIndex,
    location: section.location,
    anchorParagraphId: section.paragraph
      ? getParagraphBookmarkId(section.paragraph)
      : null,
    breakType: type ? getWAttr(type, W.val) : null,
    pageNumberStart: decimalAttr(pgNumType, W.start),
    pageNumberFormat: pgNumType ? getWAttr(pgNumType, 'fmt') : null,
    pageSize: pgSz
      ? {
          widthTwips: decimalAttr(pgSz, W.w),
          heightTwips: decimalAttr(pgSz, 'h'),
          orientation: getWAttr(pgSz, 'orient'),
        }
      : null,
    margins: pgMar
      ? {
          topTwips: decimalAttr(pgMar, W.top),
          rightTwips: decimalAttr(pgMar, W.right),
          bottomTwips: decimalAttr(pgMar, W.bottom),
          leftTwips: decimalAttr(pgMar, W.left),
          headerTwips: decimalAttr(pgMar, 'header'),
          footerTwips: decimalAttr(pgMar, 'footer'),
          gutterTwips: decimalAttr(pgMar, 'gutter'),
        }
      : null,
    headers: projectReferences(section.sectPr, W.headerReference),
    footers: projectReferences(section.sectPr, W.footerReference),
  };
}

/**
 * Return canonical main-document section properties in document order.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.12
 * @see #654
 */
export function getDocumentSections(doc: Document): DocumentSection[] {
  return collectLiveSections(doc).map(projectSection);
}

const PAGE_SIZE_KEYS = [
  'widthTwips',
  'heightTwips',
  'orientation',
] as const satisfies readonly (keyof SectionPageSizeMutation)[];

const MARGIN_KEYS = [
  'topTwips',
  'rightTwips',
  'bottomTwips',
  'leftTwips',
  'headerTwips',
  'footerTwips',
  'gutterTwips',
] as const satisfies readonly (keyof SectionMarginsMutation)[];

function hasDefinedValue<T extends object>(
  value: T | undefined,
  keys: readonly (keyof T)[],
): boolean {
  return value !== undefined && keys.some((key) => value[key] !== undefined);
}

function validatePositiveTwips(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new SectionMutationError(
      'INVALID_PAGE_SIZE',
      `${label} must be a positive safe integer.`,
    );
  }
}

function validateSignedTwips(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new SectionMutationError(
      'INVALID_PAGE_MARGINS',
      `${label} must be a safe integer.`,
    );
  }
}

function validateUnsignedTwips(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new SectionMutationError(
      'INVALID_PAGE_MARGINS',
      `${label} must be a non-negative safe integer.`,
    );
  }
}

function validateMutation(mutation: SectionPropertiesMutation): void {
  if (!Number.isSafeInteger(mutation.sectionIndex) || mutation.sectionIndex < 0) {
    throw new SectionMutationError(
      'INVALID_SECTION_INDEX',
      'sectionIndex must be a non-negative safe integer.',
    );
  }

  const hasPageSize = hasDefinedValue(mutation.pageSize, PAGE_SIZE_KEYS);
  const hasMargins = hasDefinedValue(mutation.margins, MARGIN_KEYS);
  if (
    mutation.pageNumberStart === undefined
    && !hasPageSize
    && !hasMargins
  ) {
    throw new SectionMutationError(
      'EMPTY_SECTION_MUTATION',
      'At least one section page-setup value must be provided.',
    );
  }

  if (mutation.pageNumberStart !== undefined) {
    if (
      !Number.isSafeInteger(mutation.pageNumberStart)
      || mutation.pageNumberStart < 0
    ) {
      throw new SectionMutationError(
        'INVALID_PAGE_NUMBER_START',
        'pageNumberStart must be a non-negative safe integer.',
      );
    }
  }

  if (mutation.pageSize?.widthTwips !== undefined) {
    validatePositiveTwips(mutation.pageSize.widthTwips, 'pageSize.widthTwips');
  }
  if (mutation.pageSize?.heightTwips !== undefined) {
    validatePositiveTwips(mutation.pageSize.heightTwips, 'pageSize.heightTwips');
  }
  if (
    mutation.pageSize?.orientation !== undefined
    && mutation.pageSize.orientation !== 'portrait'
    && mutation.pageSize.orientation !== 'landscape'
  ) {
    throw new SectionMutationError(
      'INVALID_PAGE_ORIENTATION',
      'pageSize.orientation must be "portrait" or "landscape".',
    );
  }

  if (mutation.margins?.topTwips !== undefined) {
    validateSignedTwips(mutation.margins.topTwips, 'margins.topTwips');
  }
  if (mutation.margins?.bottomTwips !== undefined) {
    validateSignedTwips(mutation.margins.bottomTwips, 'margins.bottomTwips');
  }
  for (const key of [
    'rightTwips',
    'leftTwips',
    'headerTwips',
    'footerTwips',
    'gutterTwips',
  ] as const) {
    const value = mutation.margins?.[key];
    if (value !== undefined) validateUnsignedTwips(value, `margins.${key}`);
  }
}

function insertPgSzInSchemaOrder(sectPr: Element, pgSz: Element): void {
  const successors = new Set([
    W.pgMar,
    'paperSrc',
    'pgBorders',
    'lnNumType',
    W.pgNumType,
    'cols',
    'formProt',
    'vAlign',
    'noEndnote',
    W.titlePg,
    'textDirection',
    'bidi',
    'rtlGutter',
    'docGrid',
    'printerSettings',
    'sectPrChange',
  ]);
  const successor = childElements(sectPr)
    .find((child) => successors.has(child.localName));
  if (successor) sectPr.insertBefore(pgSz, successor);
  else sectPr.appendChild(pgSz);
}

function insertPgMarInSchemaOrder(sectPr: Element, pgMar: Element): void {
  const successors = new Set([
    'paperSrc',
    'pgBorders',
    'lnNumType',
    W.pgNumType,
    'cols',
    'formProt',
    'vAlign',
    'noEndnote',
    W.titlePg,
    'textDirection',
    'bidi',
    'rtlGutter',
    'docGrid',
    'printerSettings',
    'sectPrChange',
  ]);
  const successor = childElements(sectPr)
    .find((child) => successors.has(child.localName));
  if (successor) sectPr.insertBefore(pgMar, successor);
  else sectPr.appendChild(pgMar);
}

function insertPgNumTypeInSchemaOrder(sectPr: Element, pgNumType: Element): void {
  const successors = new Set([
    'cols',
    'formProt',
    'vAlign',
    'noEndnote',
    W.titlePg,
    'textDirection',
    'bidi',
    'rtlGutter',
    'docGrid',
    'printerSettings',
    'sectPrChange',
  ]);
  const successor = childElements(sectPr)
    .find((child) => successors.has(child.localName));
  if (successor) sectPr.insertBefore(pgNumType, successor);
  else sectPr.appendChild(pgNumType);
}

function requestedValueDiffers(
  element: Element | undefined,
  localName: string,
  value: number | string | undefined,
): boolean {
  return value !== undefined
    && (!element || getWAttr(element, localName) !== String(value));
}

function assertMissingElementsCanBeCreated(
  liveSection: LiveSection,
  mutation: SectionPropertiesMutation,
): void {
  if (
    hasDefinedValue(mutation.pageSize, PAGE_SIZE_KEYS)
    && getDirectChildrenByName(liveSection.sectPr, W.pgSz).length === 0
    && (
      mutation.pageSize?.widthTwips === undefined
      || mutation.pageSize.heightTwips === undefined
    )
  ) {
    throw new SectionMutationError(
      'INCOMPLETE_PAGE_SIZE',
      'A section without w:pgSz requires both widthTwips and heightTwips.',
    );
  }

  if (
    hasDefinedValue(mutation.margins, MARGIN_KEYS)
    && getDirectChildrenByName(liveSection.sectPr, W.pgMar).length === 0
    && MARGIN_KEYS.some((key) => mutation.margins?.[key] === undefined)
  ) {
    throw new SectionMutationError(
      'INCOMPLETE_PAGE_MARGINS',
      'A section without w:pgMar requires all seven margin values.',
    );
  }
}

/**
 * Atomically update one section's page setup while preserving every
 * unspecified section property and recording one prior-state snapshot.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.13
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.11
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @see #654
 */
export function updateSectionProperties(
  doc: Document,
  mutation: SectionPropertiesMutation,
  ctx?: RevisionContext,
): SectionPropertiesMutationResult {
  validateMutation(mutation);
  const liveSection = collectLiveSections(doc)[mutation.sectionIndex];
  if (!liveSection) {
    throw new SectionMutationError(
      'SECTION_NOT_FOUND',
      `Section index ${mutation.sectionIndex} was not found.`,
    );
  }
  assertMissingElementsCanBeCreated(liveSection, mutation);

  const existingPgNumTypes = getDirectChildrenByName(
    liveSection.sectPr,
    W.pgNumType,
  );
  const existingPageSizes = getDirectChildrenByName(liveSection.sectPr, W.pgSz);
  const existingMargins = getDirectChildrenByName(liveSection.sectPr, W.pgMar);
  const previousSection = projectSection(liveSection, mutation.sectionIndex);

  const pageNumberChanged = mutation.pageNumberStart !== undefined && (
    existingPgNumTypes.length !== 1
    || decimalAttr(existingPgNumTypes[0] ?? null, W.start) !== mutation.pageNumberStart
  );
  const pageSizeChanged = hasDefinedValue(mutation.pageSize, PAGE_SIZE_KEYS) && (
    existingPageSizes.length !== 1
    || requestedValueDiffers(existingPageSizes[0], W.w, mutation.pageSize?.widthTwips)
    || requestedValueDiffers(existingPageSizes[0], 'h', mutation.pageSize?.heightTwips)
    || requestedValueDiffers(existingPageSizes[0], 'orient', mutation.pageSize?.orientation)
  );
  const marginsChanged = hasDefinedValue(mutation.margins, MARGIN_KEYS) && (
    existingMargins.length !== 1
    || requestedValueDiffers(existingMargins[0], W.top, mutation.margins?.topTwips)
    || requestedValueDiffers(existingMargins[0], W.right, mutation.margins?.rightTwips)
    || requestedValueDiffers(existingMargins[0], W.bottom, mutation.margins?.bottomTwips)
    || requestedValueDiffers(existingMargins[0], W.left, mutation.margins?.leftTwips)
    || requestedValueDiffers(existingMargins[0], 'header', mutation.margins?.headerTwips)
    || requestedValueDiffers(existingMargins[0], 'footer', mutation.margins?.footerTwips)
    || requestedValueDiffers(existingMargins[0], 'gutter', mutation.margins?.gutterTwips)
  );

  if (!pageNumberChanged && !pageSizeChanged && !marginsChanged) {
    return {
      sectionIndex: mutation.sectionIndex,
      changed: false,
      previousSection,
      currentSection: previousSection,
    };
  }

  const oldSectPr = liveSection.sectPr.cloneNode(true) as Element;

  if (pageSizeChanged) {
    let pgSz = existingPageSizes[0];
    for (const duplicate of existingPageSizes.slice(1)) {
      liveSection.sectPr.removeChild(duplicate);
    }
    if (!pgSz) {
      pgSz = createWmlElement(doc, W.pgSz);
      insertPgSzInSchemaOrder(liveSection.sectPr, pgSz);
    }
    const pageSizeAttrs = [
      [W.w, mutation.pageSize?.widthTwips],
      ['h', mutation.pageSize?.heightTwips],
      ['orient', mutation.pageSize?.orientation],
    ] as const;
    for (const [name, value] of pageSizeAttrs) {
      if (value !== undefined) {
        pgSz.setAttributeNS(OOXML.W_NS, `w:${name}`, String(value));
      }
    }
  }

  if (marginsChanged) {
    let pgMar = existingMargins[0];
    for (const duplicate of existingMargins.slice(1)) {
      liveSection.sectPr.removeChild(duplicate);
    }
    if (!pgMar) {
      pgMar = createWmlElement(doc, W.pgMar);
      insertPgMarInSchemaOrder(liveSection.sectPr, pgMar);
    }
    const marginAttrs = [
      [W.top, mutation.margins?.topTwips],
      [W.right, mutation.margins?.rightTwips],
      [W.bottom, mutation.margins?.bottomTwips],
      [W.left, mutation.margins?.leftTwips],
      ['header', mutation.margins?.headerTwips],
      ['footer', mutation.margins?.footerTwips],
      ['gutter', mutation.margins?.gutterTwips],
    ] as const;
    for (const [name, value] of marginAttrs) {
      if (value !== undefined) {
        pgMar.setAttributeNS(OOXML.W_NS, `w:${name}`, String(value));
      }
    }
  }

  if (pageNumberChanged) {
    let pgNumType = existingPgNumTypes[0];
    for (const duplicate of existingPgNumTypes.slice(1)) {
      liveSection.sectPr.removeChild(duplicate);
    }
    if (!pgNumType) {
      pgNumType = createWmlElement(doc, W.pgNumType);
      insertPgNumTypeInSchemaOrder(liveSection.sectPr, pgNumType);
    }
    pgNumType.setAttributeNS(
      OOXML.W_NS,
      `w:${W.start}`,
      String(mutation.pageNumberStart),
    );
  }

  if (ctx) {
    for (const stale of getDirectChildrenByName(liveSection.sectPr, 'sectPrChange')) {
      liveSection.sectPr.removeChild(stale);
    }
    liveSection.sectPr.appendChild(buildSectPrChangeElement(oldSectPr, ctx));
  }

  return {
    sectionIndex: mutation.sectionIndex,
    changed: true,
    previousSection,
    currentSection: projectSection(liveSection, mutation.sectionIndex),
  };
}

/**
 * Set one section's page-number restart while preserving all unrelated section
 * properties and recording the prior state when a revision context is supplied.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @see #654
 */
export function setSectionPageNumberStart(
  doc: Document,
  mutation: SectionPageNumberMutation,
  ctx?: RevisionContext,
): SectionPageNumberMutationResult {
  const result = updateSectionProperties(doc, mutation, ctx);
  return {
    sectionIndex: result.sectionIndex,
    changed: result.changed,
    previousPageNumberStart: result.previousSection.pageNumberStart,
    currentPageNumberStart: result.currentSection.pageNumberStart
      ?? mutation.pageNumberStart,
  };
}
