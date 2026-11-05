import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { parseXml, type InlineSpec, type ParagraphSpec } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { compileMarkdoc } from '../compile.js';
import { importDocxToMarkdoc } from '../import.js';
import { defaultPdfRenderTools } from '../pdf/tools.js';
import { requiredPdfText, runCreateCommand } from './cli-create.js';
import { createDocumentFromMarkdoc, type CreationCertificate } from './create.js';
import { projectSourceText } from './oracle.js';

const TEST_FEATURE = 'add-text-cross-references';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1259 text cross-references in created documents',
  severity: 'critical',
});
const conforming = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' });

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Numbered Articles and Sections, a clause, a bullet and an unnumbered heading, referred to by their text. */
const SOURCE = [
  '---',
  'heading-numbers: legal',
  '---',
  '',
  '# ASSET PURCHASE AGREEMENT',
  '',
  '## Purchase and Sale {% #purchase-and-sale %}',
  '',
  '### Purchase Price Adjustment {% #price-adjustment %}',
  '',
  '1. the Buyer pays the *Adjustment* Amount {% #adjustment-payment %}',
  '2. the Seller delivers the statement',
  '',
  '### Escrow{% fnref id="escrow" /%} Release by {% fill %}Outside Date{% /fill %} {% #escrow-release %}',
  '',
  '- the escrow agent releases the funds {% #release-funds %}',
  '',
  '## Closing {% #closing %}',
  '',
  '### Closing Deliveries {% #deliveries %}',
  '',
  'The adjustment under {% xref to="price-adjustment" /%} ({% xref to="price-adjustment" /%}, {% xref to="price-adjustment" show="text" /%}) follows {% xref to="purchase-and-sale" show="text" /%}.',
  '',
  'See {% xref to="escrow-release" show="text" /%}, where {% xref to="release-funds" show="text" /%}, and {% xref to="adjustment-payment" /%}: {% xref to="adjustment-payment" show="text" /%}.',
  '',
  '{% table %}',
  '* Term',
  '* Where',
  '---',
  '* Deliveries',
  '* {% xref to="deliveries" show="text" /%} in {% xref to="closing" show="text" /%}',
  '{% /table %}',
  '',
  'Last: {% xref to="deliveries" /%}.{% fnref id="note" /%}',
  '',
  '{% footnote id="escrow" %}The escrow agent is named in Schedule 1.{% /footnote %}',
  '',
  '{% footnote id="note" %}Compare {% xref to="escrow-release" show="text" /%}.{% /footnote %}',
].join('\n');

function wChildren(parent: Element, localName: string): Element[] {
  return Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === W && (node as Element).localName === localName);
}

async function part(docx: Buffer, name: string): Promise<Document> {
  return parseXml(await (await JSZip.loadAsync(docx)).file(name)!.async('string'));
}

function instructions(document: Document): string[] {
  return Array.from(document.getElementsByTagNameNS(W, 'instrText')).map((node) => node.textContent ?? '');
}

