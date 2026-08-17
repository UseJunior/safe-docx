/**
 * Focused legacy/tagged characterization rows that must exist before the
 * corresponding tagged behavior changes. The full external-corpus manifest is
 * intentionally a later Phase 1 task; these synthetic rows are always present
 * and make the two known default-path defects independently reproducible.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 */

import { DocxArchive, childElements, parseXml } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import {
  buildDocxFromBodyXml,
  completeField,
  fldChar,
  instrText,
  resultText,
} from '../testing/ooxml-fixtures.js';
import { compareDocumentsAtomizer } from '../baselines/atomizer/pipeline.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  rejectAllChanges,
} from '../baselines/atomizer/trackChangesAcceptorAst.js';
import { testAllure } from '../testing/allure-test.js';

const TEST_FEATURE = 'refactor-tagged-tree-spine';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const DATE = new Date('2026-08-17T12:00:00Z');

async function compareXml(
  originalBody: string,
  revisedBody: string,
  comparisonStrategy: 'legacy' | 'tagged-tree',
): Promise<string> {
  const [original, revised] = await Promise.all([
    buildDocxFromBodyXml(originalBody),
    buildDocxFromBodyXml(revisedBody),
  ]);
  const result = await compareDocumentsAtomizer(original, revised, {
    author: 'Strategy Differential',
    date: DATE,
    reconstructionMode: 'inplace',
    comparisonStrategy,
  });
  expect(result.comparisonStrategyUsed).toBe(comparisonStrategy);
  return (await DocxArchive.load(result.document)).getDocumentXml();
}

function paragraphChildTags(documentXml: string): string[] {
  const document = parseXml(documentXml);
  const paragraph = document.getElementsByTagName('w:p')[0];
  if (!paragraph) throw new Error('fixture has no paragraph');
  return childElements(paragraph as Element).map((child) => child.tagName);
}

function wrapperIds(documentXml: string): string[] {
  const document = parseXml(documentXml);
  return ['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo'].flatMap((tag) =>
    Array.from(document.getElementsByTagName(tag)).map((element) => element.getAttribute('w:id') ?? ''),
  );
}

function tocBody(page: string): string {
  return '<w:p>'
    + fldChar('begin')
    + instrText(' TOC \\o "1-3" \\h \\z \\u ', { preserve: true })
    + fldChar('separate')
    + '</w:p>'
    + '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>'
    + '<w:hyperlink w:anchor="_Toc100">'
    + resultText('Alpha Topic')
    + '<w:r><w:tab/></w:r>'
    + completeField(' PAGEREF _Toc100 \\h ', page)
    + '</w:hyperlink></w:p>'
    + `<w:p>${fldChar('end')}</w:p>`;
}

function revisionTexts(documentXml: string): string[] {
  const document = parseXml(documentXml);
  return ['w:ins', 'w:del'].flatMap((tag) =>
    Array.from(document.getElementsByTagName(tag)).map((element) => element.textContent ?? ''),
  );
}

function cacheInsensitiveText(documentXml: string): string {
  return extractTextWithParagraphs(documentXml).replace(/\d+/gu, '{PAGE}');
}

describe('strategy differential characterization', () => {
  test.openspec('Revision and bookmark identifiers may overlap numerically')(
    'records tagged bookmark-hoisting divergence before compatibility is ported',
    async () => {
      const trackedBody = '<w:p><w:bookmarkStart w:id="1" w:name="Overlap"/>'
        + '<w:r><w:t>kept</w:t></w:r>'
        + '<w:del w:id="1" w:author="Earlier" w:date="2026-01-01T00:00:00Z">'
        + '<w:r><w:delText>inside</w:delText></w:r>'
        + '<w:bookmarkEnd w:id="1"/>'
        + '<w:r><w:delText>outside</w:delText></w:r></w:del></w:p>';

      const [legacyXml, taggedXml] = await Promise.all([
        compareXml(trackedBody, trackedBody, 'legacy'),
        compareXml(trackedBody, trackedBody, 'tagged-tree'),
      ]);

      expect(paragraphChildTags(legacyXml)).toEqual([
        'w:bookmarkStart', 'w:r', 'w:del', 'w:bookmarkEnd', 'w:del',
      ]);
      expect(paragraphChildTags(taggedXml)).not.toEqual(paragraphChildTags(legacyXml));
      expect(new Set(wrapperIds(legacyXml)).size).toBe(wrapperIds(legacyXml).length);
      expect(parseXml(rejectAllChanges(taggedXml)).documentElement.textContent).toBe(
        'keptinsideoutside',
      );
    },
  );

  test.openspec('Volatile TOC cache changes are suppressed before final gates')(
    'records tagged PAGEREF cache divergence before finalization is ported',
    async () => {
      const originalBody = tocBody('3');
      const revisedBody = tocBody('10');
      const [legacyXml, taggedXml] = await Promise.all([
        compareXml(originalBody, revisedBody, 'legacy'),
        compareXml(originalBody, revisedBody, 'tagged-tree'),
      ]);

      expect(revisionTexts(legacyXml)).toEqual([]);
      expect(revisionTexts(taggedXml)).not.toEqual([]);
      expect(cacheInsensitiveText(acceptAllChanges(taggedXml))).toBe(
        cacheInsensitiveText(await compareSourceXml(revisedBody)),
      );
      expect(cacheInsensitiveText(rejectAllChanges(taggedXml))).toBe(
        cacheInsensitiveText(await compareSourceXml(originalBody)),
      );
    },
  );
});

async function compareSourceXml(bodyXml: string): Promise<string> {
  const source = await buildDocxFromBodyXml(bodyXml);
  return (await DocxArchive.load(source)).getDocumentXml();
}
