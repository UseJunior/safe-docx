/**
 * Original-side bookmark renames keep supported field and internal-hyperlink
 * targets synchronized across WordprocessingML stories, including field
 * instructions fragmented over runs.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 */

import { describe, expect } from 'vitest';
import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import {
  collectBookmarkReferenceNamesInXml,
  collectWordPartBookmarkNames,
  createOriginalBookmarkRenameMap,
  disambiguateOriginalBookmarkIds,
  renameBookmarkTargetsInXml,
  renameOriginalBookmarkTargetsAcrossWordParts,
} from './bookmarkProjectionCompatibility.js';

const TEST_FEATURE = 'Consumer Compatibility Bookmark Ranges';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: TEST_FEATURE,
    story: 'Original-Side Bookmark Target Renames',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.45' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.22' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function instruction(documentXml: string): string {
  const document = parseXml(documentXml);
  return Array.from(document.getElementsByTagName('*'))
    .filter((element) =>
      element.tagName === 'w:instrText' || element.tagName === 'w:delInstrText')
    .map((element) => element.textContent ?? '')
    .join('');
}

describe('original-side bookmark target compatibility', () => {
  test.openspec('Cross-version bookmark IDs are package-local')(
    'disambiguates equal cross-version IDs that name different nested ranges', () => {
      const original = `<w:document xmlns:w="${W_NS}"><w:body><w:p>` +
        '<w:bookmarkStart w:id="101" w:name="Inner"/>' +
        '<w:bookmarkStart w:id="102" w:name="Outer"/>' +
        '<w:r><w:t>Heading</w:t></w:r><w:bookmarkEnd w:id="101"/>' +
        '<w:r><w:t>Body</w:t></w:r><w:bookmarkEnd w:id="102"/>' +
        '</w:p></w:body></w:document>';
      const revised = `<w:document xmlns:w="${W_NS}"><w:body><w:p>` +
        '<w:bookmarkStart w:id="102" w:name="Inner"/>' +
        '<w:r><w:t>Heading</w:t></w:r><w:bookmarkEnd w:id="102"/>' +
        '</w:p></w:body></w:document>';

      const result = disambiguateOriginalBookmarkIds(original, revised);
      const document = parseXml(result.xml);
      const starts = Array.from(document.getElementsByTagName('w:bookmarkStart'));
      const ends = Array.from(document.getElementsByTagName('w:bookmarkEnd'));

      expect(result.remappedRanges).toBe(1);
      expect(starts.map((start) => [start.getAttribute('w:name'), start.getAttribute('w:id')]))
        .toEqual([['Inner', '101'], ['Outer', '103']]);
      expect(ends.map((end) => end.getAttribute('w:id'))).toEqual(['101', '103']);
    },
  );

  test('does not conflate a malformed duplicate original bookmark ID', () => {
    const original = `<w:document xmlns:w="${W_NS}"><w:body><w:p>` +
      '<w:bookmarkStart w:id="7" w:name="First"/><w:bookmarkEnd w:id="7"/>' +
      '<w:bookmarkStart w:id="7" w:name="Second"/><w:bookmarkEnd w:id="7"/>' +
      '</w:p></w:body></w:document>';
    const revised = `<w:document xmlns:w="${W_NS}"><w:body><w:p>` +
      '<w:bookmarkStart w:id="7" w:name="Revised"/><w:bookmarkEnd w:id="7"/>' +
      '</w:p></w:body></w:document>';

    expect(disambiguateOriginalBookmarkIds(original, revised)).toEqual({
      xml: original,
      remappedRanges: 0,
    });
  });

  test.openspec('Original-side bookmark collisions preserve reference targets')(
    'rewrites a fragmented PAGEREF and a simple REF with the bookmark',
    () => {
      const renames = new Map([['SharedTarget', '_safe_docx_original_1']]);
      const xml = `<w:document xmlns:w="${W_NS}"><w:body>` +
        '<w:p><w:bookmarkStart w:id="4" w:name="SharedTarget"/>' +
        '<w:r><w:t>Original target</w:t></w:r><w:bookmarkEnd w:id="4"/></w:p>' +
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> PAGE</w:instrText></w:r>' +
        '<w:r><w:instrText>REF Shared</w:instrText></w:r>' +
        '<w:r><w:instrText xml:space="preserve">Target \\h </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
        '<w:p><w:fldSimple w:instr=" REF SharedTarget \\h "><w:r><w:t>1</w:t></w:r>' +
        '</w:fldSimple></w:p></w:body></w:document>';

      const rewritten = renameBookmarkTargetsInXml(xml, renames);
      const document = parseXml(rewritten.xml);

      expect(rewritten).toMatchObject({ renamedBookmarks: 1, rewrittenFields: 2 });
      expect(document.getElementsByTagName('w:bookmarkStart')[0]
        ?.getAttribute('w:name')).toBe('_safe_docx_original_1');
      expect(instruction(rewritten.xml)).toContain(' PAGEREF _safe_docx_original_1 \\h ');
      expect(document.getElementsByTagName('w:fldSimple')[0]
        ?.getAttribute('w:instr')).toBe(' REF _safe_docx_original_1 \\h ');
    },
  );

  test('uses one deterministic collision-safe map across independent word stories', () => {
    const renames = createOriginalBookmarkRenameMap(
      ['SharedTarget'],
      new Set(['SharedTarget', '_safe_docx_original_1']),
    );
    const main = renameBookmarkTargetsInXml(
      `<w:document xmlns:w="${W_NS}"><w:body><w:p>` +
        '<w:bookmarkStart w:id="1" w:name="SharedTarget"/><w:bookmarkEnd w:id="1"/>' +
        '</w:p></w:body></w:document>',
      renames,
    );
    const header = renameBookmarkTargetsInXml(
      `<w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        '<w:r><w:instrText> REF Shared</w:instrText></w:r>' +
        '<w:r><w:instrText>Target </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>',
      renames,
    );

    expect([...renames.entries()]).toEqual([['SharedTarget', '_safe_docx_original_2']]);
    expect(main.xml).toContain('w:name="_safe_docx_original_2"');
    expect(instruction(header.xml)).toBe(' REF _safe_docx_original_2 ');
  });

  test('preserves fragment whitespace and rewrites every supported bookmark reference', () => {
    const sourceName = 'StraddlingRangeAlphaXY';
    const generatedName = '_safe_docx_original_1';
    const renames = new Map([[sourceName, generatedName]]);
    const xml = `<w:document xmlns:w="${W_NS}"><w:body>` +
      `<w:p><w:bookmarkStart w:id="7" w:name="${sourceName}"/>` +
      '<w:r><w:t>Target</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p>' +
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> REF </w:instrText></w:r>' +
      `<w:r><w:instrText>${sourceName}</w:instrText></w:r>` +
      '<w:r><w:instrText xml:space="preserve"> \\h </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
      `<w:p><w:fldSimple w:instr=" NOTEREF ${sourceName} \\h "/></w:p>` +
      `<w:p><w:fldSimple w:instr=" HYPERLINK \\l &quot;${sourceName}&quot; "/></w:p>` +
      `<w:p><w:fldSimple w:instr=" TOC \\b ${sourceName} \\o &quot;1-3&quot; "/></w:p>` +
      `<w:p><w:hyperlink w:anchor="${sourceName}"><w:r><w:t>Jump</w:t></w:r>` +
      '</w:hyperlink></w:p></w:body></w:document>';

    const rewritten = renameBookmarkTargetsInXml(xml, renames);
    const document = parseXml(rewritten.xml);
    const instructionNodes = Array.from(document.getElementsByTagName('w:instrText'));

    expect(rewritten).toMatchObject({
      renamedBookmarks: 1,
      rewrittenFields: 4,
      rewrittenHyperlinks: 1,
    });
    expect(instruction(rewritten.xml)).toBe(` REF ${generatedName} \\h `);
    expect(instructionNodes[1]?.textContent).toBe(`${generatedName} `);
    expect(instructionNodes[1]?.getAttribute('xml:space')).toBe('preserve');
    expect(Array.from(document.getElementsByTagName('w:fldSimple')).map(
      (field) => field.getAttribute('w:instr'),
    )).toEqual([
      ` NOTEREF ${generatedName} \\h `,
      ` HYPERLINK \\l "${generatedName}" `,
      ` TOC \\b ${generatedName} \\o "1-3" `,
    ]);
    expect(document.getElementsByTagName('w:hyperlink')[0]?.getAttribute('w:anchor'))
      .toBe(generatedName);
    expect(collectBookmarkReferenceNamesInXml(rewritten.xml)).toEqual([generatedName]);
  });

  test('applies one bookmark/field map to every WordprocessingML XML part', async () => {
    const archive = await DocxArchive.load(await buildDocxFromBodyXml(
      '<w:p><w:bookmarkStart w:id="1" w:name="SharedTarget"/>' +
      '<w:r><w:t>Target</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>',
    ));
    archive.setFile(
      'word/header1.xml',
      `<w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        '<w:r><w:instrText> REF Shared</w:instrText></w:r>' +
        '<w:r><w:instrText>Target </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>',
    );
    const renames = createOriginalBookmarkRenameMap(
      ['SharedTarget'],
      await collectWordPartBookmarkNames([archive]),
    );

    const result = await renameOriginalBookmarkTargetsAcrossWordParts(archive, renames);
    const header = await archive.getFile('word/header1.xml');

    expect(result).toEqual({
      renamedBookmarks: 1,
      rewrittenFields: 1,
      rewrittenHyperlinks: 0,
    });
    expect(await archive.getDocumentXml()).toContain('w:name="_safe_docx_original_1"');
    expect(instruction(header ?? '')).toBe(' REF _safe_docx_original_1 ');
  });
});
