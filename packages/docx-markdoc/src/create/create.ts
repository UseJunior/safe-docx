import { createHash } from 'node:crypto';
import { checkGeneratedPackage, generateDocx } from '@usejunior/docx-core';
import { DocxMarkdocError } from '../errors.js';
import { importDocxToMarkdoc } from '../import.js';
import { requireMarkdoc } from '../markdoc.js';
import { ORACLE_NORMALIZATION, compareParagraphs, projectSourceText, type SequenceComparison, type SourceProjection } from './oracle.js';
import { lowerCreationMarkdoc, type CreationLowering, type FooterProjection } from './lower.js';
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
    readback: CreationCheck & { paragraphs: number; negativeControlDetected: boolean };
    footers: CreationCheck & { sections: number; negativeControlDetected: boolean };
    brownfield: CreationCheck & { anchoredParagraphs: number };
    /**
     * Independent round trip (#1185): the created DOCX re-imported through
     * `docx-markdoc import`, compared with plain text read straight from the
     * original Markdoc, never from the lowering or the DocumentSpec.
     */
    roundTrip: CreationCheck & {
      normalization: string;
      body: SequenceComparison;
      footers: Array<{ section: number; expected: string[] | null; actual: string[] | null; comparison?: SequenceComparison; passed: boolean }>;
      negativeControls: Record<'deletedWord' | 'deletedParagraph' | 'deletedTableCell' | 'deletedFooterText', boolean | 'not applicable'>;
    };
  };
  frontmatter: CreationLowering['frontmatter'];
  profile: CreationLowering['profile'];
  blocks: CreationLowering['blocks'];
  footers: FooterProjection[];
};

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

/** Footer paragraphs of each section from re-imported Markdoc: the story bound to `<section>:default`. */
function importedFooters(ir: ReturnType<typeof requireMarkdoc>, sections: number): Array<string[] | null> {
  const stories = ir.stories ?? [];
  const storyParagraphs = ir.storyScaffold ?? [];
  return Array.from({ length: sections }, (_, section) => {
    const story = stories.find((entry) => entry.kind === 'footer' && entry.bindings.includes(`${section}:default`));
    return story ? storyParagraphs.filter((paragraph) => paragraph.story === story.id).map((paragraph) => paragraph.originalText) : null;
  });
}

