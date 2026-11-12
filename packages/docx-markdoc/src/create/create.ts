import { createHash } from 'node:crypto';
import { bookmarkNameForSlug, checkGeneratedPackage, generateDocx } from '@usejunior/docx-core';
import { DocxMarkdocError } from '../errors.js';
import { importDocxToMarkdoc } from '../import.js';
import { requireMarkdoc } from '../markdoc.js';
import { ORACLE_NORMALIZATION, compareParagraphs, normalizeOracleText, projectSourceText, sourceCrossReferenceForm, type SequenceComparison, type SourceCrossReference, type SourceProjection } from './oracle.js';
import { lowerCreationMarkdoc, type CreationLowering, type CreationProjection, type FirstPageProjection, type FooterProjection } from './lower.js';
import { readCreatedDocx, type CreationReadback } from './readback.js';

export type CreationCheck = { passed: boolean; detail?: string };

export type CreationCertificate = {
  version: 1;
  kind: 'markdoc-create';
  sourceSha256: string;
  profileSha256?: string;
  docxSha256: string;
  textSha256: string;
  passed: boolean;
  checks: {
    package: CreationCheck & { issues: string[] };
    determinism: CreationCheck;
    /**
     * Body paragraph text read back against the lowering's projection. When
     * either side has a paragraph with direct alignment or indents (a
     * `{% paragraph-layout %}`), `layouts` records the comparison of every paragraph's
     * direct `w:jc` and `w:ind` too; its negative control drops the layout
     * of the first laid-out paragraph (or gives the first paragraph one).
     */
    readback: CreationCheck & { paragraphs: number; negativeControlDetected: boolean; layouts?: { paragraphs: number; negativeControlDetected: boolean } };
    footers: CreationCheck & { sections: number; negativeControlDetected: boolean };
    /**
     * Present when the lowering or the DOCX has a header: each section's
     * default header, and for each section with `w:titlePg` its first-page
     * header and footer, read back against the lowering's projection. The
     * negative control perturbs one expected header.
     */
    headers?: CreationCheck & {
      sections: number;
      firstPageSections: number;
      negativeControlDetected: boolean;
      /**
       * Present when a section has first-page slots (`w:titlePg`): one
       * control per slot of the first such section, each of which must be
       * detected, that changes the expected first-page header or footer by
       * one character. The default slots are compared separately.
       */
      firstPageNegativeControlDetected?: boolean;
    };
    /**
     * Footnotes read back from word/footnotes.xml, in reference order, and
     * where each reference sits, against the lowering's projection. The
     * negative control is 'not applicable' for a document without footnotes.
     */
    footnotes: CreationCheck & {
      notes: number;
      negativeControlDetected: boolean | 'not applicable';
      /**
       * Every `{% fnref /%}` in the source's syntax tree, found without the
       * text walker or the lowering, against the references the text walker
       * pairs with notes and the `w:footnoteReference` elements placed in the
       * body (#1261): a reference dropped on the way fails the build. The
       * negative control drops one placed reference; it is 'not applicable'
       * for a source without references.
       */
      references: { expected: number; actual: number; mismatches: string[]; negativeControlDetected: boolean | 'not applicable' };
    };
    brownfield: CreationCheck & { anchoredParagraphs: number };
    /**
     * Present when the source or the DOCX has a cross-reference: each REF
     * field's instruction (bookmark name and number switch, or none for a
     * text reference), in reading order, against the `{% xref /%}` it came
     * from, and each named bookmark's paragraph text against the source text
     * of the item marked with that id, and where each field sits (story,
     * paragraph, and the text either side) against where its xref is. For a
     * text reference, the text the bookmark encloses (what Word shows after
     * updating the field) must also equal the target's source text, and the
     * field's cached result must equal it. A number reference's cached
     * result must equal the number the oracle reads from the source; for a
     * relative reference that number depends on where the xref sits. The
     * read-back and round trip also check the text each field shows.
     * Negative controls change one expected switch, point one expected
     * reference at another target, move one to the next paragraph, with a
     * text reference shorten its bookmark by one character, and with a
     * relative reference expect its full number instead.
     */
    crossReferences?: CrossReferenceCheck;
    /**
     * Independent round trip (#1185): the created DOCX re-imported through
     * `docx-markdoc import`, compared with plain text read straight from the
     * original Markdoc, never from the lowering or the DocumentSpec.
     */
    roundTrip: CreationCheck & {
      normalization: string;
      body: SequenceComparison;
      footers: StoryComparison[];
      /** Present when the source or the import has a header: each section's default header. */
      headers?: StoryComparison[];
      /**
       * Present when the source or the import has a section with a
       * first-page header (`header-first: none`): that section's first-page
       * header and footer.
       */
      firstPage?: Array<StoryComparison & { slot: 'header' | 'footer' }>;
      /**
       * `deletedHeaderText` is present with `headers`, and 'not applicable' when no header has text.
       * `changedFirstPageHeader` and `changedFirstPageFooter` are present with `firstPage`: in the first
       * section with first-page slots, a slot with content is expected empty (its text and page number
       * deleted), and an empty one is expected to show the section's own header or footer (the header
       * leaking onto a first page that drops it). 'not applicable' when neither has content.
       */
      negativeControls: Record<'deletedWord' | 'deletedParagraph' | 'deletedTableCell' | 'deletedFooterText', boolean | 'not applicable'> & {
        deletedHeaderText?: boolean | 'not applicable';
        changedFirstPageHeader?: boolean | 'not applicable';
        changedFirstPageFooter?: boolean | 'not applicable';
      };
      /**
       * Present when the source or the DOCX has a paragraph with direct
       * alignment or indents (#1424): each `{% paragraph-layout %}` paragraph's text and
       * the layout its attributes call for, read straight from the source,
       * against every body paragraph of the DOCX whose own `w:pPr` sets
       * `w:jc` or `w:ind`, in order. A missing, misplaced, changed or extra
       * layout fails. The negative controls change the first expected
       * layout and drop the first expected paragraph; each must be
       * detected ('not applicable' when the source has none).
       */
      paragraphLayout?: ParagraphLayoutComparison;
      /**
       * Present when the source or the import has footnotes: every note's
       * paragraphs, in reference order, against the imported footnote
       * annotations, with a negative control that deletes a word of a note.
       */
      footnotes?: {
        comparison: SequenceComparison;
        notes: { expected: number; actual: number };
        negativeControlDetected: boolean | 'not applicable';
        /**
         * Where each reference sits, in reference order: the text before and after it in its paragraph,
         * from the source against the imported annotation's anchor. The negative control moves one
         * reference to the other end of its paragraph and must be detected.
         */
        references: {
          passed: boolean;
          mismatches: Array<{ note: number; expected: string | null; actual: string | null }>;
          negativeControlDetected: boolean | 'not applicable';
        };
      };
    };
  };
  frontmatter: CreationLowering['frontmatter'];
  profile: CreationLowering['profile'];
  blocks: CreationLowering['blocks'];
  footers: FooterProjection[];
  /** Present when the DOCX has a header: each section's default header, as read back. */
  headers?: FooterProjection[];
  /** Present when a section has a first-page header: per section, as read back. */
  firstPage?: FirstPageProjection[];
};

