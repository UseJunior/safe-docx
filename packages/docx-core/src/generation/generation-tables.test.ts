import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { DocxDocument } from '../primitives/document.js';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { generateDocx } from './compile.js';
import { GenerationSpecError } from './errors.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec, TableSpec } from './types.js';

const TEST_FEATURE = 'add-docx-generation';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

function para(text: string): { kind: 'paragraph'; runs: [{ kind: 'text'; text: string }] } {
  return { kind: 'paragraph', runs: [{ kind: 'text', text }] };
}

function specWith(table: TableSpec): DocumentSpec {
  return {
    meta: { title: 'Generation tables', createdIso: '2026-06-11T00:00:00Z' },
    sections: [{ blocks: [para('Before the table'), table, para('After the table')] }],
  };
}

async function documentDom(spec: DocumentSpec): Promise<Document> {
  const buffer = await generateDocx(spec);
  const xml = await readZipText(buffer, 'word/document.xml');
  expect(xml).not.toBeNull();
  return parseXml(xml!);
}

function elementChildNames(el: Element): string[] {
  const names: string[] = [];
  for (let child = el.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) names.push((child as Element).tagName);
  }
  return names;
}

describe('Traceability: table generation', () => {
  test
    .openspec('[SDX-GEN-050] a fixed-layout table carries its grid')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.48' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.52' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.63' },
    )(
    'Scenario: a fixed-layout table carries its grid',
    async ({ given, when, then, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a fixed-layout table with explicit 2880/6480 twip columns', async () => {
        spec = specWith({
          kind: 'table',
          layout: 'fixed',
          columnWidthsTwips: [2880, 6480],
          rows: [{ cells: [{ blocks: [para('Label')] }, { blocks: [para('Value')] }] }],
        });
        expect(spec.sections[0]!.blocks).toHaveLength(3);
      });

      let tbl!: Element;
      await when('the document is generated and its w:tbl parsed back', async () => {
        const dom = await documentDom(spec);
        tbl = dom.getElementsByTagName('w:tbl').item(0)!;
        expect(tbl).toBeTruthy();
        await attachPrettyXml('w:tbl', tbl.toString());
      });

      await then('tblLayout is fixed, the grid matches the widths, and tblW is their dxa sum', async () => {
        const tblLayout = tbl.getElementsByTagName('w:tblLayout').item(0)!;
        expect(tblLayout.getAttribute('w:type')).toBe('fixed');
        const gridCols = Array.from(tbl.getElementsByTagName('w:gridCol'));
        expect(gridCols.map((c) => c.getAttribute('w:w'))).toEqual(['2880', '6480']);
        const tblW = tbl.getElementsByTagName('w:tblW').item(0)!;
        expect(tblW.getAttribute('w:w')).toBe('9360');
        expect(tblW.getAttribute('w:type')).toBe('dxa');
      });
    },
  );

  test
    .openspec('[SDX-GEN-051] cell decoration is emitted')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.66' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.32' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.83' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.68' },
    )(
    'Scenario: cell decoration is emitted',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a cell declaring borders, shading, vertical alignment, and margins', async () => {
        spec = specWith({
          kind: 'table',
          columnWidthsTwips: [9360],
          rows: [
            {
              cells: [
                {
                  borders: { bottom: { style: 'single', sizeEighthPt: 8, colorHex: '1F4E79' } },
                  shadingHex: 'D9D9D9',
                  vAlign: 'center',
                  marginsTwips: { top: 120, left: 240, bottom: 120, right: 240 },
                  blocks: [para('Decorated cell')],
                },
              ],
            },
          ],
        });
        expect(spec.sections[0]!.blocks[1]!.kind).toBe('table');
      });

      let tcPr!: Element;
      await when('the document is generated and the cell properties parsed back', async () => {
        const dom = await documentDom(spec);
        tcPr = dom.getElementsByTagName('w:tcPr').item(0)!;
        expect(tcPr).toBeTruthy();
        await attachPrettyJson('tcpr-child-order', elementChildNames(tcPr));
      });

      await then('tcBorders, shd, tcMar, and vAlign appear in schema order with the requested values', async () => {
        expect(elementChildNames(tcPr)).toEqual(['w:tcW', 'w:tcBorders', 'w:shd', 'w:tcMar', 'w:vAlign']);
        const bottom = tcPr.getElementsByTagName('w:tcBorders').item(0)!.getElementsByTagName('w:bottom').item(0)!;
        expect(bottom.getAttribute('w:val')).toBe('single');
        expect(bottom.getAttribute('w:sz')).toBe('8');
        expect(bottom.getAttribute('w:color')).toBe('1F4E79');
        const shd = tcPr.getElementsByTagName('w:shd').item(0)!;
        expect(shd.getAttribute('w:fill')).toBe('D9D9D9');
        const vAlign = tcPr.getElementsByTagName('w:vAlign').item(0)!;
        expect(vAlign.getAttribute('w:val')).toBe('center');
        const tcMarLeft = tcPr.getElementsByTagName('w:tcMar').item(0)!.getElementsByTagName('w:left').item(0)!;
        expect(tcMarLeft.getAttribute('w:w')).toBe('240');
      });
    },
  );

  test
    .openspec('[SDX-GEN-052] merged cells keep the grid arithmetic consistent')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.17' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.84' },
    )(
    'Scenario: merged cells keep the grid arithmetic consistent',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let undersizedRow!: DocumentSpec;
      let danglingContinue!: DocumentSpec;
      let merged!: DocumentSpec;
      await given('one table whose second row underfills the grid, one whose vMerge continues nothing, and one valid merge', async () => {
        undersizedRow = specWith({
          kind: 'table',
          columnWidthsTwips: [3120, 3120, 3120],
          rows: [
            { cells: [{ blocks: [para('a')] }, { blocks: [para('b')] }, { blocks: [para('c')] }] },
            { cells: [{ gridSpan: 2, blocks: [para('d')] }] },
          ],
        });
        danglingContinue = specWith({
          kind: 'table',
          columnWidthsTwips: [4680, 4680],
          rows: [
            { cells: [{ blocks: [para('plain')] }, { blocks: [para('plain')] }] },
            { cells: [{ vMerge: 'continue', blocks: [] }, { blocks: [para('e')] }] },
          ],
        });
        merged = specWith({
          kind: 'table',
          columnWidthsTwips: [3120, 3120, 3120],
          rows: [
            { cells: [{ gridSpan: 2, blocks: [para('Spanning head')] }, { vMerge: 'restart', blocks: [para('Tall')] }] },
            { cells: [{ blocks: [para('x')] }, { blocks: [para('y')] }, { vMerge: 'continue', blocks: [] }] },
          ],
        });
      });

      let undersizedError: unknown;
      let danglingError: unknown;
      let mergedDom!: Document;
      await when('the invalid specs are validated and the valid one generated', async () => {
        undersizedError = await generateDocx(undersizedRow).then(() => null, (err: unknown) => err);
        danglingError = await generateDocx(danglingContinue).then(() => null, (err: unknown) => err);
        mergedDom = await documentDom(merged);
      });

      await then('grid divergence is rejected at validation with grid_mismatch', async () => {
        expect(undersizedError).toBeInstanceOf(GenerationSpecError);
        expect((undersizedError as GenerationSpecError).code).toBe('grid_mismatch');
        expect((undersizedError as GenerationSpecError).path).toBe('/sections/0/blocks/1/rows/1');
        expect(danglingError).toBeInstanceOf(GenerationSpecError);
        expect((danglingError as GenerationSpecError).code).toBe('grid_mismatch');
        expect((danglingError as GenerationSpecError).path).toBe('/sections/0/blocks/1/rows/1/cells/0/vMerge');
        await attachPrettyJson('rejections', {
          undersized: (undersizedError as GenerationSpecError).message,
          dangling: (danglingError as GenerationSpecError).message,
        });
      });

      await then('the valid merge emits matching gridSpan and vMerge markers', async () => {
        const gridSpan = mergedDom.getElementsByTagName('w:gridSpan').item(0)!;
        expect(gridSpan.getAttribute('w:val')).toBe('2');
        const merges = Array.from(mergedDom.getElementsByTagName('w:vMerge'));
        expect(merges).toHaveLength(2);
        expect(merges[0]!.getAttribute('w:val')).toBe('restart');
        // The continuation is the bare element form Word itself writes.
        expect(merges[1]!.hasAttribute('w:val')).toBe(false);
      });
    },
  );

  test
    .openspec('[SDX-GEN-053] table structural invariants hold')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.65' })(
    'Scenario: table structural invariants hold',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a section ending in a table whose cells include a nested table and an empty cell', async () => {
        spec = {
          meta: { title: 'Trailing table', createdIso: '2026-06-11T00:00:00Z' },
          sections: [
            {
              blocks: [
                para('Only paragraph'),
                {
                  kind: 'table',
                  columnWidthsTwips: [4680, 4680],
                  rows: [
                    {
                      cells: [
                        {
                          blocks: [
                            {
                              kind: 'table',
                              columnWidthsTwips: [4200],
                              rows: [{ cells: [{ blocks: [para('Nested')] }] }],
                            },
                          ],
                        },
                        { blocks: [] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        };
        expect(spec.sections[0]!.blocks[1]!.kind).toBe('table');
      });

      let buffer!: Buffer;
      let dom!: Document;
      await when('the document is generated', async () => {
        buffer = await generateDocx(spec);
        const xml = await readZipText(buffer, 'word/document.xml');
        dom = parseXml(xml!);
      });

      await then('every cell ends with a w:p — including the nested-table and empty cells', async () => {
        const cells = Array.from(dom.getElementsByTagName('w:tc'));
        expect(cells.length).toBe(3);
        for (const tc of cells) {
          const names = elementChildNames(tc);
          expect(names[names.length - 1]).toBe('w:p');
        }
      });

      await then('the body does not end with a table and the package passes structural checks', async () => {
        const body = dom.getElementsByTagName('w:body').item(0)!;
        const bodyChildren = elementChildNames(body);
        expect(bodyChildren[bodyChildren.length - 1]).toBe('w:sectPr');
        expect(bodyChildren[bodyChildren.length - 2]).toBe('w:p');
        const structural = await checkGeneratedPackage(buffer);
        await attachPrettyJson('structural-check-result', structural);
        expect(structural.issues).toEqual([]);
      });
    },
  );

  test('phase 4 tables artifact loads through the document façade with the grid intact', async () => {
    const artifactSpec: DocumentSpec = {
      meta: { title: 'SDX generation phase 4', author: 'safe-docx tests', createdIso: '2026-06-11T00:00:00Z' },
      sections: [
        {
          blocks: [
            para('Cover terms'),
            {
              kind: 'table',
              columnWidthsTwips: [2880, 6480],
              borders: {
                top: { style: 'single' },
                bottom: { style: 'single' },
                left: { style: 'single' },
                right: { style: 'single' },
                insideH: { style: 'single' },
                insideV: { style: 'single' },
              },
              rows: [
                {
                  header: true,
                  cells: [{ gridSpan: 2, shadingHex: 'D9D9D9', vAlign: 'center', blocks: [para('Key Terms')] }],
                },
                { cells: [{ blocks: [para('Effective Date')] }, { blocks: [para('June 11, 2026')] }] },
                { cells: [{ blocks: [para('Term')] }, { blocks: [para('2 years')] }] },
              ],
            },
          ],
        },
      ],
    };
    const buffer = await generateDocx(artifactSpec);
    const doc = await DocxDocument.load(buffer);
    doc.insertParagraphBookmarks('sdx-gen-phase4');
    const texts = doc.readParagraphs().paragraphs.map((p) => p.text);
    expect(texts.join('\n')).toContain('Effective Date');
    expect(texts.join('\n')).toContain('2 years');
    const { writeIntegrationArtifact } = await import('../integration/output-artifacts.js');
    const outputPath = await writeIntegrationArtifact('generation-phase4-tables.docx', buffer);
    expect(outputPath).toContain('generation-phase4-tables.docx');
  });
});
