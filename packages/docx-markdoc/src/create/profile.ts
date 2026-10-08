import type { DocumentDefaultsSpec, StyleSpec } from '@usejunior/docx-core';
import { DocxMarkdocError } from '../errors.js';

/**
 * House style for created documents. Plain JSON; every field is optional and
 * merges over {@link DEFAULT_CREATION_PROFILE}.
 */
export type CreationProfile = {
  /** Typeface pinned on all four w:rFonts channels through document defaults. */
  font: string;
  sizePt: number;
  spacingAfterPt: number;
  /** Line spacing as a multiple of single spacing (1.15 = 115%). */
  lineSpacing: number;
  /** Uniform page margin in inches. */
  marginsIn: number;
  titleSizePt: number;
  /** Left tab stop for the signer date column, in inches from the margin. */
  signatureTabIn: number;
  /** Justify body, quote and list text. */
  justify: boolean;
};

export const DEFAULT_CREATION_PROFILE: Readonly<CreationProfile> = Object.freeze({
  font: 'Times New Roman',
  sizePt: 11,
  spacingAfterPt: 8,
  lineSpacing: 1.15,
  marginsIn: 1,
  titleSizePt: 14,
  signatureTabIn: 4.25,
  justify: true,
});

/** US Letter width in twips; created documents use Letter portrait. */
export const PAGE_WIDTH_TWIPS = 12240;
export const PAGE_HEIGHT_TWIPS = 15840;
export const SIGNATURE_LINE = '_'.repeat(30);
export const FIRST_SIGNER_BEFORE_PT = 42;
export const NEXT_SIGNER_BEFORE_PT = 30;
export const LEGEND_BEFORE_PT = 24;
export const HEADING_BEFORE_PT = 10;
export const QUOTE_INDENT_TWIPS = 720;

const POSITIVE_KEYS = ['sizePt', 'lineSpacing', 'titleSizePt'] as const;
const NON_NEGATIVE_KEYS = ['spacingAfterPt', 'marginsIn', 'signatureTabIn'] as const;

export const twipsFromPt = (pt: number): number => Math.round(pt * 20);
export const twipsFromIn = (inches: number): number => Math.round(inches * 1440);

/** Validate a JSON profile and merge it over the default house style. */
export function resolveCreationProfile(input?: unknown): CreationProfile {
  if (input === undefined) return { ...DEFAULT_CREATION_PROFILE };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DocxMarkdocError('INVALID_CREATION_PROFILE', 'Creation profile must be a JSON object.');
  }
  const known = new Set(Object.keys(DEFAULT_CREATION_PROFILE));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) throw new DocxMarkdocError('INVALID_CREATION_PROFILE', `Unknown creation profile key '${key}'.`);
  }
  const profile = { ...DEFAULT_CREATION_PROFILE, ...(input as Partial<CreationProfile>) };
  if (typeof profile.font !== 'string' || !profile.font.trim()) {
    throw new DocxMarkdocError('INVALID_CREATION_PROFILE', 'font must be a non-empty typeface name.');
  }
  for (const key of POSITIVE_KEYS) {
    if (typeof profile[key] !== 'number' || !Number.isFinite(profile[key]) || profile[key] <= 0) {
      throw new DocxMarkdocError('INVALID_CREATION_PROFILE', `${key} must be a positive number.`);
    }
  }
  for (const key of NON_NEGATIVE_KEYS) {
    if (typeof profile[key] !== 'number' || !Number.isFinite(profile[key]) || profile[key] < 0) {
      throw new DocxMarkdocError('INVALID_CREATION_PROFILE', `${key} must be a non-negative number.`);
    }
  }
  if (typeof profile.justify !== 'boolean') throw new DocxMarkdocError('INVALID_CREATION_PROFILE', 'justify must be a boolean.');
  if (2 * twipsFromIn(profile.marginsIn) >= PAGE_WIDTH_TWIPS) {
    throw new DocxMarkdocError('INVALID_CREATION_PROFILE', 'marginsIn leaves no text width on a Letter page.');
  }
  return profile;
}

