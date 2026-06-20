import { describe, expect } from 'vitest';
import { getDirectChildrenByName } from '../primitives/dom-helpers.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { generateDocx } from './compile.js';
import { signatureBlock } from './recipes.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-oa-recipe-borders-header';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

function styledSignatureSpec(): DocumentSpec {
  return {
    meta: { title: 'OA stacked-ruled border + header', createdIso: '2026-06-20T00:00:00Z' },
    sections: [
      {
        blocks: signatureBlock({
          layout: 'oa-stacked-ruled',
          fontFamily: 'Arial',
          headerBold: true,
          headerSizePt: 9,
          lineColorHex: '494A4B',
          lineSizeEighthPt: 6,
          fillable: true,
          parties: [
            // Title is a real filled value here, so titleFillable:false suppresses its highlight.
            { party: 'Employer', name: '[Legal name of the employer]', title: 'Authorized Officer', titleFillable: false },
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

describe('Traceability: signature oa-stacked-ruled border and header styling', () => {
  test.openspec('[SDX-GEN-113] signature header weight, ruled-line styling, and per-value fillable')(
    'Scenario: oa-stacked-ruled supports header weight, ruled-line styling, and per-value fillable',
    async ({ given, when, then, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('an oa-stacked-ruled block with a bold sized header, a styled line, and a non-fillable title', async () => {
        spec = styledSignatureSpec();
        expect(spec.sections[0]!.blocks).toHaveLength(2); // header paragraph + table
      });

      let dom!: Document;
      await when('the document is generated and parsed back', async () => {
        const xml = await generatedDocumentXml(spec);
        dom = parseXml(xml);
        await attachPrettyXml('word/document.xml', xml);
      });

      await then('the party header renders bold at the authored point size', async () => {
        const header = Array.from(dom.getElementsByTagName('w:p')).find(
          (p) => p.getElementsByTagName('w:caps').length > 0,
        );
        expect(header, 'caps header paragraph missing').toBeTruthy();
        const rPr = header!.getElementsByTagName('w:rPr').item(0)!;
        expect(rPr.getElementsByTagName('w:b').length).toBeGreaterThan(0);
        expect(rPr.getElementsByTagName('w:sz').item(0)!.getAttribute('w:val')).toBe('18'); // 9pt
      });

      await then('each ruled signing line carries the authored bottom-border color and weight', async () => {
        const firstTable = dom.getElementsByTagName('w:tbl').item(0)!;
        const trs = getDirectChildrenByName(firstTable, 'tr');
        expect(trs.length).toBeGreaterThan(0);
        for (const tr of trs) {
          const lineCell = getDirectChildrenByName(tr, 'tc')[1]!;
          const tcBorders = lineCell.getElementsByTagName('w:tcBorders').item(0)!;
          const bottom = getDirectChildrenByName(tcBorders, 'bottom')[0]!;
          expect(bottom.getAttribute('w:val')).toBe('single');
          expect(bottom.getAttribute('w:sz')).toBe('6');
          expect(bottom.getAttribute('w:color')).toBe('494A4B');
        }
      });

      await then('the Print Name value is highlighted (block fillable) but the Title is not (per-party override)', async () => {
        const firstTable = dom.getElementsByTagName('w:tbl').item(0)!;
        const trs = getDirectChildrenByName(firstTable, 'tr');
        // fields order: signature / printName / title / date
        const printNameValue = getDirectChildrenByName(trs[1]!, 'tc')[1]!;
        const titleValue = getDirectChildrenByName(trs[2]!, 'tc')[1]!;
        const pnRpr = printNameValue.getElementsByTagName('w:rPr').item(0)!;
        expect(pnRpr.getElementsByTagName('w:highlight').item(0)!.getAttribute('w:val')).toBe('yellow');
        expect(pnRpr.getElementsByTagName('w:b').length).toBeGreaterThan(0);
        expect(titleValue.getElementsByTagName('w:highlight').length).toBe(0);
      });

      await then('omitting every new option preserves the existing oa-stacked-ruled output', async () => {
        const xml = await generatedDocumentXml({
          sections: [
            { blocks: signatureBlock({ layout: 'oa-stacked-ruled', parties: [{ party: 'Acme', name: 'Jane Doe', title: 'CEO' }] }) },
          ],
        });
        const defaultDom = parseXml(xml);
        const header = Array.from(defaultDom.getElementsByTagName('w:p')).find(
          (p) => p.getElementsByTagName('w:caps').length > 0,
        )!;
        const rPr = header.getElementsByTagName('w:rPr').item(0)!;
        expect(rPr.getElementsByTagName('w:b').length).toBe(0); // no bold by default
        expect(rPr.getElementsByTagName('w:sz').length).toBe(0); // no size by default
        const bottom = getDirectChildrenByName(
          getDirectChildrenByName(getDirectChildrenByName(defaultDom.getElementsByTagName('w:tbl').item(0)!, 'tr')[0]!, 'tc')[1]!.getElementsByTagName('w:tcBorders').item(0)!,
          'bottom',
        )[0]!;
        expect(bottom.getAttribute('w:sz')).toBe('4');
        expect(bottom.getAttribute('w:color')).toBe('auto');
      });

      await then('single-column and two-column layouts remain unchanged', async () => {
        const single = signatureBlock({ parties: [{ party: 'Acme', name: 'Jane Doe', title: 'CEO' }] });
        expect(single[0]!.kind).toBe('paragraph');
        expect(single[1]!.kind).toBe('table');
        const two = signatureBlock({ layout: 'two-column', parties: [{ party: 'Acme', name: 'Jane Doe' }] });
        expect(two).toHaveLength(1);
        expect(two[0]!.kind).toBe('table');
      });
    },
  );
});
