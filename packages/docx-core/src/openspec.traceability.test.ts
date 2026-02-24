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
import { testAllure } from './testing/allure-test.js';
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
    () => {
      const original = [makeTextAtom('hello')];
      const revised = [makeTextAtom('hello')];

      markCorrelationStatus(original, revised, {
        matches: [{ originalIndex: 0, revisedIndex: 0 }],
        deletedIndices: [],
        insertedIndices: [],
      });

      expect(revised[0]!.correlationStatus).toBe(CorrelationStatus.Equal);
    },
  );

  humanReadableTest.openspec('Status for unmatched atoms')(
    'Scenario: Status for unmatched atoms',
    () => {
      const original = [makeTextAtom('old')];
      const revised = [makeTextAtom('new')];

      markCorrelationStatus(original, revised, {
        matches: [],
        deletedIndices: [0],
        insertedIndices: [0],
      });

      expect(revised[0]!.correlationStatus).toBe(CorrelationStatus.Inserted);
    },
  );

  humanReadableTest.openspec('Status for deleted content')(
    'Scenario: Status for deleted content',
    () => {
      const original = [makeTextAtom('old')];
      const revised = [makeTextAtom('new')];

      markCorrelationStatus(original, revised, {
        matches: [],
        deletedIndices: [0],
        insertedIndices: [0],
      });

      expect(original[0]!.correlationStatus).toBe(CorrelationStatus.Deleted);
    },
  );

  humanReadableTest.openspec('Status for moved source content')(
    'Scenario: Status for moved source content',
    () => {
      const atoms = [
        makeTextAtom('The quick brown fox', CorrelationStatus.Deleted),
        makeTextAtom('bridge', CorrelationStatus.Equal),
        makeTextAtom('The quick brown fox jumps', CorrelationStatus.Inserted),
      ];

      detectMovesInAtomList(atoms, {
        detectMoves: true,
        moveSimilarityThreshold: 0.6,
        moveMinimumWordCount: 3,
        caseInsensitiveMove: true,
      });

      expect(atoms[0]!.correlationStatus).toBe(CorrelationStatus.MovedSource);
    },
  );

  humanReadableTest.openspec('Status for moved destination content')(
    'Scenario: Status for moved destination content',
    () => {
      const atoms = [
        makeTextAtom('The quick brown fox', CorrelationStatus.Deleted),
        makeTextAtom('bridge', CorrelationStatus.Equal),
        makeTextAtom('The quick brown fox jumps', CorrelationStatus.Inserted),
      ];

      detectMovesInAtomList(atoms, {
        detectMoves: true,
        moveSimilarityThreshold: 0.6,
        moveMinimumWordCount: 3,
        caseInsensitiveMove: true,
      });

      expect(atoms[2]!.correlationStatus).toBe(CorrelationStatus.MovedDestination);
    },
  );

  humanReadableTest.openspec('Status for format-changed content')(
    'Scenario: Status for format-changed content',
    () => {
      const before = makeTextAtom('hello', CorrelationStatus.Equal, []);
      const after = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
      after.comparisonUnitAtomBefore = before;

      detectFormatChangesInAtomList([after]);

      expect(after.correlationStatus).toBe(CorrelationStatus.FormatChanged);
    },
  );

  // XML element / part / hash
  humanReadableTest.openspec('Element with text content')(
    'Scenario: Element with text content',
    () => {
      const element = el('w:t', {}, undefined, 'Hello World');
      expect(element.tagName).toBe('w:t');
      expect(getLeafText(element)).toBe('Hello World');
    },
  );

  humanReadableTest.openspec('Element with attributes')(
    'Scenario: Element with attributes',
    () => {
      const element = el('w:p', { 'pt14:Unid': 'abc123' });
      expect(element.getAttribute('pt14:Unid')).toBe('abc123');
    },
  );

  humanReadableTest.openspec('Part from main document')(
    'Scenario: Part from main document',
    () => {
      expect(PART.uri).toBe('word/document.xml');
    },
  );

  humanReadableTest.openspec('Hash calculation for content identity')(
    'Scenario: Hash calculation for content identity',
    () => {
      const atom = createComparisonUnitAtom({
        contentElement: el('w:t', {}, undefined, 'hash me'),
        ancestors: [],
        part: PART,
      });

      expect(atom.sha1Hash).toHaveLength(40);
    },
  );

  // ComparisonUnitAtom interface scenarios
  humanReadableTest.openspec('Atom from inserted revision')(
    'Scenario: Atom from inserted revision',
    () => {
      const ins = el('w:ins', { 'w:id': '1' });
      const atom = createComparisonUnitAtom({
        contentElement: el('w:t', {}, undefined, 'new'),
        ancestors: [ins],
        part: PART,
      });

      expect(atom.correlationStatus).toBe(CorrelationStatus.Inserted);
      expect(atom.revTrackElement?.tagName).toBe('w:ins');
    },
  );

  humanReadableTest.openspec('Atom from deleted revision')(
    'Scenario: Atom from deleted revision',
    () => {
      const del = el('w:del', { 'w:id': '1' });
      const atom = createComparisonUnitAtom({
        contentElement: el('w:delText', {}, undefined, 'old'),
        ancestors: [del],
        part: PART,
      });

      expect(atom.correlationStatus).toBe(CorrelationStatus.Deleted);
      expect(atom.revTrackElement?.tagName).toBe('w:del');
    },
  );

  humanReadableTest.openspec('Atom with ancestor tracking')(
    'Scenario: Atom with ancestor tracking',
    () => {
      const paragraph = el('w:p');
      const run = el('w:r');

      const atom = createComparisonUnitAtom({
        contentElement: el('w:t', {}, undefined, 'nested'),
        ancestors: [paragraph, run],
        part: PART,
      });

      expect(atom.ancestorElements.map((e) => e.tagName)).toEqual(['w:p', 'w:r']);
    },
  );

  humanReadableTest.openspec('Atom marked as moved source')(
    'Scenario: Atom marked as moved source',
    () => {
      const atoms = [
        makeTextAtom('The quick brown fox', CorrelationStatus.Deleted),
        makeTextAtom('separator', CorrelationStatus.Equal),
        makeTextAtom('The quick brown fox jumps', CorrelationStatus.Inserted),
      ];

      detectMovesInAtomList(atoms, {
        detectMoves: true,
        moveSimilarityThreshold: 0.6,
        moveMinimumWordCount: 3,
        caseInsensitiveMove: true,
      });

      expect(atoms[0]!.correlationStatus).toBe(CorrelationStatus.MovedSource);
      expect(atoms[0]!.moveGroupId).toBeDefined();
      expect(atoms[0]!.moveName).toMatch(/^move/);
    },
  );

  humanReadableTest.openspec('Atom marked as moved destination')(
    'Scenario: Atom marked as moved destination',
    () => {
      const atoms = [
        makeTextAtom('The quick brown fox', CorrelationStatus.Deleted),
        makeTextAtom('separator', CorrelationStatus.Equal),
        makeTextAtom('The quick brown fox jumps', CorrelationStatus.Inserted),
      ];

      detectMovesInAtomList(atoms, {
        detectMoves: true,
        moveSimilarityThreshold: 0.6,
        moveMinimumWordCount: 3,
        caseInsensitiveMove: true,
      });

      expect(atoms[2]!.correlationStatus).toBe(CorrelationStatus.MovedDestination);
      expect(atoms[2]!.moveGroupId).toBe(atoms[0]!.moveGroupId);
      expect(atoms[2]!.moveName).toBe(atoms[0]!.moveName);
    },
  );

  humanReadableTest.openspec('Atom marked as format-changed')(
    'Scenario: Atom marked as format-changed',
    () => {
      const before = makeTextAtom('hello', CorrelationStatus.Equal, []);
      const after = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
      after.comparisonUnitAtomBefore = before;

      detectFormatChangesInAtomList([after]);

      expect(after.correlationStatus).toBe(CorrelationStatus.FormatChanged);
      expect(after.formatChange?.oldRunProperties).toBeDefined();
      expect(after.formatChange?.newRunProperties).toBeDefined();
      expect(after.formatChange?.changedProperties).toContain('bold');
    },
  );

  // Factory function scenarios
  humanReadableTest.openspec('Creating atom with revision detection')(
    'Scenario: Creating atom with revision detection',
    () => {
      const ins = el('w:ins', { 'w:id': '1' });
      const atom = createComparisonUnitAtom({
        contentElement: el('w:t', {}, undefined, 'new'),
        ancestors: [ins],
        part: PART,
      });

      expect(atom.correlationStatus).toBe(CorrelationStatus.Inserted);
      expect(atom.revTrackElement?.tagName).toBe('w:ins');
    },
  );

  humanReadableTest.openspec('Creating atom without revision context')(
    'Scenario: Creating atom without revision context',
    () => {
      const atom = createComparisonUnitAtom({
        contentElement: el('w:t', {}, undefined, 'plain'),
        ancestors: [],
        part: PART,
      });

      expect(atom.revTrackElement ?? null).toBeNull();
      expect([
        CorrelationStatus.Unknown,
        CorrelationStatus.Equal,
      ]).toContain(atom.correlationStatus);
    },
  );

  // Numbering continuation scenarios
  humanReadableTest.openspec('Orphan list item renders with parent format')(
    'Scenario: Orphan list item renders with parent format',
    () => {
      const state = createNumberingState();
      const level0: ListLevelInfo = { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' };
      const level1: ListLevelInfo = { ilvl: 1, start: 4, numFmt: 'decimal', lvlText: '%1.%2' };

      processNumberedParagraph(state, 1, 0, level0); // 1
      processNumberedParagraph(state, 1, 0, level0); // 2
      processNumberedParagraph(state, 1, 0, level0); // 3
      const continuation = processNumberedParagraph(state, 1, 1, level1);

      expect(continuation).toBe(4);
    },
  );

  humanReadableTest.openspec('Proper nested list renders hierarchically')(
    'Scenario: Proper nested list renders hierarchically',
    () => {
      const result = detectContinuationPattern(1, 1, [1, 0, 0]);
      expect(result.isContinuation).toBe(false);
      expect(result.effectiveLevel).toBe(1);
    },
  );

  humanReadableTest.openspec('Continuation pattern inherits formatting')(
    'Scenario: Continuation pattern inherits formatting',
    () => {
      const result = detectContinuationPattern(1, 4, [3, 0, 0]);
      expect(result.isContinuation).toBe(true);
      expect(result.effectiveLevel).toBe(0);
    },
  );

  // Footnote numbering scenarios
  humanReadableTest.openspec('First footnote displays as 1')(
    'Scenario: First footnote displays as 1',
    () => {
      const tracker = new FootnoteNumberingTracker(createDocumentWithFootnotes(['2', '5', '3']));
      expect(tracker.getFootnoteDisplayNumber('2')).toBe(1);
    },
  );

  humanReadableTest.openspec('Sequential numbering ignores XML IDs')(
    'Scenario: Sequential numbering ignores XML IDs',
    () => {
      const ids = Array.from({ length: 91 }, (_, i) => (i + 2).toString());
      const tracker = new FootnoteNumberingTracker(createDocumentWithFootnotes(ids));

      expect(tracker.getFootnoteDisplayNumber('2')).toBe(1);
      expect(tracker.getFootnoteDisplayNumber('92')).toBe(91);
    },
  );

  humanReadableTest.openspec('Reserved footnote IDs excluded from numbering')(
    'Scenario: Reserved footnote IDs excluded from numbering',
    () => {
      const tracker = new FootnoteNumberingTracker(createDocumentWithFootnotes(['0', '1', '2', '3']));
      expect(tracker.getFootnoteDisplayNumber('0')).toBeUndefined();
      expect(tracker.getFootnoteDisplayNumber('1')).toBeUndefined();
      expect(tracker.getFootnoteDisplayNumber('2')).toBe(1);
    },
  );

  humanReadableTest.openspec('Building footnote mapping')(
    'Scenario: Building footnote mapping',
    () => {
      const tracker = new FootnoteNumberingTracker(createDocumentWithFootnotes(['7', '3', '8']));
      expect(tracker.getFootnoteCount()).toBe(3);
      expect(tracker.getFootnoteDisplayNumber('7')).toBe(1);
    },
  );

  humanReadableTest.openspec('Custom footnote marks respected')(
    'Scenario: Custom footnote marks respected',
    () => {
      const tracker = new FootnoteNumberingTracker(createDocumentWithFootnotes(['2', '3'], new Set(['2'])));
      expect(tracker.getFootnoteDisplayNumber('2')).toBeUndefined();
      expect(tracker.hasFootnoteCustomMark('2')).toBe(true);
      expect(tracker.getFootnoteDisplayNumber('3')).toBe(1);
    },
  );

  // Move detection algorithm scenarios
  humanReadableTest.openspec('Move detected between similar blocks')(
    'Scenario: Move detected between similar blocks',
    () => {
      const atoms = [
        makeTextAtom('The quick brown fox', CorrelationStatus.Deleted),
        makeTextAtom('middle', CorrelationStatus.Equal),
        makeTextAtom('The quick brown fox jumps', CorrelationStatus.Inserted),
      ];

      detectMovesInAtomList(atoms, {
        detectMoves: true,
        moveSimilarityThreshold: 0.6,
        moveMinimumWordCount: 3,
        caseInsensitiveMove: true,
      });

      expect(atoms[0]!.correlationStatus).toBe(CorrelationStatus.MovedSource);
      expect(atoms[2]!.correlationStatus).toBe(CorrelationStatus.MovedDestination);
    },
  );

  humanReadableTest.openspec('Short blocks ignored')(
    'Scenario: Short blocks ignored',
    () => {
      const atoms = [
        makeTextAtom('the', CorrelationStatus.Deleted),
        makeTextAtom('bridge', CorrelationStatus.Equal),
        makeTextAtom('the', CorrelationStatus.Inserted),
      ];

      detectMovesInAtomList(atoms, {
        detectMoves: true,
        moveSimilarityThreshold: 0.1,
        moveMinimumWordCount: 3,
        caseInsensitiveMove: true,
      });

      expect(atoms[0]!.correlationStatus).toBe(CorrelationStatus.Deleted);
      expect(atoms[2]!.correlationStatus).toBe(CorrelationStatus.Inserted);
    },
  );

  humanReadableTest.openspec('Below threshold treated as separate changes')(
    'Scenario: Below threshold treated as separate changes',
    () => {
      const atoms = [
        makeTextAtom('The quick brown fox', CorrelationStatus.Deleted),
        makeTextAtom('bridge', CorrelationStatus.Equal),
        makeTextAtom('A slow gray elephant', CorrelationStatus.Inserted),
      ];

      detectMovesInAtomList(atoms, {
        detectMoves: true,
        moveSimilarityThreshold: 0.8,
        moveMinimumWordCount: 3,
        caseInsensitiveMove: true,
      });

      expect(atoms[0]!.correlationStatus).toBe(CorrelationStatus.Deleted);
      expect(atoms[2]!.correlationStatus).toBe(CorrelationStatus.Inserted);
    },
  );

  // Jaccard scenarios
  humanReadableTest.openspec('Identical text returns 1.0')(
    'Scenario: Identical text returns 1.0',
    () => {
      expect(jaccardWordSimilarity('hello world', 'hello world')).toBe(1);
    },
  );

  humanReadableTest.openspec('No common words returns 0.0')(
    'Scenario: No common words returns 0.0',
    () => {
      expect(jaccardWordSimilarity('hello world', 'foo bar')).toBe(0);
    },
  );

  humanReadableTest.openspec('Partial overlap')(
    'Scenario: Partial overlap',
    () => {
      const similarity = jaccardWordSimilarity('the quick brown fox', 'the slow brown dog');
      expect(similarity).toBeCloseTo(2 / 6, 5);
    },
  );

  // Move detection settings
  humanReadableTest.openspec('Move detection disabled')(
    'Scenario: Move detection disabled',
    () => {
      const atoms = [
        makeTextAtom('The quick brown fox', CorrelationStatus.Deleted),
        makeTextAtom('bridge', CorrelationStatus.Equal),
        makeTextAtom('The quick brown fox jumps', CorrelationStatus.Inserted),
      ];

      detectMovesInAtomList(atoms, {
        detectMoves: false,
        moveSimilarityThreshold: 0.1,
        moveMinimumWordCount: 1,
        caseInsensitiveMove: true,
      });

      expect(atoms[0]!.correlationStatus).toBe(CorrelationStatus.Deleted);
      expect(atoms[2]!.correlationStatus).toBe(CorrelationStatus.Inserted);
    },
  );

  humanReadableTest.openspec('Custom threshold applied')(
    'Scenario: Custom threshold applied',
    () => {
      const atoms = [
        makeTextAtom('one two three four', CorrelationStatus.Deleted),
        makeTextAtom('bridge', CorrelationStatus.Equal),
        makeTextAtom('one two five six', CorrelationStatus.Inserted),
      ];

      detectMovesInAtomList(atoms, {
        detectMoves: true,
        moveSimilarityThreshold: 0.3,
        moveMinimumWordCount: 1,
        caseInsensitiveMove: true,
      });

      expect(atoms[0]!.correlationStatus).toBe(CorrelationStatus.MovedSource);
      expect(atoms[2]!.correlationStatus).toBe(CorrelationStatus.MovedDestination);
    },
  );

  // Move markup generation
  humanReadableTest.openspec('Move source markup structure')(
    'Scenario: Move source markup structure',
    () => {
      const content: Element[] = [el('w:r')];
      const markup = generateMoveSourceMarkup('move1', content, {
        author: 'Tester',
        dateTime: new Date('2026-01-01T00:00:00.000Z'),
        startId: 1,
      });

      expect(markup.rangeStart.tagName).toBe('w:moveFromRangeStart');
      expect(markup.moveWrapper.tagName).toBe('w:moveFrom');
      expect(markup.rangeEnd.tagName).toBe('w:moveFromRangeEnd');
      expect(markup.rangeStart.getAttribute('w:name')).toBe('move1');
    },
  );

  humanReadableTest.openspec('Move destination markup structure')(
    'Scenario: Move destination markup structure',
    () => {
      const content: Element[] = [el('w:r')];
      const markup = generateMoveDestinationMarkup('move1', content, {
        author: 'Tester',
        dateTime: new Date('2026-01-01T00:00:00.000Z'),
        startId: 5,
      });

      expect(markup.rangeStart.tagName).toBe('w:moveToRangeStart');
      expect(markup.moveWrapper.tagName).toBe('w:moveTo');
      expect(markup.rangeEnd.tagName).toBe('w:moveToRangeEnd');
      expect(markup.rangeStart.getAttribute('w:name')).toBe('move1');
    },
  );

  humanReadableTest.openspec('Range IDs properly paired')(
    'Scenario: Range IDs properly paired',
    () => {
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

      expect(source.rangeStart.getAttribute('w:id')).toBe(source.rangeEnd.getAttribute('w:id'));
      expect(destination.rangeStart.getAttribute('w:id')).toBe(destination.rangeEnd.getAttribute('w:id'));
    },
  );

  // Format change info interface
  humanReadableTest.openspec('Bold added')(
    'Scenario: Bold added',
    () => {
      expect(getChangedPropertyNames(el('w:rPr'), el('w:rPr', {}, [el('w:b')]))).toContain('bold');
    },
  );

  humanReadableTest.openspec('Multiple properties changed')(
    'Scenario: Multiple properties changed',
    () => {
      const changed = getChangedPropertyNames(
        el('w:rPr', {}, [el('w:b')]),
        el('w:rPr', {}, [el('w:i'), el('w:u')]),
      );
      expect(changed).toContain('bold');
      expect(changed).toContain('italic');
      expect(changed).toContain('underline');
    },
  );

  // Format change detection algorithm
  humanReadableTest.openspec('Text becomes bold')(
    'Scenario: Text becomes bold',
    () => {
      const before = makeTextAtom('hello', CorrelationStatus.Equal, []);
      const after = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
      after.comparisonUnitAtomBefore = before;

      detectFormatChangesInAtomList([after]);

      expect(after.correlationStatus).toBe(CorrelationStatus.FormatChanged);
      expect(after.formatChange?.changedProperties).toContain('bold');
    },
  );

  humanReadableTest.openspec('No format change')(
    'Scenario: No format change',
    () => {
      const before = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
      const after = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
      after.comparisonUnitAtomBefore = before;

      detectFormatChangesInAtomList([after]);

      expect(after.correlationStatus).toBe(CorrelationStatus.Equal);
      expect(after.formatChange).toBeUndefined();
    },
  );

  humanReadableTest.openspec('Format detection with text change')(
    'Scenario: Format detection with text change',
    () => {
      const before = makeTextAtom('hello', CorrelationStatus.Equal, []);
      const inserted = makeTextAtom('hello changed', CorrelationStatus.Inserted, [el('w:b')]);
      inserted.comparisonUnitAtomBefore = before;

      detectFormatChangesInAtomList([inserted]);

      expect(inserted.correlationStatus).toBe(CorrelationStatus.Inserted);
      expect(inserted.formatChange).toBeUndefined();
    },
  );

  // Run property extraction
  humanReadableTest.openspec('Run with properties')(
    'Scenario: Run with properties',
    () => {
      const atom = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
      const rPr = getRunPropertiesFromAtom(atom);
      assertDefined(rPr, 'rPr');
      expect(childElements(rPr).some((child) => child.tagName === 'w:b')).toBe(true);
    },
  );

  humanReadableTest.openspec('Run without properties')(
    'Scenario: Run without properties',
    () => {
      const atom = makeTextAtom('hello', CorrelationStatus.Equal, null);
      expect(getRunPropertiesFromAtom(atom)).toBeNull();
    },
  );

  // Run property normalization
  humanReadableTest.openspec('Normalize null properties')(
    'Scenario: Normalize null properties',
    () => {
      const normalized = normalizeRunProperties(null);
      expect(normalized.children).toEqual([]);
    },
  );

  humanReadableTest.openspec('Remove existing revision tracking')(
    'Scenario: Remove existing revision tracking',
    () => {
      const normalized = normalizeRunProperties(el('w:rPr', {}, [
        el('w:b'),
        el('w:rPrChange', { 'w:id': '1' }),
      ]));

      expect(normalized.children?.some((child) => child.tagName === 'w:rPrChange')).toBe(false);
      expect(normalized.children?.some((child) => child.tagName === 'w:b')).toBe(true);
    },
  );

  // Run property comparison
  humanReadableTest.openspec('Empty properties equal')(
    'Scenario: Empty properties equal',
    () => {
      expect(areRunPropertiesEqual(null, el('w:rPr'))).toBe(true);
    },
  );

  humanReadableTest.openspec('Different properties')(
    'Scenario: Different properties',
    () => {
      expect(areRunPropertiesEqual(
        el('w:rPr', {}, [el('w:b')]),
        el('w:rPr', {}, [el('w:i')]),
      )).toBe(false);
    },
  );

  humanReadableTest.openspec('Same properties different order')(
    'Scenario: Same properties different order',
    () => {
      expect(areRunPropertiesEqual(
        el('w:rPr', {}, [el('w:b'), el('w:i')]),
        el('w:rPr', {}, [el('w:i'), el('w:b')]),
      )).toBe(true);
    },
  );

  // Format detection settings
  humanReadableTest.openspec('Format detection disabled')(
    'Scenario: Format detection disabled',
    () => {
      const before = makeTextAtom('hello', CorrelationStatus.Equal, []);
      const after = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
      after.comparisonUnitAtomBefore = before;

      detectFormatChangesInAtomList([after], { detectFormatChanges: false });

      expect(after.correlationStatus).toBe(CorrelationStatus.Equal);
      expect(after.formatChange).toBeUndefined();
    },
  );

  humanReadableTest.openspec('Format detection enabled by default')(
    'Scenario: Format detection enabled by default',
    () => {
      expect(DEFAULT_FORMAT_DETECTION_SETTINGS.detectFormatChanges).toBe(true);
    },
  );

  // OpenXML format change markup generation
  humanReadableTest.openspec('Format change markup structure')(
    'Scenario: Format change markup structure',
    () => {
      const markup = generateFormatChangeMarkup({
        oldRunProperties: el('w:rPr', {}, [el('w:b')]),
        newRunProperties: el('w:rPr', {}, [el('w:i')]),
        changedProperties: ['bold', 'italic'],
      }, {
        author: 'Tester',
        dateTime: new Date('2026-01-01T00:00:00.000Z'),
        id: 1,
      });

      expect(markup.tagName).toBe('w:rPrChange');
      expect(markup.getAttribute('w:id')).toBe('1');
      expect(markup.getAttribute('w:author')).toBe('Tester');
      expect(markup.getAttribute('w:date')).toBeDefined();
      expect(childElements(markup)[0]?.tagName).toBe('w:rPr');
    },
  );

  humanReadableTest.openspec('Bold added markup')(
    'Scenario: Bold added markup',
    () => {
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

      const rPr = childElements(run).find((child) => child.tagName === 'w:rPr');
      assertDefined(rPr, 'rPr');
      const insertedEl = childElements(rPr).find((child) => child.tagName === 'w:rPrChange');
      assertDefined(insertedEl, 'rPrChange');
      const oldRPr = childElements(insertedEl)[0];
      assertDefined(oldRPr, 'oldRPr');
      expect(childElements(oldRPr)).toHaveLength(0);
    },
  );

  humanReadableTest.openspec('Bold removed markup')(
    'Scenario: Bold removed markup',
    () => {
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

      const rPr = childElements(run).find((child) => child.tagName === 'w:rPr');
      assertDefined(rPr, 'rPr');
      const insertedEl = childElements(rPr).find((child) => child.tagName === 'w:rPrChange');
      assertDefined(insertedEl, 'rPrChange');
      const oldRPr = childElements(insertedEl)[0];
      assertDefined(oldRPr, 'oldRPr');
      expect(childElements(oldRPr).some((child) => child.tagName === 'w:b')).toBe(true);
    },
  );

  // Format change revision reporting / property mapping
  humanReadableTest.openspec('Get format change revisions')(
    'Scenario: Get format change revisions',
    () => {
      const before = makeTextAtom('hello', CorrelationStatus.Equal, []);
      const after = makeTextAtom('hello', CorrelationStatus.Equal, [el('w:b')]);
      after.comparisonUnitAtomBefore = before;

      detectFormatChangesInAtomList([after]);
      assertDefined(after.formatChange, 'formatChange');

      const markup = generateFormatChangeMarkup(after.formatChange, {
        author: 'Tester',
        dateTime: new Date('2026-01-01T00:00:00.000Z'),
        id: 4,
      });

      expect(after.correlationStatus).toBe(CorrelationStatus.FormatChanged);
      expect(after.formatChange.changedProperties).toContain('bold');
      expect(markup.getAttribute('w:author')).toBe('Tester');
      expect(markup.getAttribute('w:date')).toBeDefined();
    },
  );

  humanReadableTest.openspec('Unknown property name')(
    'Scenario: Unknown property name',
    () => {
      const changed = getChangedPropertyNames(
        el('w:rPr'),
        el('w:rPr', {}, [el('w:emboss')]),
      );
      expect(changed.some((name) => name.endsWith('emboss'))).toBe(true);
    },
  );

  // Additional mapping for explicit footnote parsing API scenario
  // (keeps the mapping anchored to concrete exported behavior)
  humanReadableTest.openspec('Building footnote mapping')(
    'Scenario: Building footnote mapping preserves document order in references',
    () => {
      const doc = createDocumentWithFootnotes(['9', '3', '5']);
      const refs = findReferencesInOrder(doc, 'w:footnoteReference');
      expect(refs.map((ref) => ref.getAttribute('w:id'))).toEqual(['9', '3', '5']);
    },
  );
});