export function textWidthTwips(profile: CreationProfile): number {
  return PAGE_WIDTH_TWIPS - 2 * twipsFromIn(profile.marginsIn);
}

/** Document defaults: the house font, size and paragraph spacing, declared once. */
export function creationDefaults(profile: CreationProfile): DocumentDefaultsSpec {
  return {
    run: { font: profile.font, sizePt: profile.sizePt },
    paragraph: {
      spacing: { afterTwips: twipsFromPt(profile.spacingAfterPt), lineTwips: Math.round(240 * profile.lineSpacing), lineRule: 'auto' },
    },
  };
}

/** Style IDs the lowering references; every one is declared by {@link creationStyles}. */
export const CREATION_STYLE = {
  title: 'Title',
  heading1: 'Heading1',
  heading2: 'Heading2',
  body: 'BodyText',
  quote: 'Quote',
  centered: 'Centered',
  legend: 'Legend',
  signature: 'Signature',
  list: 'ListParagraph',
  table: 'TableText',
  footer: 'Footer',
} as const;

/**
 * Named paragraph styles over the document defaults. Built-in Word names
 * ("heading 1", "Title", "Quote", "footer") let Word and LibreOffice map
 * them to their own heading and quote semantics.
 */
export function creationStyles(profile: CreationProfile): StyleSpec[] {
  const prose = profile.justify ? 'justify' : 'left';
  const style = (styleId: string, name: string, extra: Partial<StyleSpec>): StyleSpec => ({
    styleId,
    name,
    type: 'paragraph',
    basedOn: 'Normal',
    ...extra,
  });
  return [
    style(CREATION_STYLE.title, 'Title', {
      next: CREATION_STYLE.body,
      paragraph: { alignment: 'center', keepNext: true },
      run: { bold: true, sizePt: profile.titleSizePt },
    }),
    style(CREATION_STYLE.heading1, 'heading 1', {
      next: CREATION_STYLE.body,
      paragraph: { keepNext: true, spacing: { beforeTwips: twipsFromPt(HEADING_BEFORE_PT) } },
      run: { bold: true },
    }),
    style(CREATION_STYLE.heading2, 'heading 2', {
      next: CREATION_STYLE.body,
      paragraph: { keepNext: true },
      run: { bold: true, italic: true },
    }),
    style(CREATION_STYLE.body, 'Body Text', { paragraph: { alignment: prose } }),
    style(CREATION_STYLE.quote, 'Quote', {
      paragraph: { alignment: prose, indent: { leftTwips: QUOTE_INDENT_TWIPS, rightTwips: QUOTE_INDENT_TWIPS } },
    }),
    style(CREATION_STYLE.centered, 'Centered', { paragraph: { alignment: 'center' } }),
    style(CREATION_STYLE.legend, 'Legend', {
      paragraph: { alignment: 'center', keepLines: true, spacing: { beforeTwips: twipsFromPt(LEGEND_BEFORE_PT) } },
      run: { italic: true },
    }),
    style(CREATION_STYLE.signature, 'Signature', {
      paragraph: {
        alignment: 'left',
        keepLines: true,
        spacing: { beforeTwips: twipsFromPt(NEXT_SIGNER_BEFORE_PT) },
        tabs: [{ posTwips: twipsFromIn(profile.signatureTabIn), align: 'left' }],
      },
    }),
    style(CREATION_STYLE.list, 'List Paragraph', { paragraph: { alignment: prose } }),
    style(CREATION_STYLE.table, 'Table Text', { paragraph: { alignment: 'left', spacing: { afterTwips: 0 } } }),
    style(CREATION_STYLE.footer, 'footer', { paragraph: { alignment: 'center', spacing: { afterTwips: 0 } } }),
  ];
}
