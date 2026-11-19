import { describe, expect } from 'vitest';
import { DocxArchive } from '@usejunior/docx-core';
import { compareDocuments } from './index.js';
import { buildDocxFromBodyXml, paragraphWithText } from './testing/ooxml-fixtures.js';
import { testAllure } from './testing/allure-test.js';

const TEST_FEATURE = 'expose-comparison-move-statistics';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const DATE = new Date('2026-10-19T12:00:00Z');
const MOVED = 'this complete paragraph moves away to a new place in the document';

async function compareParagraphs(original: string[], revised: string[], detectMoves = true) {
  const [left, right] = await Promise.all([
    buildDocxFromBodyXml(original.map(paragraphWithText).join('')),
    buildDocxFromBodyXml(revised.map(paragraphWithText).join('')),
  ]);
  const result = await compareDocuments(left, right, { date: DATE, detectMoves });
  const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
  return { stats: result.stats, xml };
}

describe('public comparison statistics report detected moves (#940)', () => {
  test.openspec('A pure move is distinguishable from an unchanged document')(
    'reports a pure paragraph move without insertions or deletions',
    async () => {
      const { stats, xml } = await compareParagraphs(
        [MOVED, 'stable paragraph one', 'stable paragraph two'],
        ['stable paragraph one', 'stable paragraph two', MOVED],
      );

      expect(xml).toContain('<w:moveFrom ');
      expect(xml).toContain('<w:moveTo ');
      expect(stats).toEqual({
        atomMetricVersion: 'tagged-token-v1',
        insertions: 0,
        deletions: 0,
        modifications: 0,
        insertedRanges: 0,
        deletedRanges: 0,
        insertedAtoms: 0,
        deletedAtoms: 0,
        modifiedParagraphs: 0,
        formatChanges: 0,
        formatChangeAtoms: 0,
        insertedTableRows: 0,
        deletedTableRows: 0,
        moves: 1,
        movedParagraphs: 1,
        moveFromRanges: 2,
        moveToRanges: 2,
      });
    },
  );

  test.openspec('A move and an edit are reported separately')(
    'reports a move plus an unrelated insertion in both stat families',
    async () => {
      const { stats } = await compareParagraphs(
        [MOVED, 'stable paragraph one', 'stable paragraph two'],
        ['stable paragraph one', 'stable paragraph two changed', MOVED],
      );

      expect(stats).toMatchObject({
        moves: 1,
        movedParagraphs: 1,
        moveFromRanges: 2,
        moveToRanges: 2,
        insertions: 1,
        deletions: 0,
        insertedAtoms: 2,
        deletedAtoms: 0,
        modifiedParagraphs: 1,
      });
    },
  );

  test.openspec('A move and an edit are reported separately')(
    'reports a move plus a paragraph split without attributing the split to the move',
    async () => {
      const { stats, xml } = await compareParagraphs(
        [MOVED, 'stable first sentence. stable second sentence', 'stable tail'],
        ['stable first sentence.', 'stable second sentence', 'stable tail', MOVED],
      );

      expect(xml.match(/<w:moveFrom /g)).toHaveLength(1);
      expect(xml.match(/<w:moveTo /g)).toHaveLength(1);
      expect(stats).toMatchObject({ moves: 1, movedParagraphs: 1, moveFromRanges: 2, moveToRanges: 2 });
      expect(stats.insertedRanges).toBeGreaterThan(0);
    },
  );

  test.openspec('Move fields are zero without detected moves')(
    'reports zero move fields for identical documents and when move detection is off',
    async () => {
      const identical = await compareParagraphs(['alpha paragraph', 'beta paragraph'], ['alpha paragraph', 'beta paragraph']);
      expect(identical.stats).toMatchObject({ moves: 0, movedParagraphs: 0, moveFromRanges: 0, moveToRanges: 0 });

      const disabled = await compareParagraphs(
        [MOVED, 'stable paragraph one'],
        ['stable paragraph one', MOVED],
        false,
      );
      expect(disabled.stats).toMatchObject({ moves: 0, movedParagraphs: 0, moveFromRanges: 0, moveToRanges: 0 });
      expect(disabled.stats.insertedRanges).toBeGreaterThan(0);
      expect(disabled.stats.deletedRanges).toBeGreaterThan(0);
    },
  );
});
