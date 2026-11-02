import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { DocxDocument, parseXml, type InlineSpec, type ParagraphSpec } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { compileMarkdoc } from '../compile.js';
import { importDocxToMarkdoc } from '../import.js';
import { defaultPdfRenderTools } from '../pdf/tools.js';
import { requiredPdfText, runCreateCommand } from './cli-create.js';
import { createDocumentFromMarkdoc, type CreationCertificate } from './create.js';
import { projectSourceText } from './oracle.js';

const TEST_FEATURE = 'add-generated-cross-references';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1236 cross-references in created documents',
  severity: 'critical',
});
const conforming = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' });

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const SOURCE = [
  '# ASSET PURCHASE AGREEMENT',
  '',
  '## Definitions {% #definitions %}',
  '',
  '1. Purchase Price. The price is set out in {% xref to="price-adjustment" format="section" /%}.',
  '2. Closing {% #closing %}',
  '   1. Deliveries {% #deliveries %}',
  '      1. Escrow {% #escrow-release %}',
  '      2. Officer certificate',
  '   2. Price adjustment {% #price-adjustment %}',
  '',
  'See {% xref to="escrow-release" /%}, clause {% xref to="escrow-release" number="paragraph" /%} and Section {% xref to="closing" /%}.{% fnref id="note" /%}',
  '',
  '{% table %}',
  '* Term',
  '---',
  '* Escrow, under {% xref to="escrow-release" format="section" /%}',
  '{% /table %}',
  '',
  '{% footnote id="note" %}Compare {% xref to="deliveries" format="section" /%}.{% /footnote %}',
].join('\n');

function wChildren(parent: Element, localName: string): Element[] {
  return Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === W && (node as Element).localName === localName);
}

async function part(docx: Buffer, name: string): Promise<Document> {
  return parseXml(await (await JSZip.loadAsync(docx)).file(name)!.async('string'));
}

/** Each paragraph's own text (w:t only) with the names of the bookmarks it starts. */
function bookmarkedParagraphs(document: Document): Array<[string, string]> {
  return Array.from(document.getElementsByTagNameNS(W, 'p')).flatMap((paragraph) => wChildren(paragraph, 'bookmarkStart')
    .map((start): [string, string] => [start.getAttributeNS(W, 'name') ?? '', Array.from(paragraph.getElementsByTagNameNS(W, 't')).map((t) => t.textContent).join('')]));
}

function instructions(document: Document): string[] {
  return Array.from(document.getElementsByTagNameNS(W, 'instrText')).map((node) => node.textContent ?? '');
}

async function verificationFailure(promise: Promise<unknown>): Promise<CreationCertificate> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught as { code?: string; details?: unknown });
  expect(error?.code).toBe('CREATION_VERIFICATION_FAILED');
  return error!.details as CreationCertificate;
}

async function failure(source: string): Promise<{ code?: string; line?: number }> {
  const error = await createDocumentFromMarkdoc(source).then(() => undefined, (caught: { code?: string; details?: { line?: number } }) => caught);
  expect(error, source).toBeDefined();
  return { code: error!.code, ...(error!.details?.line === undefined ? {} : { line: error!.details.line }) };
}

