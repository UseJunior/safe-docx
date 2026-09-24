import { describe, expect } from 'vitest';
import { DocxDocument } from '../src/primitives/document.js';
import { DocxZip } from '../src/primitives/zip.js';
import { getParagraphBookmarkId } from '../src/primitives/bookmarks.js';
import { createRevisionContext } from '../src/primitives/track-changes-emitter.js';
import { buildDocxFromBodyXml } from '../src/testing/ooxml-fixtures.js';
import { testAllure } from './helpers/allure-test.js';

const TEST_FEATURE = 'add-merged-table-row-operations';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.17' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.84' },
  );

function table(firstCellProperties: string, firstRowSecondCell: string, secondCellProperties = ''): string {
  return `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>
    <w:tr><w:tc><w:tcPr>${firstCellProperties}</w:tcPr><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>${firstRowSecondCell}</w:tr>
    <w:tr><w:tc><w:tcPr>${secondCellProperties}</w:tcPr><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl>`;
}

async function documentXml(doc: DocxDocument): Promise<string> {
  const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
  return (await DocxZip.load(buffer)).readText('word/document.xml');
}

describe('merge-aware table row opt-in boundary', () => {
  test.openspec('[SDX-MERGEDROW-GUARD-01] default row edits still refuse merged tables')(
    'keeps insert and delete transactional for horizontal and vertical merges', async () => {
      const horizontal = table('<w:gridSpan w:val="2"/>', '');
      const vertical = table('<w:vMerge w:val="restart"/>',
        '<w:tc><w:p><w:r><w:t>D</w:t></w:r></w:p></w:tc>', '<w:vMerge/>');
      for (const [feature, body] of [['occupancy', horizontal], ['vMerge', vertical]] as const) {
        for (const operation of ['insert', 'delete'] as const) {
          const doc = await DocxDocument.load(await buildDocxFromBodyXml(body));
          doc.insertParagraphBookmarks('merged-row-guard');
          const anchor = getParagraphBookmarkId(doc.getParagraphs()[0]!)!;
          const before = await documentXml(doc);
          const ctx = createRevisionContext({ author: 'AI', date: '2026-01-01T00:00:00Z' });
          const nextId = ctx.idState.nextId;
          const invoke = () => operation === 'insert'
            ? doc.insertTableRow({ positionalAnchorNodeId: anchor, relativePosition: 'AFTER', cellTexts: ['x', 'y'] }, ctx)
            : doc.deleteTableRow({ targetParagraphId: anchor }, ctx);
          let thrown: unknown;
          try { invoke(); } catch (error) { thrown = error; }
          expect(thrown).toMatchObject({ code: 'UNSUPPORTED_EDIT', detail: { feature, rowIndex: 0 } });
          expect(await documentXml(doc)).toBe(before);
          expect(ctx.idState.nextId).toBe(nextId);
        }
      }
    },
  );
});
