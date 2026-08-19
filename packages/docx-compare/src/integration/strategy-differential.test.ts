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
import { compareDocumentsAtomizer } from '../tagged/pipeline.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  rejectAllChanges,
} from '../tagged/trackChangesAcceptorAst.js';
import { testAllure } from '../testing/allure-test.js';
import {
  assertCharacterizationSafety,
  assertExpectedPackageParts,
  characterizeStrategyDifferential,
  type StrategyDifferentialFixture,
} from './strategy-differential-harness.js';

const TEST_FEATURE = 'refactor-tagged-tree-spine';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.45' },
  );
const DATE = new Date('2026-08-17T12:00:00Z');

async function compareXml(
  originalBody: string,
  revisedBody: string,
): Promise<string> {
  const [original, revised] = await Promise.all([
    buildDocxFromBodyXml(originalBody),
    buildDocxFromBodyXml(revisedBody),
  ]);
  const result = await compareDocumentsAtomizer(original, revised, {
    author: 'Strategy Differential',
    date: DATE,
  });
  expect(result.comparisonStrategyUsed).toBe('tagged-tree');
  const documentXml = await (await DocxArchive.load(result.document)).getDocumentXml();
  expect(documentXml.startsWith('<?xml')).toBe(true);
  return documentXml;
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

describe('sole tagged-spine characterization', () => {
  test.openspec('Revision and bookmark identifiers may overlap numerically')(
    'keeps tagged bookmark hoisting equivalent with overlapping ID spaces',
    async () => {
      const trackedBody = '<w:p><w:bookmarkStart w:id="1" w:name="Overlap"/>'
        + '<w:r><w:t>kept</w:t></w:r>'
        + '<w:del w:id="1" w:author="Earlier" w:date="2026-01-01T00:00:00Z">'
        + '<w:r><w:delText>inside</w:delText></w:r>'
        + '<w:bookmarkEnd w:id="1"/>'
        + '<w:r><w:delText>outside</w:delText></w:r></w:del></w:p>';

      const taggedXml = await compareXml(trackedBody, trackedBody);

      expect(paragraphChildTags(taggedXml)).toEqual([
        'w:bookmarkStart', 'w:r', 'w:del', 'w:bookmarkEnd', 'w:del',
      ]);
      expect(new Set(wrapperIds(taggedXml)).size).toBe(wrapperIds(taggedXml).length);
      expect(parseXml(rejectAllChanges(taggedXml)).documentElement.textContent).toBe(
        'keptinsideoutside',
      );

      const enclosedOriginal = '<w:p><w:bookmarkStart w:id="1" w:name="DeletedRange"/>'
        + '<w:r><w:t>deleted</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>';
      const enclosedTaggedXml = await compareXml(enclosedOriginal, '<w:p/>');
      expect(acceptAllChanges(enclosedTaggedXml)).not.toContain('DeletedRange');
      expect(rejectAllChanges(enclosedTaggedXml)).toContain('DeletedRange');
    },
  );

  test.openspec('Volatile TOC cache changes are suppressed before final gates')(
    'keeps volatile PAGEREF cache refreshes out of tracked revisions',
    async () => {
      const originalBody = tocBody('3');
      const revisedBody = tocBody('10');
      const taggedXml = await compareXml(originalBody, revisedBody);

      expect(revisionTexts(taggedXml)).toEqual([]);
      expect(cacheInsensitiveText(acceptAllChanges(taggedXml))).toBe(
        cacheInsensitiveText(await compareSourceXml(revisedBody)),
      );
      expect(cacheInsensitiveText(rejectAllChanges(taggedXml))).toBe(
        cacheInsensitiveText(await compareSourceXml(originalBody)),
      );
    },
  );
});

describe('strategy differential manifest evidence', () => {
  test.openspec('Missing corpus evidence fails loudly')(
    'records complete deterministic evidence and rejects missing package coverage',
    async () => {
      const [original, revised] = await Promise.all([
        buildDocxFromBodyXml(
          '<w:p><w:bookmarkStart w:id="1" w:name="Evidence"/>' +
            '<w:r><w:t>Alpha old</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>',
        ),
        buildDocxFromBodyXml(
          '<w:p><w:bookmarkStart w:id="1" w:name="Evidence"/>' +
            '<w:r><w:t>Alpha new</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>',
        ),
      ]);
      const fixture: StrategyDifferentialFixture = {
        id: 'synthetic-bookmark-replacement',
        original,
        revised,
        capabilityTags: ['bookmarks', 'formatting', 'relationships'],
        expectedPackageParts: [
          '[Content_Types].xml',
          '_rels/.rels',
          'word/document.xml',
          'word/_rels/document.xml.rels',
        ],
      };

      const first = await characterizeStrategyDifferential(fixture);
      const second = await characterizeStrategyDifferential(fixture);

      expect(second).toEqual(first);
      expect(first.fixture.capabilityTags).toEqual([
        'bookmarks',
        'formatting',
        'relationships',
      ]);
      expect(first.fixture.originalSha256).not.toBe(first.fixture.revisedSha256);
      expect(first.taggedTree.strategy).toBe('tagged-tree');
      assertCharacterizationSafety(first);
      assertExpectedPackageParts(fixture, first);

      expect(() => assertExpectedPackageParts(
        { ...fixture, expectedPackageParts: ['word/comments.xml'] },
        first,
      )).toThrow(/no longer exercises expected source part word\/comments\.xml/u);
    },
  );

  test.openspec('Missing corpus evidence fails loudly')(
    'rejects fallback and projection drift instead of recording a green row',
    async () => {
      const [original, revised] = await Promise.all([
        buildDocxFromBodyXml('<w:p><w:r><w:t>old</w:t></w:r></w:p>'),
        buildDocxFromBodyXml('<w:p><w:r><w:t>new</w:t></w:r></w:p>'),
      ]);
      const row = await characterizeStrategyDifferential({
        id: 'synthetic-safety-failure',
        original,
        revised,
        capabilityTags: ['fallbacks', 'projections'],
      });
      const fallback = structuredClone(row);
      fallback.taggedTree.fallback.comparisonStrategyUsed = 'legacy';
      expect(() => assertCharacterizationSafety(fallback)).toThrow(/fell back to legacy/u);

      const projectionDrift = structuredClone(row);
      projectionDrift.taggedTree.projections.accept.matchesSourceText = false;
      expect(() => assertCharacterizationSafety(projectionDrift))
        .toThrow(/accept projection drifted/u);
      expect(() => assertCharacterizationSafety(
        projectionDrift,
        new Set(['tagged-tree.acceptProjection']),
      )).not.toThrow();
      expect(() => assertCharacterizationSafety(
        projectionDrift,
        new Set(['tagged-tree.rejectProjection']),
      )).toThrow(/accept projection drifted/u);
    },
  );
});

async function compareSourceXml(bodyXml: string): Promise<string> {
  const source = await buildDocxFromBodyXml(bodyXml);
  return (await DocxArchive.load(source)).getDocumentXml();
}
