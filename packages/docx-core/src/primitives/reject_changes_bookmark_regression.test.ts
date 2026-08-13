import { describe, expect } from 'vitest';
import { itAllure } from '../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { DocxDocument } from './document.js';

describe('rejectChanges sibling bookmark relocation', () => {
  itAllure('moves only the bookmark pair enclosing an inserted paragraph', async () => {
    const source = await buildDocxFromBodyXml([
      '<w:bookmarkStart w:id="1" w:name="_bk_keep"/><w:p><w:r><w:t>Keep.</w:t></w:r></w:p><w:bookmarkEnd w:id="1"/>',
      '<w:bookmarkStart w:id="2" w:name="_bk_deleted"/><w:p><w:pPr><w:rPr><w:del w:id="10"/></w:rPr></w:pPr><w:del w:id="11"><w:r><w:delText>Restore.</w:delText></w:r></w:del></w:p><w:bookmarkEnd w:id="2"/>',
      '<w:bookmarkStart w:id="3" w:name="_bk_inserted"/><w:p><w:pPr><w:rPr><w:ins w:id="12"/></w:rPr></w:pPr><w:ins w:id="13"><w:r><w:t>Remove.</w:t></w:r></w:ins></w:p><w:bookmarkEnd w:id="3"/>',
      '<w:bookmarkStart w:id="4" w:name="_bk_tail"/><w:p><w:r><w:t>Tail.</w:t></w:r></w:p><w:bookmarkEnd w:id="4"/>',
    ].join(''));
    const document = await DocxDocument.load(source);

    await document.rejectChanges();

    expect(document.buildDocumentView().nodes.map((node) => node.raw_text)).toEqual(['Keep.', 'Restore.', 'Tail.']);
    expect(document.buildDocumentView().nodes.map((node) => node.id)).toEqual(['_bk_keep', '_bk_deleted', '_bk_tail']);
  });
});
