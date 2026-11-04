import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { OOXML, computeParagraphListLabels, parseNumberingXml, parseStylesXml, parseXml, type NumberingSpec, type ParagraphSpec } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { defaultPdfRenderTools } from '../pdf/tools.js';
import { runCreateCommand } from './cli-create.js';
import { createDocumentFromMarkdoc, type CreationCertificate } from './create.js';
import { lowerCreationMarkdoc } from './lower.js';
import { comparePdfWords, projectSourceText } from './oracle.js';

const TEST_FEATURE = 'add-created-heading-numbering';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1250 numbered headings in created documents',
  severity: 'critical',
});
const conforming = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.23' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.4' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.10' });

const W = OOXML.W_NS;
const EVIDENCE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../scripts/oracle/word/evidence/issue-1250-word-16.114.json');

type WordReading = { listStrings: Array<{ listString: string; text: string }>; references: Array<{ instruction: string; word: string }> };
type Insertion = WordReading & { insertedAfter: string; insertedText: string; style: string };
type Evidence = {
  source: string;
  cachedResults: string[];
  before: WordReading;
  afterInsertingSection: Insertion;
  afterInsertingSectionInArticleOne: Insertion;
  afterInsertingArticle: Insertion;
  controls: {
    articleClauseFullContext: WordReading & { libreOffice: { pdfText: string } };
    skippedSectionLevel: WordReading & { libreOffice: { pdfText: string } };
  };
};

const LEGAL = '---\nheading-numbers: legal\n---\n';

const SOURCE = `${LEGAL}${[
  '# ASSET PURCHASE AGREEMENT',
  '',
  '1. A recital list before the first heading.',
  '',
  '## Definitions {% #definitions %}',
  '',
  '### Defined Terms {% #defined-terms %}',
  '',
  '1. "Business Day" means a weekday. {% #business-day %}',
  '2. "Closing" has the meaning in {% xref to="closing" /%}.',
  '   1. as extended {% #as-extended %}',
  '      1. by written notice {% #written-notice %}',
  '',
  'This Section applies throughout.',
  '',
  '3. "Person" means any individual.',
  '',
  '- A bullet, not a clause.',
  '',
  '## Purchase and Sale',
  '',
  '### Closing {% #closing %}',
  '',
  '1. See {% xref to="definitions" /%}, {% xref to="defined-terms" number="paragraph" /%}, {% xref to="written-notice" /%} and clause {% xref to="written-notice" number="paragraph" /%}.',
].join('\n')}\n`;

async function parts(docx: Buffer): Promise<{ document: Document; numbering: Document; styles: Document }> {
  const zip = await JSZip.loadAsync(docx);
  const read = async (name: string) => parseXml(await zip.file(name)!.async('string'));
  return { document: await read('word/document.xml'), numbering: await read('word/numbering.xml'), styles: await read('word/styles.xml') };
}

const textOf = (paragraph: Element): string => Array.from(paragraph.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join('');

/** docx-core's read-side label for every numbered paragraph, style-linked headings included, with its text. */
function labels(document: Document, numbering: Document, styles: Document): string[] {
  const paragraphs = Array.from(document.getElementsByTagNameNS(W, 'p'));
  const found = computeParagraphListLabels(paragraphs, parseNumberingXml(numbering), parseStylesXml(styles));
  return paragraphs.flatMap((paragraph) => {
    const label = found.get(paragraph)?.label;
    return label ? [`${label} ${textOf(paragraph)}`] : [];
  });
}

/** Insert a paragraph of style `styleId` after the paragraph whose text starts with `after`, as a Word user adding a heading would. */
function insertHeadingAfter(document: Document, after: string, text: string, styleId: string): void {
  const anchor = Array.from(document.getElementsByTagNameNS(W, 'p')).find((paragraph) => textOf(paragraph).startsWith(after))!;
  const paragraph = document.createElementNS(W, 'w:p');
  const pPr = document.createElementNS(W, 'w:pPr');
  const pStyle = document.createElementNS(W, 'w:pStyle');
  pStyle.setAttributeNS(W, 'w:val', styleId);
  pPr.appendChild(pStyle);
  const run = document.createElementNS(W, 'w:r');
  const t = document.createElementNS(W, 'w:t');
  t.textContent = text;
  run.appendChild(t);
  paragraph.appendChild(pPr);
  paragraph.appendChild(run);
  anchor.parentNode!.insertBefore(paragraph, anchor.nextSibling);
}

const wAttr = (element: Element | null | undefined, name: string): string | null =>
  element ? element.getAttributeNS(W, name) || element.getAttribute(`w:${name}`) : null;

async function failure(source: string): Promise<{ code?: string; line?: number }> {
  const error = await createDocumentFromMarkdoc(source).then(() => undefined, (caught: { code?: string; details?: { line?: number } }) => caught);
  expect(error, source).toBeDefined();
  return { code: error!.code, ...(error!.details?.line === undefined ? {} : { line: error!.details.line }) };
}

async function verificationFailure(promise: Promise<unknown>): Promise<CreationCertificate> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught as { code?: string; details?: unknown });
  expect(error?.code).toBe('CREATION_VERIFICATION_FAILED');
  return error!.details as CreationCertificate;
}

