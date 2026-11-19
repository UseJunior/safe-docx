import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { parseXml } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { createDocumentFromMarkdoc, type CreationCertificate } from './create.js';
import type { CreationLowering } from './lower.js';
import { projectSourceText } from './oracle.js';
import { pullCreationEdits } from './pull.js';

const TEST_FEATURE = 'add-created-paragraph-keep';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1496 keep-with-next and keep-lines on paragraph layout',
  severity: 'critical',
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** A synthetic notices clause: a caption kept with its address, the address kept on one page, and a closing line before a signer. */
const NOTICES = [
  '---',
  'title: Notices',
  '---',
  '',
  'All notices under this Agreement must be in writing and delivered to the addresses below.',
  '',
  '{% paragraph-layout align="left" indent-left="0.5" keep-with-next=true %}If to the Buyer:{% /paragraph-layout %}',
  '',
  '{% paragraph-layout align="left" indent-left="1" keep-lines=true %}Example Corp\\',
  '1 Example Street\\',
  'Example City, ST 00000{% /paragraph-layout %}',
  '',
  '{% paragraph-layout keep-with-next=true %}The parties sign this Agreement below.{% /paragraph-layout %}',
  '',
  '{% signer name="Example Corp" /%}',
  '',
].join('\n');

/** Each body paragraph's text and the local names of its own w:pPr children, in document order, read through the DOM. */
async function paragraphProperties(docx: Buffer): Promise<Array<{ text: string; pPr: string[] }>> {
  const document = parseXml(await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string'));
  const body = document.getElementsByTagNameNS(W, 'body')[0]!;
  return Array.from(body.childNodes)
    .filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'p')
    .map((paragraph) => {
      const pPr = Array.from(paragraph.childNodes).find((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'pPr');
      return {
        text: Array.from(paragraph.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join(''),
        pPr: pPr ? Array.from(pPr.childNodes).filter((node): node is Element => node.nodeType === 1).map((node) => node.localName) : [],
      };
    });
}

function keeps(properties: Array<{ text: string; pPr: string[] }>, text: string): string[] {
  return properties.find((paragraph) => paragraph.text.startsWith(text))!.pPr.filter((name) => name === 'keepNext' || name === 'keepLines');
}

async function editDocument(docx: Buffer, change: (xml: string) => string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  zip.file('word/document.xml', change(await zip.file('word/document.xml')!.async('string')));
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('Traceability: keep-with-next and keep-lines on created paragraph layout', () => {
  test.openspec('[SDX-MDOC-PARAKEEP-01] keep flags are written once, in schema order, and verified')(
    'Scenario: keep flags are written once, in schema order, and verified',
    async () => {
      const created = await createDocumentFromMarkdoc(NOTICES);
      expect(created.certificate.passed).toBe(true);
      const properties = await paragraphProperties(created.docx);

      const caption = properties.find((paragraph) => paragraph.text === 'If to the Buyer:')!.pPr;
      expect(caption).toContain('keepNext');
      expect(caption.indexOf('keepNext')).toBeLessThan(caption.indexOf('ind'));
      expect(caption.indexOf('keepNext')).toBeLessThan(caption.indexOf('jc'));
      expect(keeps(properties, 'If to the Buyer:')).toEqual(['keepNext']);
      expect(keeps(properties, 'Example Corp1')).toEqual(['keepLines']);
      // The closing line is kept with the signer by create's own rule too: one w:keepNext, not two.
      expect(keeps(properties, 'The parties sign')).toEqual(['keepNext']);
      expect(keeps(properties, 'All notices')).toEqual([]);

      expect(created.certificate.checks.readback).toMatchObject({ passed: true, layouts: { negativeControlDetected: true } });
      expect(created.certificate.checks.roundTrip.paragraphLayout).toEqual({
        passed: true,
        paragraphs: { expected: 3, actual: 3 },
        mismatches: [],
        negativeControls: { changedLayout: true, droppedParagraph: true, movedLayout: true },
      });
      expect(projectSourceText(NOTICES).body.map((entry) => entry.layout ?? null).slice(0, 4)).toEqual([
        null, 'jc=left ind.left=720 keepNext', 'jc=left ind.left=1440 keepLines', 'keepNext',
      ]);

      // A paragraph create keeps by its own rule alone is not a laid-out paragraph to the round trip.
      const plain = await createDocumentFromMarkdoc('Closing line.\n\n{% signer name="Example Corp" /%}\n');
      expect(keeps(await paragraphProperties(plain.docx), 'Closing line.')).toEqual(['keepNext']);
      expect(plain.certificate.checks.roundTrip.paragraphLayout).toBeUndefined();
      expect(plain.certificate.passed).toBe(true);
    },
  );

  test.openspec('[SDX-MDOC-PARAKEEP-02] verification fails when an authored keep is lost')(
    'Scenario: verification fails when an authored keep is lost',
    async () => {
      const dropKeep = (lowering: CreationLowering): CreationLowering => {
        const spec = JSON.parse(JSON.stringify(lowering.spec));
        let done = false;
        const visit = (value: unknown): void => {
          if (done || !value || typeof value !== 'object') return;
          const record = value as Record<string, unknown>;
          const runs = record.runs as Array<{ text?: string }> | undefined;
          if (record.keepNext === true && runs?.some((run) => run.text === 'If to the Buyer:')) {
            delete record.keepNext;
            done = true;
            return;
          }
          for (const child of Object.values(record)) visit(child);
        };
        visit(spec);
        expect(done).toBe(true);
        return { ...lowering, spec };
      };
      const error = await createDocumentFromMarkdoc(NOTICES, { transformLowering: dropKeep }).then(() => undefined, (caught: { code?: string; details?: unknown }) => caught);
      expect(error?.code).toBe('CREATION_VERIFICATION_FAILED');
      const certificate = error!.details as CreationCertificate;
      expect(certificate.checks.readback.passed).toBe(false);
      expect(certificate.checks.readback.detail).toContain('keepNext');
      expect(certificate.checks.roundTrip.paragraphLayout?.passed).toBe(false);
      expect(JSON.stringify(certificate.checks.roundTrip.paragraphLayout?.mismatches)).toContain('If to the Buyer:');

      // A keepNext added where neither the source nor create's own rules call for one fails the round trip,
      // even when the lowering's projection agrees with it.
      const addKeep = (lowering: CreationLowering): CreationLowering => {
        const spec = JSON.parse(JSON.stringify(lowering.spec));
        let done = false;
        const visit = (value: unknown): void => {
          if (done || !value || typeof value !== 'object') return;
          const record = value as Record<string, unknown>;
          const runs = record.runs as Array<{ text?: string }> | undefined;
          if (runs?.some((run) => run.text?.startsWith('All notices'))) {
            record.keepNext = true;
            done = true;
            return;
          }
          for (const child of Object.values(record)) visit(child);
        };
        visit(spec);
        expect(done).toBe(true);
        const layouts = lowering.projection.layouts.map((layout, index) => (lowering.projection.paragraphs[index]!.startsWith('All notices') ? 'keepNext' : layout));
        return { ...lowering, spec, projection: { ...lowering.projection, layouts } };
      };
      // The oracle marks create's own keep only where create sets one: not across a section break, and on a
      // table of contents' first entry.
      const sectioned = projectSourceText('Alpha.\n\n{% section /%}\n\n{% legend %}New section.{% /legend %}\n').body;
      expect(sectioned.find((entry) => entry.text === 'Alpha.')?.generatedKeepNext).toBeUndefined();
      const contents = await createDocumentFromMarkdoc('{% toc /%}\n\n{% legend %}Signature page follows.{% /legend %}\n\n## A\n\nText.\n\n## B\n\nMore.\n');
      expect(contents.certificate.passed).toBe(true);

      const extra = await createDocumentFromMarkdoc(NOTICES, { transformLowering: addKeep }).then(() => undefined, (caught: { code?: string; details?: unknown }) => caught);
      expect(extra?.code).toBe('CREATION_VERIFICATION_FAILED');
      const extraCertificate = extra!.details as CreationCertificate;
      expect(extraCertificate.checks.readback.passed).toBe(true);
      expect(extraCertificate.checks.roundTrip.paragraphLayout?.passed).toBe(false);
      expect(JSON.stringify(extraCertificate.checks.roundTrip.paragraphLayout?.mismatches)).toContain('All notices');
    },
  );

  test.openspec('[SDX-MDOC-PARAKEEP-03] a keep flag with any value but true fails closed')(
    'Scenario: a keep flag with any value but true fails closed',
    async () => {
      for (const attribute of ['keep-with-next="true"', 'keep-with-next=false', 'keep-lines="yes"']) {
        const source = `{% paragraph-layout ${attribute} %}Text.{% /paragraph-layout %}\n`;
        const error = await createDocumentFromMarkdoc(source).then(() => undefined, (caught: { code?: string; message: string }) => caught);
        expect(error?.code, source).toBe('INVALID_PARAGRAPH_LAYOUT');
        expect(error?.message, source).toMatch(/must be true/u);
      }
      const alone = await createDocumentFromMarkdoc('{% paragraph-layout keep-lines=true %}Text.{% /paragraph-layout %}\n');
      expect(keeps(await paragraphProperties(alone.docx), 'Text.')).toEqual(['keepLines']);
    },
  );

  test.openspec('[SDX-MDOC-PARAKEEP-04] pull writes the keep flags back')(
    'Scenario: pull writes the keep flags back',
    async () => {
      for (const [source, expected] of [
        ['{% paragraph-layout keep-with-next=true %}Alpha.{% /paragraph-layout %}\n\nNext.\n', '{% paragraph-layout keep-with-next=true %}Gamma.{% /paragraph-layout %}\n\nNext.\n'],
        ['{% paragraph-layout align="left" indent-left="0.5" keep-with-next=true keep-lines=true %}Alpha.{% /paragraph-layout %}\n', '{% paragraph-layout align="left" indent-left="0.5" keep-with-next=true keep-lines=true %}Gamma.{% /paragraph-layout %}\n'],
      ] as const) {
        const one = await createDocumentFromMarkdoc(source);
        const retyped = await pullCreationEdits({ source, base: one, edited: await editDocument(one.docx, (xml) => xml.replace('Alpha.', 'Gamma.')) });
        expect(retyped, source).toMatchObject({ complete: true, diagnostics: [], pulledSource: expected });
        const again = await createDocumentFromMarkdoc(retyped.pulledSource!);
        expect(keeps(await paragraphProperties(again.docx), 'Gamma.')).toEqual(keeps(await paragraphProperties(one.docx), 'Alpha.'));
      }

      // A retyped paragraph before a signer keeps the keep-with-next create gives it, without gaining a flag.
      for (const closing of ['Intro.\n\nAlpha closing.\n\n{% signer name="Example Corp" /%}\n', 'Intro.\n\nAlpha closing.\n\n{% legend %}Signature page follows.{% /legend %}\n']) {
      const closed = await createDocumentFromMarkdoc(closing);
      const reclosed = await pullCreationEdits({ source: closing, base: closed, edited: await editDocument(closed.docx, (xml) => xml.replace('Alpha closing.', 'Gamma ending.')) });
      expect(reclosed).toMatchObject({ complete: true, diagnostics: [], pulledSource: closing.replace('Alpha closing.', 'Gamma ending.') });
      }

      const base = await createDocumentFromMarkdoc(NOTICES);
      const edited = await editDocument(base.docx, (xml) => xml.replace('If to the Buyer:', 'If to the Purchaser:'));
      const pulled = await pullCreationEdits({ source: NOTICES, base, edited });
      expect(pulled).toMatchObject({ complete: true, diagnostics: [] });
      expect(pulled.pulledSource).toBe(NOTICES.replace('If to the Buyer:', 'If to the Purchaser:'));
      const rebuilt = await createDocumentFromMarkdoc(pulled.pulledSource!);
      expect(rebuilt.certificate.passed).toBe(true);
      expect(keeps(await paragraphProperties(rebuilt.docx), 'If to the Purchaser:')).toEqual(['keepNext']);
    },
  );
});
