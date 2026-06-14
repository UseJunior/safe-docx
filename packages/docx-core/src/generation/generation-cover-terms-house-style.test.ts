import { describe, expect } from 'vitest';
import { getDirectChildrenByName } from '../primitives/dom-helpers.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { generateDocx } from './compile.js';
import { coverTermsTable } from './recipes.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-cover-terms-house-style';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

function specWithCoverTable(): DocumentSpec {
  return {
    meta: { title: 'Cover terms house style', createdIso: '2026-06-14T00:00:00Z' },
    sections: [
      {
        blocks: [
          coverTermsTable({
            title: 'Cover Terms',
            borderMode: 'horizontal-rules',
            rowHeightTwips: 560,
            cellPaddingTwips: 120,
            subrowLabelIndentTwips: 360,
            terms: [
              { group: 'Transaction Parties' },
              { label: 'Disclosing Party', value: 'Acme Manufacturing, Inc.' },
              { label: 'Affiliate', value: 'Acme Services LLC', subrow: true },
            ],
          }),
        ],
      },
    ],
  };
}

async function generateDocumentXml(spec: DocumentSpec): Promise<string> {
  const buffer = await generateDocx(spec);
  const structural = await checkGeneratedPackage(buffer);
  expect(structural.issues).toEqual([]);
  const xml = await readZipText(buffer, 'word/document.xml');
  expect(xml, 'word/document.xml missing from package').not.toBeNull();
  return xml!;
}

function firstDirectChild(parent: Element, localName: string): Element {
  const child = getDirectChildrenByName(parent, localName)[0];
  expect(child, `missing direct w:${localName}`).toBeTruthy();
  return child!;
}

function borderValues(tbl: Element): Record<string, string | null> {
  const tblPr = firstDirectChild(tbl, 'tblPr');
  const tblBorders = firstDirectChild(tblPr, 'tblBorders');
  return Object.fromEntries(
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((edge) => [
      edge,
      firstDirectChild(tblBorders, edge).getAttribute('w:val'),
    ]),
  );
}

function firstRunProps(cell: Element): Element {
  const run = cell.getElementsByTagName('w:r').item(0);
  expect(run).toBeTruthy();
  return firstDirectChild(run!, 'rPr');
}

describe('Traceability: cover-terms house style', () => {
  test.openspec('[SDX-GEN-106] cover-terms tables support house-style rows and rhythm')(
    'Scenario: cover-terms tables support house-style rows and rhythm',
    async ({ given, when, then, attachPrettyJson, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a cover-terms table using horizontal rules, a group row, a subrow, and row height', async () => {
        const table = specWithCoverTable().sections[0]!.blocks[0]!;
        await attachPrettyJson('recipe-output', table);
        expect(table.kind).toBe('table');
        if (table.kind !== 'table') throw new Error('expected table');
        expect(table.borders?.left?.style).toBe('none');
        expect(table.borders?.right?.style).toBe('none');
        expect(table.borders?.insideV?.style).toBe('none');
        expect(table.rows[1]!.heightTwips).toBe(560);
        expect(table.rows[1]!.heightRule).toBe('atLeast');
        expect(table.rows[1]!.cells[0]!.gridSpan).toBe(2);
        expect(table.rows[1]!.cells[0]!.shadingHex).toBeUndefined();
        // Subrow label indent is additive over the uniform cell padding: 120 + 360 = 480.
        expect(table.rows[3]!.cells[0]!.marginsTwips?.left).toBe(480);
        // The subrow value cell keeps the plain uniform padding (only the label is indented).
        expect(table.rows[3]!.cells[1]!.marginsTwips?.left).toBe(120);
        spec = specWithCoverTable();
      });

      let documentXml!: string;
      let dom!: Document;
      await when('the document is generated and parsed back', async () => {
        documentXml = await generateDocumentXml(spec);
        dom = parseXml(documentXml);
        await attachPrettyXml('word/document.xml', documentXml);
      });

      await then('the table emits horizontal rules with no vertical outside or inside borders', async () => {
        const tbl = dom.getElementsByTagName('w:tbl').item(0)!;
        expect(borderValues(tbl)).toEqual({
          top: 'single',
          left: 'none',
          bottom: 'single',
          right: 'none',
          insideH: 'single',
          insideV: 'none',
        });
      });

      await then('the group row spans both columns, is bold, and does not emit shading', async () => {
        const rows = Array.from(dom.getElementsByTagName('w:tr'));
        const groupCell = firstDirectChild(rows[1]!, 'tc');
        const groupCellPr = firstDirectChild(groupCell, 'tcPr');
        expect(firstDirectChild(groupCellPr, 'gridSpan').getAttribute('w:val')).toBe('2');
        expect(getDirectChildrenByName(groupCellPr, 'shd')).toHaveLength(0);
        expect(firstRunProps(groupCell).getElementsByTagName('w:b')).toHaveLength(1);
      });

      await then('the subrow is italic, soft-ink, and left-indented through its label-cell margin', async () => {
        const rows = Array.from(dom.getElementsByTagName('w:tr'));
        const subrowCells = getDirectChildrenByName(rows[3]!, 'tc');
        const labelPr = firstDirectChild(subrowCells[0]!, 'tcPr');
        const labelMargins = firstDirectChild(labelPr, 'tcMar');
        expect(firstDirectChild(labelMargins, 'left').getAttribute('w:w')).toBe('480');
        for (const cell of subrowCells) {
          const rPr = firstRunProps(cell);
          expect(rPr.getElementsByTagName('w:i')).toHaveLength(1);
          expect(rPr.getElementsByTagName('w:color').item(0)!.getAttribute('w:val')).toBe('595959');
        }
      });

      await then('body rows carry the authored minimum row height', async () => {
        const rows = Array.from(dom.getElementsByTagName('w:tr'));
        expect(rows).toHaveLength(4);
        expect(getDirectChildrenByName(rows[0]!, 'trPr')).toHaveLength(1);
        for (const row of rows.slice(1)) {
          const trHeight = firstDirectChild(firstDirectChild(row, 'trPr'), 'trHeight');
          expect(trHeight.getAttribute('w:val')).toBe('560');
          expect(trHeight.getAttribute('w:hRule')).toBe('atLeast');
        }
      });

      await then('default options preserve the existing full-grid recipe behavior', async () => {
        const defaultXml = await generateDocumentXml({
          sections: [
            {
              blocks: [
                coverTermsTable({
                  terms: [{ label: 'Effective Date', value: 'June 14, 2026' }],
                }),
              ],
            },
          ],
        });
        const defaultDom = parseXml(defaultXml);
        await attachPrettyXml('default-word/document.xml', defaultXml);
        expect(borderValues(defaultDom.getElementsByTagName('w:tbl').item(0)!)).toEqual({
          top: 'single',
          left: 'single',
          bottom: 'single',
          right: 'single',
          insideH: 'single',
          insideV: 'single',
        });
        expect(defaultDom.getElementsByTagName('w:trHeight')).toHaveLength(0);
        expect(defaultDom.getElementsByTagName('w:tcMar')).toHaveLength(0);
      });
    },
  );
});