/** Laid-out paragraphs from the source against those of the DOCX: see `roundTrip.paragraphLayout`. */
export type ParagraphLayoutComparison = {
  passed: boolean;
  paragraphs: { expected: number; actual: number };
  mismatches: Array<{ paragraph: number; expected: string | null; actual: string | null }>;
  negativeControls: Record<'changedLayout' | 'droppedParagraph' | 'movedLayout', boolean | 'not applicable'>;
};

/** One section's header or footer, from the source against the import. */
export type StoryComparison = { section: number; expected: string[] | null; actual: string[] | null; comparison?: SequenceComparison; passed: boolean };

export type CrossReferenceCheck = CreationCheck & {
  /** Tags in the source, fields placed in the DOCX, and how many of the tags are text and relative references. */
  references: { expected: number; actual: number; text: number; relative: number };
  mismatches: Array<{ reference: number; expected: string | null; actual: string | null }>;
  /**
   * `textExtent` is 'not applicable' for a source without text references;
   * `relativeContext` for a source without a relative reference whose
   * number differs from its full number.
   */
  negativeControls: Record<'switchChanged' | 'retargeted' | 'moved' | 'textExtent' | 'relativeContext', boolean | 'not applicable'>;
};

/** The number switch of each `{% xref number="…" %}` form. */
const NUMBER_SWITCHES: Record<SourceCrossReference['number'], string> = { full: '\\w', paragraph: '\\n', relative: '\\r' };

/** The REF instruction an `{% xref /%}` must become: a number switch for a number, none for text. */
function expectedInstruction(xref: SourceCrossReference): string {
  const name = bookmarkNameForSlug(xref.to);
  if (xref.show === 'text') return ` REF ${name} \\h `;
  return ` REF ${name} ${NUMBER_SWITCHES[xref.number]} \\h `;
}

/** Index of `index` among the paragraphs that are not empty after normalization, or -1 for an empty one. */
function nonEmptyOrdinal(texts: readonly string[], index: number): number {
  if (!normalizeOracleText(texts[index] ?? '')) return -1;
  return texts.slice(0, index).filter((text) => normalizeOracleText(text)).length;
}

/** Where a number sits: its story, paragraph (non-empty paragraphs counted on each side) and the text either side. */
function siteKey(story: string, paragraph: number, text: string, offset: number, length: number): string {
  return `${story} paragraph ${paragraph + 1}: ${normalizeOracleText(text.slice(0, offset))}‸${normalizeOracleText(text.slice(offset + length))}`;
}

function expectedSiteKey(xref: SourceCrossReference, expected: SourceProjection, shift = 0): string {
  if (xref.story === 'body') {
    const texts = expected.body.map((entry) => entry.text);
    return siteKey('body', nonEmptyOrdinal(texts, xref.entry) + shift, texts[xref.entry] ?? '', xref.offset, xref.length);
  }
  const text = expected.footnotes?.[xref.note - 1]?.paragraphs[xref.paragraph] ?? '';
  return siteKey(`note ${xref.note}`, xref.paragraph + shift, text, xref.offset, xref.length);
}

/** Every REF field read back, body first and then the notes, with its place and cached result. */
function readbackSites(readback: CreationReadback): Array<{ instruction: string; key: string; result: string }> {
  return [
    ...(readback.crossReferences ?? []).map((site) => ({
      instruction: site.instruction,
      result: site.text,
      key: siteKey('body', nonEmptyOrdinal(readback.paragraphs, site.paragraph), readback.paragraphs[site.paragraph] ?? '', site.offset, site.text.length),
    })),
    ...(readback.footnoteCrossReferences ?? []).map((site) => ({
      instruction: site.instruction,
      result: site.text,
      key: siteKey(`note ${site.note}`, site.paragraph, readback.footnotes[site.note - 1]?.[site.paragraph] ?? '', site.offset, site.text.length),
    })),
  ];
}

/**
 * Mismatches between the source's cross-references and the fields and
 * bookmarks read back from the DOCX: each field's instruction, where it sits,
 * and the paragraph its bookmark opens in.
 */
function crossReferenceMismatches(
  xrefs: readonly SourceCrossReference[],
  expected: SourceProjection,
  readback: CreationReadback,
  shiftFirst = 0,
): CrossReferenceCheck['mismatches'] {
  const sites = readbackSites(readback);
  const targets = expected.crossReferenceTargets ?? {};
  const bookmarks = new Map((readback.bookmarks ?? []).map((bookmark) => [bookmark.name, bookmark]));
  const mismatches: CrossReferenceCheck['mismatches'] = [];
  for (let index = 0; index < Math.max(xrefs.length, sites.length); index += 1) {
    const xref = xrefs[index];
    const site = sites[index];
    const instruction = xref ? expectedInstruction(xref) : null;
    if (!xref || !site || instruction !== site.instruction) {
      mismatches.push({ reference: index + 1, expected: instruction, actual: site?.instruction ?? null });
      continue;
    }
    const key = expectedSiteKey(xref, expected, index === 0 ? shiftFirst : 0);
    if (key !== site.key) {
      mismatches.push({ reference: index + 1, expected: key, actual: site.key });
      continue;
    }
    const bookmark = bookmarks.get(bookmarkNameForSlug(xref.to));
    const want = normalizeOracleText(targets[xref.to] ?? '');
    const got = bookmark === undefined ? null : normalizeOracleText(readback.paragraphs[bookmark.paragraph] ?? '');
    if (want !== got) {
      mismatches.push({ reference: index + 1, expected: `bookmark on "${want}"`, actual: got === null ? null : `bookmark on "${got}"` });
      continue;
    }
    if (xref.show !== 'text') {
      // The number the oracle reads from the source, for a relative reference from where the xref sits.
      if (site.result !== xref.shown) mismatches.push({ reference: index + 1, expected: `cached result "${xref.shown}"`, actual: `cached result "${site.result}"` });
      continue;
    }
    // Word shows the text between the bookmark's start and end, so the
    // bookmark must enclose the whole target text and the cached result must
    // be that text.
    const enclosed = bookmark?.text;
    if (enclosed === undefined || normalizeOracleText(enclosed) !== want) {
      mismatches.push({ reference: index + 1, expected: `bookmark enclosing "${want}"`, actual: enclosed === undefined ? 'bookmark ending outside its paragraph' : `bookmark enclosing "${normalizeOracleText(enclosed)}"` });
    } else if (site.result !== enclosed) {
      mismatches.push({ reference: index + 1, expected: `cached result "${enclosed}"`, actual: `cached result "${site.result}"` });
    }
  }
  return mismatches;
}

