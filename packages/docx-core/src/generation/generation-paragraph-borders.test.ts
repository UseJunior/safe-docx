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

/**
 * A body paragraph that exercises every supported edge plus the three default
 * behaviours: `left` omits size (→ w:sz="4"), `right` uses the `none` style
 * (→ w:sz="0"), and `between` omits color (→ w:color="auto"). Because the edge
 * lives in the body, its `w:pBdr` lands in `word/document.xml` — the only part
 * the emitted-document schema gate validates.
 */
function bodyAllEdgesSpec(): DocumentSpec {
  return {
    sections: [{
      blocks: [{
        kind: 'paragraph',
        borders: {
          top: { style: 'single', sizeEighthPt: 8, colorHex: '2F75B5' },
          left: { style: 'single', colorHex: '2F75B5' },
          bottom: { style: 'double', sizeEighthPt: 12, colorHex: 'FF0000' },
          right: { style: 'none' },
          between: { style: 'single', sizeEighthPt: 6 },
        },
        runs: [{ kind: 'text', text: 'Bordered body paragraph' }],
      }],
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

async function readBodyPBdr(buffer: Buffer): Promise<Element> {
  const documentXml = await readZipText(buffer, 'word/document.xml');
  expect(documentXml).not.toBeNull();
  const doc = parseXml(documentXml!);
  const paragraph = doc.getElementsByTagName('w:p').item(0)!;
  const pPr = getDirectChildrenByName(paragraph, 'pPr')[0]!;
  return getDirectChildrenByName(pPr, 'pBdr')[0]!;
}

describe('Paragraph border generation', () => {
  test
    .openspec('[SDX-GEN-044] a paragraph border survives document workflows')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.24' })(
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

  test
    .openspec('[SDX-GEN-045] all paragraph border edges emit in schema order with defaults')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.24' })(
    'Scenario: all paragraph border edges emit in schema order with defaults',
    async ({ given, when, then }: AllureBddContext) => {
      let pBdr!: Element;
      await given('a generated body paragraph declaring all supported edges', async () => {
        const generated = await generateDocx(bodyAllEdgesSpec());
        expect((await checkGeneratedPackage(generated)).ok).toBe(true);
        pBdr = await readBodyPBdr(generated);
      });

      await when('the emitted document.xml pBdr is inspected', () => {
        // no-op: reading happened in `given`; the schema-corpus capture validates
        // this document.xml when the suite runs under SDX_SCHEMA_CORPUS_DIR.
      });

      await then('the edges appear in CT_PBdr order with the default-derived attributes', () => {
        const edgeElements = Array.from(pBdr.children) as Element[];
        const edges = edgeElements.map((el) => el.localName ?? el.nodeName.replace(/^w:/, ''));
        expect(edges).toEqual(['top', 'left', 'bottom', 'right', 'between']);

        // left omits size → default w:sz="4"; omits nothing else it declares.
        const left = getDirectChildrenByName(pBdr, 'left')[0]!;
        expect(left.getAttribute('w:sz')).toBe('4');
        expect(left.getAttribute('w:color')).toBe('2F75B5');

        // right uses the `none` style → w:sz="0" and default w:color="auto".
        const right = getDirectChildrenByName(pBdr, 'right')[0]!;
        expect(right.getAttribute('w:val')).toBe('none');
        expect(right.getAttribute('w:sz')).toBe('0');
        expect(right.getAttribute('w:color')).toBe('auto');

        // between omits color → default w:color="auto"; every edge carries w:space="0".
        const between = getDirectChildrenByName(pBdr, 'between')[0]!;
        expect(between.getAttribute('w:sz')).toBe('6');
        expect(between.getAttribute('w:color')).toBe('auto');
        for (const edge of edgeElements) {
          expect(edge.getAttribute('w:space')).toBe('0');
        }
      });
    },
  );
});
