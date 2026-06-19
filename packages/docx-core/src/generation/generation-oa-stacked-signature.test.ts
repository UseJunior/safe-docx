import { describe, expect } from 'vitest';
import { getDirectChildrenByName } from '../primitives/dom-helpers.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { generateDocx } from './compile.js';
import { signatureBlock } from './recipes.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-oa-recipe-styling';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

function oaSignatureSpec(): DocumentSpec {
  return {
    meta: { title: 'OA stacked-ruled signatures', createdIso: '2026-06-18T00:00:00Z' },
    sections: [
      {
        blocks: signatureBlock({
          layout: 'oa-stacked-ruled',
          fontFamily: 'Arial',
          headerColorHex: '8C8D8E',
          ruledRowHeightTwips: 620,
          fillable: true,
          parties: [
            { party: 'Employer', name: '[Legal name of the employer]', title: '[Signatory title]' },
            { party: 'Employee', name: '[Full legal name of the employee]' },
          ],
        }),
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

describe('Traceability: signature block oa-stacked-ruled layout', () => {
  test.openspec('[SDX-GEN-111] signature block oa-stacked-ruled layout')(
    'Scenario: signature blocks support the oa-stacked-ruled layout',
    async ({ given, when, then, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('two parties authored with oa-stacked-ruled layout, a row height, and fillable print names', async () => {
        spec = oaSignatureSpec();
        // Per party: one header paragraph + one table => 2 blocks each, 4 total.
        expect(spec.sections[0]!.blocks).toHaveLength(4);
      });

      let dom!: Document;
      await when('the document is generated and parsed back', async () => {
        const xml = await generatedDocumentXml(spec);
        dom = parseXml(xml);
        await attachPrettyXml('word/document.xml', xml);
      });

      await then('each party renders a centered uppercase header in the muted color', async () => {
        const paragraphs = Array.from(dom.getElementsByTagName('w:p'));
        const headers = paragraphs.filter((p) => {
          const caps = p.getElementsByTagName('w:caps');
          return caps.length > 0;
        });
        expect(headers.length).toBe(2);
        const firstHeaderJc = headers[0]!.getElementsByTagName('w:jc').item(0);
        expect(firstHeaderJc!.getAttribute('w:val')).toBe('center');
        expect(headers[0]!.getElementsByTagName('w:color').item(0)!.getAttribute('w:val')).toBe('8C8D8E');
      });

      await then('each field row carries the row height and a bold label cell over a bottom-ruled line cell', async () => {
        const firstTable = dom.getElementsByTagName('w:tbl').item(0)!;
        const trs = getDirectChildrenByName(firstTable, 'tr');
        expect(trs).toHaveLength(4); // Signature / Print Name / Title / Date
        for (const tr of trs) {
          const trHeight = tr.getElementsByTagName('w:trHeight').item(0)!;
          expect(trHeight.getAttribute('w:val')).toBe('620');
          expect(trHeight.getAttribute('w:hRule')).toBe('atLeast');
          const cells = getDirectChildrenByName(tr, 'tc');
          // Label cell run is bold.
          expect(cells[0]!.getElementsByTagName('w:b').length).toBeGreaterThan(0);
          // Ruled cell carries a bottom border.
          const tcBorders = cells[1]!.getElementsByTagName('w:tcBorders').item(0)!;
          expect(getDirectChildrenByName(tcBorders, 'bottom')[0]!.getAttribute('w:val')).toBe('single');
        }
      });

      await then('a fillable print name emits a highlight and bold on its value run', async () => {
        const firstTable = dom.getElementsByTagName('w:tbl').item(0)!;
        const printNameRow = getDirectChildrenByName(firstTable, 'tr')[1]!; // Signature, [Print Name], Title, Date
        const valueCell = getDirectChildrenByName(printNameRow, 'tc')[1]!;
        const rPr = valueCell.getElementsByTagName('w:rPr').item(0)!;
        expect(rPr.getElementsByTagName('w:highlight').item(0)!.getAttribute('w:val')).toBe('yellow');
        expect(rPr.getElementsByTagName('w:b').length).toBeGreaterThan(0);
      });

      await then('single-column and two-column layouts remain unchanged', async () => {
        const single = signatureBlock({ parties: [{ party: 'Acme', name: 'Jane Doe', title: 'CEO' }] });
        // single-column: a bold party paragraph + one single-column table.
        expect(single[0]!.kind).toBe('paragraph');
        expect(single[1]!.kind).toBe('table');
        const two = signatureBlock({ layout: 'two-column', parties: [{ party: 'Acme', name: 'Jane Doe' }] });
        expect(two).toHaveLength(1);
        expect(two[0]!.kind).toBe('table');
        expect((two[0] as { columnWidthsTwips: number[] }).columnWidthsTwips).toHaveLength(3); // signer/gutter/signer
      });
    },
  );
});