/** Where the source's `{% fnref /%}` tags and the references placed in the DOCX (`placed` of them) disagree. */
function footnoteReferenceMismatches(expected: SourceProjection, placed: number): string[] {
  const inventory = expected.footnoteReferenceInventory ?? [];
  const walked = (expected.footnotes ?? []).map((note) => note.id).sort();
  const mismatches: string[] = [];
  if (JSON.stringify(walked) !== JSON.stringify(inventory)) mismatches.push(`source tags ${inventory.join(', ') || 'none'}; text walker reached ${walked.join(', ') || 'none'}`);
  if (placed !== inventory.length) mismatches.push(`source tags ${inventory.length} footnote reference(s); the DOCX places ${placed} w:footnoteReference element(s)`);
  return mismatches;
}

/** The read-back with bookmark `name` ending one character early: a bookmark that misses the last character of its target. */
function shortenBookmark(readback: CreationReadback, name: string): CreationReadback {
  return {
    ...readback,
    bookmarks: (readback.bookmarks ?? []).map((bookmark) => (bookmark.name === name && bookmark.text !== undefined ? { ...bookmark, text: bookmark.text.slice(0, -1) } : bookmark)),
  };
}

function crossReferenceCheck(expected: SourceProjection, readback: CreationReadback): CrossReferenceCheck | undefined {
  const xrefs = expected.crossReferences ?? [];
  const inventory = expected.crossReferenceInventory ?? [];
  const sites = (readback.crossReferences?.length ?? 0) + (readback.footnoteCrossReferences?.length ?? 0);
  if (xrefs.length === 0 && sites === 0 && inventory.length === 0) return undefined;
  const targets = expected.crossReferenceTargets ?? {};
  const mismatches = crossReferenceMismatches(xrefs, expected, readback);
  // Every tag in the source must have been placed: a tag the text walker never reached would otherwise drop
  // out of the expectation and the document together.
  const placed = xrefs.map((xref) => `${xref.to}|${sourceCrossReferenceForm(xref)}`).sort();
  if (JSON.stringify(placed) !== JSON.stringify(inventory)) {
    mismatches.push({ reference: 0, expected: `source tags ${inventory.join(', ')}`, actual: `placed ${placed.join(', ') || 'none'}` });
  }
  const detects = (mutated: SourceCrossReference[], shiftFirst = 0, against = readback) => crossReferenceMismatches(mutated, expected, against, shiftFirst).length > 0;
  const first = xrefs[0];
  const other = first ? Object.keys(targets).find((id) => id !== first.to && normalizeOracleText(targets[id]!) !== normalizeOracleText(targets[first.to] ?? '')) : undefined;
  // A number reference changes its number switch; a text reference gains one.
  const switched = (xref: SourceCrossReference): SourceCrossReference =>
    xref.show === 'text' ? { ...xref, show: 'number', number: 'full' } : { ...xref, number: xref.number === 'full' ? 'paragraph' : 'full' };
  const textReference = xrefs.find((xref) => xref.show === 'text');
  // A relative reference that shows less than its full number: expecting the full number must fail.
  const relativeIndex = xrefs.findIndex((xref) => xref.number === 'relative' && xref.show === 'number' && xref.fullNumber !== undefined && xref.fullNumber !== xref.shown);
  const negativeControls: CrossReferenceCheck['negativeControls'] = {
    switchChanged: first ? detects([switched(first), ...xrefs.slice(1)]) : 'not applicable',
    retargeted: first && other ? detects([{ ...first, to: other }, ...xrefs.slice(1)]) : 'not applicable',
    moved: first ? detects([...xrefs], 1) : 'not applicable',
    textExtent: textReference ? detects(xrefs, 0, shortenBookmark(readback, bookmarkNameForSlug(textReference.to))) : 'not applicable',
    relativeContext: relativeIndex === -1 ? 'not applicable'
      : detects(xrefs.map((xref, index) => (index === relativeIndex ? { ...xref, shown: xref.fullNumber! } : xref))),
  };
  const controlsOk = Object.values(negativeControls).every((value) => value !== false);
  const passed = mismatches.length === 0 && controlsOk;
  return {
    passed,
    references: {
      expected: inventory.length,
      actual: sites,
      text: inventory.filter((entry) => entry.endsWith('|text')).length,
      relative: inventory.filter((entry) => entry.endsWith('|relative')).length,
    },
    mismatches,
    negativeControls,
    ...(passed ? {} : { detail: `${mismatches.length} cross-reference mismatch(es)${controlsOk ? '' : '; a negative control was not detected'}` }),
  };
}

export type CreateDocumentOptions = {
  /** Parsed JSON house-style profile; merged over the default. */
  profile?: unknown;
  /** Exact profile bytes when it came from a file, for the certificate hash. */
  profileSource?: string | Buffer;
  /** Banner line for the text mirror (for example the output file name). */
  mirrorLabel?: string;
  /**
   * Diagnostics and tests only: rewrite the lowering before generation. It
   * lets a test corrupt the lowering (drop a paragraph from both the spec and
   * its projection) to prove the round-trip oracle does not depend on it.
   */
  transformLowering?: (lowering: CreationLowering) => CreationLowering;
};

export type CreatedDocument = {
  docx: Buffer;
  /** Text mirror built from the read-back, never from the source. */
  text: string;
  readback: CreationReadback;
  lowering: CreationLowering;
  certificate: CreationCertificate;
};

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

