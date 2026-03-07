import { describe, expect } from 'vitest';
import { createComparisonUnitAtom } from './atomizer.js';
import { markCorrelationStatus } from './baselines/atomizer/atomLcs.js';
import {
  CorrelationStatus,
  DEFAULT_FORMAT_DETECTION_SETTINGS,
  type ComparisonUnitAtom,
  type ListLevelInfo,
  type OpcPart,
} from './core-types.js';
import {
  detectFormatChangesInAtomList,
  areRunPropertiesEqual,
  generateFormatChangeMarkup,
  getChangedPropertyNames,
  getRunPropertiesFromAtom,
  mergeFormatChangeIntoRun,
  normalizeRunProperties,
} from './format-detection.js';
import { findReferencesInOrder, FootnoteNumberingTracker } from './footnotes.js';
import {
  detectMovesInAtomList,
  generateMoveDestinationMarkup,
  generateMoveSourceMarkup,
  jaccardWordSimilarity,
} from './move-detection.js';
import {
  createNumberingState,
  detectContinuationPattern,
  processNumberedParagraph,
} from './numbering.js';
import { testAllure, allureStep } from './testing/allure-test.js';
import { assertDefined } from './testing/test-utils.js';
import { el } from './testing/dom-test-helpers.js';
import { childElements, getLeafText } from './primitives/index.js';

const TEST_FEATURE = 'docx-comparison';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const humanReadableTest = test.allure({
  tags: ['human-readable'],
  parameters: { audience: 'developers' },
});

const PART: OpcPart = {
  uri: 'word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function makeTextAtom(
  text: string,
  status: CorrelationStatus = CorrelationStatus.Unknown,
  runProps: Element[] | null = []
): ComparisonUnitAtom {
  const runChildren: Element[] = [];
  if (runProps !== null) {
    runChildren.push(el('w:rPr', {}, runProps));
  }
  runChildren.push(el('w:t', {}, undefined, text));

  const run = el('w:r', {}, runChildren);
  const paragraph = el('w:p', {}, [run]);

  return {
    sha1Hash: `hash-${text}`,
    correlationStatus: status,
    contentElement: el('w:t', {}, undefined, text),
    ancestorElements: [paragraph, run],
    ancestorUnids: [],
    part: PART,
  };
}

function createDocumentWithFootnotes(ids: string[], customMarkIds: Set<string> = new Set()): Element {
  return el('w:body', {}, ids.map((id) =>
    el('w:p', {}, [
      el('w:r', {}, [
        el('w:footnoteReference', customMarkIds.has(id)
          ? { 'w:id': id, 'w:customMarkFollows': '1' }
          : { 'w:id': id }),
      ]),
    ])
  ));
}

