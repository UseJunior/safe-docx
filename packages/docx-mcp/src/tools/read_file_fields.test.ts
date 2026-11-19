import { expect } from 'vitest';
import { parseXml, OOXML } from '@usejunior/docx-core';
import { readZipText } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { buildParagraphRunLengths, readFile } from './read_file.js';
import { assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';

// Core's test fixtures are excluded from its published build. Resolve the
// source at test runtime so MCP's composite build does not require unpublished
// declarations; keep field and package shapes owned by the shared fixtures.
const { buildDocxFromBodyXml, COMPLETE_PAGE_FIELD, fldChar, instrText, resultText }: {
  buildDocxFromBodyXml(body: string): Promise<Buffer>;
  COMPLETE_PAGE_FIELD: string;
  fldChar(kind: 'begin' | 'separate' | 'end'): string;
  instrText(text: string): string;
  resultText(text: string): string;
} = await import(new URL('../../../docx-core/src/testing/ooxml-fixtures.ts', import.meta.url).href);

const TEST_FEATURE = 'refactor-nested-field-consumers';
const test = testAllure.epic('Document Reading')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });

registerCleanup();

test.openspec('nested field results do not shift inline comment markers')(
  'nested field results do not shift inline comment markers', async () => {
    const xml = await readZipText(await buildDocxFromBodyXml(
      '<w:p><w:bookmarkStart w:id="1" w:name="_bk_nested_field"/>' +
      fldChar('begin') + instrText(' IF ') + COMPLETE_PAGE_FIELD + instrText(' = 1 ') +
      fldChar('separate') + resultText('Lead ') + '<w:commentRangeStart w:id="0"/>' +
      resultText('Beta') + '<w:commentRangeEnd w:id="0"/>' + resultText(' Tail') + fldChar('end') +
      '<w:bookmarkEnd w:id="1"/></w:p>',
    ), 'word/document.xml');
    const opened = await openSession([], { xml: xml!, extraFiles: {
      'word/comments.xml': '<?xml version="1.0"?><w:comments xmlns:w="' + OOXML.W_NS + '">' +
        '<w:comment w:id="0" w:author="Alice" w:date="2026-01-01T00:00:00Z"><w:p>' +
        resultText('Nested field note.') + '</w:p></w:comment></w:comments>',
    } });
    for (const params of [{}, { offset: 1, limit: 1 }]) {
      const response = await readFile(opened.mgr, { file_path: opened.inputPath,
        comment_rendering: 'inline_markers', ...params });
      assertSuccess(response);
      expect(String(response.content)).toContain('Lead [cm-start:0]Beta[cm-end:0] Tail');
    }
  },
);

test.openspec('comment coordinate traversal spans paragraphs without crossing stories')(
  'comment coordinate traversal spans paragraphs without crossing stories', async () => {
  const paragraph = (id: number, content: string) =>
    `<w:p><w:bookmarkStart w:id="${id}" w:name="_bk_field${id}"/>${content}<w:bookmarkEnd w:id="${id}"/></w:p>`;
  const xml = await readZipText(await buildDocxFromBodyXml(
    paragraph(1, fldChar('begin') + instrText(' IF ')) +
    paragraph(2, COMPLETE_PAGE_FIELD + resultText('still code')) +
    paragraph(3, '<w:r><w:pict><w:txbxContent>' + paragraph(4, resultText('Box')) + '</w:txbxContent></w:pict></w:r>') +
    paragraph(5, fldChar('separate') + fldChar('separate') + resultText('Result') + fldChar('end')) +
    paragraph(6, fldChar('separate') + fldChar('end') + '<w:r><w:fldChar/></w:r>' +
      fldChar('begin') + fldChar('end') + resultText('After')),
  ), 'word/document.xml');
  expect(xml).not.toBeNull();
  const paragraphs = Array.from(parseXml(xml!).getElementsByTagNameNS(OOXML.W_NS, 'p'));
  const lengths = buildParagraphRunLengths(paragraphs);
  expect(lengths.get('_bk_field1')).toEqual([0, 0]);
  expect(lengths.get('_bk_field2')).toEqual([0, 0, 0, 0, 0, 0]);
  expect(lengths.get('_bk_field3')).toEqual([0]);
  expect(lengths.get('_bk_field4')).toEqual([3]);
  expect(lengths.get('_bk_field5')).toEqual([0, 0, 6, 0]);
  expect(lengths.get('_bk_field6')).toEqual([0, 0, 0, 0, 0, 5]);
});

test('unbookmarked paragraphs still advance field traversal before cached anchors', async () => {
  const document = parseXml(`<w:document xmlns:w="${OOXML.W_NS}"><w:body>` +
    `<w:p>${fldChar('begin')}</w:p>` +
    '<w:p><w:bookmarkStart w:id="1" w:name="_bk_after_unbookmarked"/>' +
    resultText('Hidden') + fldChar('separate') + resultText('Visible') + fldChar('end') +
    '<w:bookmarkEnd w:id="1"/></w:p></w:body></w:document>');
  const lengths = buildParagraphRunLengths(Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'p')));
  expect(lengths.size).toBe(1);
  expect(lengths.get('_bk_after_unbookmarked')).toEqual([0, 0, 7, 0]);
});
