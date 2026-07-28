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

export type SectionMutationErrorCode =
  | 'INVALID_SECTION_INDEX'
  | 'SECTION_NOT_FOUND'
  | 'INVALID_PAGE_NUMBER_START';

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

function validateMutation(mutation: SectionPageNumberMutation): void {
  if (!Number.isSafeInteger(mutation.sectionIndex) || mutation.sectionIndex < 0) {
    throw new SectionMutationError(
      'INVALID_SECTION_INDEX',
      'sectionIndex must be a non-negative safe integer.',
    );
  }
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
  validateMutation(mutation);
  const liveSection = collectLiveSections(doc)[mutation.sectionIndex];
  if (!liveSection) {
    throw new SectionMutationError(
      'SECTION_NOT_FOUND',
      `Section index ${mutation.sectionIndex} was not found.`,
    );
  }

  const existingPgNumTypes = getDirectChildrenByName(
    liveSection.sectPr,
    W.pgNumType,
  );
  const previousPageNumberStart = decimalAttr(
    existingPgNumTypes[0] ?? null,
    W.start,
  );
  if (
    existingPgNumTypes.length === 1
    && previousPageNumberStart === mutation.pageNumberStart
  ) {
    return {
      sectionIndex: mutation.sectionIndex,
      changed: false,
      previousPageNumberStart,
      currentPageNumberStart: mutation.pageNumberStart,
    };
  }

  const oldSectPr = liveSection.sectPr.cloneNode(true) as Element;
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

  if (ctx) {
    for (const stale of getDirectChildrenByName(liveSection.sectPr, 'sectPrChange')) {
      liveSection.sectPr.removeChild(stale);
    }
    liveSection.sectPr.appendChild(buildSectPrChangeElement(oldSectPr, ctx));
  }

  return {
    sectionIndex: mutation.sectionIndex,
    changed: true,
    previousPageNumberStart,
    currentPageNumberStart: mutation.pageNumberStart,
  };
}
