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
import { controlsSummary, requiredPdfText, runCreateCommand } from './cli-create.js';
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
        { paragraph: 2, offset: 48, text: '2(b)', instruction: ' REF price_adjustment \\w \\h ' },
        { paragraph: 8, offset: 4, text: '2(a)(i)', instruction: ' REF escrow_release \\w \\h ' },
        { paragraph: 8, offset: 20, text: '(i)', instruction: ' REF escrow_release \\n \\h ' },
        { paragraph: 8, offset: 36, text: '2', instruction: ' REF closing \\w \\h ' },
        { paragraph: 10, offset: 22, text: '2(a)(i)', instruction: ' REF escrow_release \\w \\h ' },
      ]);
      expect(created.readback.footnoteCrossReferences).toEqual([{ note: 1, paragraph: 0, offset: 17, text: '2(a)', instruction: ' REF deliveries \\w \\h ' }]);
      // Each field points at the bookmark on the item its xref names.
      expect(created.certificate.checks.crossReferences).toEqual({
        passed: true,
        references: { expected: 6, actual: 6, text: 0, relative: 0 },
        mismatches: [],
        negativeControls: { switchChanged: true, retargeted: true, moved: true, textExtent: 'not applicable', relativeContext: 'not applicable' },
      });
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

      // A source without ids or xrefs has no bookmarks, no cross-reference sites and no cross-reference check.
      const plain = await createDocumentFromMarkdoc('# T\n\n1. One\n2. Two\n');
      expect((await part(plain.docx, 'word/document.xml')).getElementsByTagNameNS(W, 'bookmarkStart')).toHaveLength(0);
      expect(plain.readback.crossReferences).toBeUndefined();
      expect(plain.certificate.checks.crossReferences).toBeUndefined();

      // Letters past z repeat, as Word numbers them: the 28th nested item is (bb).
      const long = ['# T', '', '1. Parent', ...Array.from({ length: 28 }, (_, index) => `   1. Item ${index + 1}${index === 27 ? ' {% #last %}' : ''}`), '', 'See {% xref to="last" /%} and {% xref to="last" number="paragraph" /%}.', ''].join('\n');
      expect((await createDocumentFromMarkdoc(long)).readback.paragraphs.at(-1)).toBe('See 1(bb) and (bb).');
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
      expect(await failure(`${item}See {% xref to="one" number="page" /%}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${item}See {% xref to="one" format="article" /%}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${item}See {% xref to="one" %}x{% /xref %}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${item}See {% xref /%}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${item}See {% xref to="One" /%}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${item}{% fill %}{% xref to="one" /%}{% /fill %}\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${item}{% literal %}{% xref to="one" /%}{% /literal %}\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });

      // XML cannot hold C0 control characters (the verification walker also uses some as stand-ins).
      expect(await failure('# T\n\nHello\u0004world.\n')).toEqual({ code: 'INVALID_CHARACTER', line: 3 });
      expect(await failure('# T\n\n1. One {% #one %}\n\nSee \u0004one|full\u0005 1\u0006.\n')).toEqual({ code: 'INVALID_CHARACTER', line: 5 });

      // The message names the missing id and where the reference is.
      const unknown = await createDocumentFromMarkdoc(`${item}See {% xref to="tow" /%}.\n`).then(() => undefined, (error: Error) => error.message);
      expect(unknown).toContain('{% #tow %}');
      expect(unknown).toContain('line 5');
    },
  );

  test.openspec("[SDX-MDOC-XREF-03] verification checks each cross-reference's number and destination against the source")(
    "Scenario: verification checks each cross-reference's number and destination against the source",
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
      expect(retargeted.checks.crossReferences?.mismatches).toEqual([{ reference: 1, expected: ' REF two \\w \\h ', actual: ' REF one \\w \\h ' }]);

      // Two separate lists each number their item 1, so pointing the field at the other one keeps its text:
      // the read-back and the round trip pass, and the cross-reference check, which reads where the field
      // points, fails.
      const twins = '# T\n\n1. Alpha {% #alpha %}\n\nBetween.\n\n1. Beta {% #beta %}\n\nSee {% xref to="beta" /%}.\n';
      expect((await createDocumentFromMarkdoc(twins)).certificate.passed).toBe(true);
      const sameNumber = await verificationFailure(createDocumentFromMarkdoc(twins, {
        transformLowering(lowering) {
          const paragraph = lowering.spec.sections[0]!.blocks.at(-1) as ParagraphSpec;
          paragraph.runs = paragraph.runs.map((run): InlineSpec => (run.kind === 'crossReference' ? { ...run, bookmark: 'alpha' } : run));
          return lowering;
        },
      }));
      expect(sameNumber.checks.readback.passed).toBe(true);
      expect(sameNumber.checks.roundTrip.passed).toBe(true);
      expect(sameNumber.checks.crossReferences?.mismatches).toEqual([{ reference: 1, expected: ' REF beta \\w \\h ', actual: ' REF alpha \\w \\h ' }]);

      // A top-level item shows "1" in both number forms, so changing the switch keeps its text too.
      const switched = await verificationFailure(createDocumentFromMarkdoc(twins, {
        transformLowering(lowering) {
          const paragraph = lowering.spec.sections[0]!.blocks.at(-1) as ParagraphSpec;
          paragraph.runs = paragraph.runs.map((run): InlineSpec => (run.kind === 'crossReference' ? { ...run, number: 'paragraph' } : run));
          return lowering;
        },
      }));
      expect(switched.checks.roundTrip.passed).toBe(true);
      expect(switched.checks.crossReferences?.mismatches).toEqual([{ reference: 1, expected: ' REF beta \\w \\h ', actual: ' REF beta \\n \\h ' }]);

      // A bookmark moved to another paragraph fails even though every field instruction is right.
      const moved = await verificationFailure(createDocumentFromMarkdoc(twins, {
        transformLowering(lowering) {
          const blocks = lowering.spec.sections[0]!.blocks as ParagraphSpec[];
          const beta = blocks.find((block) => block.bookmark === 'beta')!;
          delete beta.bookmark;
          blocks.find((block) => block.bookmark === 'alpha')!.bookmark = 'beta';
          return lowering;
        },
      }));
      expect(moved.checks.crossReferences?.mismatches).toEqual([{ reference: 1, expected: 'bookmark on "Beta"', actual: 'bookmark on "Alpha"' }]);

      // A field moved onto an equal literal number keeps every paragraph's text, its instruction and its
      // target: only where it sits differs.
      const literal = '# T\n\n1. Target {% #target %}\n\nLiteral 1.\n\nSee {% xref to="target" /%}.\n';
      expect((await createDocumentFromMarkdoc(literal)).certificate.passed).toBe(true);
      const relocated = await verificationFailure(createDocumentFromMarkdoc(literal, {
        transformLowering(lowering) {
          const blocks = lowering.spec.sections[0]!.blocks as ParagraphSpec[];
          const [literalParagraph, see] = blocks.slice(-2) as [ParagraphSpec, ParagraphSpec];
          const field = see.runs.find((run) => run.kind === 'crossReference')!;
          see.runs = [{ kind: 'text', text: 'See 1.' }];
          literalParagraph.runs = [{ kind: 'text', text: 'Literal ' }, field, { kind: 'text', text: '.' }];
          return lowering;
        },
      }));
      expect(relocated.checks.readback.passed).toBe(true);
      expect(relocated.checks.roundTrip.passed).toBe(true);
      expect(relocated.checks.crossReferences?.mismatches).toEqual([{ reference: 1, expected: 'body paragraph 4: See‸.', actual: 'body paragraph 3: Literal‸.' }]);

      // Every xref tag in the source's syntax tree is counted, whether or not the text walker reaches it, so a
      // tag the walker skipped would fail the build. A tag after a signer's name, the one shape that used to
      // be skipped (the signature block renders only the name's line), is now refused before anything is built.
      expect((await createDocumentFromMarkdoc(SOURCE)).certificate.checks.crossReferences?.references).toEqual({ expected: 6, actual: 6, text: 0, relative: 0 });
      expect(await failure('# T\n\n1. One {% #one %}\n2. Two {% #two %}\n\n{% signer %}\nSee  \n{% xref to="two" /%}\n{% /signer %}\n')).toEqual({ code: 'INVALID_SIGNER', line: 8 });

      // A target that holds a footnote reference compares by its text without the note.
      const noted = await createDocumentFromMarkdoc('# T\n\n1. One{% fnref id="n" /%} {% #one %}\n\nSee {% xref to="one" /%}.\n\n{% footnote id="n" %}A note.{% /footnote %}\n');
      expect(noted.certificate.checks.crossReferences?.passed).toBe(true);
      expect(noted.readback.footnotes).toEqual([[' A note.']]);
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

  conforming.openspec('[SDX-MDOC-XREF-05] cross-references survive import and compile as REF fields')(
    'Scenario: cross-references survive import and compile as REF fields',
    async () => {
      const created = await createDocumentFromMarkdoc(SOURCE);
      const imported = await importDocxToMarkdoc(created.docx);
      // Each reference imports as an xref tag over its number text (#1260); format="section" stays literal text.
      expect(imported.markdoc).toContain('See&#32;{% xref to="escrow-release" %}2(a)(i){% /xref %}, clause&#32;{% xref to="escrow-release" number="paragraph" %}(i){% /xref %}&#32;and Section&#32;{% xref to="closing" %}2{% /xref %}.');
      expect(imported.markdoc).toContain('{% annotation-run size=20 %}Compare Section&#32;{% /annotation-run %}{% xref to="deliveries" %}{% annotation-run size=20 %}2(a){% /annotation-run %}{% /xref %}');
      const compiled = await compileMarkdoc(imported.anchoredSource, imported.markdoc, { annotationPresentation: { unspecified: { as: 'preserve' } } });
      const notes = await (await DocxDocument.load(compiled.tracked)).getFootnotes();
      expect(notes.map((note) => note.paragraphs.map((paragraph) => paragraph.text))).toEqual([[' Compare Section 2(a).']]);
      // The footnote, which compile writes again, keeps its REF field, and the body keeps every field.
      expect(instructions(await part(compiled.tracked, 'word/footnotes.xml'))).toEqual([' REF deliveries \\w \\h ']);
      expect(instructions(await part(compiled.tracked, 'word/document.xml'))).toEqual(instructions(await part(created.docx, 'word/document.xml')));

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
      // Instruction text in a field's result is ordinary text to Word, which import would drop; a second
      // separator is malformed. Both are refused rather than imported with text missing.
      const separator = '<w:fldChar w:fldCharType="separate"/></w:r>';
      expect(footnoteXml).toContain(separator);
      expect(await rewritten(footnoteXml.replace(separator, `${separator}<w:r><w:instrText>IMPORTANT</w:instrText></w:r>`))).toBe('ANNOTATION_IMPORT_UNSUPPORTED:unsupported-field');
      expect(await rewritten(footnoteXml.replace(separator, `${separator}<w:r>${separator}`))).toBe('ANNOTATION_IMPORT_UNSUPPORTED:unsupported-field');
    },
  );

  test.openspec('[SDX-MDOC-XREF-06] the CLI summary reports the cross-reference check')(
    'Scenario: the CLI summary reports the cross-reference check',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-xref-summary-'));
      const summary = async (name: string, source: string) => {
        const file = path.join(dir, `${name}.mdoc`);
        await writeFile(file, source);
        return (await runCreateCommand([file, path.join(dir, name), '--no-pdf'])).summary;
      };
      try {
        const full = await summary('full', SOURCE);
        expect(full).toContain('cross-references ok (6 references; negative controls ok)');
        // The entry follows the footnotes entry.
        expect(full.indexOf('cross-references ok')).toBeGreaterThan(full.indexOf('footnotes ok'));
        // With one target there is no other item to point a reference at: that control is not applicable, and
        // the summary says so rather than counting it as ok.
        const single = await summary('single', '1. Price {% #price %}\n\nSee {% xref to="price" format="section" /%}.\n');
        expect(single).toContain('cross-references ok (1 reference; negative controls ok, except retargeted: not applicable)');
        expect(await summary('none', 'No references.\n')).not.toContain('cross-references');
        // A control that went undetected is named as failed, never counted as ok.
        expect(controlsSummary({ a: true, b: false })).toBe('negative controls ok, except b: failed');
        expect(controlsSummary({ a: true, b: false, c: 'not applicable' })).toBe('negative controls ok, except b: failed, c: not applicable');
        expect(controlsSummary({ a: false })).toBe('negative control failed');
        expect(controlsSummary({ a: false, b: 'not applicable' })).toBe('negative controls: a: failed, b: not applicable');
        expect(controlsSummary({ a: 'not applicable', b: 'not applicable' })).toBe('negative controls not applicable');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
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
    60_000,
  );
});