/** Each REF field's result as `{flags}text` segments (b bold, i italic, h highlight), in document order. */
function formattedResults(document: Document): string[] {
  const out: string[] = [];
  for (const paragraph of Array.from(document.getElementsByTagNameNS(W, 'p'))) {
    let result: string | null = null;
    let last: string | null = null;
    for (const run of wChildren(paragraph, 'r')) {
      const type = wChildren(run, 'fldChar')[0]?.getAttributeNS(W, 'fldCharType');
      if (type === 'separate') { result = ''; last = null; continue; }
      if (type === 'end' && result !== null) { out.push(result); result = null; continue; }
      if (result === null) continue;
      const rPr = wChildren(run, 'rPr')[0];
      const flags = rPr ? `${wChildren(rPr, 'b').length ? 'b' : ''}${wChildren(rPr, 'i').length ? 'i' : ''}${wChildren(rPr, 'highlight').length ? 'h' : ''}` : '';
      if (flags !== last) { result += `{${flags}}`; last = flags; }
      result += wChildren(run, 't').map((t) => t.textContent).join('');
    }
  }
  return out;
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

describe('Traceability: text cross-references in created documents', () => {
  conforming.openspec('[SDX-MDOC-XREFTEXT-01] show="text" cross-references show the target text without its number or footnote marks')(
    'Scenario: show="text" cross-references show the target text without its number or footnote marks',
    async () => {
      const created = await createDocumentFromMarkdoc(SOURCE);
      expect(created.certificate.passed).toBe(true);
      expect(created.certificate.checks.roundTrip.passed).toBe(true);

      // A text reference reads as its target's text: no "ARTICLE I" or "Section 1.01", no list label, no
      // footnote mark; a fill keeps its brackets. Number references beside them are unchanged.
      expect(created.readback.paragraphs.slice(9, 11)).toEqual([
        'The adjustment under Section 1.01 (Section 1.01, Purchase Price Adjustment) follows Purchase and Sale.',
        'See Escrow Release by [Outside Date], where the escrow agent releases the funds, and Section 1.01(a): the Buyer pays the Adjustment Amount.',
      ]);
      expect(created.readback.paragraphs.slice(11, 15)).toEqual(['Term', 'Where', 'Deliveries', 'Closing Deliveries in Closing']);
      expect(created.readback.footnotes[1]).toEqual([' Compare Escrow Release by [Outside Date].']);

      // A text reference is REF with no number switch, the instruction Word's Insert > Cross-reference writes
      // for "Bookmark text".
      const document = await part(created.docx, 'word/document.xml');
      expect(instructions(document)).toEqual([
        ' REF price_adjustment \\w \\h ',
        ' REF price_adjustment \\w \\h ',
        ' REF price_adjustment \\h ',
        ' REF purchase_and_sale \\h ',
        ' REF escrow_release \\h ',
        ' REF release_funds \\h ',
        ' REF adjustment_payment \\w \\h ',
        ' REF adjustment_payment \\h ',
        ' REF deliveries \\h ',
        ' REF closing \\h ',
        ' REF deliveries \\w \\h ',
      ]);
      expect(instructions(await part(created.docx, 'word/footnotes.xml'))).toEqual([' REF escrow_release \\h ']);

      // The cached result is the target's runs with their own formatting, as Word writes it on update: the
      // italic word stays italic, the fill stays highlighted.
      expect(formattedResults(document)).toEqual([
        '{}Section 1.01',
        '{}Section 1.01',
        '{}Purchase Price Adjustment',
        '{}Purchase and Sale',
        '{}Escrow Release by {h}[Outside Date]',
        '{}the escrow agent releases the funds',
        '{}Section 1.01(a)',
        '{}the Buyer pays the {i}Adjustment{} Amount',
        '{}Closing Deliveries',
        '{}Closing',
        '{}Section 2.01',
      ]);

      // The check counts text references, compares what each bookmark encloses with the target's source text,
      // and its text-extent control (a bookmark one character short) is detected.
      expect(created.certificate.checks.crossReferences).toEqual({
        passed: true,
        references: { expected: 12, actual: 12, text: 8, relative: 0 },
        mismatches: [],
        negativeControls: { switchChanged: true, retargeted: true, moved: true, textExtent: true, relativeContext: 'not applicable' },
      });
      expect(created.readback.bookmarks?.find((bookmark) => bookmark.name === 'escrow_release')?.text).toBe('Escrow Release by [Outside Date]');
    },
  );

  test.openspec('[SDX-MDOC-XREFTEXT-02] malformed text cross-references fail closed with a code and a line')(
    'Scenario: malformed text cross-references fail closed with a code and a line',
    async () => {
      const heading = '# T\n\n## Price {% #price %}\n\n';
      // Any heading or list item may be a text target, numbered or not.
      expect((await createDocumentFromMarkdoc(`${heading}See {% xref to="price" show="text" /%}.\n`)).readback.paragraphs.at(-1)).toBe('See Price.');
      expect((await createDocumentFromMarkdoc('# T\n\n- Item {% #item %}\n\nSee {% xref to="item" show="text" /%}.\n')).readback.paragraphs.at(-1)).toBe('See Item.');
      // The number form still refuses an unnumbered target.
      expect(await failure(`${heading}See {% xref to="price" /%}.\n`)).toEqual({ code: 'XREF_TARGET_NOT_NUMBERED', line: 5 });

      expect(await failure(`${heading}See {% xref to="price" show="page" /%}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${heading}See {% xref to="price" show="text" number="full" /%}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${heading}See {% xref to="price" show="text" format="section" /%}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      // Word replaces a text reference's formatting with its target's when fields update.
      expect(await failure(`${heading}See *{% xref to="price" show="text" /%}*.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${heading}See **{% xref to="price" show="text" /%}**.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${heading}See {% u %}{% xref to="price" show="text" /%}{% /u %}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${heading}See {% xref to="prise" show="text" /%}.\n`)).toEqual({ code: 'XREF_UNKNOWN_ID', line: 5 });
      // A target holding a cross-reference or a line break is refused: Word's result for either is not measured.
      expect(await failure('# T\n\n1. One {% #one %}\n\n## Under {% xref to="one" /%} {% #under %}\n\nSee {% xref to="under" show="text" /%}.\n'))
        .toEqual({ code: 'XREF_TEXT_TARGET_UNSUPPORTED', line: 7 });
      expect(await failure('# T\n\n- Line one\\\n  line two {% #item %}\n\nSee {% xref to="item" show="text" /%}.\n'))
        .toEqual({ code: 'XREF_TEXT_TARGET_UNSUPPORTED', line: 6 });
      const message = await createDocumentFromMarkdoc('# T\n\n1. One {% #one %}\n\n## Under {% xref to="one" /%} {% #under %}\n\nSee {% xref to="under" show="text" /%}.\n')
        .then(() => '', (error: Error) => error.message);
      expect(message).toContain('line 5');
    },
  );

  test.openspec("[SDX-MDOC-XREFTEXT-03] verification checks each text cross-reference's instruction, target and bookmarked text")(
    "Scenario: verification checks each text cross-reference's instruction, target and bookmarked text",
    async () => {
      const source = '# T\n\n## Notices {% #notices %}\n\n## Governing Law {% #law %}\n\n## Notices {% #notices-again %}\n\nSee {% xref to="law" show="text" /%}.\n';
      expect((await createDocumentFromMarkdoc(source)).certificate.passed).toBe(true);
      const retarget = (bookmark: string, shown: string) => createDocumentFromMarkdoc(source, {
        transformLowering(lowering) {
          const paragraph = lowering.spec.sections[0]!.blocks.at(-1) as ParagraphSpec;
          paragraph.runs = paragraph.runs.map((run): InlineSpec => (run.kind === 'crossReference' ? { ...run, bookmark } : run));
          lowering.projection.paragraphs[lowering.projection.paragraphs.length - 1] = `See ${shown}.`;
          return lowering;
        },
      });
      // Pointing the field at another heading, projected consistently, passes the read-back check (which
      // compares with the lowering) but not the round trip, which reads the target's text from the source.
      const retargeted = await verificationFailure(retarget('notices', 'Notices'));
      expect(retargeted.checks.readback.passed).toBe(true);
      expect(retargeted.checks.roundTrip.body.mismatches).toMatchObject([{ kind: 'changed', expected: 'See Governing Law.', actual: 'See Notices.' }]);
      expect(retargeted.checks.crossReferences?.mismatches).toEqual([{ reference: 1, expected: ' REF law \\h ', actual: ' REF notices \\h ' }]);

      // A text reference that became a number reference keeps no text in common, and its instruction differs.
      const switched = await verificationFailure(createDocumentFromMarkdoc('---\nheading-numbers: legal\n---\n\n# T\n\n## Law {% #law %}\n\nSee {% xref to="law" show="text" /%}.\n', {
        transformLowering(lowering) {
          const paragraph = lowering.spec.sections[0]!.blocks.at(-1) as ParagraphSpec;
          paragraph.runs = paragraph.runs.map((run): InlineSpec => (run.kind === 'crossReference' ? { kind: 'crossReference', bookmark: run.bookmark } : run));
          return lowering;
        },
      }));
      expect(switched.checks.crossReferences?.mismatches).toEqual([{ reference: 1, expected: ' REF law \\h ', actual: ' REF law \\w \\h ' }]);

      // Two headings with the same text: pointing the field at the twin keeps every paragraph's text, so only
      // the instruction and the bookmark the field names tell them apart.
      const twins = '# T\n\n## Notices {% #notices %}\n\n## Notices {% #notices-again %}\n\nSee {% xref to="notices-again" show="text" /%}.\n';
      const twin = await verificationFailure(createDocumentFromMarkdoc(twins, {
        transformLowering(lowering) {
          const paragraph = lowering.spec.sections[0]!.blocks.at(-1) as ParagraphSpec;
          paragraph.runs = paragraph.runs.map((run): InlineSpec => (run.kind === 'crossReference' ? { ...run, bookmark: 'notices' } : run));
          return lowering;
        },
      }));
      expect(twin.checks.roundTrip.passed).toBe(true);
      expect(twin.checks.crossReferences?.mismatches).toEqual([{ reference: 1, expected: ' REF notices_again \\h ', actual: ' REF notices \\h ' }]);
      // With only same-text targets there is no other text to point at, so retargeted is not applicable;
      // the text-extent control still runs.
      expect((await createDocumentFromMarkdoc(twins)).certificate.checks.crossReferences?.negativeControls)
        .toEqual({ switchChanged: true, retargeted: 'not applicable', moved: true, textExtent: true, relativeContext: 'not applicable' });
    },
  );

  test.openspec('[SDX-MDOC-XREFTEXT-04] the CLI summary counts text cross-references')(
    'Scenario: the CLI summary counts text cross-references',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-xref-text-summary-'));
      const summary = async (name: string, source: string) => {
        const file = path.join(dir, `${name}.mdoc`);
        await writeFile(file, source);
        return (await runCreateCommand([file, path.join(dir, name), '--no-pdf'])).summary;
      };
      try {
        expect(await summary('mixed', SOURCE)).toContain('cross-references ok (12 references: 4 number, 8 text; negative controls ok)');
        // Number references alone read as before, without the text-extent control.
        expect(await summary('numbers', '1. Price {% #price %}\n2. Other {% #other %}\n\nSee {% xref to="price" /%}.\n'))
          .toContain('cross-references ok (1 reference; negative controls ok)');
        expect(await summary('text', '## Price {% #price %}\n\nSee {% xref to="price" show="text" /%}.\n'))
          .toContain('cross-references ok (1 reference: 0 number, 1 text; negative controls ok, except retargeted: not applicable)');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  test.openspec('[SDX-MDOC-XREFTEXT-05] text cross-references import as xref tags and the PDF checks expect the same text')(
    'Scenario: text cross-references import as xref tags and the PDF checks expect the same text',
    async () => {
      const created = await createDocumentFromMarkdoc(SOURCE);
      const imported = await importDocxToMarkdoc(created.docx);
      // Each text reference imports as an xref tag over its text (#1260), and compiles back to the same field.
      expect(imported.markdoc).toContain('{% xref to="price-adjustment" show="text" %}Purchase Price Adjustment{% /xref %}) follows&#32;{% xref to="purchase-and-sale" show="text" %}Purchase and Sale{% /xref %}.');
      expect(imported.markdoc).toContain('{% xref to="escrow-release" show="text" %}Escrow Release by \\[Outside Date\\]{% /xref %}');
      const compiled = await compileMarkdoc(imported.anchoredSource, imported.markdoc, { annotationPresentation: { unspecified: { as: 'preserve' } } });
      expect(compiled.certificate.passed).toBe(true);
      const instructionsOf = async (docx: Buffer) => {
        const zip = await JSZip.loadAsync(docx);
        const texts = await Promise.all(['word/document.xml', 'word/footnotes.xml'].map((name) => zip.file(name)!.async('string')));
        return texts.flatMap((xml) => [...xml.matchAll(/<w:instrText[^>]*>([^<]*)<\/w:instrText>/gu)].map((match) => match[1]));
      };
      expect(await instructionsOf(compiled.tracked)).toEqual(await instructionsOf(created.docx));
      // LibreOffice recalculates a REF field with no number switch to the bookmarked text, as Word does, so the
      // PDF projection expects the same text; only full-context numbers take LibreOffice's period.
      const libreOffice = projectSourceText(SOURCE, { reader: 'libreoffice' });
      const word = projectSourceText(SOURCE);
      expect(libreOffice.body.map((entry) => entry.text)).toEqual(word.body.map((entry) => entry.text));
      const needles = requiredPdfText({ ...created, readback: { ...created.readback, paragraphs: [...created.readback.paragraphs, '401(k) Plan'], crossReferences: [...created.readback.crossReferences!, { paragraph: created.readback.paragraphs.length, offset: 0, text: '401(k) Plan', instruction: ' REF plan \\h ' }] } });
      expect(needles).toContain('401(k) Plan');
    },
  );
});

const realTools = defaultPdfRenderTools();
const describeWithLibreOffice = realTools.resolve('soffice') && realTools.resolve('pdftotext') ? describe : describe.skip;

describeWithLibreOffice('Traceability: text cross-references in a real LibreOffice PDF', () => {
  test.openspec('[SDX-MDOC-XREFTEXT-06] a real LibreOffice PDF of text cross-references passes the PDF checks')(
    'Scenario: a real LibreOffice PDF of text cross-references passes the PDF checks',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-xref-text-'));
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
