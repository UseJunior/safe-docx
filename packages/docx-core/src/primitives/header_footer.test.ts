import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { DocxDocument } from './document.js';
import { HeaderFooterError } from './header_footer.js';
import { createRevisionContext, createRevisionIdState } from './track-changes-emitter.js';

const TEST_FEATURE = 'header-footer-attach-primitive';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

describe('setHeaderFooter', () => {
  test('a refused call on a section with a foreign sectPrChange leaves the document unchanged', async () => {
    const body = '<w:p><w:r><w:t>Body.</w:t></w:r></w:p>'
      + '<w:sectPr><w:sectPrChange w:id="90" w:author="Alice" w:date="2026-01-01T00:00:00Z"><w:sectPr/></w:sectPrChange></w:sectPr>';
    const doc = await DocxDocument.load(await buildDocxFromBodyXml(body));
    const before = await doc.getMutationSnapshot();
    const ctx = createRevisionContext({ author: 'AI', date: new Date('2026-02-01T00:00:00Z'), idState: createRevisionIdState() });
    await expect(doc.setHeaderFooter({
      kind: 'footer', sectionIndex: 0, type: 'first', source: { kind: 'content', paragraphs: [{ runs: [{ text: 'Cover' }] }] },
    }, ctx)).rejects.toBeInstanceOf(HeaderFooterError);
    expect((await doc.getMutationSnapshot()).equals(before)).toBe(true);
  });
});