/** Footer (or header) paragraphs of each section from re-imported Markdoc: the story bound to `<section>:<slot>`. */
function importedFooters(ir: ReturnType<typeof requireMarkdoc>, sections: number, kind: 'header' | 'footer' = 'footer', slot: 'default' | 'first' = 'default'): Array<string[] | null> {
  const stories = ir.stories ?? [];
  const storyParagraphs = ir.storyScaffold ?? [];
  return Array.from({ length: sections }, (_, section) => {
    const story = stories.find((entry) => entry.kind === kind && entry.bindings.includes(`${section}:${slot}`));
    return story ? storyParagraphs.filter((paragraph) => paragraph.story === story.id).map((paragraph) => paragraph.originalText) : null;
  });
}

/**
 * Compare each section's expected header or footer with the imported one. A
 * section without a reference on one side passes only when the other side has
 * no text either.
 */
function compareStories(expected: ReadonlyArray<string[] | null>, actual: ReadonlyArray<string[] | null>, sections: number): StoryComparison[] {
  return Array.from({ length: Math.max(sections, expected.length) }, (_, section) => {
    const want = expected[section] ?? null;
    const got = actual[section] ?? null;
    if (want === null || got === null) {
      const passed = (want === null || want.every((line) => !normalizeEmpty(line))) && (got === null || got.every((line) => !normalizeEmpty(line)));
      return { section, expected: want, actual: got, passed };
    }
    const comparison = compareParagraphs(want.map((text) => ({ text })), got);
    return { section, expected: want, actual: got, comparison, passed: comparison.passed };
  });
}

/** True when some section's expected story disagrees with the imported one (both present). */
function storiesDiffer(expected: ReadonlyArray<string[] | null>, actual: ReadonlyArray<string[] | null>): boolean {
  return expected.some((want, section) => {
    const got = actual[section] ?? null;
    return want !== null && got !== null && !compareParagraphs(want.map((text) => ({ text })), got).passed;
  });
}

/** A header or footer line with its own text removed and only its field markers kept ("Page \u0000PAGE" → "\u0000PAGE"). */
function fieldsOnly(line: string): string {
  return (line.match(/\u0000[A-Z]+/gu) ?? []).join(' ');
}

/** The first section whose header or footer has text of its own, and that story with the text deleted. */
function withoutStoryText(stories: ReadonlyArray<string[] | null>): { index: number; stories: Array<string[] | null> } {
  const index = stories.findIndex((story) => story?.some((line) => line.trim() && fieldsOnly(line) !== line.trim()));
  return { index, stories: stories.map((story, i) => (i === index ? story!.map(fieldsOnly).filter(Boolean) : story)) };
}

/** Note paragraphs in order, each note closed by a separator entry so a paragraph cannot move between notes unseen. */
function footnoteParagraphSequence(notes: ReadonlyArray<readonly string[]>): Array<{ text: string }> {
  return notes.flatMap((paragraphs, index) => [...paragraphs.map((text) => ({ text })), { text: `\u0000end of note ${index + 1}` }]);
}

/**
 * Where a reference sits: which non-empty body paragraph holds it (counted in document order, so empty
 * paragraphs, which import may omit or keep, do not shift it), and the text before and after it in that
 * paragraph, whitespace runs collapsed (the boundary space is kept, so "Alpha¹ beta" and "Alpha ¹beta" differ).
 */
type ReferencePlace = { paragraph: number; before: string; after: string };

function referencePlace(paragraph: number, text: string, offset: number): ReferencePlace {
  const collapse = (value: string) => value.normalize('NFC').replace(/[\s ]+/gu, ' ');
  return { paragraph, before: collapse(text.slice(0, offset)).trimStart(), after: collapse(text.slice(offset)).trimEnd() };
}

/** For each paragraph, the count of non-empty paragraphs before it: an occurrence index both sides derive alike. */
function paragraphOccurrences(texts: readonly string[]): number[] {
  let seen = 0;
  return texts.map((text) => {
    const index = seen;
    if (normalizeOracleText(text)) seen += 1;
    return index;
  });
}

const samePlace = (a: ReferencePlace | null, b: ReferencePlace | null) =>
  a === b || (a !== null && b !== null && a.paragraph === b.paragraph && a.before === b.before && a.after === b.after);

/** A printable form for diagnostics only; places are compared field by field, never as this string. */
const showPlace = (place: ReferencePlace | null) => (place ? `paragraph ${place.paragraph + 1}: ${place.before}‸${place.after}` : null);

function compareReferencePlaces(expected: readonly ReferencePlace[], actual: ReadonlyArray<ReferencePlace | null>): Array<{ note: number; expected: string | null; actual: string | null }> {
  return Array.from({ length: Math.max(expected.length, actual.length) }, (_, index) => ({ note: index + 1, expected: expected[index] ?? null, actual: actual[index] ?? null }))
    .filter((entry) => !samePlace(entry.expected, entry.actual))
    .map((entry) => ({ note: entry.note, expected: showPlace(entry.expected), actual: showPlace(entry.actual) }));
}

