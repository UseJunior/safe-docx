import { describe, expect } from 'vitest';
import { getDirectChildrenByName } from '../primitives/dom-helpers.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { generateDocx } from './compile.js';
import { coverTermsTable } from './recipes.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-oa-recipe-borders-header';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

function ruledSpec(): DocumentSpec {
  return {
    meta: { title: 'Cover terms rule styling', createdIso: '2026-06-20T00:00:00Z' },
    sections: [
      {
        blocks: [
          coverTermsTable({
            borderMode: 'horizontal-rules',
            ruleColorHex: 'C7C7C7',
            ruleSizeEighthPt: 4,
            terms: [
              { label: 'Employer', value: 'Acme, Inc.' },
              { label: 'Governing Law', value: 'Wyoming' },
            ],
          }),
        ],
      },
    ],
  };
}

async function generatedDocumentXml(spec: DocumentSpec): Promise<string> {
  const buffer = await generateDocx(spec);
  const structural = await checkGeneratedPackage(buffer);
  expect(structural.issues).toEqual([]);
  const xml = await readZipText(buffer, 'word/document.xml');
  expect(xml, 'word/document.xml missing from package').not.toBeNull();
  return xml!;
}

function tblBorders(dom: Document): Element {
  const borders = dom.getElementsByTagName('w:tblBorders').item(0);
  expect(borders, 'w:tblBorders missing').toBeTruthy();
  return borders!;
}

function edge(borders: Element, name: string): Element {
  const el = getDirectChildrenByName(borders, name)[0];
  expect(el, `border edge ${name} missing`).toBeTruthy();
  return el!;
}

describe('Traceability: cover-terms rule color and weight', () => {
  test.openspec('[SDX-GEN-112] cover-terms rule color and weight')(
    'Scenario: cover-terms tables support an authored rule color and weight',
    async ({ given, when, then, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a horizontal-rules cover-terms table with a rule color and weight', async () => {
        spec = ruledSpec();
        expect(spec.sections[0]!.blocks[0]!.kind).toBe('table');
      });

      let dom!: Document;
      await when('the document is generated and parsed back', async () => {
        const xml = await generatedDocumentXml(spec);
        dom = parseXml(xml);
        await attachPrettyXml('word/document.xml', xml);
      });

      await then('the top, bottom, and inside-horizontal rules carry the authored color and weight', async () => {
        const borders = tblBorders(dom);
        for (const name of ['top', 'bottom', 'insideH']) {
          const e = edge(borders, name);
          expect(e.getAttribute('w:val')).toBe('single');
          expect(e.getAttribute('w:sz')).toBe('4');
          expect(e.getAttribute('w:color')).toBe('C7C7C7');
        }
      });

      await then('the left, right, and inside-vertical edges remain none', async () => {
        const borders = tblBorders(dom);
        for (const name of ['left', 'right', 'insideV']) {
          expect(edge(borders, name).getAttribute('w:val')).toBe('none');
        }
      });

      await then('omitting both options preserves the existing borders byte-for-byte', async () => {
        const xml = await generatedDocumentXml({
          sections: [{ blocks: [coverTermsTable({ borderMode: 'horizontal-rules', terms: [{ label: 'A', value: 'B' }] })] }],
        });
        const defaultDom = parseXml(xml);
        const top = edge(tblBorders(defaultDom), 'top');
        expect(top.getAttribute('w:val')).toBe('single');
        expect(top.getAttribute('w:sz')).toBe('4');
        expect(top.getAttribute('w:color')).toBe('auto');
      });
    },
  );
});
