/**
 * Focused tagged-tree characterization rows retained after the authority flip.
 * These synthetic rows are always present and keep the formerly known
 * default-path defects independently reproducible.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 */

import { DocxArchive, checkGeneratedPackage, childElements, parseXml } from '@usejunior/docx-core';
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
  assertActiveDivergencesConsumed,
  assertCharacterizationSafety,
  assertExpectedPackageParts,
  characterizeStrategyDifferential,
  classifyOutputStructure,
  collectRevisionIdIssues,
  collectRevisionTopologyIssues,
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
const policyTest = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE });
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
  expect(result.engine).toBe('tagged-tree');
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
  test('detects every illegal run-inner revision-wrapper topology', () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:body><w:p>'
      + '<w:r><w:del w:id="7"/></w:r>'
      + '<w:r><w:drawing><w:ins w:id="8"/></w:drawing></w:r>'
      + '<w:r><w:moveFrom w:id="9"/></w:r>'
      + '<w:r><w:drawing><w:moveTo w:id="10"/></w:drawing></w:r>'
      + '</w:p></w:body></w:document>';

    expect(collectRevisionTopologyIssues(xml)).toEqual([
      'del:parent-r:id-7',
      'ins:parent-drawing:id-8',
      'moveFrom:parent-r:id-9',
      'moveTo:parent-drawing:id-10',
    ]);
  });

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
      const missingAuthority = structuredClone(row);
      delete missingAuthority.taggedTree.authority.comparisonStrategyUsed;
      expect(() => assertCharacterizationSafety(missingAuthority)).toThrow(/fell back to undefined/u);

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

      const formattingDrift = structuredClone(row);
      formattingDrift.taggedTree.formatting.score = 0.75;
      expect(() => assertCharacterizationSafety(formattingDrift))
        .toThrow(/formatting fidelity drifted/u);
      expect(assertCharacterizationSafety(
        formattingDrift,
        new Set(['tagged-tree.formattingFidelity']),
      )).toEqual(new Set(['tagged-tree.formattingFidelity']));

      const unsupportedStory = structuredClone(row);
      unsupportedStory.taggedTree.unsupportedStoryDiagnostics.push('text-box:unsupported');
      expect(() => assertCharacterizationSafety(unsupportedStory))
        .toThrow(/unsupported story diagnostics/u);

      const invalidField = structuredClone(row);
      invalidField.taggedTree.integrity.fieldIssues.push('combined:FIELD_UNCLOSED');
      expect(() => assertCharacterizationSafety(invalidField))
        .toThrow(/failed fieldIssues/u);

      const invalidBookmark = structuredClone(row);
      invalidBookmark.taggedTree.integrity.bookmarkIssues.push('combined:duplicate-name:Target');
      expect(() => assertCharacterizationSafety(invalidBookmark))
        .toThrow(/failed bookmarkIssues/u);

      const invalidRevisionTopology = structuredClone(row);
      invalidRevisionTopology.taggedTree.integrity.revisionTopologyIssues.push(
        'del:parent-r:id-7',
      );
      expect(() => assertCharacterizationSafety(invalidRevisionTopology))
        .toThrow(/failed revisionTopologyIssues/u);

      const reusedRevisionId = structuredClone(row);
      reusedRevisionId.taggedTree.integrity.revisionIdIssues.push(
        'revision-id-reused-across-identities:7',
      );
      expect(() => assertCharacterizationSafety(reusedRevisionId))
        .toThrow(/failed revisionIdIssues/u);

      const unbalancedMove = structuredClone(row);
      unbalancedMove.taggedTree.integrity.moveBalanceIssues.push(
        'moveFrom:range-boundaries-unbalanced',
      );
      expect(() => assertCharacterizationSafety(unbalancedMove))
        .toThrow(/failed moveBalanceIssues/u);
    },
  );

  // ECMA-376 Part 1 § 17.13.6.2 lets a document repeat a bookmark name, so a
  // repeat in an input is a recorded warning. A repeat the comparison itself
  // introduces still fails (#1264).
  const bookmarkedParagraph = (id: number, name: string, text: string): string =>
    `<w:p><w:bookmarkStart w:id="${id}" w:name="${name}"/>` +
    `<w:r><w:t>${text}</w:t></w:r><w:bookmarkEnd w:id="${id}"/></w:p>`;
  const repeatedTargetBody = (tail: string): string =>
    bookmarkedParagraph(1, 'Target', 'First target.') +
    bookmarkedParagraph(2, 'Target', 'Second target.') +
    `<w:p><w:r><w:t>${tail}</w:t></w:r></w:p>`;
  const repeatedTarget = {
    check: 'bookmark_name_uniqueness',
    part: 'word/document.xml',
    message: "Bookmark name 'Target' is used twice",
    bookmarkName: 'target',
  };

  test('records a bookmark name both inputs repeat as a warning and passes the row', async () => {
    const [original, revised] = await Promise.all([
      buildDocxFromBodyXml(repeatedTargetBody('Old tail.')),
      buildDocxFromBodyXml(repeatedTargetBody('New tail.')),
    ]);
    const row = await characterizeStrategyDifferential({
      id: 'synthetic-repeated-bookmark-name',
      original,
      revised,
      capabilityTags: ['bookmarks'],
    });
    expect(row.fixture.sourceStructuralIssues).toEqual([]);
    expect(row.fixture.sourceStructuralWarnings).toEqual([repeatedTarget]);
    expect(row.taggedTree.schema).toEqual({
      packageStructural: 'inherited',
      issues: [repeatedTarget],
      introducedIssues: [],
      warnings: [repeatedTarget],
    });
    expect(row.taggedTree.integrity.bookmarkIssues).toEqual([]);
    expect(() => assertCharacterizationSafety(row)).not.toThrow();
  });

  test('fails a bookmark name the comparison repeats when no input repeats it in that part', async () => {
    const [unique, repeated] = await Promise.all([
      buildDocxFromBodyXml(
        bookmarkedParagraph(1, 'Target', 'First target.') +
        bookmarkedParagraph(2, 'Other', 'Second target.'),
      ),
      buildDocxFromBodyXml(repeatedTargetBody('Tail.')),
    ]);
    const output = await checkGeneratedPackage(repeated);
    expect(output.issues).toEqual([repeatedTarget]);

    const sources = await checkGeneratedPackage(unique, { duplicateBookmarkNames: 'warning' });
    expect(sources.warnings).toEqual([]);
    const introduced = classifyOutputStructure(output, sources.issues, [sources.warnings]);
    expect(introduced).toEqual({
      packageStructural: 'failed',
      issues: [repeatedTarget],
      introducedIssues: [repeatedTarget],
      warnings: [],
    });

    // An input repeating a different name, or the same name in another
    // story part, does not excuse this repeat.
    for (const sourceWarning of [
      { ...repeatedTarget, message: "Bookmark name 'Other' is used twice", bookmarkName: 'other' },
      { ...repeatedTarget, part: 'word/header1.xml' },
    ]) {
      expect(classifyOutputStructure(output, [], [[sourceWarning]]).packageStructural).toBe('failed');
    }
    expect(classifyOutputStructure(output, [], [[repeatedTarget]]).packageStructural).toBe('inherited');

    const [original, revised] = await Promise.all([
      buildDocxFromBodyXml('<w:p><w:r><w:t>old</w:t></w:r></w:p>'),
      buildDocxFromBodyXml('<w:p><w:r><w:t>new</w:t></w:r></w:p>'),
    ]);
    const row = await characterizeStrategyDifferential({
      id: 'synthetic-introduced-bookmark-name',
      original,
      revised,
      capabilityTags: ['bookmarks'],
    });
    row.taggedTree.schema = introduced;
    expect(() => assertCharacterizationSafety(row))
      .toThrow(/introduced package structural failures: bookmark_name_uniqueness:word\/document\.xml/u);
  });

  test('fails a comparison that adds a further range under a name an input already repeats', async () => {
    // Two original "Target" ranges against one wholly rewritten revised range:
    // the comparison keeps both deleted ranges and adds the inserted one, so
    // the output holds three "Target" ranges although no input has more than
    // two. That extra collision is the comparison's, in either direction.
    const twice = bookmarkedParagraph(1, 'Target', 'First original target.') +
      bookmarkedParagraph(2, 'Target', 'Second original target.');
    const once = bookmarkedParagraph(1, 'Target', 'Completely revised target.');
    for (const [id, originalBody, revisedBody] of [
      ['synthetic-added-repeat-original-twice', twice, once],
      ['synthetic-added-repeat-revised-twice', once, twice],
    ] as const) {
      const [original, revised] = await Promise.all([
        buildDocxFromBodyXml(originalBody),
        buildDocxFromBodyXml(revisedBody),
      ]);
      const row = await characterizeStrategyDifferential({ id, original, revised, capabilityTags: ['bookmarks'] });
      expect(row.fixture.sourceStructuralWarnings).toEqual([repeatedTarget]);
      expect(row.taggedTree.schema.issues).toEqual([repeatedTarget, repeatedTarget]);
      expect(row.taggedTree.schema.packageStructural, id).toBe('failed');
      expect(row.taggedTree.schema.warnings).toEqual([]);
      expect(() => assertCharacterizationSafety(row))
        .toThrow(/introduced package structural failures: bookmark_name_uniqueness:word\/document\.xml/u);
    }
  });

  test('rejects active divergences that did not suppress an observed assertion', () => {
    expect(() => assertActiveDivergencesConsumed(
      new Set(['TD-OBSERVED-001', 'TD-UNOBSERVED-002']),
      new Set(['TD-OBSERVED-001']),
    )).toThrow(/TD-UNOBSERVED-002/u);
  });

  const revision = (
    kind: 'ins' | 'del',
    text: string,
    author = 'Strategy Differential',
    date = '2026-08-17T12:00:00Z',
  ): string => {
    const textElement = kind === 'del' ? 'delText' : 't';
    return `<w:${kind} w:id="7" w:author="${author}" w:date="${date}">` +
      `<w:r><w:${textElement}>${text}</w:${textElement}></w:r></w:${kind}>`;
  };

  policyTest.openspec('Sibling fragments of one logical revision may share an identifier')(
    'allows same-signature sibling fragments separated by a bookmark boundary',
    async () => {
      const [candidate, emptySource] = await Promise.all([
        compareSourceXml(
          '<w:p>' + revision('del', 'first') +
          '<w:bookmarkStart w:id="1" w:name="Boundary"/>' +
          revision('del', 'second') +
          '<w:bookmarkEnd w:id="1"/></w:p>',
        ),
        compareSourceXml('<w:p/>'),
      ]);

      expect(collectRevisionIdIssues(candidate, emptySource, emptySource)).toEqual([]);
    },
  );

  policyTest.openspec('Revision identifier reuse across logical signatures fails')(
    'rejects cross-scope, cross-kind, metadata, and source collisions',
    async () => {
      const [emptySource, source] = await Promise.all([
        compareSourceXml('<w:p/>'),
        compareSourceXml(`<w:p>${revision(
          'ins',
          'source',
          'Human',
          '2026-01-01T00:00:00Z',
        )}</w:p>`),
      ]);
      const issue = 'revision-id-reused-across-identities:7';
      const cases = await Promise.all([
        compareSourceXml(
          `<w:p>${revision('ins', 'first')}</w:p>` +
          `<w:p>${revision('ins', 'second')}</w:p>`,
        ),
        compareSourceXml(`<w:p>${revision('ins', 'first')}${revision('del', 'second')}</w:p>`),
        compareSourceXml(
          `<w:p>${revision('ins', 'first')}${revision('ins', 'second', 'Another Author')}</w:p>`,
        ),
        compareSourceXml(
          `<w:p>${revision('ins', 'first')}` +
          `${revision('ins', 'second', 'Strategy Differential', '2026-08-18T12:00:00Z')}</w:p>`,
        ),
        compareSourceXml(
          `<w:p>${revision('ins', 'first')}` +
          '<w:pPrChange w:id="7" w:author="Strategy Differential" ' +
          'w:date="2026-08-17T12:00:00Z"><w:pPr/></w:pPrChange></w:p>',
        ),
      ]);

      for (const candidate of cases) {
        expect(collectRevisionIdIssues(candidate, emptySource, emptySource)).toContain(issue);
      }

      const candidate = await compareSourceXml(`<w:p>${revision('ins', 'comparison')}</w:p>`);
      expect(collectRevisionIdIssues(candidate, source, emptySource))
        .toContain('comparison-id-collides-with-source:7');
    },
  );

  policyTest.openspec('Linked property-change facets share a normalized logical signature')(
    'allows linked property-change facets in the same paragraph scope',
    async () => {
      const propertyChangeAttributes =
        'w:id="8" w:author="Strategy Differential" w:date="2026-08-17T12:00:00Z"';
      const [candidate, emptySource] = await Promise.all([
        compareSourceXml(
          '<w:p><w:pPr>' +
          `<w:pPrChange ${propertyChangeAttributes}><w:pPr/></w:pPrChange>` +
          '<w:rPr>' +
          `<w:rPrChange ${propertyChangeAttributes}><w:rPr/></w:rPrChange>` +
          '</w:rPr></w:pPr><w:r><w:t>same paragraph</w:t></w:r></w:p>',
        ),
        compareSourceXml('<w:p/>'),
      ]);

      expect(collectRevisionIdIssues(candidate, emptySource, emptySource)).toEqual([]);
    },
  );
});

async function compareSourceXml(bodyXml: string): Promise<string> {
  const source = await buildDocxFromBodyXml(bodyXml);
  return (await DocxArchive.load(source)).getDocumentXml();
}