/** Compare the source's footnotes, and where they are referenced, with the footnote annotations re-imported from the DOCX. */
function footnoteRoundTrip(expected: SourceProjection, ir: ReturnType<typeof requireMarkdoc>): NonNullable<CreationCertificate['checks']['roundTrip']['footnotes']> | undefined {
  const want = (expected.footnotes ?? []).map((note) => note.paragraphs);
  const imported = ir.annotations.filter((annotation) => annotation.sourcePresentation === 'footnote');
  const got = imported.map((annotation) => annotation.body.map((paragraph) => paragraph.runs.map((run) => run.text).join('')));
  // Reference places straight from the source text, and from each imported anchor's paragraph and offset. The
  // paragraph occurrence is derived on each side independently: from the source body and from the imported scaffold.
  const sourceOccurrences = paragraphOccurrences(expected.body.map((entry) => entry.text));
  const sourceReferences = expected.body.flatMap((entry, index) => (entry.footnoteMarks ?? []).map((offset) => ({ paragraph: sourceOccurrences[index]!, text: entry.text, offset })));
  const wantPlaces = sourceReferences.map(({ paragraph, text, offset }) => referencePlace(paragraph, text, offset));
  const scaffoldOccurrences = paragraphOccurrences(ir.scaffold.map((paragraph) => paragraph.originalText));
  const gotPlaces = imported.map((annotation) => {
    if (annotation.anchor.kind !== 'point') return null;
    const { paragraphId, offset } = annotation.anchor.point;
    const index = ir.scaffold.findIndex((candidate) => candidate.id === paragraphId);
    return index === -1 ? null : referencePlace(scaffoldOccurrences[index]!, ir.scaffold[index]!.originalText, offset);
  });
  const referenceMismatches = compareReferencePlaces(wantPlaces, gotPlaces);
  // Two negative controls, each of which must be detected: the first reference in a non-empty paragraph moved to
  // the other end of its paragraph, and the first reference moved to a neighbouring paragraph occurrence.
  const movable = sourceReferences.findIndex(({ text }) => text.trim().length > 0);
  const moved = wantPlaces.map((place, index) => {
    if (index !== movable) return place;
    const { paragraph, text, offset } = sourceReferences[index]!;
    const other = referencePlace(paragraph, text, offset === 0 ? text.length : 0);
    return samePlace(other, place) ? referencePlace(paragraph, text, offset === text.length ? 0 : text.length) : other;
  });
  const shifted = wantPlaces.map((place, index) => (index === 0 ? { ...place, paragraph: place.paragraph === 0 ? 1 : place.paragraph - 1 } : place));
  const referenceControl = movable === -1 ? 'not applicable' as const
    : compareReferencePlaces(moved, gotPlaces).length > 0 && compareReferencePlaces(shifted, gotPlaces).length > 0;
  if (want.length === 0 && got.length === 0) return undefined;
  const actual = footnoteParagraphSequence(got).map((entry) => entry.text);
  const comparison = compareParagraphs(footnoteParagraphSequence(want), actual);
  const wordNote = want.findIndex((note) => note.some((paragraph) => paragraph.trim().split(/\s+/u).length >= 2));
  const mutated = want.map((note, index) => (index === wordNote
    ? note.map((paragraph, p) => (p === note.findIndex((text) => text.trim().split(/\s+/u).length >= 2) ? paragraph.trim().split(/\s+/u).slice(1).join(' ') : paragraph))
    : note));
  const negativeControlDetected = wordNote === -1 ? 'not applicable' as const : !compareParagraphs(footnoteParagraphSequence(mutated), actual).passed;
  return {
    comparison,
    notes: { expected: want.length, actual: got.length },
    negativeControlDetected,
    references: { passed: referenceMismatches.length === 0, mismatches: referenceMismatches, negativeControlDetected: referenceControl },
  };
}

/** A body paragraph as compared: its layout token (null for none), then its normalized text. */
type BodyLayout = { layout: string | null; text: string };

/**
 * Position by position over the non-empty body paragraphs: a layout must sit on the same paragraph on both sides,
 * and a laid-out paragraph must carry the same text. Text without a layout is the body comparison's job.
 */
function bodyLayoutMismatches(expected: readonly BodyLayout[], actual: readonly BodyLayout[]): ParagraphLayoutComparison['mismatches'] {
  const show = (entry: BodyLayout | undefined) => (entry ? `${entry.layout ?? 'no layout'} | ${entry.text}` : null);
  const out: ParagraphLayoutComparison['mismatches'] = [];
  for (let index = 0; index < Math.max(expected.length, actual.length); index += 1) {
    const a = expected[index];
    const b = actual[index];
    const layoutDiffers = (a?.layout ?? null) !== (b?.layout ?? null) || (a === undefined) !== (b === undefined);
    const textDiffers = (a?.layout != null || b?.layout != null) && a?.text !== b?.text;
    if (layoutDiffers || textDiffers) out.push({ paragraph: index + 1, expected: show(a), actual: show(b) });
  }
  return out;
}

/**
 * Each body paragraph's layout as the source calls for it (from `{% paragraph-layout %}`)
 * against the layout its own `w:pPr` sets (`w:jc`, `w:ind`) in the DOCX, position by
 * position over the non-empty paragraphs, or undefined when neither side has a
 * layout. The expectation never comes from the lowering. Empty paragraphs are left
 * out on both sides (create generates them after a table and as section breaks).
 */
function paragraphLayoutRoundTrip(expected: SourceProjection, readback: CreationReadback): ParagraphLayoutComparison | undefined {
  const kept = (entry: BodyLayout) => entry.text !== '' || entry.layout !== null;
  const wanted: BodyLayout[] = expected.body.map((entry) => ({ layout: entry.layout ?? null, text: normalizeOracleText(entry.text) })).filter(kept);
  const found: BodyLayout[] = readback.paragraphs.map((text, index) => ({ layout: readback.layouts[index] ?? null, text: normalizeOracleText(text) })).filter(kept);
  const laidOut = (entries: readonly BodyLayout[]) => entries.filter((entry) => entry.layout !== null).length;
  if (laidOut(wanted) === 0 && laidOut(found) === 0) return undefined;
  const mismatches = bodyLayoutMismatches(wanted, found);
  // Three negative controls, each of which must be detected: the first layout changed, its paragraph dropped, and
  // its layout swapped with the nearest paragraph that lays out differently (the same text there or not).
  const first = wanted.findIndex((entry) => entry.layout !== null);
  // The nearest paragraph, either way, whose layout differs from the first layout.
  const neighbour = first === -1 ? undefined : Array.from({ length: wanted.length }, (_, distance) => [first + distance, first - distance]).flat()
    .find((index) => index >= 0 && index < wanted.length && wanted[index]!.layout !== wanted[first]!.layout);
  const detects = (mutated: BodyLayout[]) => bodyLayoutMismatches(mutated, found).length > 0;
  const negativeControls: ParagraphLayoutComparison['negativeControls'] = {
    changedLayout: first === -1 ? 'not applicable' : detects(wanted.map((entry, index) => (index === first ? { ...entry, layout: `${entry.layout} ind.right=1` } : entry))),
    droppedParagraph: first === -1 ? 'not applicable' : detects(wanted.filter((_, index) => index !== first)),
    movedLayout: first === -1 || neighbour === undefined ? 'not applicable'
      : detects(wanted.map((entry, index) => (index === first ? { ...entry, layout: wanted[neighbour]!.layout } : index === neighbour ? { ...entry, layout: wanted[first]!.layout } : entry))),
  };
  return {
    passed: mismatches.length === 0 && Object.values(negativeControls).every((value) => value !== false),
    paragraphs: { expected: laidOut(wanted), actual: laidOut(found) },
    mismatches,
    negativeControls,
  };
}