const headingDefinition = (numbering: readonly NumberingSpec[] | undefined) => numbering!.find((definition) => definition.levels[0]!.pStyle !== undefined)!;

describe('Traceability: numbered headings in created documents', () => {
  conforming.openspec('[SDX-MDOC-HEADNUM-01] heading-numbers legal numbers headings and the clause lists under them with one style-linked definition')(
    'Scenario: heading-numbers legal numbers headings and the clause lists under them with one style-linked definition',
    async () => {
      const created = await createDocumentFromMarkdoc(SOURCE);
      expect(created.certificate.passed).toBe(true);
      const { document, numbering, styles } = await parts(created.docx);

      // The labels come from numbering, never from the paragraph text.
      expect(created.readback.paragraphs.slice(0, 5)).toEqual(['ASSET PURCHASE AGREEMENT', 'A recital list before the first heading.', 'Definitions', 'Defined Terms', '"Business Day" means a weekday.']);
      expect(labels(document, numbering, styles)).toEqual([
        '1. A recital list before the first heading.',
        'ARTICLE I Definitions',
        'Section 1.01 Defined Terms',
        '(a) "Business Day" means a weekday.',
        '(b) "Closing" has the meaning in Section 2.01.',
        '(i) as extended',
        '(A) by written notice',
        '(c) "Person" means any individual.',
        '• A bullet, not a clause.',
        'ARTICLE II Purchase and Sale',
        'Section 2.01 Closing',
        '(a) See ARTICLE I, Section 1.01, Section 1.01(b)(i)(A) and clause (A).',
      ]);

      // One heading definition: upper-Roman Articles and legal, zero-padded Sections, linked to the
      // heading styles; the clause levels below them. The list before the first heading keeps the
      // ordered definition, and the bullets their own.
      const lowering = lowerCreationMarkdoc(SOURCE);
      const heading = headingDefinition(lowering.spec.numbering);
      expect(heading.levels.map(({ ilvl, numFmt, lvlText, pStyle, isLgl }) => ({ ilvl, numFmt, lvlText, pStyle, isLgl }))).toEqual([
        { ilvl: 0, numFmt: 'upperRoman', lvlText: 'ARTICLE %1', pStyle: 'Heading1', isLgl: undefined },
        { ilvl: 1, numFmt: 'decimalZero', lvlText: 'Section %1.%2', pStyle: 'Heading2', isLgl: true },
        { ilvl: 2, numFmt: 'lowerLetter', lvlText: '(%3)', pStyle: undefined, isLgl: undefined },
        { ilvl: 3, numFmt: 'lowerRoman', lvlText: '(%4)', pStyle: undefined, isLgl: undefined },
        { ilvl: 4, numFmt: 'upperLetter', lvlText: '(%5)', pStyle: undefined, isLgl: undefined },
      ]);
      expect(lowering.spec.numbering!.map((definition) => definition.levels[0]!.lvlText)).toEqual(['%1.', 'ARTICLE %1', '•']);
      expect(heading.levels.every((level) => !level.lvlText.endsWith('.'))).toBe(true);

      // Headings carry no numPr of their own: the style's numPr numbers them, as Word's outline numbering does.
      const headingParagraphs = Array.from(document.getElementsByTagNameNS(W, 'p')).filter((paragraph) => /^Heading[12]$/u.test(wAttr(paragraph.getElementsByTagNameNS(W, 'pStyle').item(0), 'val') ?? ''));
      expect(headingParagraphs).toHaveLength(4);
      expect(headingParagraphs.every((paragraph) => paragraph.getElementsByTagNameNS(W, 'numPr').length === 0)).toBe(true);
      const styleNumPr = (styleId: string) => {
        const style = Array.from(styles.getElementsByTagNameNS(W, 'style')).find((candidate) => wAttr(candidate, 'styleId') === styleId)!;
        return wAttr(style.getElementsByTagNameNS(W, 'ilvl').item(0), 'val');
      };
      expect([styleNumPr('Heading1'), styleNumPr('Heading2')]).toEqual(['0', '1']);
      const abstract = Array.from(numbering.getElementsByTagNameNS(W, 'abstractNum')).find((candidate) => candidate.getElementsByTagNameNS(W, 'pStyle').length > 0)!;
      expect(abstract.getElementsByTagNameNS(W, 'isLgl')).toHaveLength(1);
      expect(numbering.getElementsByTagNameNS(W, 'lvlOverride')).toHaveLength(0);

      // Without the frontmatter, headings stay unnumbered and literal heading numbers stay text.
      const plain = lowerCreationMarkdoc('# T\n\n## 2.04 Purchase Price\n\n1. One.\n');
      expect(plain.spec.numbering!.map((definition) => definition.levels[0]!.lvlText)).toEqual(['%1.']);
      expect(plain.projection.paragraphs).toEqual(['T', '2.04 Purchase Price', 'One.']);
      expect((await createDocumentFromMarkdoc('# T\n\n## 2.04 Purchase Price\n\n1. One.\n')).certificate.passed).toBe(true);
    },
  );

  test.openspec('[SDX-MDOC-HEADNUM-02] cross-references to numbered headings and their clauses show the numbers Word shows and renumber with them')(
    'Scenario: cross-references to numbered headings and their clauses show the numbers Word shows and renumber with them',
    async () => {
      const created = await createDocumentFromMarkdoc(SOURCE);
      expect(created.certificate.checks.crossReferences?.passed).toBe(true);
      expect(created.readback.crossReferences?.map(({ text, instruction }) => `${instruction.trim()} = ${text}`)).toEqual([
        'REF closing \\w \\h = Section 2.01',
        'REF definitions \\w \\h = ARTICLE I',
        'REF defined_terms \\n \\h = Section 1.01',
        'REF written_notice \\w \\h = Section 1.01(b)(i)(A)',
        'REF written_notice \\n \\h = (A)',
      ]);

      // Word 16.114 on the oracle document: its after-update REF results equal create's cached results,
      // and docx-core's read side labels every heading and clause as Word does, before and after a Word
      // user inserts a Section (in Article II or Article I) or an Article.
      const evidence = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) as Evidence;
      const oracle = await createDocumentFromMarkdoc(evidence.source);
      expect(oracle.certificate.passed).toBe(true);
      expect(oracle.readback.crossReferences?.map((reference) => reference.text)).toEqual(evidence.cachedResults);
      expect(evidence.before.references.map((reference) => reference.word)).toEqual(evidence.cachedResults);
      const wordLabels = (reading: WordReading) => reading.listStrings.map((entry) => `${entry.listString} ${entry.text}`);
      const { document, numbering, styles } = await parts(oracle.docx);
      expect(labels(document, numbering, styles)).toEqual(wordLabels(evidence.before));
      for (const reading of [evidence.afterInsertingSection, evidence.afterInsertingSectionInArticleOne, evidence.afterInsertingArticle]) {
        const edited = await parts(oracle.docx);
        insertHeadingAfter(edited.document, reading.insertedAfter, reading.insertedText, reading.style === 'Heading 1' ? 'Heading1' : 'Heading2');
        // Word's texts hold the updated REF results; the labels, and where the new heading sits, must match.
        const after = labels(edited.document, edited.numbering, edited.styles);
        expect(after.map((entry) => entry.split(' ')[0] === 'ARTICLE' || entry.startsWith('Section ') ? entry.split(' ').slice(0, 2).join(' ') : entry.split(' ')[0])).toEqual(reading.listStrings.map((entry) => entry.listString));
        expect(after.findIndex((entry) => entry.endsWith(reading.insertedText))).toBe(reading.listStrings.findIndex((entry) => entry.text === reading.insertedText));
      }
      // Every REF result after the Article II insertion is the renumbered target's new number.
      expect(evidence.afterInsertingSection.references.map((reference) => reference.word).slice(0, 3)).toEqual(['Section 2.04', 'Section 2.04(b)', 'Section 2.03']);

      // Controls behind the two refusals: a clause directly under an Article reads "ARTICLE II(a)" in full in
      // Word but "Section 2.01(a)" in LibreOffice, and clauses before an Article's first Section make it 1.02.
      expect(evidence.controls.articleClauseFullContext.references.map((reference) => reference.word)).toEqual(['(a)', 'ARTICLE II(a)', '(i)', 'ARTICLE II(a)(i)']);
      expect(evidence.controls.articleClauseFullContext.libreOffice.pdfText).toContain('Section 2.01(a)');
      expect(wordLabels(evidence.controls.skippedSectionLevel)).toEqual(['ARTICLE I Definitions', '(a) A clause under the Article.', '(b) Another clause.', 'Section 1.02 First', 'Section 1.03 Second']);
    },
  );

  test.openspec('[SDX-MDOC-HEADNUM-03] verification holds numbered headings and their references to the source')(
    'Scenario: verification holds numbered headings and their references to the source',
    async () => {
      // The source projection numbers the headings and clauses from the source alone.
      const projection = projectSourceText(SOURCE);
      expect(projection.body.filter((entry) => entry.marker).map((entry) => `${entry.marker} ${entry.text.trim()}`).slice(0, 5)).toEqual([
        '1. A recital list before the first heading.',
        'ARTICLE I Definitions',
        'Section 1.01 Defined Terms',
        '(a) "Business Day" means a weekday.',
        '(b) "Closing" has the meaning in Section 2.01.',
      ]);
      // A heading's bookmark must hold its own text; LibreOffice renders these references as Word does.
      const targets = Object.fromEntries(Object.entries(projection.crossReferenceTargets ?? {}).map(([id, text]) => [id, text.trim()]));
      expect(targets).toMatchObject({ definitions: 'Definitions', 'defined-terms': 'Defined Terms', closing: 'Closing', 'written-notice': 'by written notice' });
      expect(projectSourceText(SOURCE, { reader: 'libreoffice' }).body.at(-1)!.text).toBe(projection.body.at(-1)!.text);

      // A lowering that numbers the Sections from 2 and projects that consistently passes the read-back
      // but fails the round trip, which numbers the targets from the source.
      const shifted = await verificationFailure(createDocumentFromMarkdoc(SOURCE, {
        transformLowering(lowering) {
          headingDefinition(lowering.spec.numbering).levels[1]!.start = 2;
          lowering.projection.paragraphs = lowering.projection.paragraphs.map((text) => text.replace('Section 2.01', 'Section 2.02').replace(/Section 1\.01/gu, 'Section 1.02'));
          return lowering;
        },
      }));
      expect(shifted.checks.readback.passed).toBe(true);
      expect(shifted.checks.roundTrip.passed).toBe(false);
      // A reference moved to another heading with the same text, or a bookmark moved off its heading, fails the
      // cross-reference check although the text is unchanged.
      const retargeted = await verificationFailure(createDocumentFromMarkdoc(SOURCE, {
        transformLowering(lowering) {
          const blocks = lowering.spec.sections[0]!.blocks as ParagraphSpec[];
          const definitions = blocks.find((block) => block.bookmark === 'definitions')!;
          const purchase = blocks.find((block) => block.runs.some((run) => run.kind === 'text' && run.text === 'Purchase and Sale'))!;
          definitions.bookmark = undefined;
          purchase.bookmark = 'definitions';
          lowering.projection.paragraphs = lowering.projection.paragraphs.map((text) => text.replace('See ARTICLE I,', 'See ARTICLE II,'));
          return lowering;
        },
      }));
      expect(retargeted.checks.crossReferences?.passed).toBe(false);

      // The PDF word check expects each heading's label, as two words, before its text.
      const source = `${LEGAL}## Definitions\n\n### Terms\n\n1. One term.\n`;
      const expected = projectSourceText(source, { reader: 'libreoffice' });
      expect(comparePdfWords(expected, ['ARTICLE I Definitions\nSection 1.01 Terms\n(a) One term.\n'])).toMatchObject({ passed: true, knownGenerated: { listMarkers: 3 } });
      expect(comparePdfWords(expected, ['Definitions\nSection 1.01 Terms\n(a) One term.\n'])).toMatchObject({ passed: false, missing: [{ words: 'ARTICLE I' }] });
      expect(comparePdfWords(expected, ['ARTICLE I Definitions\nSection 1.02 Terms\n(a) One term.\n']).passed).toBe(false);
    },
  );

  test.openspec('[SDX-MDOC-HEADNUM-04] heading numbering fails closed on sources Word would number differently')(
    'Scenario: heading numbering fails closed on sources Word would number differently',
    async () => {
      expect(await failure('---\nheading-numbers: outline\n---\n## A\n')).toEqual({ code: 'UNSUPPORTED_CREATION_FRONTMATTER' });
      expect(await failure(`${LEGAL}# T\n\n### Orphan\n`)).toEqual({ code: 'HEADING_NUMBER_SKIPS_LEVEL', line: 6 });
      expect(await failure(`${LEGAL}## ARTICLE IV Definitions\n`)).toEqual({ code: 'DUPLICATE_HEADING_NUMBER', line: 4 });
      expect(await failure(`${LEGAL}## Definitions\n\n### Section 1.01 Terms\n`)).toEqual({ code: 'DUPLICATE_HEADING_NUMBER', line: 6 });
      // Ordinary words after "Article", and statutory section references, are heading text, not a number.
      const admitted = await createDocumentFromMarkdoc(`${LEGAL}## Article Civil Rights\n\n## Article Integrity\n\n### Section 409A Matters\n\n## Articles of Incorporation\n\n## Article Légal\n\n## Article Me\u0301me\n\n### Section 1.409A Compliance\n\n### Section 1.409 Regulations\n\n### Section 1.04.5 Rules\n`);
      expect(admitted.readback.paragraphs).toEqual(['Article Civil Rights', 'Article Integrity', 'Section 409A Matters', 'Articles of Incorporation', 'Article Légal', 'Article Me\u0301me', 'Section 1.409A Compliance', 'Section 1.409 Regulations', 'Section 1.04.5 Rules']);
      expect(await failure(`${LEGAL}## Definitions\n\n### Section 2.04. Terms\n`)).toEqual({ code: 'DUPLICATE_HEADING_NUMBER', line: 6 });
      expect(await failure(`${LEGAL}## Article XIV. Notices\n`)).toEqual({ code: 'DUPLICATE_HEADING_NUMBER', line: 4 });
      // Clauses restart at (a) under each heading; a list continues only the list before it under the same heading.
      expect(await failure(`${LEGAL}## A\n\n### S\n\n2. Two.\n`)).toEqual({ code: 'HEADING_LIST_START', line: 8 });
      expect(await failure(`${LEGAL}## A\n\n### S\n\n1. One.\n\nText.\n\n3. Three.\n`)).toEqual({ code: 'HEADING_LIST_START', line: 12 });
      expect((await createDocumentFromMarkdoc(`${LEGAL}## A\n\n### S\n\n1. One.\n\nText.\n\n2. Two.\n\n### T\n\n1. One again.\n`)).readback.paragraphs).toEqual(['A', 'S', 'One.', 'Text.', 'Two.', 'T', 'One again.']);
      // Clauses directly under an Article may not precede its Sections: Word would number the first one N.02.
      expect(await failure(`${LEGAL}## A\n\n1. One.\n\n### S\n`)).toEqual({ code: 'SECTION_AFTER_ARTICLE_CLAUSES', line: 8 });
      // A clause directly under an Article is referenced by its own number only; its full number differs by reader.
      const articleClause = `${LEGAL}## A\n\n1. One {% #one %}\n\n`;
      expect(await failure(`${articleClause}See {% xref to="one" /%}.\n`)).toEqual({ code: 'XREF_FULL_NUMBER_UNDER_ARTICLE', line: 8 });
      expect((await createDocumentFromMarkdoc(`${articleClause}See clause {% xref to="one" number="paragraph" /%}.\n`)).readback.paragraphs.at(-1)).toBe('See clause (a).');
      // A heading-numbered target already carries its word, so format="section" does not apply.
      expect(await failure(`${LEGAL}## A {% #a %}\n\nSee {% xref to="a" format="section" /%}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 6 });
      // The title is never numbered, and without the frontmatter no heading is.
      expect(await failure(`${LEGAL}# T {% #t %}\n\nSee {% xref to="t" /%}.\n`)).toEqual({ code: 'XREF_TARGET_NOT_NUMBERED', line: 6 });
      const unnumbered = await createDocumentFromMarkdoc('# T\n\n## Defs {% #defs %}\n\nSee {% xref to="defs" /%}.\n').then(() => '', (error: Error) => error.message);
      expect(unnumbered).toContain('heading-numbers: legal');
    },
  );
});

const realTools = defaultPdfRenderTools();
const describeWithLibreOffice = realTools.resolve('soffice') && realTools.resolve('pdftotext') ? describe : describe.skip;

describeWithLibreOffice('Traceability: numbered headings in a real LibreOffice PDF', () => {
  test.openspec('[SDX-MDOC-HEADNUM-03] verification holds numbered headings and their references to the source')(
    'Scenario: a real LibreOffice PDF of a document with numbered headings passes the PDF checks',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-headnum-'));
      try {
        const file = path.join(dir, 'agreement.mdoc');
        await writeFile(file, SOURCE);
        const result = await runCreateCommand([file, path.join(dir, 'out'), '--require-pdf']);
        expect(result.pdf).toMatchObject({ status: 'passed', words: { passed: true } });
        const certificate = JSON.parse(await readFile(path.join(dir, 'out', 'agreement.verification.json'), 'utf8')) as { pdf: { words: { knownGenerated: { listMarkers: number } } } };
        expect(certificate.pdf.words.knownGenerated.listMarkers).toBe(12);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