/** Run the independent round-trip comparison, with negative controls that must each be detected. */
function roundTripCheck(expected: SourceProjection, importedMarkdoc: string, sections: number): CreationCertificate['checks']['roundTrip'] {
  const ir = requireMarkdoc(importedMarkdoc);
  const actualBody = ir.scaffold.map((paragraph) => paragraph.originalText);
  const actualFooters = importedFooters(ir, sections);
  const body = compareParagraphs(expected.body, actualBody);
  const footers = Array.from({ length: Math.max(sections, expected.footers.length) }, (_, section) => {
    const want = expected.footers[section] ?? null;
    const got = actualFooters[section] ?? null;
    if (want === null || got === null) {
      const passed = (want === null || want.every((line) => !normalizeEmpty(line))) && (got === null || got.every((line) => !normalizeEmpty(line)));
      return { section, expected: want, actual: got, passed };
    }
    const comparison = compareParagraphs(want.map((text) => ({ text })), got);
    return { section, expected: want, actual: got, comparison, passed: comparison.passed };
  });
  const detects = (mutated: SourceProjection) => {
    const mutatedBody = compareParagraphs(mutated.body, actualBody);
    const mutatedFooters = mutated.footers.some((want, section) => {
      const got = actualFooters[section] ?? null;
      return want !== null && got !== null && !compareParagraphs(want.map((text) => ({ text })), got).passed;
    });
    return !mutatedBody.passed || mutatedFooters;
  };
  const wordIndex = expected.body.findIndex((entry) => entry.text.trim().split(/\s+/u).length >= 2);
  const cellIndex = expected.body.findIndex((entry) => entry.cell && entry.text.trim());
  const footerIndex = expected.footers.findIndex((footer) => footer?.some((line) => line.trim() && !line.startsWith('\u0000')));
  const negativeControls: CreationCertificate['checks']['roundTrip']['negativeControls'] = {
    deletedWord: wordIndex === -1 ? 'not applicable' : detects({ ...expected, body: expected.body.map((entry, i) => (i === wordIndex ? { ...entry, text: entry.text.trim().split(/\s+/u).slice(1).join(' ') } : entry)) }),
    deletedParagraph: expected.body.length === 0 ? 'not applicable' : detects({ ...expected, body: expected.body.filter((entry) => entry.text.trim()).slice(1) }),
    deletedTableCell: cellIndex === -1 ? 'not applicable' : detects({ ...expected, body: expected.body.filter((_, i) => i !== cellIndex) }),
    deletedFooterText: footerIndex === -1 ? 'not applicable' : detects({ ...expected, footers: expected.footers.map((footer, i) => (i === footerIndex ? footer!.filter((line) => line.startsWith('\u0000')) : footer)) }),
  };
  const controlsOk = Object.values(negativeControls).every((value) => value !== false);
  const footersOk = footers.every((footer) => footer.passed);
  const mismatchCount = body.mismatches.length + footers.reduce((sum, footer) => sum + (footer.comparison?.mismatches.length ?? (footer.passed ? 0 : 1)), 0);
  return {
    passed: body.passed && footersOk && controlsOk,
    normalization: ORACLE_NORMALIZATION,
    body,
    footers,
    negativeControls,
    ...(body.passed && footersOk && controlsOk ? {} : { detail: `${mismatchCount} round-trip mismatch(es)${controlsOk ? '' : '; a negative control was not detected'}` }),
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
  return [`# Read back from ${label} by docx-markdoc create. Generated; do not edit.`, '', readback.paragraphs.join('\n\n'), ''].join('\n');
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
  const footersPassed = footersEqual(lowering.projection.footers, readback.footers);
  const footerControl = !footersEqual(perturbFooters(lowering.projection.footers), readback.footers);
  // Brownfield import anchors every paragraph with text and every table-cell
  // paragraph (a blank cell is still an editable slot); an empty body
  // paragraph (the break after a section-ending table) is not anchored.
  const imported = await importDocxToMarkdoc(docx);
  const anchored = imported.source.paragraphs;
  const editable = readback.paragraphs.filter((paragraph, index) => paragraph.length > 0 || readback.inTableCell[index]).length;

  const roundTrip = roundTripCheck(projectSourceText(source), imported.markdoc, readback.footers.length);

  const text = creationTextMirror(readback, options.mirrorLabel);
  const checks: CreationCertificate['checks'] = {
    package: {
      passed: structural.issues.length === 0,
      issues: structural.issues.map((issue) => JSON.stringify(issue)),
    },
    determinism: { passed: Buffer.compare(docx, again) === 0 },
    readback: {
      passed: mismatch === -1 && readbackControl,
      paragraphs: readback.paragraphs.length,
      negativeControlDetected: readbackControl,
      ...(mismatch === -1 ? {} : {
        detail: `paragraph ${mismatch + 1}: expected ${JSON.stringify(lowering.projection.paragraphs[mismatch] ?? null)}, read ${JSON.stringify(readback.paragraphs[mismatch] ?? null)}`,
      }),
    },
    footers: {
      passed: footersPassed && footerControl,
      sections: readback.footers.length,
      negativeControlDetected: footerControl,
      ...(footersPassed ? {} : { detail: `expected ${JSON.stringify(lowering.projection.footers)}, read ${JSON.stringify(readback.footers)}` }),
    },
    roundTrip,
    brownfield: {
      passed: anchored === editable,
      anchoredParagraphs: anchored,
      ...(anchored === editable ? {} : { detail: `import anchored ${anchored} paragraphs; read-back has ${editable} anchorable paragraphs` }),
    },
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
  };
  if (!certificate.passed) {
    const failed = Object.entries(checks).filter(([, check]) => !check.passed).map(([name, check]) => `${name}${check.detail ? ` (${check.detail})` : ''}`);
    throw new DocxMarkdocError('CREATION_VERIFICATION_FAILED', `Created document failed verification: ${failed.join('; ')}.`, certificate);
  }
  return { docx, text, readback, lowering, certificate };
}