/** Run the independent round-trip comparison, with negative controls that must each be detected. */
function roundTripCheck(expected: SourceProjection, importedMarkdoc: string, sections: number, readback: CreationReadback): CreationCertificate['checks']['roundTrip'] {
  const ir = requireMarkdoc(importedMarkdoc);
  const paragraphLayout = paragraphLayoutRoundTrip(expected, readback);
  const footnotes = footnoteRoundTrip(expected, ir);
  const footnotesOk = !footnotes || (footnotes.comparison.passed && footnotes.notes.expected === footnotes.notes.actual && footnotes.negativeControlDetected !== false
    && footnotes.references.passed && footnotes.references.negativeControlDetected !== false);
  const actualBody = ir.scaffold.map((paragraph) => paragraph.originalText);
  const actualFooters = importedFooters(ir, sections);
  const actualHeaders = importedFooters(ir, sections, 'header');
  const actualFirst = { header: importedFooters(ir, sections, 'header', 'first'), footer: importedFooters(ir, sections, 'footer', 'first') };
  const body = compareParagraphs(expected.body, actualBody);
  const footers = compareStories(expected.footers, actualFooters, sections);
  const expectedHeaders = expected.headers ?? [];
  const headersRecorded = [...expectedHeaders, ...actualHeaders].some((story) => story !== null);
  const headers = compareStories(expectedHeaders, actualHeaders, sections);
  // A first-page slot is compared for every section that has one on either side.
  const expectedFirst = (slot: 'header' | 'footer') => Array.from({ length: Math.max(sections, expected.firstPage?.length ?? 0) }, (_, section) => expected.firstPage?.[section]?.[slot] ?? null);
  const firstSections = Array.from({ length: Math.max(sections, expected.firstPage?.length ?? 0) }, (_, section) => section)
    .filter((section) => expected.firstPage?.[section] || actualFirst.header[section] !== null || actualFirst.footer[section] !== null);
  const firstPage = (['header', 'footer'] as const).flatMap((slot) => {
    const compared = compareStories(expectedFirst(slot), actualFirst[slot], sections);
    return firstSections.map((section) => ({ ...compared[section]!, slot }));
  }).sort((a, b) => a.section - b.section);
  const detects = (mutated: SourceProjection) => {
    const mutatedBody = compareParagraphs(mutated.body, actualBody);
    const firstDiffers = (['header', 'footer'] as const).some((slot) => storiesDiffer(
      Array.from({ length: Math.max(sections, mutated.firstPage?.length ?? 0) }, (_, section) => mutated.firstPage?.[section]?.[slot] ?? null),
      actualFirst[slot],
    ));
    return !mutatedBody.passed || storiesDiffer(mutated.footers, actualFooters) || storiesDiffer(mutated.headers ?? [], actualHeaders) || firstDiffers;
  };
  // The first section with first-page slots. A slot with content is expected empty; an empty slot is expected
  // to show what the section's other pages show (its own header or footer, declared or inherited).
  const firstIndex = (expected.firstPage ?? []).findIndex((entry) => entry !== null);
  const hasContent = (lines: readonly string[] | null | undefined) => (lines ?? []).some((line) => normalizeEmpty(line) !== '');
  const runningOf = (stories: ReadonlyArray<string[] | null>) => stories.slice(0, firstIndex + 1).reverse().find((story) => story !== null) ?? null;
  const firstPageControl = (slot: 'header' | 'footer'): boolean | 'not applicable' => {
    const entry = expected.firstPage![firstIndex]!;
    const running = runningOf(slot === 'header' ? expectedHeaders : expected.footers);
    const changed = hasContent(entry[slot]) ? [] : hasContent(running) ? running : undefined;
    if (changed === undefined) return 'not applicable';
    return detects({ ...expected, firstPage: expected.firstPage!.map((other, i) => (i === firstIndex ? { ...entry, [slot]: changed } : other)) });
  };
  const wordIndex = expected.body.findIndex((entry) => entry.text.trim().split(/\s+/u).length >= 2);
  const cellIndex = expected.body.findIndex((entry) => entry.cell && entry.text.trim());
  const withoutFooterText = withoutStoryText(expected.footers);
  const withoutHeaderText = withoutStoryText(expectedHeaders);
  const negativeControls: CreationCertificate['checks']['roundTrip']['negativeControls'] = {
    deletedWord: wordIndex === -1 ? 'not applicable' : detects({ ...expected, body: expected.body.map((entry, i) => (i === wordIndex ? { ...entry, text: entry.text.trim().split(/\s+/u).slice(1).join(' ') } : entry)) }),
    deletedParagraph: expected.body.length === 0 ? 'not applicable' : detects({ ...expected, body: expected.body.filter((entry) => entry.text.trim()).slice(1) }),
    deletedTableCell: cellIndex === -1 ? 'not applicable' : detects({ ...expected, body: expected.body.filter((_, i) => i !== cellIndex) }),
    deletedFooterText: withoutFooterText.index === -1 ? 'not applicable' : detects({ ...expected, footers: withoutFooterText.stories }),
    ...(headersRecorded ? { deletedHeaderText: withoutHeaderText.index === -1 ? 'not applicable' as const : detects({ ...expected, headers: withoutHeaderText.stories }) } : {}),
    ...(firstPage.length > 0 && firstIndex !== -1 ? { changedFirstPageHeader: firstPageControl('header'), changedFirstPageFooter: firstPageControl('footer') } : {}),
  };
  const controlsOk = Object.values(negativeControls).every((value) => value !== false);
  const stories = [...footers, ...headers, ...firstPage];
  const footersOk = stories.every((story) => story.passed);
  const mismatchCount = body.mismatches.length + stories.reduce((sum, story) => sum + (story.comparison?.mismatches.length ?? (story.passed ? 0 : 1)), 0)
    + (footnotes?.comparison.mismatches.length ?? 0) + (footnotes?.references.mismatches.length ?? 0);
  const layoutOk = paragraphLayout?.passed !== false;
  const passed = body.passed && footersOk && controlsOk && footnotesOk && layoutOk;
  return {
    passed,
    normalization: ORACLE_NORMALIZATION,
    body,
    footers,
    ...(headersRecorded ? { headers } : {}),
    ...(firstPage.length > 0 ? { firstPage } : {}),
    negativeControls,
    ...(paragraphLayout ? { paragraphLayout } : {}),
    ...(footnotes ? { footnotes } : {}),
    ...(passed ? {} : { detail: `${mismatchCount + (paragraphLayout?.mismatches.length ?? 0)} round-trip mismatch(es)${layoutOk ? '' : `; paragraph layout: ${paragraphLayout!.mismatches.length > 0 ? `expected ${JSON.stringify(paragraphLayout!.mismatches[0]!.expected)}, read ${JSON.stringify(paragraphLayout!.mismatches[0]!.actual)}` : 'a negative control was not detected'}`}${controlsOk && footnotes?.negativeControlDetected !== false && footnotes?.references.negativeControlDetected !== false ? '' : '; a negative control was not detected'}${footnotes && footnotes.notes.expected !== footnotes.notes.actual ? `; expected ${footnotes.notes.expected} footnote(s), imported ${footnotes.notes.actual}` : ''}` }),
  };
}

