import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { parseXml } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { defaultPdfRenderTools } from '../pdf/tools.js';
import { runCreateCommand } from './cli-create.js';
import { createDocumentFromMarkdoc } from './create.js';

const TEST_FEATURE = 'add-esign-anchors';

const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1607 e-signature field placement',
  severity: 'critical',
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const line = '______________________';
const markers = ['{{sig:Alice}}', '{{date:Alice}}'];
const signatureBlock = (anchors: boolean) => [
  '{% paragraph-layout keep-with-next=true %}',
  `Signature: ${anchors ? `{% esign-anchor %}${markers[0]}{% /esign-anchor %}` : ''}${line}`,
  '{% /paragraph-layout %}',
  '',
  `Date: ${anchors ? `{% esign-anchor %}${markers[1]}{% /esign-anchor %}` : ''}${line}`,
  '',
  '{% signer name="Alice" date="Date: ___" /%}',
].join('\n');

const tools = defaultPdfRenderTools();
const pdftotext = tools.resolve('pdftotext');
const pdftoppm = pdftotext && path.join(path.dirname(pdftotext), 'pdftoppm');
const pdfToolsAvailable = tools.resolve('soffice') && pdftoppm && existsSync(pdftoppm);

async function pdfWords(pdf: string, raw = false) {
  const result = await tools.run(pdftotext!, [...(raw ? ['-raw'] : []), '-bbox', pdf, '-']);
  expect(result.code, result.stderr).toBe(0);
  return [...result.stdout.matchAll(/<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([^<]+)<\/word>/gu)]
    .map(([, xMin, yMin, xMax, yMax, text]) => ({ xMin: Number(xMin), yMin: Number(yMin), xMax: Number(xMax), yMax: Number(yMax), text }));
}

describe('E-signature anchors in created documents', () => {
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.2.43' })(
    'emits a dedicated white, condensed one-point run and preserves keep-with-next and the signer block',
    async () => {
      const created = await createDocumentFromMarkdoc(signatureBlock(true));
      const baseline = await createDocumentFromMarkdoc(signatureBlock(false));
      const paragraphs = async (docx: Buffer) => {
        const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
        return Array.from(parseXml(xml).getElementsByTagNameNS(W, 'p'));
      };
      const [actual, control] = await Promise.all([paragraphs(created.docx), paragraphs(baseline.docx)]);
      expect(created.certificate.passed).toBe(true);
      expect(actual).toHaveLength(control.length);
      expect(actual[0]!.getElementsByTagNameNS(W, 'keepNext')).toHaveLength(1);
      expect(actual.slice(2).map(String)).toEqual(control.slice(2).map(String));
      for (const [index, marker] of markers.entries()) {
        const runs = Array.from(actual[index]!.getElementsByTagNameNS(W, 'r'));
        expect(runs.map((run) => run.textContent)).toEqual([index === 0 ? 'Signature: ' : 'Date: ', marker, line]);
        const property = (name: string) => runs[1]!.getElementsByTagNameNS(W, name).item(0)?.getAttributeNS(W, 'val');
        expect(property('color')).toBe('FFFFFF');
        expect(property('sz')).toBe('2');
        expect(property('w')).toBe('20');
        expect(runs[1]!.getElementsByTagNameNS(W, 'vanish')).toHaveLength(0);
      }
    },
  );

  test('rejects empty, nested and formatted markers', async () => {
    for (const source of [
      'Sign {% esign-anchor /%} here',
      'Sign {% esign-anchor %}two words{% /esign-anchor %} here',
      'Sign {% esign-anchor %}**bold**{% /esign-anchor %} here',
      'Sign {% fill %}{% esign-anchor %}{{sig:Alice}}{% /esign-anchor %}{% /fill %} here',
      'Sign {% u %}{% esign-anchor %}{{sig:Alice}}{% /esign-anchor %}{% /u %} here',
    ]) {
      await expect(createDocumentFromMarkdoc(source)).rejects.toMatchObject({ code: 'INVALID_ESIGN_ANCHOR' });
    }
    await expect(createDocumentFromMarkdoc('Sign {% esign-anchor color="000000" %}SIG{% /esign-anchor %}')).rejects
      .toMatchObject({ code: 'UNSUPPORTED_CREATION_ATTRIBUTE' });
  });

  (pdfToolsAvailable ? describe : describe.skip)('LibreOffice and Poppler', () => {
    test.openspec('[SDX-MDOC-ESIGN-01] a signature marker survives PDF conversion')(
      'Scenario: a signature marker survives PDF conversion',
      async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-esign-'));
        try {
          const build = async (name: string, anchors: boolean) => {
            const source = path.join(dir, `${name}.mdoc`);
            await writeFile(source, signatureBlock(anchors));
            const result = await runCreateCommand([source, path.join(dir, 'out'), '--require-pdf']);
            expect(result.pdf).toMatchObject({ status: 'passed' });
            return result.outputs.pdf!;
          };
          const anchored = await build('anchored', true);
          const control = await build('control', false);
          const rawText = await tools.run(pdftotext!, ['-raw', anchored, '-']);
          expect(rawText.code, rawText.stderr).toBe(0);
          const [words, controlWords, rawWords] = await Promise.all([
            pdfWords(anchored), pdfWords(control), pdfWords(anchored, true),
          ]);
          const lines = words.filter((word) => word.text === line);
          const controlLines = controlWords.filter((word) => word.text === line);
          expect(lines).toHaveLength(2);
          expect(controlLines).toHaveLength(2);
          for (const [index, marker] of markers.entries()) {
            expect(rawText.stdout).toContain(marker);
            const signatureLine = lines[index]!;
            const unmarkedLine = controlLines[index]!;
            // Raw bounding boxes keep glyphs Poppler's layout mode may collapse at small sizes.
            const start = rawWords.find((word) => word.text.startsWith('{')
              && word.yMin > signatureLine.yMin && word.yMax < signatureLine.yMax);
            expect(start).toBeDefined();
            expect(Math.abs(start!.xMin - unmarkedLine.xMin)).toBeLessThan(0.25);
            expect(signatureLine.xMin - start!.xMin).toBeLessThan(2);
            expect(signatureLine.yMin).toBe(unmarkedLine.yMin);
            expect(signatureLine.xMax - signatureLine.xMin).toBeCloseTo(unmarkedLine.xMax - unmarkedLine.xMin);

            // Sample the actual rendered marker area at 720 dpi, ending before the black line.
            const prefix = path.join(dir, `marker-${index}`);
            const x = Math.ceil(start!.xMin * 10);
            const y = Math.floor(start!.yMin * 10);
            const width = Math.floor(signatureLine.xMin * 10) - x;
            const height = Math.ceil(start!.yMax * 10) - y;
            expect(width).toBeGreaterThan(0);
            const raster = await tools.run(pdftoppm!, [
              '-f', '1', '-l', '1', '-r', '720', '-gray', '-singlefile',
              '-x', String(x), '-y', String(y), '-W', String(width), '-H', String(height), anchored, prefix,
            ]);
            expect(raster.code, raster.stderr).toBe(0);
            const pgm = await readFile(`${prefix}.pgm`);
            const header = Buffer.from(`P5\n${width} ${height}\n255\n`);
            expect(pgm.subarray(0, header.length)).toEqual(header);
            expect(pgm.subarray(header.length)).toEqual(Buffer.alloc(width * height, 255));
          }
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
      60_000,
    );
  });
});