describe('OpenSpec traceability: docx-comparison', () => {
  // Correlation status enumeration
  humanReadableTest.openspec('Status assigned during comparison')(
    'Scenario: Status assigned during comparison',
    async () => {
      const { original, revised } = await allureStep('Given matching original and revised atoms', () => {
        const original = [makeTextAtom('hello')];
        const revised = [makeTextAtom('hello')];
        return { original, revised };
      });

      await allureStep('When correlation status is marked with a match', () => {
        markCorrelationStatus(original, revised, {
          matches: [{ originalIndex: 0, revisedIndex: 0 }],
          deletedIndices: [],
          insertedIndices: [],
        });
      });

      await allureStep('Then the revised atom is marked as Equal', () => {
        expect(revised[0]!.correlationStatus).toBe(CorrelationStatus.Equal);
      });
    },
  );

  humanReadableTest.openspec('Status for unmatched atoms')(
    'Scenario: Status for unmatched atoms',
    async () => {
      const { original, revised } = await allureStep('Given non-matching original and revised atoms', () => {
        return { original: [makeTextAtom('old')], revised: [makeTextAtom('new')] };
      });

      await allureStep('When correlation status is marked with no matches', () => {
        markCorrelationStatus(original, revised, {
          matches: [],
          deletedIndices: [0],
          insertedIndices: [0],
        });
      });

      await allureStep('Then the revised atom is marked as Inserted', () => {
        expect(revised[0]!.correlationStatus).toBe(CorrelationStatus.Inserted);
      });
    },
  );

  humanReadableTest.openspec('Status for deleted content')(
    'Scenario: Status for deleted content',
    async () => {
      const { original, revised } = await allureStep('Given non-matching original and revised atoms', () => {
        return { original: [makeTextAtom('old')], revised: [makeTextAtom('new')] };
      });

      await allureStep('When correlation status is marked with deletions', () => {
        markCorrelationStatus(original, revised, {
          matches: [],
          deletedIndices: [0],
          insertedIndices: [0],
        });
      });

      await allureStep('Then the original atom is marked as Deleted', () => {
        expect(original[0]!.correlationStatus).toBe(CorrelationStatus.Deleted);
      });
    },
  );

  humanReadableTest.openspec('Status for moved source content')(
    'Scenario: Status for moved source content',
    async () => {
      const atoms = await allureStep('Given atoms with deleted and inserted similar text', () => [
        makeTextAtom('The quick brown fox', CorrelationStatus.Deleted),
        makeTextAtom('bridge', CorrelationStatus.Equal),
        makeTextAtom('The quick brown fox jumps', CorrelationStatus.Inserted),
      ]);

      await allureStep('When move detection is applied', () => {
        detectMovesInAtomList(atoms, {
          detectMoves: true,
          moveSimilarityThreshold: 0.6,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await allureStep('Then the deleted atom is marked as MovedSource', () => {
        expect(atoms[0]!.correlationStatus).toBe(CorrelationStatus.MovedSource);
      });
    },
  );

  humanReadableTest.openspec('Status for moved destination content')(
    'Scenario: Status for moved destination content',
    async () => {
      const atoms = await allureStep('Given atoms with deleted and inserted similar text', () => [
        makeTextAtom('The quick brown fox', CorrelationStatus.Deleted),
        makeTextAtom('bridge', CorrelationStatus.Equal),
        makeTextAtom('The quick brown fox jumps', CorrelationStatus.Inserted),
      ]);

      await allureStep('When move detection is applied', () => {
        detectMovesInAtomList(atoms, {
          detectMoves: true,
          moveSimilarityThreshold: 0.6,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await allureStep('Then the inserted atom is marked as MovedDestination', () => {
        expect(atoms[2]!.correlationStatus).toBe(CorrelationStatus.MovedDestination);
      });
    },
  );

  humanReadableTest.openspec('Status for format-changed content')(
    'Scenario: Status for format-changed content',
    async () => {
      const after = await allureStep('Given an atom with bold added compared to its before state', () => {
        const before = makeTextAtom('hello', CorrelationStatus.Equal, []);
        const after = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
        after.comparisonUnitAtomBefore = before;
        return after;
      });

      await allureStep('When format change detection is applied', () => {
        detectFormatChangesInAtomList([after]);
      });

      await allureStep('Then the atom is marked as FormatChanged', () => {
        expect(after.correlationStatus).toBe(CorrelationStatus.FormatChanged);
      });
    },
  );

  // XML element / part / hash
  humanReadableTest.openspec('Element with text content')(
    'Scenario: Element with text content',
    async () => {
      const element = await allureStep('Given a w:t element with text content', () => {
        return el('w:t', {}, undefined, 'Hello World');
      });

      await allureStep('Then the element has correct tag and text', () => {
        expect(element.tagName).toBe('w:t');
        expect(getLeafText(element)).toBe('Hello World');
      });
    },
  );

  humanReadableTest.openspec('Element with attributes')(
    'Scenario: Element with attributes',
    async () => {
      const element = await allureStep('Given a w:p element with a Unid attribute', () => {
        return el('w:p', { 'pt14:Unid': 'abc123' });
      });

      await allureStep('Then the attribute value is accessible', () => {
        expect(element.getAttribute('pt14:Unid')).toBe('abc123');
      });
    },
  );

  humanReadableTest.openspec('Part from main document')(
    'Scenario: Part from main document',
    async () => {
      await allureStep('Then the part URI points to the main document', () => {
        expect(PART.uri).toBe('word/document.xml');
      });
    },
  );

  humanReadableTest.openspec('Hash calculation for content identity')(
    'Scenario: Hash calculation for content identity',
    async () => {
      const atom = await allureStep('Given an atom created from text content', () => {
        return createComparisonUnitAtom({
          contentElement: el('w:t', {}, undefined, 'hash me'),
          ancestors: [],
          part: PART,
        });
      });

      await allureStep('Then the SHA1 hash is 40 characters long', () => {
        expect(atom.sha1Hash).toHaveLength(40);
      });
    },
  );

  // ComparisonUnitAtom interface scenarios
  humanReadableTest.openspec('Atom from inserted revision')(
    'Scenario: Atom from inserted revision',
    async () => {
      const atom = await allureStep('Given an atom created inside a w:ins ancestor', () => {
        const ins = el('w:ins', { 'w:id': '1' });
        return createComparisonUnitAtom({
          contentElement: el('w:t', {}, undefined, 'new'),
          ancestors: [ins],
          part: PART,
        });
      });

      await allureStep('Then the atom is marked Inserted with w:ins revision tracking', () => {
        expect(atom.correlationStatus).toBe(CorrelationStatus.Inserted);
        expect(atom.revTrackElement?.tagName).toBe('w:ins');
      });
    },
  );

  humanReadableTest.openspec('Atom from deleted revision')(
    'Scenario: Atom from deleted revision',
    async () => {
      const atom = await allureStep('Given an atom created inside a w:del ancestor', () => {
        const del = el('w:del', { 'w:id': '1' });
        return createComparisonUnitAtom({
          contentElement: el('w:delText', {}, undefined, 'old'),
          ancestors: [del],
          part: PART,
        });
      });

      await allureStep('Then the atom is marked Deleted with w:del revision tracking', () => {
        expect(atom.correlationStatus).toBe(CorrelationStatus.Deleted);
        expect(atom.revTrackElement?.tagName).toBe('w:del');
      });
    },
  );

  humanReadableTest.openspec('Atom with ancestor tracking')(
    'Scenario: Atom with ancestor tracking',
    async () => {
      const atom = await allureStep('Given an atom created with paragraph and run ancestors', () => {
        const paragraph = el('w:p');
        const run = el('w:r');
        return createComparisonUnitAtom({
          contentElement: el('w:t', {}, undefined, 'nested'),
          ancestors: [paragraph, run],
          part: PART,
        });
      });

      await allureStep('Then the ancestor elements preserve their tag names', () => {
        expect(atom.ancestorElements.map((e) => e.tagName)).toEqual(['w:p', 'w:r']);
      });
    },
  );

  humanReadableTest.openspec('Atom marked as moved source')(
    'Scenario: Atom marked as moved source',
    async () => {
      const atoms = await allureStep('Given atoms with similar deleted and inserted text separated by equal content', () => [
        makeTextAtom('The quick brown fox', CorrelationStatus.Deleted),
        makeTextAtom('separator', CorrelationStatus.Equal),
        makeTextAtom('The quick brown fox jumps', CorrelationStatus.Inserted),
      ]);

      await allureStep('When move detection is applied', () => {
        detectMovesInAtomList(atoms, {
          detectMoves: true,
          moveSimilarityThreshold: 0.6,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await allureStep('Then the source atom has MovedSource status with move metadata', () => {
        expect(atoms[0]!.correlationStatus).toBe(CorrelationStatus.MovedSource);
        expect(atoms[0]!.moveGroupId).toBeDefined();
        expect(atoms[0]!.moveName).toMatch(/^move/);
      });
    },
  );

  humanReadableTest.openspec('Atom marked as moved destination')(
    'Scenario: Atom marked as moved destination',
    async () => {
      const atoms = await allureStep('Given atoms with similar deleted and inserted text separated by equal content', () => [
        makeTextAtom('The quick brown fox', CorrelationStatus.Deleted),
        makeTextAtom('separator', CorrelationStatus.Equal),
        makeTextAtom('The quick brown fox jumps', CorrelationStatus.Inserted),
      ]);

      await allureStep('When move detection is applied', () => {
        detectMovesInAtomList(atoms, {
          detectMoves: true,
          moveSimilarityThreshold: 0.6,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await allureStep('Then the destination atom shares move metadata with the source', () => {
        expect(atoms[2]!.correlationStatus).toBe(CorrelationStatus.MovedDestination);
        expect(atoms[2]!.moveGroupId).toBe(atoms[0]!.moveGroupId);
        expect(atoms[2]!.moveName).toBe(atoms[0]!.moveName);
      });
    },
  );

  humanReadableTest.openspec('Atom marked as format-changed')(
    'Scenario: Atom marked as format-changed',
    async () => {
      const after = await allureStep('Given an atom with bold added compared to its before state', () => {
        const before = makeTextAtom('hello', CorrelationStatus.Equal, []);
        const after = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
        after.comparisonUnitAtomBefore = before;
        return after;
      });

      await allureStep('When format change detection is applied', () => {
        detectFormatChangesInAtomList([after]);
      });

      await allureStep('Then the atom has FormatChanged status with bold in changed properties', () => {
        expect(after.correlationStatus).toBe(CorrelationStatus.FormatChanged);
        expect(after.formatChange?.oldRunProperties).toBeDefined();
        expect(after.formatChange?.newRunProperties).toBeDefined();
        expect(after.formatChange?.changedProperties).toContain('bold');
      });
    },
  );

  // Factory function scenarios
  humanReadableTest.openspec('Creating atom with revision detection')(
    'Scenario: Creating atom with revision detection',
    async () => {
      const atom = await allureStep('Given an atom created with a w:ins revision ancestor', () => {
        const ins = el('w:ins', { 'w:id': '1' });
        return createComparisonUnitAtom({
          contentElement: el('w:t', {}, undefined, 'new'),
          ancestors: [ins],
          part: PART,
        });
      });

      await allureStep('Then the atom detects insertion revision context', () => {
        expect(atom.correlationStatus).toBe(CorrelationStatus.Inserted);
        expect(atom.revTrackElement?.tagName).toBe('w:ins');
      });
    },
  );

  humanReadableTest.openspec('Creating atom without revision context')(
    'Scenario: Creating atom without revision context',
    async () => {
      const atom = await allureStep('Given an atom created with no revision ancestors', () => {
        return createComparisonUnitAtom({
          contentElement: el('w:t', {}, undefined, 'plain'),
          ancestors: [],
          part: PART,
        });
      });

      await allureStep('Then the atom has no revision tracking and Unknown or Equal status', () => {
        expect(atom.revTrackElement ?? null).toBeNull();
        expect([
          CorrelationStatus.Unknown,
          CorrelationStatus.Equal,
        ]).toContain(atom.correlationStatus);
      });
    },
  );

  // Numbering continuation scenarios
  humanReadableTest.openspec('Orphan list item renders with parent format')(
    'Scenario: Orphan list item renders with parent format',
    async () => {
      const { state, level0, level1 } = await allureStep('Given numbering state and level definitions', () => {
        const state = createNumberingState();
        const level0: ListLevelInfo = { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' };
        const level1: ListLevelInfo = { ilvl: 1, start: 4, numFmt: 'decimal', lvlText: '%1.%2' };
        return { state, level0, level1 };
      });

      const continuation = await allureStep('When three level-0 items are processed then a level-1 orphan', () => {
        processNumberedParagraph(state, 1, 0, level0);
        processNumberedParagraph(state, 1, 0, level0);
        processNumberedParagraph(state, 1, 0, level0);
        return processNumberedParagraph(state, 1, 1, level1);
      });

      await allureStep('Then the orphan continues as item 4', () => {
        expect(continuation).toBe(4);
      });
    },
  );

  humanReadableTest.openspec('Proper nested list renders hierarchically')(
    'Scenario: Proper nested list renders hierarchically',
    async () => {
      const result = await allureStep('Given a nested list item at level 1 with parent at level 0', () => {
        return detectContinuationPattern(1, 1, [1, 0, 0]);
      });

      await allureStep('Then it is not a continuation and stays at level 1', () => {
        expect(result.isContinuation).toBe(false);
        expect(result.effectiveLevel).toBe(1);
      });
    },
  );

  humanReadableTest.openspec('Continuation pattern inherits formatting')(
    'Scenario: Continuation pattern inherits formatting',
    async () => {
      const result = await allureStep('Given a list item with start=4 and 3 items already at level 0', () => {
        return detectContinuationPattern(1, 4, [3, 0, 0]);
      });

      await allureStep('Then it is detected as a continuation at effective level 0', () => {
        expect(result.isContinuation).toBe(true);
        expect(result.effectiveLevel).toBe(0);
      });
    },
  );

  // Footnote numbering scenarios
  humanReadableTest.openspec('First footnote displays as 1')(
    'Scenario: First footnote displays as 1',
    async () => {
      const tracker = await allureStep('Given a document with footnote IDs 2, 5, 3', () => {
        return new FootnoteNumberingTracker(createDocumentWithFootnotes(['2', '5', '3']));
      });

      await allureStep('Then the first footnote in document order displays as 1', () => {
        expect(tracker.getFootnoteDisplayNumber('2')).toBe(1);
      });
    },
  );

  humanReadableTest.openspec('Sequential numbering ignores XML IDs')(
    'Scenario: Sequential numbering ignores XML IDs',
    async () => {
      const tracker = await allureStep('Given a document with 91 footnotes (IDs 2..92)', () => {
        const ids = Array.from({ length: 91 }, (_, i) => (i + 2).toString());
        return new FootnoteNumberingTracker(createDocumentWithFootnotes(ids));
      });

      await allureStep('Then display numbers are sequential regardless of XML IDs', () => {
        expect(tracker.getFootnoteDisplayNumber('2')).toBe(1);
        expect(tracker.getFootnoteDisplayNumber('92')).toBe(91);
      });
    },
  );

  humanReadableTest.openspec('Reserved footnote IDs excluded from numbering')(
    'Scenario: Reserved footnote IDs excluded from numbering',
    async () => {
      const tracker = await allureStep('Given a document with footnote IDs including reserved 0 and 1', () => {
        return new FootnoteNumberingTracker(createDocumentWithFootnotes(['0', '1', '2', '3']));
      });

      await allureStep('Then reserved IDs return undefined and numbering starts from ID 2', () => {
        expect(tracker.getFootnoteDisplayNumber('0')).toBeUndefined();
        expect(tracker.getFootnoteDisplayNumber('1')).toBeUndefined();
        expect(tracker.getFootnoteDisplayNumber('2')).toBe(1);
      });
    },
  );

  humanReadableTest.openspec('Building footnote mapping')(
    'Scenario: Building footnote mapping',
    async () => {
      const tracker = await allureStep('Given a document with footnote IDs 7, 3, 8', () => {
        return new FootnoteNumberingTracker(createDocumentWithFootnotes(['7', '3', '8']));
      });

      await allureStep('Then the tracker counts 3 footnotes and first in order displays as 1', () => {
        expect(tracker.getFootnoteCount()).toBe(3);
        expect(tracker.getFootnoteDisplayNumber('7')).toBe(1);
      });
    },
  );

  humanReadableTest.openspec('Custom footnote marks respected')(
    'Scenario: Custom footnote marks respected',
    async () => {
      const tracker = await allureStep('Given a document with footnote 2 having a custom mark', () => {
        return new FootnoteNumberingTracker(createDocumentWithFootnotes(['2', '3'], new Set(['2'])));
      });

      await allureStep('Then the custom-marked footnote is excluded from numbering', () => {
        expect(tracker.getFootnoteDisplayNumber('2')).toBeUndefined();
        expect(tracker.hasFootnoteCustomMark('2')).toBe(true);
        expect(tracker.getFootnoteDisplayNumber('3')).toBe(1);
      });
    },
  );

  // Move detection algorithm scenarios
  humanReadableTest.openspec('Move detected between similar blocks')(
    'Scenario: Move detected between similar blocks',
    async () => {
      const atoms = await allureStep('Given deleted and inserted atoms with similar text', () => [
        makeTextAtom('The quick brown fox', CorrelationStatus.Deleted),
        makeTextAtom('middle', CorrelationStatus.Equal),
        makeTextAtom('The quick brown fox jumps', CorrelationStatus.Inserted),
      ]);

      await allureStep('When move detection is applied with threshold 0.6', () => {
        detectMovesInAtomList(atoms, {
          detectMoves: true,
          moveSimilarityThreshold: 0.6,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await allureStep('Then the atoms are paired as MovedSource and MovedDestination', () => {
        expect(atoms[0]!.correlationStatus).toBe(CorrelationStatus.MovedSource);
        expect(atoms[2]!.correlationStatus).toBe(CorrelationStatus.MovedDestination);
      });
    },
  );

  humanReadableTest.openspec('Short blocks ignored')(
    'Scenario: Short blocks ignored',
    async () => {
      const atoms = await allureStep('Given atoms with single-word deleted and inserted text', () => [
        makeTextAtom('the', CorrelationStatus.Deleted),
        makeTextAtom('bridge', CorrelationStatus.Equal),
        makeTextAtom('the', CorrelationStatus.Inserted),
      ]);

      await allureStep('When move detection requires minimum 3 words', () => {
        detectMovesInAtomList(atoms, {
          detectMoves: true,
          moveSimilarityThreshold: 0.1,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await allureStep('Then short blocks remain as Deleted and Inserted', () => {
        expect(atoms[0]!.correlationStatus).toBe(CorrelationStatus.Deleted);
        expect(atoms[2]!.correlationStatus).toBe(CorrelationStatus.Inserted);
      });
    },
  );

  humanReadableTest.openspec('Below threshold treated as separate changes')(
    'Scenario: Below threshold treated as separate changes',
    async () => {
      const atoms = await allureStep('Given dissimilar deleted and inserted text', () => [
        makeTextAtom('The quick brown fox', CorrelationStatus.Deleted),
        makeTextAtom('bridge', CorrelationStatus.Equal),
        makeTextAtom('A slow gray elephant', CorrelationStatus.Inserted),
      ]);

      await allureStep('When move detection uses a high similarity threshold of 0.8', () => {
        detectMovesInAtomList(atoms, {
          detectMoves: true,
          moveSimilarityThreshold: 0.8,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await allureStep('Then the atoms remain as separate Deleted and Inserted changes', () => {
        expect(atoms[0]!.correlationStatus).toBe(CorrelationStatus.Deleted);
        expect(atoms[2]!.correlationStatus).toBe(CorrelationStatus.Inserted);
      });
    },
  );

  // Jaccard scenarios
  humanReadableTest.openspec('Identical text returns 1.0')(
    'Scenario: Identical text returns 1.0',
    async () => {
      await allureStep('Then identical text has Jaccard similarity of 1.0', () => {
        expect(jaccardWordSimilarity('hello world', 'hello world')).toBe(1);
      });
    },
  );

  humanReadableTest.openspec('No common words returns 0.0')(
    'Scenario: No common words returns 0.0',
    async () => {
      await allureStep('Then completely different text has Jaccard similarity of 0.0', () => {
        expect(jaccardWordSimilarity('hello world', 'foo bar')).toBe(0);
      });
    },
  );

  humanReadableTest.openspec('Partial overlap')(
    'Scenario: Partial overlap',
    async () => {
      const similarity = await allureStep('Given two strings with partial word overlap', () => {
        return jaccardWordSimilarity('the quick brown fox', 'the slow brown dog');
      });

      await allureStep('Then the Jaccard similarity equals 2/6', () => {
        expect(similarity).toBeCloseTo(2 / 6, 5);
      });
    },
  );

  // Move detection settings
  humanReadableTest.openspec('Move detection disabled')(
    'Scenario: Move detection disabled',
    async () => {
      const atoms = await allureStep('Given atoms with similar deleted and inserted text', () => [
        makeTextAtom('The quick brown fox', CorrelationStatus.Deleted),
        makeTextAtom('bridge', CorrelationStatus.Equal),
        makeTextAtom('The quick brown fox jumps', CorrelationStatus.Inserted),
      ]);

      await allureStep('When move detection is disabled', () => {
        detectMovesInAtomList(atoms, {
          detectMoves: false,
          moveSimilarityThreshold: 0.1,
          moveMinimumWordCount: 1,
          caseInsensitiveMove: true,
        });
      });

      await allureStep('Then atoms retain their original Deleted and Inserted status', () => {
        expect(atoms[0]!.correlationStatus).toBe(CorrelationStatus.Deleted);
        expect(atoms[2]!.correlationStatus).toBe(CorrelationStatus.Inserted);
      });
    },
  );

  humanReadableTest.openspec('Custom threshold applied')(
    'Scenario: Custom threshold applied',
    async () => {
      const atoms = await allureStep('Given atoms with partially overlapping deleted and inserted text', () => [
        makeTextAtom('one two three four', CorrelationStatus.Deleted),
        makeTextAtom('bridge', CorrelationStatus.Equal),
        makeTextAtom('one two five six', CorrelationStatus.Inserted),
      ]);

      await allureStep('When move detection uses a low threshold of 0.3', () => {
        detectMovesInAtomList(atoms, {
          detectMoves: true,
          moveSimilarityThreshold: 0.3,
          moveMinimumWordCount: 1,
          caseInsensitiveMove: true,
        });
      });

      await allureStep('Then partial overlap is sufficient to detect a move', () => {
        expect(atoms[0]!.correlationStatus).toBe(CorrelationStatus.MovedSource);
        expect(atoms[2]!.correlationStatus).toBe(CorrelationStatus.MovedDestination);
      });
    },
  );

  // Move markup generation
  humanReadableTest.openspec('Move source markup structure')(
    'Scenario: Move source markup structure',
    async () => {
      const markup = await allureStep('Given move source markup generated for move1', () => {
        const content: Element[] = [el('w:r')];
        return generateMoveSourceMarkup('move1', content, {
          author: 'Tester',
          dateTime: new Date('2026-01-01T00:00:00.000Z'),
          startId: 1,
        });
      });

      await allureStep('Then the markup has correct moveFrom range and wrapper elements', () => {
        expect(markup.rangeStart.tagName).toBe('w:moveFromRangeStart');
        expect(markup.moveWrapper.tagName).toBe('w:moveFrom');
        expect(markup.rangeEnd.tagName).toBe('w:moveFromRangeEnd');
        expect(markup.rangeStart.getAttribute('w:name')).toBe('move1');
      });
    },
  );

  humanReadableTest.openspec('Move destination markup structure')(
    'Scenario: Move destination markup structure',
    async () => {
      const markup = await allureStep('Given move destination markup generated for move1', () => {
        const content: Element[] = [el('w:r')];
        return generateMoveDestinationMarkup('move1', content, {
          author: 'Tester',
          dateTime: new Date('2026-01-01T00:00:00.000Z'),
          startId: 5,
        });
      });

      await allureStep('Then the markup has correct moveTo range and wrapper elements', () => {
        expect(markup.rangeStart.tagName).toBe('w:moveToRangeStart');
        expect(markup.moveWrapper.tagName).toBe('w:moveTo');
        expect(markup.rangeEnd.tagName).toBe('w:moveToRangeEnd');
        expect(markup.rangeStart.getAttribute('w:name')).toBe('move1');
      });
    },
  );

  humanReadableTest.openspec('Range IDs properly paired')(
    'Scenario: Range IDs properly paired',
    async () => {
      const { source, destination } = await allureStep('Given source and destination markup for move2', () => {
        const source = generateMoveSourceMarkup('move2', [], {
          author: 'Tester',
          dateTime: new Date('2026-01-01T00:00:00.000Z'),
          startId: 11,
        });
        const destination = generateMoveDestinationMarkup('move2', [], {
          author: 'Tester',
          dateTime: new Date('2026-01-01T00:00:00.000Z'),
          startId: 21,
        });
        return { source, destination };
      });

      await allureStep('Then range start and end IDs match within each markup', () => {
        expect(source.rangeStart.getAttribute('w:id')).toBe(source.rangeEnd.getAttribute('w:id'));
        expect(destination.rangeStart.getAttribute('w:id')).toBe(destination.rangeEnd.getAttribute('w:id'));
      });
    },
  );

  // Format change info interface
  humanReadableTest.openspec('Bold added')(
    'Scenario: Bold added',
    async () => {
      await allureStep('Then adding w:b is detected as bold property change', () => {
        expect(getChangedPropertyNames(el('w:rPr'), el('w:rPr', {}, [el('w:b')]))).toContain('bold');
      });
    },
  );

  humanReadableTest.openspec('Multiple properties changed')(
    'Scenario: Multiple properties changed',
    async () => {
      const changed = await allureStep('Given properties changing from bold to italic+underline', () => {
        return getChangedPropertyNames(
          el('w:rPr', {}, [el('w:b')]),
          el('w:rPr', {}, [el('w:i'), el('w:u')]),
        );
      });

      await allureStep('Then all three changed properties are reported', () => {
        expect(changed).toContain('bold');
        expect(changed).toContain('italic');
        expect(changed).toContain('underline');
      });
    },
  );

  // Format change detection algorithm
  humanReadableTest.openspec('Text becomes bold')(
    'Scenario: Text becomes bold',
    async () => {
      const after = await allureStep('Given an atom that gains bold formatting', () => {
        const before = makeTextAtom('hello', CorrelationStatus.Equal, []);
        const after = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
        after.comparisonUnitAtomBefore = before;
        return after;
      });

      await allureStep('When format change detection is applied', () => {
        detectFormatChangesInAtomList([after]);
      });

      await allureStep('Then the atom is FormatChanged with bold in changed properties', () => {
        expect(after.correlationStatus).toBe(CorrelationStatus.FormatChanged);
        expect(after.formatChange?.changedProperties).toContain('bold');
      });
    },
  );

  humanReadableTest.openspec('No format change')(
    'Scenario: No format change',
    async () => {
      const after = await allureStep('Given an atom with identical formatting before and after', () => {
        const before = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
        const after = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
        after.comparisonUnitAtomBefore = before;
        return after;
      });

      await allureStep('When format change detection is applied', () => {
        detectFormatChangesInAtomList([after]);
      });

      await allureStep('Then the atom stays Equal with no format change', () => {
        expect(after.correlationStatus).toBe(CorrelationStatus.Equal);
        expect(after.formatChange).toBeUndefined();
      });
    },
  );

  humanReadableTest.openspec('Format detection with text change')(
    'Scenario: Format detection with text change',
    async () => {
      const inserted = await allureStep('Given an inserted atom with different text and formatting', () => {
        const before = makeTextAtom('hello', CorrelationStatus.Equal, []);
        const inserted = makeTextAtom('hello changed', CorrelationStatus.Inserted, [el('w:b')]);
        inserted.comparisonUnitAtomBefore = before;
        return inserted;
      });

      await allureStep('When format change detection is applied', () => {
        detectFormatChangesInAtomList([inserted]);
      });

      await allureStep('Then text change takes priority and no format change is reported', () => {
        expect(inserted.correlationStatus).toBe(CorrelationStatus.Inserted);
        expect(inserted.formatChange).toBeUndefined();
      });
    },
  );

  // Run property extraction
  humanReadableTest.openspec('Run with properties')(
    'Scenario: Run with properties',
    async () => {
      const atom = await allureStep('Given an atom with bold run properties', () => {
        return makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
      });

      await allureStep('Then the extracted run properties contain w:b', () => {
        const rPr = getRunPropertiesFromAtom(atom);
        assertDefined(rPr, 'rPr');
        expect(childElements(rPr).some((child) => child.tagName === 'w:b')).toBe(true);
      });
    },
  );

  humanReadableTest.openspec('Run without properties')(
    'Scenario: Run without properties',
    async () => {
      const atom = await allureStep('Given an atom with no run properties element', () => {
        return makeTextAtom('hello', CorrelationStatus.Equal, null);
      });

      await allureStep('Then extracted run properties return null', () => {
        expect(getRunPropertiesFromAtom(atom)).toBeNull();
      });
    },
  );

  // Run property normalization
  humanReadableTest.openspec('Normalize null properties')(
    'Scenario: Normalize null properties',
    async () => {
      const normalized = await allureStep('Given null run properties to normalize', () => {
        return normalizeRunProperties(null);
      });

      await allureStep('Then the normalized result has empty children', () => {
        expect(normalized.children).toEqual([]);
      });
    },
  );

  humanReadableTest.openspec('Remove existing revision tracking')(
    'Scenario: Remove existing revision tracking',
    async () => {
      const normalized = await allureStep('Given run properties with w:b and w:rPrChange', () => {
        return normalizeRunProperties(el('w:rPr', {}, [
          el('w:b'),
          el('w:rPrChange', { 'w:id': '1' }),
        ]));
      });

      await allureStep('Then rPrChange is stripped but w:b is preserved', () => {
        expect(normalized.children?.some((child) => child.tagName === 'w:rPrChange')).toBe(false);
        expect(normalized.children?.some((child) => child.tagName === 'w:b')).toBe(true);
      });
    },
  );

  // Run property comparison
  humanReadableTest.openspec('Empty properties equal')(
    'Scenario: Empty properties equal',
    async () => {
      await allureStep('Then null and empty w:rPr are considered equal', () => {
        expect(areRunPropertiesEqual(null, el('w:rPr'))).toBe(true);
      });
    },
  );

  humanReadableTest.openspec('Different properties')(
    'Scenario: Different properties',
    async () => {
      await allureStep('Then bold and italic run properties are not equal', () => {
        expect(areRunPropertiesEqual(
          el('w:rPr', {}, [el('w:b')]),
          el('w:rPr', {}, [el('w:i')]),
        )).toBe(false);
      });
    },
  );

  humanReadableTest.openspec('Same properties different order')(
    'Scenario: Same properties different order',
    async () => {
      await allureStep('Then run properties with same elements in different order are equal', () => {
        expect(areRunPropertiesEqual(
          el('w:rPr', {}, [el('w:b'), el('w:i')]),
          el('w:rPr', {}, [el('w:i'), el('w:b')]),
        )).toBe(true);
      });
    },
  );

  // Format detection settings
  humanReadableTest.openspec('Format detection disabled')(
    'Scenario: Format detection disabled',
    async () => {
      const after = await allureStep('Given an atom with formatting change and detection disabled', () => {
        const before = makeTextAtom('hello', CorrelationStatus.Equal, []);
        const after = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
        after.comparisonUnitAtomBefore = before;
        return after;
      });

      await allureStep('When format detection is explicitly disabled', () => {
        detectFormatChangesInAtomList([after], { detectFormatChanges: false });
      });

      await allureStep('Then the atom remains Equal with no format change', () => {
        expect(after.correlationStatus).toBe(CorrelationStatus.Equal);
        expect(after.formatChange).toBeUndefined();
      });
    },
  );

  humanReadableTest.openspec('Format detection enabled by default')(
    'Scenario: Format detection enabled by default',
    async () => {
      await allureStep('Then the default settings have format detection enabled', () => {
        expect(DEFAULT_FORMAT_DETECTION_SETTINGS.detectFormatChanges).toBe(true);
      });
    },
  );

  // OpenXML format change markup generation
  humanReadableTest.openspec('Format change markup structure')(
    'Scenario: Format change markup structure',
    async () => {
      const markup = await allureStep('Given format change markup from bold to italic', () => {
        return generateFormatChangeMarkup({
          oldRunProperties: el('w:rPr', {}, [el('w:b')]),
          newRunProperties: el('w:rPr', {}, [el('w:i')]),
          changedProperties: ['bold', 'italic'],
        }, {
          author: 'Tester',
          dateTime: new Date('2026-01-01T00:00:00.000Z'),
          id: 1,
        });
      });

      await allureStep('Then the markup has correct rPrChange structure with author and date', () => {
        expect(markup.tagName).toBe('w:rPrChange');
        expect(markup.getAttribute('w:id')).toBe('1');
        expect(markup.getAttribute('w:author')).toBe('Tester');
        expect(markup.getAttribute('w:date')).toBeDefined();
        expect(childElements(markup)[0]?.tagName).toBe('w:rPr');
      });
    },
  );

  humanReadableTest.openspec('Bold added markup')(
    'Scenario: Bold added markup',
    async () => {
      const run = await allureStep('Given a run with bold and a format change markup for bold addition', () => {
        const run = el('w:r', {}, [
          el('w:rPr', {}, [el('w:b')]),
          el('w:t', {}, undefined, 'text'),
        ]);

        const rPrChange = generateFormatChangeMarkup({
          oldRunProperties: el('w:rPr'),
          newRunProperties: el('w:rPr', {}, [el('w:b')]),
          changedProperties: ['bold'],
        }, {
          author: 'Tester',
          dateTime: new Date('2026-01-01T00:00:00.000Z'),
          id: 2,
        });

        mergeFormatChangeIntoRun(run, rPrChange);
        return run;
      });

      await allureStep('Then the old run properties in rPrChange are empty (bold was added)', () => {
        const rPr = childElements(run).find((child) => child.tagName === 'w:rPr');
        assertDefined(rPr, 'rPr');
        const insertedEl = childElements(rPr).find((child) => child.tagName === 'w:rPrChange');
        assertDefined(insertedEl, 'rPrChange');
        const oldRPr = childElements(insertedEl)[0];
        assertDefined(oldRPr, 'oldRPr');
        expect(childElements(oldRPr)).toHaveLength(0);
      });
    },
  );

  humanReadableTest.openspec('Bold removed markup')(
    'Scenario: Bold removed markup',
    async () => {
      const run = await allureStep('Given a run without bold and a format change markup for bold removal', () => {
        const run = el('w:r', {}, [
          el('w:rPr'),
          el('w:t', {}, undefined, 'text'),
        ]);

        const rPrChange = generateFormatChangeMarkup({
          oldRunProperties: el('w:rPr', {}, [el('w:b')]),
          newRunProperties: el('w:rPr'),
          changedProperties: ['bold'],
        }, {
          author: 'Tester',
          dateTime: new Date('2026-01-01T00:00:00.000Z'),
          id: 3,
        });

        mergeFormatChangeIntoRun(run, rPrChange);
        return run;
      });

      await allureStep('Then the old run properties in rPrChange contain w:b (bold was removed)', () => {
        const rPr = childElements(run).find((child) => child.tagName === 'w:rPr');
        assertDefined(rPr, 'rPr');
        const insertedEl = childElements(rPr).find((child) => child.tagName === 'w:rPrChange');
        assertDefined(insertedEl, 'rPrChange');
        const oldRPr = childElements(insertedEl)[0];
        assertDefined(oldRPr, 'oldRPr');
        expect(childElements(oldRPr).some((child) => child.tagName === 'w:b')).toBe(true);
      });
    },
  );

  // Format change revision reporting / property mapping
  humanReadableTest.openspec('Get format change revisions')(
    'Scenario: Get format change revisions',
    async () => {
      const after = await allureStep('Given an atom with bold added and format change detected', () => {
        const before = makeTextAtom('hello', CorrelationStatus.Equal, []);
        const after = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
        after.comparisonUnitAtomBefore = before;
        detectFormatChangesInAtomList([after]);
        return after;
      });

      const markup = await allureStep('When format change markup is generated from the detected change', () => {
        assertDefined(after.formatChange, 'formatChange');
        return generateFormatChangeMarkup(after.formatChange, {
          author: 'Tester',
          dateTime: new Date('2026-01-01T00:00:00.000Z'),
          id: 4,
        });
      });

      await allureStep('Then the revision has correct status, properties, and author', () => {
        expect(after.correlationStatus).toBe(CorrelationStatus.FormatChanged);
        expect(after.formatChange!.changedProperties).toContain('bold');
        expect(markup.getAttribute('w:author')).toBe('Tester');
        expect(markup.getAttribute('w:date')).toBeDefined();
      });
    },
  );

  humanReadableTest.openspec('Unknown property name')(
    'Scenario: Unknown property name',
    async () => {
      const changed = await allureStep('Given a run property with unknown element w:emboss', () => {
        return getChangedPropertyNames(
          el('w:rPr'),
          el('w:rPr', {}, [el('w:emboss')]),
        );
      });

      await allureStep('Then the changed property name includes emboss', () => {
        expect(changed.some((name) => name.endsWith('emboss'))).toBe(true);
      });
    },
  );

  // Additional mapping for explicit footnote parsing API scenario
  // (keeps the mapping anchored to concrete exported behavior)
  humanReadableTest.openspec('Building footnote mapping preserves document order')(
    'Scenario: Building footnote mapping preserves document order in references',
    async () => {
      const refs = await allureStep('Given a document with footnote references 9, 3, 5', () => {
        const doc = createDocumentWithFootnotes(['9', '3', '5']);
        return findReferencesInOrder(doc, 'w:footnoteReference');
      });

      await allureStep('Then references are returned in document order', () => {
        expect(refs.map((ref) => ref.getAttribute('w:id'))).toEqual(['9', '3', '5']);
      });
    },
  );
});
