import { describe, expect } from 'vitest';
import { getDirectChildrenByName } from '../primitives/dom-helpers.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { generateDocx } from './compile.js';
import { signatureBlock } from './recipes.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-signature-and-keeplines';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

// Three signers → an odd count, so the second grid row carries a trailing empty padding cell.
const PARTIES = [
  { party: 'Acme Manufacturing, Inc.', name: 'Jane Doe', title: 'CEO' },
  { party: 'Northeast Logistics LLC', name: 'John Smith', title: 'Managing Member' },
  { party: 'Third Signer Inc.', name: 'Pat Lee', title: 'Secretary' },
];

function twoColumnSpec(): DocumentSpec {
  return {
    meta: { title: 'Two-column signature', createdIso: '2026-06-15T00:00:00Z' },
    sections: [{ blocks: signatureBlock({ layout: 'two-column', parties: PARTIES }) }],
  };
}

async function generateDocumentXml(spec: DocumentSpec): Promise<string> {
  const buffer = await generateDocx(spec);
  const structural = await checkGeneratedPackage(buffer);
  expect(structural.issues).toEqual([]);
  const xml = await readZipText(buffer, 'word/document.xml');
  expect(xml, 'word/document.xml missing').not.toBeNull();
  return xml!;
}

function firstDirectChild(parent: Element, localName: string): Element {
  const child = getDirectChildrenByName(parent, localName)[0];
  expect(child, `missing direct w:${localName}`).toBeTruthy();
  return child!;
}

function cellText(cell: Element): string {
  return Array.from(cell.getElementsByTagName('w:t'))
    .map((t) => t.textContent ?? '')
    .join('');
}

describe('Traceability: two-column signature block layout', () => {
  test.openspec('[SDX-GEN-109] two-column signature renders a paired pre-filled signing grid')(
    'Scenario: two-column signature renders a paired pre-filled signing grid',
    async ({ given, when, then, attachPrettyJson, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a two-column signature block over three signers', async () => {
        const blocks = signatureBlock({ layout: 'two-column', parties: PARTIES });
        await attachPrettyJson('recipe-output', blocks);
        // The two-column recipe returns exactly one grid table block.
        expect(blocks).toHaveLength(1);
        expect(blocks[0]!.kind).toBe('table');
        if (blocks[0]!.kind !== 'table') throw new Error('expected table');
        expect(blocks[0]!.columnWidthsTwips).toHaveLength(3);
        spec = twoColumnSpec();
      });

      let dom!: Document;
      await when('the document is generated and parsed back', async () => {
        const xml = await generateDocumentXml(spec);
        await attachPrettyXml('word/document.xml', xml);
        dom = parseXml(xml);
      });

      await then('the outer table is a 3-column grid with two signer rows', async () => {
        const outer = dom.getElementsByTagName('w:tbl').item(0)!;
        const grid = firstDirectChild(outer, 'tblGrid');
        expect(getDirectChildrenByName(grid, 'gridCol')).toHaveLength(3);
        expect(getDirectChildrenByName(outer, 'tr')).toHaveLength(2);
      });

      await then('each signer cell leads with a centered uppercase muted party header', async () => {
        const outer = dom.getElementsByTagName('w:tbl').item(0)!;
        const firstRow = firstDirectChild(outer, 'tr');
        const signerCell = getDirectChildrenByName(firstRow, 'tc')[0]!;
        const header = getDirectChildrenByName(signerCell, 'p')[0]!;
        const pPr = firstDirectChild(header, 'pPr');
        expect(firstDirectChild(pPr, 'jc').getAttribute('w:val')).toBe('center');
        const rPr = firstDirectChild(header.getElementsByTagName('w:r').item(0)!, 'rPr');
        expect(rPr.getElementsByTagName('w:caps')).toHaveLength(1);
        expect(rPr.getElementsByTagName('w:color').item(0)!.getAttribute('w:val')).toBe('595959');
        expect(cellText(header)).toBe('Acme Manufacturing, Inc.');
      });

      await then('the signer form pre-fills Print Name and Title and leaves Signature/Date blank on ruled lines', async () => {
        const outer = dom.getElementsByTagName('w:tbl').item(0)!;
        const firstRow = firstDirectChild(outer, 'tr');
        const signerCell = getDirectChildrenByName(firstRow, 'tc')[0]!;
        const form = getDirectChildrenByName(signerCell, 'tbl')[0]!;
        const formRows = getDirectChildrenByName(form, 'tr');
        // Four fields × (rule row + caption row) = 8 rows.
        expect(formRows).toHaveLength(8);
        const ruleCell = (i: number) => getDirectChildrenByName(formRows[i]!, 'tc')[0]!;
        const captions = [1, 3, 5, 7].map((i) => cellText(ruleCell(i)));
        expect(captions).toEqual(['Signature', 'Print Name', 'Title', 'Date']);
        // Value lines: Signature blank, Print Name = name, Title = title, Date blank.
        expect(cellText(ruleCell(0))).toBe('');
        expect(cellText(ruleCell(2))).toBe('Jane Doe');
        expect(cellText(ruleCell(4))).toBe('CEO');
        expect(cellText(ruleCell(6))).toBe('');
        // Each value line is a bottom-ruled cell.
        for (const i of [0, 2, 4, 6]) {
          const tcBorders = firstDirectChild(firstDirectChild(ruleCell(i), 'tcPr'), 'tcBorders');
          expect(firstDirectChild(tcBorders, 'bottom').getAttribute('w:val')).toBe('single');
        }
      });

      await then('an odd signer count yields a trailing empty padding cell with no nested form', async () => {
        const outer = dom.getElementsByTagName('w:tbl').item(0)!;
        const secondRow = getDirectChildrenByName(outer, 'tr')[1]!;
        const cells = getDirectChildrenByName(secondRow, 'tc');
        expect(cells).toHaveLength(3);
        // Third signer present in the left cell; padding cell on the right has no nested table and no text.
        expect(cellText(cells[0]!)).toContain('Third Signer Inc.');
        expect(getDirectChildrenByName(cells[2]!, 'tbl')).toHaveLength(0);
        expect(cellText(cells[2]!)).toBe('');
      });

      await then('the grid uses no VML or pictures', async () => {
        expect(dom.getElementsByTagName('w:pict')).toHaveLength(0);
        expect(dom.getElementsByTagName('v:shape')).toHaveLength(0);
      });

      await then('omitting layout preserves the single-column recipe behavior', async () => {
        const xml = await generateDocumentXml({
          sections: [{ blocks: signatureBlock({ parties: [PARTIES[0]!] }) }],
        });
        const singleDom = parseXml(xml);
        // Single-column path: a bold heading paragraph + a one-column table with "Name: ..." rows, no caps header.
        expect(singleDom.getElementsByTagName('w:caps')).toHaveLength(0);
        const allText = Array.from(singleDom.getElementsByTagName('w:t'))
          .map((t) => t.textContent ?? '')
          .join('|');
        expect(allText).toContain('Name: Jane Doe');
      });
    },
  );
});