function normalizeEmpty(text: string): string {
  return text.replace(/[\s\u00a0]+/gu, '');
}

/** First index where two paragraph lists differ, or -1 when they are equal. */
export function firstParagraphMismatch(expected: readonly string[], actual: readonly string[]): number {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    if (expected[index] !== actual[index]) return index;
  }
  return -1;
}

function footnotesEqual(expected: Pick<CreationProjection, 'footnotes' | 'footnoteReferences'>, actual: Pick<CreationReadback, 'footnotes' | 'footnoteReferences'>): boolean {
  return JSON.stringify([expected.footnotes, expected.footnoteReferences]) === JSON.stringify([actual.footnotes, actual.footnoteReferences]);
}

/** One-character perturbation of the last note, to prove the footnote comparison can fail. */
function perturbFootnotes(projection: CreationProjection): CreationProjection {
  const footnotes = projection.footnotes.map((note) => [...note]);
  const last = footnotes.at(-1);
  if (last) last[last.length - 1] = `${last.at(-1) ?? ''}x`;
  return { ...projection, footnotes };
}

/**
 * The first-page controls of the read-back check, or undefined when no section has first-page slots: the
 * first such section's first-page header and footer, each changed by one character (a slot without a
 * reference is expected to have one). Each changed projection must differ from the read-back.
 */
function firstPageControls(projection: CreationProjection, readback: CreationReadback): boolean | undefined {
  const index = projection.firstPage.findIndex((entry) => entry !== null);
  if (index === -1) return undefined;
  const entry = projection.firstPage[index]!;
  const changed = (lines: FooterProjection) => (lines ? [`${lines[0] ?? ''}x`, ...lines.slice(1)] : ['x']);
  const variants: FirstPageProjection[] = [{ ...entry, header: changed(entry.header) }, { ...entry, footer: changed(entry.footer) }];
  return variants.every((variant) => JSON.stringify(projection.firstPage.map((other, i) => (i === index ? variant : other))) !== JSON.stringify(readback.firstPage));
}

/** First index where two layout lists differ, or -1 when they are equal. */
function firstLayoutMismatch(expected: ReadonlyArray<string | null>, actual: ReadonlyArray<string | null>): number {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    if ((expected[index] ?? null) !== (actual[index] ?? null) || (index >= expected.length) !== (index >= actual.length)) return index;
  }
  return -1;
}

/** Drop the first expected layout, or give the first paragraph one when none has a layout, to prove the comparison can fail. */
function perturbLayouts(layouts: ReadonlyArray<string | null>): Array<string | null> {
  const copy = [...layouts];
  const index = copy.findIndex((layout) => layout !== null);
  if (index === -1) copy[0] = 'jc=left';
  else copy[index] = null;
  return copy;
}