describe('Traceability: cross-references in created documents', () => {
  conforming.openspec('[SDX-MDOC-XREF-01] ids and xref tags create bookmarks and REF fields with the numbers Word shows')(
    'Scenario: ids and xref tags create bookmarks and REF fields with the numbers Word shows',
    async () => {
      const created = await createDocumentFromMarkdoc(SOURCE);
      expect(created.certificate.passed).toBe(true);
      expect(created.certificate.checks.roundTrip.passed).toBe(true);

      // The read-back reads each REF field as its cached result; the {% #id %} annotations leave no text behind.
      expect(created.readback.paragraphs).toEqual([
        'ASSET PURCHASE AGREEMENT',
        'Definitions',
        'Purchase Price. The price is set out in Section 2(b).',
        'Closing',
        'Deliveries',
        'Escrow',
        'Officer certificate',
        'Price adjustment',
        'See 2(a)(i), clause (i) and Section 2.',
        'Term',
        'Escrow, under Section 2(a)(i)',
        '',
      ]);
      expect(created.readback.crossReferences).toEqual([
        { paragraph: 2, offset: 48, text: '2(b)' },
        { paragraph: 8, offset: 4, text: '2(a)(i)' },
        { paragraph: 8, offset: 20, text: '(i)' },
        { paragraph: 8, offset: 36, text: '2' },
        { paragraph: 10, offset: 22, text: '2(a)(i)' },
      ]);
      expect(created.readback.footnotes).toEqual([[' Compare Section 2(a).']]);
      expect(created.text).toContain('Purchase Price. The price is set out in Section 2(b).');

      // Every id is a bookmark on its heading or list item paragraph, hyphens mapped to underscores.
      const document = await part(created.docx, 'word/document.xml');
      expect(bookmarkedParagraphs(document)).toEqual([
        ['definitions', 'Definitions'],
        ['closing', 'Closing'],
        ['deliveries', 'Deliveries'],
        ['escrow_release', 'Escrow'],
        ['price_adjustment', 'Price adjustment'],
      ]);
      expect(instructions(document)).toEqual([
        ' REF price_adjustment \\w \\h ',
        ' REF escrow_release \\w \\h ',
        ' REF escrow_release \\n \\h ',
        ' REF closing \\w \\h ',
        ' REF escrow_release \\w \\h ',
      ]);
      expect(instructions(await part(created.docx, 'word/footnotes.xml'))).toEqual([' REF deliveries \\w \\h ']);

      // format="section" is literal text before the field, not part of its result.
      const fieldParagraph = Array.from(document.getElementsByTagNameNS(W, 'p'))[2]!;
      const runTexts = wChildren(fieldParagraph, 'r').map((run) => wChildren(run, 't').map((t) => t.textContent).join('')).filter(Boolean);
      expect(runTexts.slice(-3)).toEqual(['Purchase Price. The price is set out in Section ', '2(b)', '.']);

      // A source without ids or xrefs has no bookmarks and no cross-reference sites.
      const plain = await createDocumentFromMarkdoc('# T\n\n1. One\n2. Two\n');
      expect((await part(plain.docx, 'word/document.xml')).getElementsByTagNameNS(W, 'bookmarkStart')).toHaveLength(0);
      expect(plain.readback.crossReferences).toBeUndefined();
    },
  );

  test.openspec('[SDX-MDOC-XREF-02] malformed ids and cross-references fail closed with a code and a line')(
    'Scenario: malformed ids and cross-references fail closed with a code and a line',
    async () => {
      const item = '# T\n\n1. One {% #one %}\n\n';
      expect(await failure(`${item}See {% xref to="tow" /%}.\n`)).toEqual({ code: 'XREF_UNKNOWN_ID', line: 5 });
      expect(await failure('# T\n\n## Defs {% #defs %}\n\nSee {% xref to="defs" /%}.\n')).toEqual({ code: 'XREF_TARGET_NOT_NUMBERED', line: 5 });
      expect(await failure('# T\n\n- One {% #one %}\n\nSee {% xref to="one" /%}.\n')).toEqual({ code: 'XREF_TARGET_NOT_NUMBERED', line: 5 });
      expect(await failure('# T\n\n1. One {% #one %}\n2. Two {% #one %}\n')).toEqual({ code: 'DUPLICATE_ID', line: 4 });
      expect(await failure('# T\n\n1. One {% #a_b %}\n')).toEqual({ code: 'INVALID_ID', line: 3 });
      expect(await failure('# T\n\nPara {% #p %}\n')).toEqual({ code: 'ID_PLACEMENT', line: 3 });
      expect(await failure(`${item}See {% xref to="one" number="relative" /%}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${item}See {% xref to="one" format="article" /%}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${item}See {% xref to="one" %}x{% /xref %}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${item}See {% xref /%}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${item}See {% xref to="One" /%}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${item}{% fill %}{% xref to="one" /%}{% /fill %}\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${item}{% literal %}{% xref to="one" /%}{% /literal %}\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });

      // The message names the missing id and where the reference is.
      const unknown = await createDocumentFromMarkdoc(`${item}See {% xref to="tow" /%}.\n`).then(() => undefined, (error: Error) => error.message);
      expect(unknown).toContain('{% #tow %}');
      expect(unknown).toContain('line 5');
    },
  );

  test.openspec('[SDX-MDOC-XREF-03] the round trip checks each cross-reference number against the source')(
    'Scenario: the round trip checks each cross-reference number against the source',
    async () => {
      const source = '# T\n\n1. One {% #one %}\n2. Two {% #two %}\n\nSee {% xref to="two" /%}.\n';
      expect((await createDocumentFromMarkdoc(source)).certificate.passed).toBe(true);
      // A lowering that points the field at the wrong item, and projects that consistently, passes the
      // read-back check (which compares with the lowering) but not the round trip (which reads the source).
      const retargeted = await verificationFailure(createDocumentFromMarkdoc(source, {
        transformLowering(lowering) {
          const paragraph = lowering.spec.sections[0]!.blocks.at(-1) as ParagraphSpec;
          paragraph.runs = paragraph.runs.map((run): InlineSpec => (run.kind === 'crossReference' ? { ...run, bookmark: 'one' } : run));
          lowering.projection.paragraphs[lowering.projection.paragraphs.length - 1] = 'See 1.';
          return lowering;
        },
      }));
      expect(retargeted.checks.readback.passed).toBe(true);
      expect(retargeted.checks.roundTrip.body.mismatches).toMatchObject([{ kind: 'changed', expected: 'See 2.', actual: 'See 1.' }]);
    },
  );

  test.openspec('[SDX-MDOC-XREF-04] the PDF checks expect the number as LibreOffice renders it')(
    'Scenario: the PDF checks expect the number as LibreOffice renders it',
    async () => {
      const word = projectSourceText(SOURCE);
      const libreOffice = projectSourceText(SOURCE, { reader: 'libreoffice' });
      expect(word.body.map((entry) => entry.text)).toContain('See 2(a)(i), clause (i) and Section 2.');
      expect(libreOffice.body.map((entry) => entry.text)).toContain('See 2.(a)(i), clause (i) and Section 2.');
      expect(word.footnotes).toEqual([{ id: 'note', paragraphs: ['Compare Section 2(a).'] }]);
      expect(libreOffice.footnotes).toEqual([{ id: 'note', paragraphs: ['Compare Section 2.(a).'] }]);
      // A target the source does not number projects no number, so the comparison cannot pass by accident.
      expect(projectSourceText('See {% xref to="nowhere" /%}.').body[0]!.text).toBe('See .');

      // The title and last-paragraph needles come from the read-back, with LibreOffice's form of the number
      // and the footnote number joined where the reference is.
      const created = await createDocumentFromMarkdoc(`${SOURCE.split('\n{% table %}')[0]}\n{% footnote id="note" %}A note.{% /footnote %}\n`);
      expect(requiredPdfText(created).at(-1)).toBe('See 2.(a)(i), clause (i) and Section 2.1');
    },
  );

  conforming.openspec('[SDX-MDOC-XREF-05] cross-references survive import and compile as their numbers')(
    'Scenario: cross-references survive import and compile as their numbers',
    async () => {
      const created = await createDocumentFromMarkdoc(SOURCE);
      const imported = await importDocxToMarkdoc(created.docx);
      expect(imported.markdoc).toContain('See 2(a)(i), clause (i) and Section 2.');
      const compiled = await compileMarkdoc(imported.anchoredSource, imported.markdoc, { annotationPresentation: { unspecified: { as: 'preserve' } } });
      const notes = await (await DocxDocument.load(compiled.tracked)).getFootnotes();
      expect(notes.map((note) => note.paragraphs.map((paragraph) => paragraph.text))).toEqual([[' Compare Section 2(a).']]);

      // A footnote may hold REF fields only: another field, a stray instruction or an unbalanced field fails closed.
      const footnoteXml = await (await JSZip.loadAsync(created.docx)).file('word/footnotes.xml')!.async('string');
      const rewritten = async (xml: string) => {
        const zip = await JSZip.loadAsync(created.docx);
        zip.file('word/footnotes.xml', xml);
        return importDocxToMarkdoc(await zip.generateAsync({ type: 'nodebuffer' })).then(
          () => 'imported',
          (error: { code?: string; details?: { reason?: string } }) => `${error.code}:${error.details?.reason}`,
        );
      };
      const instruction = '> REF deliveries \\w \\h </w:instrText>';
      expect(footnoteXml).toContain(instruction);
      expect(await rewritten(footnoteXml)).toBe('imported');
      expect(await rewritten(footnoteXml.replace(instruction, '> PAGE </w:instrText>'))).toBe('ANNOTATION_IMPORT_UNSUPPORTED:unsupported-field');
      expect(await rewritten(footnoteXml.replace(/<w:fldChar w:fldCharType="begin"\/>/u, ''))).toBe('ANNOTATION_IMPORT_UNSUPPORTED:unsupported-field');
      expect(await rewritten(footnoteXml.replace(/<w:fldChar w:fldCharType="end"\/>/u, ''))).toBe('ANNOTATION_IMPORT_UNSUPPORTED:unsupported-field');
    },
  );
});

const realTools = defaultPdfRenderTools();
const describeWithLibreOffice = realTools.resolve('soffice') && realTools.resolve('pdftotext') ? describe : describe.skip;

describeWithLibreOffice('Traceability: cross-references in a real LibreOffice PDF', () => {
  test.openspec('[SDX-MDOC-XREF-04] the PDF checks expect the number as LibreOffice renders it')(
    'Scenario: a real LibreOffice PDF of a document with cross-references passes the PDF checks',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-xref-'));
      try {
        const file = path.join(dir, 'agreement.mdoc');
        await writeFile(file, SOURCE);
        const result = await runCreateCommand([file, path.join(dir, 'out'), '--require-pdf']);
        expect(result.pdf).toMatchObject({ status: 'passed', words: { passed: true } });
        const certificate = JSON.parse(await readFile(path.join(dir, 'out', 'agreement.verification.json'), 'utf8')) as { pdf: { status: string } };
        expect(certificate.pdf.status).toBe('passed');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
