import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { DocxDocument } from '../primitives/document.js';
import { getDirectChildrenByName } from '../primitives/dom-helpers.js';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { generateDocx } from './compile.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-paragraph-borders';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

function borderedHeaderSpec(): DocumentSpec {
  return {
    sections: [{
      headers: {
        default: {
          blocks: [{
            kind: 'paragraph',
            borders: { bottom: { style: 'single', sizeEighthPt: 8, colorHex: '2F75B5' } },
            runs: [{ kind: 'text', text: 'CONFIDENTIAL' }],
          }],
        },
      },
      blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'Body' }] }],
    }],
  };
}

async function readBottomBorder(buffer: Buffer): Promise<Element> {
  const headerXml = await readZipText(buffer, 'word/header1.xml');
  expect(headerXml).not.toBeNull();
  const header = parseXml(headerXml!);
  const paragraph = header.getElementsByTagName('w:p').item(0)!;
  const pPr = getDirectChildrenByName(paragraph, 'pPr')[0]!;
  const pBdr = getDirectChildrenByName(pPr, 'pBdr')[0]!;
  return getDirectChildrenByName(pBdr, 'bottom')[0]!;
}

describe('Paragraph border generation', () => {
  test
    .openspec('[SDX-GEN-044] a paragraph border survives document workflows')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.26' })(
    'Scenario: a paragraph border survives document workflows',
    async ({ given, when, then }: AllureBddContext) => {
      let generated!: Buffer;
      await given('a generated header containing a bottom-bordered paragraph', async () => {
        generated = await generateDocx(borderedHeaderSpec());
        expect((await checkGeneratedPackage(generated)).ok).toBe(true);
      });

      let saved!: Buffer;
      await when('the document is loaded and saved', async () => {
        const loaded = await DocxDocument.load(generated);
        saved = (await loaded.toBuffer()).buffer;
      });

      await then('the border remains present with the authored attributes', async () => {
        for (const buffer of [generated, saved]) {
          const bottom = await readBottomBorder(buffer);
          expect(bottom.getAttribute('w:val')).toBe('single');
          expect(bottom.getAttribute('w:sz')).toBe('8');
          expect(bottom.getAttribute('w:space')).toBe('0');
          expect(bottom.getAttribute('w:color')).toBe('2F75B5');
        }
      });
    },
  );
});
