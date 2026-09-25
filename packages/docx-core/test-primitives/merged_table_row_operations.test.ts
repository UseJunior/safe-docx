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
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.23' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.17' },
  );

const BODY = `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>
  <w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Heading</w:t></w:r></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:r><w:t>Left</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>Right</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>`;

async function loaded() {
  const doc = await DocxDocument.load(await buildDocxFromBodyXml(BODY));
  doc.insertParagraphBookmarks('merged-horizontal-test');
  return { doc, anchor: getParagraphBookmarkId(doc.getParagraphs()[0]!)! };
}

async function xml(doc: DocxDocument): Promise<string> {
  const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
  return (await DocxZip.load(buffer)).readText('word/document.xml');
}

describe('opt-in horizontal merged row operations', () => {
  test.openspec('[SDX-MERGEDROW-01] horizontal insertion clones geometry only')('clean insertion copies the physical merged cell without cloning content', async () => {
    const { doc, anchor } = await loaded();
    const result = doc.insertTableRow({ positionalAnchorNodeId: anchor, relativePosition: 'AFTER', cellTexts: ['New'], mergeAware: true });
    expect(result.rowIndex).toBe(1);
    expect(result.cellParagraphIds).toHaveLength(1);
    expect(doc.getParagraphTextById(result.cellParagraphIds[0]!)).toBe('New');
    const output = await xml(doc);
    expect(output.match(/<w:gridSpan w:val="2"/g)).toHaveLength(2);
    expect(output.match(/<w:tr>/g)).toHaveLength(3);
  });

  test.openspec('[SDX-MERGEDROW-02] tracked horizontal edits have inverse projections')('tracked insertion and deletion project to the expected row count', async () => {
    const first = await loaded();
    const source = await xml(first.doc);
    const context = createRevisionContext({ author: 'Tester', date: '2026-09-24T00:00:00Z' });
    first.doc.insertTableRow({ positionalAnchorNodeId: first.anchor, relativePosition: 'AFTER', cellTexts: ['New'], mergeAware: true }, context);
    const inserted = (await first.doc.toBuffer({ cleanBookmarks: false })).buffer;
    const acceptedInsert = await DocxDocument.load(inserted);
    await acceptedInsert.acceptChanges();
    expect((await xml(acceptedInsert)).match(/<w:tr>/g)).toHaveLength(3);
    const cleanInsert = await loaded();
    cleanInsert.doc.insertTableRow({ positionalAnchorNodeId: cleanInsert.anchor, relativePosition: 'AFTER', cellTexts: ['New'], mergeAware: true });
    expect(await xml(acceptedInsert)).toBe(await xml(cleanInsert.doc));
    const rejectedInsert = await DocxDocument.load(inserted);
    await rejectedInsert.rejectChanges();
    expect(await xml(rejectedInsert)).toBe(source);

    const second = await loaded();
    second.doc.deleteTableRow({ targetParagraphId: second.anchor, mergeAware: true },
      createRevisionContext({ author: 'Tester', date: '2026-09-24T00:00:00Z' }));
    const deleted = (await second.doc.toBuffer({ cleanBookmarks: false })).buffer;
    const acceptedDelete = await DocxDocument.load(deleted);
    await acceptedDelete.acceptChanges();
    expect((await xml(acceptedDelete)).match(/<w:tr>/g)).toHaveLength(1);
    const rejectedDelete = await DocxDocument.load(deleted);
    await rejectedDelete.rejectChanges();
    expect(await xml(rejectedDelete)).toBe(source);
  });

  test.openspec('[SDX-MERGEDROW-06] empty row properties normalize explicitly')('normalizes an authored empty row-properties element after rejection', async () => {
    const doc = await DocxDocument.load(await buildDocxFromBodyXml(BODY.replace('<w:tr><w:tc>', '<w:tr><w:trPr/><w:tc>')));
    doc.insertParagraphBookmarks('merged-empty-trpr-test');
    const anchor = getParagraphBookmarkId(doc.getParagraphs()[0]!)!;
    const source = await xml(doc);
    doc.deleteTableRow({ targetParagraphId: anchor, mergeAware: true },
      createRevisionContext({ author: 'Tester', date: '2026-09-24T00:00:00Z' }));
    const rejected = await DocxDocument.load((await doc.toBuffer({ cleanBookmarks: false })).buffer);
    await rejected.rejectChanges();
    expect(await xml(rejected)).toBe(source.replace('<w:tr><w:trPr/>', '<w:tr>'));
  });

  test.openspec('[SDX-MERGEDROW-05] legacy horizontal merge is not misread')('refuses legacy hMerge in both modes without mutation or revision IDs', async () => {
    const body = BODY.replace(
      '<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>',
      '<w:tcPr><w:hMerge w:val="restart"/></w:tcPr>',
    ).replace(
      '</w:tc></w:tr>',
      '</w:tc><w:tc><w:tcPr><w:hMerge/></w:tcPr><w:p/></w:tc></w:tr>',
    );
    for (const mergeAware of [false, true]) {
      const doc = await DocxDocument.load(await buildDocxFromBodyXml(body));
      doc.insertParagraphBookmarks('hmerge-guard-test');
      const anchor = getParagraphBookmarkId(doc.getParagraphs()[0]!)!;
      const before = await xml(doc);
      const ctx = createRevisionContext({ author: 'Tester', date: '2026-09-24T00:00:00Z' });
      const nextId = ctx.idState.nextId;
      expect(() => doc.insertTableRow({ positionalAnchorNodeId: anchor, relativePosition: 'AFTER', cellTexts: ['A', 'B'], mergeAware }, ctx))
        .toThrowError(/hMerge/);
      expect(await xml(doc)).toBe(before);
      expect(ctx.idState.nextId).toBe(nextId);
    }
  });

  test.openspec('[SDX-TABLEROW-07] merge, wrapper, and nested-table guards are table-wide')('keeps default span rejection and opt-in vertical rejection', async () => {
    const { doc, anchor } = await loaded();
    const before = await xml(doc);
    expect(() => doc.insertTableRow({ positionalAnchorNodeId: anchor, relativePosition: 'AFTER', cellTexts: ['New'] }))
      .toThrowError(/occupancy/);
    expect(await xml(doc)).toBe(before);
    const vertical = await DocxDocument.load(await buildDocxFromBodyXml(BODY.replace(
      '<w:gridSpan w:val="2"/>', '<w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>',
    )));
    vertical.insertParagraphBookmarks('vertical-guard-test');
    const verticalAnchor = getParagraphBookmarkId(vertical.getParagraphs()[0]!)!;
    const verticalBefore = await xml(vertical);
    expect(() => vertical.insertTableRow({ positionalAnchorNodeId: verticalAnchor, relativePosition: 'AFTER', cellTexts: ['New'], mergeAware: true }))
      .toThrowError(/vMerge/);
    expect(await xml(vertical)).toBe(verticalBefore);
  });

  test.openspec('[SDX-TABLEROW-08] malformed and topology-revised tables are transactional')('rejects invalid opt-in value count without spending a revision ID', async () => {
    const { doc, anchor } = await loaded();
    const before = await xml(doc);
    const ctx = createRevisionContext({ author: 'Tester', date: '2026-09-24T00:00:00Z' });
    const nextId = ctx.idState.nextId;
    let thrown: unknown;
    try {
      doc.insertTableRow({ positionalAnchorNodeId: anchor, relativePosition: 'AFTER', cellTexts: ['one', 'two'], mergeAware: true }, ctx);
    } catch (error) { thrown = error; }
    expect(thrown).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await xml(doc)).toBe(before);
    expect(ctx.idState.nextId).toBe(nextId);
  });
});
