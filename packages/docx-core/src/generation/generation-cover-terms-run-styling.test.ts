import { describe, expect } from 'vitest';
import { getDirectChildrenByName } from '../primitives/dom-helpers.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { generateDocx } from './compile.js';
import { coverTermsTable } from './recipes.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-oa-recipe-styling';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

function styledSpec(): DocumentSpec {
  return {
    meta: { title: 'Cover terms run styling', createdIso: '2026-06-18T00:00:00Z' },
    sections: [
      {
        blocks: [
          coverTermsTable({
            borderMode: 'horizontal-rules',
            fontFamily: 'Arial',
            sizePt: 11,
            subrowSizePt: 10,
            textColorHex: '1D2021',
            subrowColorHex: '494A4B',
            fillableHighlight: 'yellow',
            cellMarginsTwips: { top: 60, right: 0, bottom: 60, left: 115 },
            subrowLabelIndentTwips: 230,
            terms: [
              { label: 'Employer', value: '[Legal name of the employer]', fillable: true },
              { label: 'Governing Law', value: 'Wyoming' },
              { group: 'Confidentiality' },
              { label: 'Trade Secrets Duration', value: 'Perpetual', subrow: true },
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

function rows(dom: Document): Element[] {
  return Array.from(dom.getElementsByTagName('w:tr'));
}

function firstRunProps(cell: Element): Element {
  const run = cell.getElementsByTagName('w:r').item(0);
  expect(run, 'cell has no run').toBeTruthy();
  const rPr = run!.getElementsByTagName('w:rPr').item(0);
  expect(rPr, 'run has no rPr').toBeTruthy();
  return rPr!;
}

describe('Traceability: cover-terms run styling and fillable values', () => {
  test.openspec('[SDX-GEN-110] cover-terms run styling and fillable values')(
    'Scenario: cover-terms tables support run styling and fillable placeholders',
    async ({ given, when, then, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a cover-terms table with font, size, color, non-uniform margins, and a fillable value', async () => {
        spec = styledSpec();
        const table = spec.sections[0]!.blocks[0]!;
        expect(table.kind).toBe('table');
      });

      let dom!: Document;
      await when('the document is generated and parsed back', async () => {
        const xml = await generatedDocumentXml(spec);
        dom = parseXml(xml);
        await attachPrettyXml('word/document.xml', xml);
      });

      await then('styled cells emit the authored font, size, and color on their runs', async () => {
        // rows: [Employer, Governing Law, Confidentiality(group), Trade Secrets(subrow)]
        const valueCell = getDirectChildrenByName(rows(dom)[1]!, 'tc')[1]!; // Governing Law value
        const rPr = firstRunProps(valueCell);
        expect(rPr.getElementsByTagName('w:rFonts').item(0)!.getAttribute('w:ascii')).toBe('Arial');
        expect(rPr.getElementsByTagName('w:sz').item(0)!.getAttribute('w:val')).toBe('22'); // 11pt
        expect(rPr.getElementsByTagName('w:color').item(0)!.getAttribute('w:val')).toBe('1D2021');
      });

      await then('the fillable value run emits a yellow highlight and bold', async () => {
        const valueCell = getDirectChildrenByName(rows(dom)[0]!, 'tc')[1]!; // [Legal name...] fillable
        const rPr = firstRunProps(valueCell);
        expect(rPr.getElementsByTagName('w:highlight').item(0)!.getAttribute('w:val')).toBe('yellow');
        expect(rPr.getElementsByTagName('w:b')).toHaveLength(1);
      });

      await then('non-uniform cell margins appear, with the subrow indent added to the left', async () => {
        const valueCell = getDirectChildrenByName(rows(dom)[1]!, 'tc')[1]!;
        const margins = valueCell.getElementsByTagName('w:tcMar').item(0)!;
        expect(getDirectChildrenByName(margins, 'top')[0]!.getAttribute('w:w')).toBe('60');
        expect(getDirectChildrenByName(margins, 'left')[0]!.getAttribute('w:w')).toBe('115');

        const subrowLabelCell = getDirectChildrenByName(rows(dom)[3]!, 'tc')[0]!;
        const subMargins = subrowLabelCell.getElementsByTagName('w:tcMar').item(0)!;
        expect(getDirectChildrenByName(subMargins, 'left')[0]!.getAttribute('w:w')).toBe('345'); // 115 + 230
      });

      await then('omitting every new option preserves the existing cover-terms output', async () => {
        const xml = await generatedDocumentXml({
          sections: [{ blocks: [coverTermsTable({ terms: [{ label: 'Effective Date', value: 'June 14, 2026' }] })] }],
        });
        const defaultDom = parseXml(xml);
        // The unstyled recipe emits no run font, size, highlight, or cell margins.
        expect(defaultDom.getElementsByTagName('w:rFonts')).toHaveLength(0);
        expect(defaultDom.getElementsByTagName('w:sz')).toHaveLength(0);
        expect(defaultDom.getElementsByTagName('w:highlight')).toHaveLength(0);
        expect(defaultDom.getElementsByTagName('w:tcMar')).toHaveLength(0);
      });
    },
  );
});