function footersEqual(expected: readonly FooterProjection[], actual: readonly FooterProjection[]): boolean {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

/** One-character perturbation used to prove the comparator can fail. */
function perturbParagraphs(paragraphs: readonly string[]): string[] {
  const copy = [...paragraphs];
  const index = copy.length - 1;
  copy[index] = `${copy[index] ?? ''}x`;
  return copy;
}

function perturbFooters(footers: readonly FooterProjection[]): FooterProjection[] {
  const copy = footers.map((footer) => (footer ? [...footer] : null));
  const index = copy.findIndex((footer) => footer !== null && footer.length > 0);
  if (index === -1) copy[0] = ['x'];
  else copy[index]![0] = `${copy[index]![0]}x`;
  return copy;
}

export function creationTextMirror(readback: CreationReadback, label = 'document.docx'): string {
  // Footnotes follow the body, each opening with its number; a note's text
  // already starts with the space that follows the number mark.
  const footnotes = readback.footnotes.length === 0
    ? []
    : ['Footnotes:', '', readback.footnotes.map((paragraphs, index) => `[${index + 1}]${paragraphs.join('\n')}`).join('\n\n'), ''];
  return [`# Read back from ${label} by docx-markdoc create. Generated; do not edit.`, '', readback.paragraphs.join('\n\n'), '', ...footnotes].join('\n');
}

/**
 * Create a new DOCX from creation Markdoc and prove it: package structure,
 * byte determinism, read-back text and footers against an independent source
 * projection (each with a negative control), and brownfield import anchoring.
 * Throws CREATION_VERIFICATION_FAILED, with the certificate as details, when
 * any check fails.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1162
 */
export async function createDocumentFromMarkdoc(source: string, options: CreateDocumentOptions = {}): Promise<CreatedDocument> {
  const transform = options.transformLowering ?? ((value: CreationLowering) => value);
  const lowering = transform(lowerCreationMarkdoc(source, options.profile));
  const docx = await generateDocx(lowering.spec);
  const again = await generateDocx(transform(lowerCreationMarkdoc(source, options.profile)).spec);
  const structural = await checkGeneratedPackage(docx);
  const readback = await readCreatedDocx(docx);

  const mismatch = firstParagraphMismatch(lowering.projection.paragraphs, readback.paragraphs);
  const readbackControl = firstParagraphMismatch(perturbParagraphs(lowering.projection.paragraphs), readback.paragraphs) !== -1;
  // Direct paragraph layout: compared for every paragraph, recorded when either side has one.
  const layoutMismatch = firstLayoutMismatch(lowering.projection.layouts, readback.layouts);
  const layoutControl = firstLayoutMismatch(perturbLayouts(lowering.projection.layouts), readback.layouts) !== -1;
  const layoutsRecorded = [...lowering.projection.layouts, ...readback.layouts].some((layout) => layout !== null);
  const readbackPassed = mismatch === -1 && readbackControl && layoutMismatch === -1 && (!layoutsRecorded || layoutControl);
  const footersPassed = footersEqual(lowering.projection.footers, readback.footers);
  const footerControl = !footersEqual(perturbFooters(lowering.projection.footers), readback.footers);
  // Headers and first-page slots are always compared; the check is recorded when either side has one.
  const firstPagePassed = JSON.stringify(lowering.projection.firstPage) === JSON.stringify(readback.firstPage);
  const headersPassed = footersEqual(lowering.projection.headers, readback.headers) && firstPagePassed;
  const headerControl = !footersEqual(perturbFooters(lowering.projection.headers), readback.headers);
  const firstPageControl = firstPageControls(lowering.projection, readback);
  const headersRecorded = [...lowering.projection.headers, ...readback.headers, ...lowering.projection.firstPage, ...readback.firstPage].some((entry) => entry !== null);
  const footnotesPassed = footnotesEqual(lowering.projection, readback);
  const footnoteControl = lowering.projection.footnotes.length === 0 ? 'not applicable' as const : !footnotesEqual(perturbFootnotes(lowering.projection), readback);
  // Brownfield import anchors every paragraph with text and every table-cell
  // paragraph (a blank cell is still an editable slot); an empty body
  // paragraph (the break after a section-ending table) is not anchored.
  const imported = await importDocxToMarkdoc(docx);
  const anchored = imported.source.paragraphs;
  const editable = readback.paragraphs.filter((paragraph, index) => paragraph.length > 0 || readback.inTableCell[index]).length;

  const sourceProjection = projectSourceText(source);
  const roundTrip = roundTripCheck(sourceProjection, imported.markdoc, readback.footers.length, readback);
  const crossReferences = crossReferenceCheck(sourceProjection, readback);
  const placedReferences = readback.footnoteReferences.length;
  const referenceMismatches = footnoteReferenceMismatches(sourceProjection, placedReferences);
  const referenceControl = (sourceProjection.footnoteReferenceInventory?.length ?? 0) === 0
    ? 'not applicable' as const
    : footnoteReferenceMismatches(sourceProjection, placedReferences - 1).length > 0;
  const footnoteDetail = [
    ...(footnotesPassed ? [] : [`expected ${JSON.stringify({ footnotes: lowering.projection.footnotes, references: lowering.projection.footnoteReferences })}, read ${JSON.stringify({ footnotes: readback.footnotes, references: readback.footnoteReferences })}`]),
    ...referenceMismatches,
    ...(footnoteControl === false || referenceControl === false ? ['a negative control was not detected'] : []),
  ];

  const text = creationTextMirror(readback, options.mirrorLabel);
  const checks: CreationCertificate['checks'] = {
    package: {
      passed: structural.issues.length === 0,
      issues: structural.issues.map((issue) => JSON.stringify(issue)),
    },
    determinism: { passed: Buffer.compare(docx, again) === 0 },
    readback: {
      passed: readbackPassed,
      paragraphs: readback.paragraphs.length,
      negativeControlDetected: readbackControl,
      ...(layoutsRecorded ? { layouts: { paragraphs: readback.layouts.filter((layout) => layout !== null).length, negativeControlDetected: layoutControl } } : {}),
      ...(mismatch !== -1 ? {
        detail: `paragraph ${mismatch + 1}: expected ${JSON.stringify(lowering.projection.paragraphs[mismatch] ?? null)}, read ${JSON.stringify(readback.paragraphs[mismatch] ?? null)}`,
      } : layoutMismatch !== -1 ? {
        detail: `paragraph ${layoutMismatch + 1} layout: expected ${JSON.stringify(lowering.projection.layouts[layoutMismatch] ?? null)}, read ${JSON.stringify(readback.layouts[layoutMismatch] ?? null)}`,
      } : readbackPassed ? {} : { detail: 'a negative control was not detected' }),
    },
    footers: {
      passed: footersPassed && footerControl,
      sections: readback.footers.length,
      negativeControlDetected: footerControl,
      ...(footersPassed ? {} : { detail: `expected ${JSON.stringify(lowering.projection.footers)}, read ${JSON.stringify(readback.footers)}` }),
    },
    ...(headersRecorded ? {
      headers: {
        passed: headersPassed && headerControl && firstPageControl !== false,
        sections: readback.headers.length,
        firstPageSections: readback.firstPage.filter((entry) => entry !== null).length,
        negativeControlDetected: headerControl,
        ...(firstPageControl === undefined ? {} : { firstPageNegativeControlDetected: firstPageControl }),
        ...(headersPassed ? {} : { detail: `expected ${JSON.stringify({ headers: lowering.projection.headers, firstPage: lowering.projection.firstPage })}, read ${JSON.stringify({ headers: readback.headers, firstPage: readback.firstPage })}` }),
      },
    } : {}),
    footnotes: {
      passed: footnoteDetail.length === 0,
      notes: readback.footnotes.length,
      negativeControlDetected: footnoteControl,
      references: {
        expected: sourceProjection.footnoteReferenceInventory?.length ?? 0,
        actual: placedReferences,
        mismatches: referenceMismatches,
        negativeControlDetected: referenceControl,
      },
      ...(footnoteDetail.length === 0 ? {} : { detail: footnoteDetail.join('; ') }),
    },
    roundTrip,
    brownfield: {
      passed: anchored === editable,
      anchoredParagraphs: anchored,
      ...(anchored === editable ? {} : { detail: `import anchored ${anchored} paragraphs; read-back has ${editable} anchorable paragraphs` }),
    },
    ...(crossReferences ? { crossReferences } : {}),
  };
  const certificate: CreationCertificate = {
    version: 1,
    kind: 'markdoc-create',
    sourceSha256: sha256(source),
    ...(options.profileSource === undefined ? {} : { profileSha256: sha256(options.profileSource) }),
    docxSha256: sha256(docx),
    textSha256: sha256(text),
    passed: Object.values(checks).every((check) => check.passed),
    checks,
    frontmatter: lowering.frontmatter,
    profile: lowering.profile,
    blocks: lowering.blocks,
    footers: readback.footers,
    ...(readback.headers.some((entry) => entry !== null) ? { headers: readback.headers } : {}),
    ...(readback.firstPage.some((entry) => entry !== null) ? { firstPage: readback.firstPage } : {}),
  };
  if (!certificate.passed) {
    const failed = Object.entries(checks).filter(([, check]) => !check.passed).map(([name, check]) => `${name}${check.detail ? ` (${check.detail})` : ''}`);
    throw new DocxMarkdocError('CREATION_VERIFICATION_FAILED', `Created document failed verification: ${failed.join('; ')}.`, certificate);
  }
  return { docx, text, readback, lowering, certificate };
}
