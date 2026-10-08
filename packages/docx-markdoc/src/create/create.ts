import { createHash } from 'node:crypto';
import { checkGeneratedPackage, generateDocx } from '@usejunior/docx-core';
import { DocxMarkdocError } from '../errors.js';
import { importDocxToMarkdoc } from '../import.js';
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
  const lowering = lowerCreationMarkdoc(source, options.profile);
  const docx = await generateDocx(lowering.spec);
  const again = await generateDocx(lowerCreationMarkdoc(source, options.profile).spec);
  const structural = await checkGeneratedPackage(docx);
  const readback = await readCreatedDocx(docx);

  const mismatch = firstParagraphMismatch(lowering.projection.paragraphs, readback.paragraphs);
  const readbackControl = firstParagraphMismatch(perturbParagraphs(lowering.projection.paragraphs), readback.paragraphs) !== -1;
  const footersPassed = footersEqual(lowering.projection.footers, readback.footers);
  const footerControl = !footersEqual(perturbFooters(lowering.projection.footers), readback.footers);
  // Brownfield import anchors every paragraph that has text; an empty
  // paragraph (the break paragraph after a section-ending table) has nothing
  // to edit and is not anchored.
  const imported = await importDocxToMarkdoc(docx);
  const anchored = imported.source.paragraphs;
  const editable = readback.paragraphs.filter((paragraph) => paragraph.length > 0).length;

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
    brownfield: {
      passed: anchored === editable,
      anchoredParagraphs: anchored,
      ...(anchored === editable ? {} : { detail: `import anchored ${anchored} paragraphs; read-back has ${editable} non-empty paragraphs` }),
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
