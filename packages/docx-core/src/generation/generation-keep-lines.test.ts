import { describe, expect } from 'vitest';
import { childElements, getDirectChildrenByName } from '../primitives/dom-helpers.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { generateDocx } from './compile.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-signature-and-keeplines';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

function specWithKeepLines(): DocumentSpec {
  return {
    meta: { title: 'Keep lines', createdIso: '2026-06-15T00:00:00Z' },
    styles: [
      {
        styleId: 'SignerBlock',
        name: 'Signer Block',
        type: 'paragraph',
        basedOn: 'Normal',
        paragraph: { keepLines: true },
      },
    ],
    sections: [
      {
        blocks: [
          // keepNext + keepLines together: lets us assert both emit and their order.
          { kind: 'paragraph', keepNext: true, keepLines: true, runs: [{ kind: 'text', text: 'Kept together' }] },
          // No keep* flags: must emit no w:keepLines.
          { kind: 'paragraph', runs: [{ kind: 'text', text: 'Free to break' }] },
        ],
      },
    ],
  };
}

async function generatePackage(spec: DocumentSpec): Promise<Buffer> {
  const buffer = await generateDocx(spec);
  const structural = await checkGeneratedPackage(buffer);
  expect(structural.issues).toEqual([]);
  return buffer;
}

describe('Traceability: paragraph keep-lines pagination', () => {
  test.openspec('[SDX-GEN-108] keepLines emits w:keepLines after w:keepNext and is absent when unset')(
    'Scenario: keepLines emits w:keepLines after w:keepNext and is absent when unset',
    async ({ given, when, then, attachPrettyJson, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a paragraph with keepLines + keepNext, a paragraph without, and a style carrying keepLines', async () => {
        spec = specWithKeepLines();
        await attachPrettyJson('spec', spec);
        expect(spec.sections[0]!.blocks[0]!.kind).toBe('paragraph');
      });

      let documentDom!: Document;
      let stylesDom!: Document;
      await when('the document is generated and parsed back', async () => {
        const buffer = await generatePackage(spec);
        const documentXml = (await readZipText(buffer, 'word/document.xml'))!;
        const stylesXml = (await readZipText(buffer, 'word/styles.xml'))!;
        await attachPrettyXml('word/document.xml', documentXml);
        await attachPrettyXml('word/styles.xml', stylesXml);
        documentDom = parseXml(documentXml);
        stylesDom = parseXml(stylesXml);
      });

      await then('the keep-together paragraph emits w:keepLines immediately after w:keepNext', async () => {
        const firstPPr = documentDom.getElementsByTagName('w:pPr').item(0)!;
        const order = childElements(firstPPr).map((el) => el.localName ?? el.nodeName.replace(/^w:/, ''));
        expect(order).toContain('keepNext');
        expect(order).toContain('keepLines');
        expect(order.indexOf('keepLines')).toBe(order.indexOf('keepNext') + 1);
      });

      await then('a paragraph without keepLines emits none', async () => {
        // Two body paragraphs: the second has no pPr at all (no formatting), so the doc carries exactly one keepLines.
        expect(documentDom.getElementsByTagName('w:keepLines')).toHaveLength(1);
      });

      await then('a paragraph style carrying keepLines also emits w:keepLines (shared emitter)', async () => {
        const styleEls = Array.from(stylesDom.getElementsByTagName('w:style'));
        const signer = styleEls.find((el) => el.getAttribute('w:styleId') === 'SignerBlock');
        expect(signer, 'SignerBlock style missing').toBeTruthy();
        const pPr = getDirectChildrenByName(signer!, 'pPr')[0];
        expect(pPr, 'style pPr missing').toBeTruthy();
        expect(getDirectChildrenByName(pPr!, 'keepLines')).toHaveLength(1);
      });
    },
  );
});
