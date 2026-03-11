import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import {
  jaccardWordSimilarity,
  groupIntoBlocks,
  findBestMatch,
  markAsMove,
  detectMovesInAtomList,
  getAtomText,
  countWords,
  generateMoveSourceMarkup,
  generateMoveDestinationMarkup,
  createRevisionIdState,
  allocateMoveIds,
} from './move-detection.js';
import { assertDefined } from './testing/test-utils.js';
import {
  ComparisonUnitAtom,
  CorrelationStatus,
  OpcPart,
  MoveDetectionSettings,
} from './core-types.js';
import { el } from './testing/dom-test-helpers.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Move Detection' });

// Helper to create test atoms
function createTestAtom(
  text: string,
  status: CorrelationStatus = CorrelationStatus.Unknown
): ComparisonUnitAtom {
  const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
  return {
    sha1Hash: 'test-hash',
    correlationStatus: status,
    contentElement: el('w:t', {}, undefined, text),
    ancestorElements: [],
    ancestorUnids: [],
    part,
  };
}

describe('jaccardWordSimilarity', () => {
  test('returns 1 for identical texts', async ({ given, when, then }: AllureBddContext) => {
    await given('two identical strings', () => {});
    await when('similarity is computed', () => {});
    await then('similarity is 1', () => {
      expect(jaccardWordSimilarity('hello world', 'hello world')).toBe(1);
    });
  });

  test('returns 0 for completely different texts', async ({ given, when, then }: AllureBddContext) => {
    await given('two completely different strings', () => {});
    await when('similarity is computed', () => {});
    await then('similarity is 0', () => {
      expect(jaccardWordSimilarity('hello world', 'foo bar')).toBe(0);
    });
  });

  test('returns 1 for both empty strings', async ({ given, when, then }: AllureBddContext) => {
    await given('two empty strings', () => {});
    await when('similarity is computed', () => {});
    await then('similarity is 1', () => {
      expect(jaccardWordSimilarity('', '')).toBe(1);
    });
  });

  test('returns 0 when one text is empty', async ({ given, when, then }: AllureBddContext) => {
    await given('one non-empty and one empty string', () => {});
    await when('similarity is computed', () => {});
    await then('similarity is 0', () => {
      expect(jaccardWordSimilarity('hello', '')).toBe(0);
      expect(jaccardWordSimilarity('', 'world')).toBe(0);
    });
  });

  test('calculates correct similarity for partial overlap', async ({ given, when, then }: AllureBddContext) => {
    await given('two sentences sharing three of five words', () => {});
    await when('similarity is computed', () => {});
    await then('similarity is 0.6', () => {
      // "the quick brown fox" vs "the quick brown dog"
      // Intersection: {the, quick, brown} = 3
      // Union: {the, quick, brown, fox, dog} = 5
      // Similarity: 3/5 = 0.6
      expect(
        jaccardWordSimilarity('the quick brown fox', 'the quick brown dog')
      ).toBe(0.6);
    });
  });

  test('is order-independent', async ({ given, when, then }: AllureBddContext) => {
    await given('two strings with the same words in different order', () => {});
    await when('similarity is computed', () => {});
    await then('similarity is 1', () => {
      const sim1 = jaccardWordSimilarity('fox quick brown', 'brown quick fox');
      expect(sim1).toBe(1); // Same words, different order
    });
  });

  test('handles case insensitive comparison by default', async ({ given, when, then }: AllureBddContext) => {
    await given('two strings differing only in case', () => {});
    await when('similarity is computed', () => {});
    await then('similarity is 1', () => {
      expect(jaccardWordSimilarity('Hello World', 'hello world')).toBe(1);
    });
  });

  test('handles case sensitive comparison when specified', async ({ given, when, then }: AllureBddContext) => {
    await given('two strings differing only in case', () => {});
    await when('similarity is computed with case sensitive mode', () => {});
    await then('similarity is 0', () => {
      const similarity = jaccardWordSimilarity('Hello World', 'hello world', false);
      expect(similarity).toBe(0); // Different when case sensitive
    });
  });

  test('handles multiple spaces and whitespace', async ({ given, when, then }: AllureBddContext) => {
    await given('strings with extra spaces or tabs', () => {});
    await when('similarity is computed', () => {});
    await then('whitespace differences are ignored', () => {
      expect(jaccardWordSimilarity('hello   world', 'hello world')).toBe(1);
      expect(jaccardWordSimilarity('hello\tworld', 'hello world')).toBe(1);
    });
  });

  test('handles duplicate words', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with repeated words vs a single occurrence', () => {});
    await when('similarity is computed', () => {});
    await then('similarity is 1 because unique word sets are the same', () => {
      // "the the the" and "the" should have similarity 1 (same unique word set)
      expect(jaccardWordSimilarity('the the the', 'the')).toBe(1);
    });
  });
});

describe('getAtomText', () => {
  test('returns text content for w:t elements', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;

    await given('a w:t atom', () => {
      atom = createTestAtom('Hello');
    });

    await when('getAtomText is called', () => {});

    await then('the text content is returned', () => {
      expect(getAtomText(atom)).toBe('Hello');
    });
  });

  test('returns newline for w:br elements', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;

    await given('a w:br atom', () => {
      const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
      atom = {
        sha1Hash: 'test',
        correlationStatus: CorrelationStatus.Unknown,
        contentElement: el('w:br'),
        ancestorElements: [],
        ancestorUnids: [],
        part,
      };
    });

    await when('getAtomText is called', () => {});

    await then('a newline character is returned', () => {
      expect(getAtomText(atom)).toBe('\n');
    });
  });

  test('returns tab for w:tab elements', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;

    await given('a w:tab atom', () => {
      const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
      atom = {
        sha1Hash: 'test',
        correlationStatus: CorrelationStatus.Unknown,
        contentElement: el('w:tab'),
        ancestorElements: [],
        ancestorUnids: [],
        part,
      };
    });

    await when('getAtomText is called', () => {});

    await then('a tab character is returned', () => {
      expect(getAtomText(atom)).toBe('\t');
    });
  });

  test('returns empty string for unknown elements', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;

    await given('a w:drawing atom', () => {
      const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
      atom = {
        sha1Hash: 'test',
        correlationStatus: CorrelationStatus.Unknown,
        contentElement: el('w:drawing'),
        ancestorElements: [],
        ancestorUnids: [],
        part,
      };
    });

    await when('getAtomText is called', () => {});

    await then('an empty string is returned', () => {
      expect(getAtomText(atom)).toBe('');
    });
  });
});

describe('countWords', () => {
  test('counts words correctly', async ({ given, when, then }: AllureBddContext) => {
    await given('strings with known word counts', () => {});
    await when('words are counted', () => {});
    await then('the correct count is returned', () => {
      expect(countWords('hello world')).toBe(2);
      expect(countWords('one two three four five')).toBe(5);
    });
  });

  test('returns 0 for empty string', async ({ given, when, then }: AllureBddContext) => {
    await given('an empty string', () => {});
    await when('words are counted', () => {});
    await then('0 is returned', () => {
      expect(countWords('')).toBe(0);
    });
  });

  test('handles multiple spaces', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with multiple consecutive spaces', () => {});
    await when('words are counted', () => {});
    await then('only the words are counted', () => {
      expect(countWords('hello   world')).toBe(2);
    });
  });

  test('handles leading/trailing whitespace', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with leading and trailing spaces', () => {});
    await when('words are counted', () => {});
    await then('the surrounding whitespace is ignored', () => {
      expect(countWords('  hello world  ')).toBe(2);
    });
  });
});

describe('groupIntoBlocks', () => {
  test('groups consecutive deleted atoms', async ({ given, when, then }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];
    let blocks: ReturnType<typeof groupIntoBlocks>;

    await given('three consecutive deleted atoms', () => {
      atoms = [
        createTestAtom('one', CorrelationStatus.Deleted),
        createTestAtom(' ', CorrelationStatus.Deleted),
        createTestAtom('two', CorrelationStatus.Deleted),
      ];
    });

    await when('atoms are grouped into blocks', () => {
      blocks = groupIntoBlocks(atoms);
    });

    await then('a single deleted block with three atoms is returned', () => {
      expect(blocks).toHaveLength(1);
      const block0 = blocks[0];
      assertDefined(block0, 'blocks[0]');
      expect(block0.status).toBe(CorrelationStatus.Deleted);
      expect(block0.atoms).toHaveLength(3);
      expect(block0.text).toBe('one two');
    });
  });

  test('groups consecutive inserted atoms', async ({ given, when, then }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];
    let blocks: ReturnType<typeof groupIntoBlocks>;

    await given('three consecutive inserted atoms', () => {
      atoms = [
        createTestAtom('new', CorrelationStatus.Inserted),
        createTestAtom(' ', CorrelationStatus.Inserted),
        createTestAtom('text', CorrelationStatus.Inserted),
      ];
    });

    await when('atoms are grouped into blocks', () => {
      blocks = groupIntoBlocks(atoms);
    });

    await then('a single inserted block is returned', () => {
      expect(blocks).toHaveLength(1);
      const block0 = blocks[0];
      assertDefined(block0, 'blocks[0]');
      expect(block0.status).toBe(CorrelationStatus.Inserted);
    });
  });

  test('separates blocks by status change', async ({ given, when, then }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];
    let blocks: ReturnType<typeof groupIntoBlocks>;

    await given('a deleted atom followed by an inserted atom', () => {
      atoms = [
        createTestAtom('deleted', CorrelationStatus.Deleted),
        createTestAtom('inserted', CorrelationStatus.Inserted),
      ];
    });

    await when('atoms are grouped into blocks', () => {
      blocks = groupIntoBlocks(atoms);
    });

    await then('two separate blocks are returned', () => {
      expect(blocks).toHaveLength(2);
      const block0 = blocks[0];
      const block1 = blocks[1];
      assertDefined(block0, 'blocks[0]');
      assertDefined(block1, 'blocks[1]');
      expect(block0.status).toBe(CorrelationStatus.Deleted);
      expect(block1.status).toBe(CorrelationStatus.Inserted);
    });
  });

  test('separates blocks by equal atoms', async ({ given, when, then }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];
    let blocks: ReturnType<typeof groupIntoBlocks>;

    await given('two deleted atoms separated by an equal atom', () => {
      atoms = [
        createTestAtom('deleted', CorrelationStatus.Deleted),
        createTestAtom('equal', CorrelationStatus.Equal),
        createTestAtom('deleted again', CorrelationStatus.Deleted),
      ];
    });

    await when('atoms are grouped into blocks', () => {
      blocks = groupIntoBlocks(atoms);
    });

    await then('two deleted blocks are returned', () => {
      expect(blocks).toHaveLength(2);
      const block0 = blocks[0];
      const block1 = blocks[1];
      assertDefined(block0, 'blocks[0]');
      assertDefined(block1, 'blocks[1]');
      expect(block0.text).toBe('deleted');
      expect(block1.text).toBe('deleted again');
    });
  });

  test('calculates word count for each block', async ({ given, when, then }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];
    let blocks: ReturnType<typeof groupIntoBlocks>;

    await given('a deleted atom with three words', () => {
      atoms = [createTestAtom('one two three', CorrelationStatus.Deleted)];
    });

    await when('atoms are grouped into blocks', () => {
      blocks = groupIntoBlocks(atoms);
    });

    await then('the block has a word count of 3', () => {
      const block0 = blocks[0];
      assertDefined(block0, 'blocks[0]');
      expect(block0.wordCount).toBe(3);
    });
  });
});

describe('findBestMatch', () => {
  const defaultSettings: MoveDetectionSettings = {
    detectMoves: true,
    moveSimilarityThreshold: 0.8,
    moveMinimumWordCount: 1,
    caseInsensitiveMove: true,
  };

  test('finds exact match', async ({ given, when, then }: AllureBddContext) => {
    let deleted: ReturnType<typeof groupIntoBlocks>[number];
    let insertedBlocks: ReturnType<typeof groupIntoBlocks>;
    let match: ReturnType<typeof findBestMatch>;

    await given('a deleted block and an inserted block with the same text', () => {
      deleted = {
        status: CorrelationStatus.Deleted,
        atoms: [createTestAtom('hello world', CorrelationStatus.Deleted)],
        text: 'hello world',
        wordCount: 2,
      };
      insertedBlocks = [
        {
          status: CorrelationStatus.Inserted,
          atoms: [createTestAtom('hello world', CorrelationStatus.Inserted)],
          text: 'hello world',
          wordCount: 2,
        },
      ];
    });

    await when('the best match is found', () => {
      match = findBestMatch(deleted, insertedBlocks, defaultSettings);
    });

    await then('an exact match with similarity 1 is returned', () => {
      expect(match).toBeDefined();
      expect(match!.similarity).toBe(1);
    });
  });

  test('returns undefined for no match above threshold', async ({ given, when, then }: AllureBddContext) => {
    let deleted: ReturnType<typeof groupIntoBlocks>[number];
    let insertedBlocks: ReturnType<typeof groupIntoBlocks>;
    let match: ReturnType<typeof findBestMatch>;

    await given('a deleted block and an inserted block with completely different text', () => {
      deleted = {
        status: CorrelationStatus.Deleted,
        atoms: [createTestAtom('hello world', CorrelationStatus.Deleted)],
        text: 'hello world',
        wordCount: 2,
      };
      insertedBlocks = [
        {
          status: CorrelationStatus.Inserted,
          atoms: [createTestAtom('foo bar', CorrelationStatus.Inserted)],
          text: 'foo bar',
          wordCount: 2,
        },
      ];
    });

    await when('the best match is found', () => {
      match = findBestMatch(deleted, insertedBlocks, defaultSettings);
    });

    await then('undefined is returned', () => {
      expect(match).toBeUndefined();
    });
  });

  test('finds best match among multiple candidates', async ({ given, when, then }: AllureBddContext) => {
    let deleted: ReturnType<typeof groupIntoBlocks>[number];
    let insertedBlocks: ReturnType<typeof groupIntoBlocks>;
    let match: ReturnType<typeof findBestMatch>;

    await given('a deleted block and two inserted blocks of varying similarity', () => {
      // Use a lower threshold to test the matching logic
      const testSettings: MoveDetectionSettings = {
        ...defaultSettings,
        moveSimilarityThreshold: 0.5, // Lower threshold for this test
      };
      deleted = {
        status: CorrelationStatus.Deleted,
        atoms: [createTestAtom('the quick brown fox', CorrelationStatus.Deleted)],
        text: 'the quick brown fox',
        wordCount: 4,
      };
      insertedBlocks = [
        {
          status: CorrelationStatus.Inserted,
          atoms: [createTestAtom('the slow red cat', CorrelationStatus.Inserted)],
          text: 'the slow red cat',
          wordCount: 4,
        },
        {
          status: CorrelationStatus.Inserted,
          atoms: [createTestAtom('the quick brown dog', CorrelationStatus.Inserted)],
          text: 'the quick brown dog',
          wordCount: 4,
        },
      ];
      match = findBestMatch(deleted, insertedBlocks, testSettings);
    });

    await when('the best match is found', () => {});

    await then('the more similar block is returned', () => {
      expect(match).toBeDefined();
      expect(match!.index).toBe(1); // Second block is better match
      expect(match!.similarity).toBeGreaterThan(0.5);
    });
  });

  test('skips already matched blocks', async ({ given, when, then }: AllureBddContext) => {
    let deleted: ReturnType<typeof groupIntoBlocks>[number];
    let insertedBlocks: ReturnType<typeof groupIntoBlocks>;
    let match: ReturnType<typeof findBestMatch>;

    await given('a deleted block and an already-matched inserted block', () => {
      deleted = {
        status: CorrelationStatus.Deleted,
        atoms: [createTestAtom('hello world', CorrelationStatus.Deleted)],
        text: 'hello world',
        wordCount: 2,
      };
      // First block is already marked as MovedDestination
      insertedBlocks = [
        {
          status: CorrelationStatus.Inserted,
          atoms: [createTestAtom('hello world', CorrelationStatus.MovedDestination)],
          text: 'hello world',
          wordCount: 2,
        },
      ];
    });

    await when('the best match is found', () => {
      match = findBestMatch(deleted, insertedBlocks, defaultSettings);
    });

    await then('undefined is returned because the block was already matched', () => {
      expect(match).toBeUndefined();
    });
  });
});

describe('markAsMove', () => {
  test('marks atoms as moved source', async ({ given, when, then }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];

    await given('two deleted atoms', () => {
      atoms = [
        createTestAtom('hello', CorrelationStatus.Deleted),
        createTestAtom(' world', CorrelationStatus.Deleted),
      ];
    });

    await when('atoms are marked as MovedSource', () => {
      markAsMove(atoms, CorrelationStatus.MovedSource, 1, 'move1');
    });

    await then('all atoms have MovedSource status and correct move properties', () => {
      const atom0 = atoms[0];
      const atom1 = atoms[1];
      assertDefined(atom0, 'atoms[0]');
      assertDefined(atom1, 'atoms[1]');
      expect(atom0.correlationStatus).toBe(CorrelationStatus.MovedSource);
      expect(atom0.moveGroupId).toBe(1);
      expect(atom0.moveName).toBe('move1');
      expect(atom1.correlationStatus).toBe(CorrelationStatus.MovedSource);
    });
  });

  test('marks atoms as moved destination', async ({ given, when, then }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];

    await given('an inserted atom', () => {
      atoms = [createTestAtom('new text', CorrelationStatus.Inserted)];
    });

    await when('the atom is marked as MovedDestination', () => {
      markAsMove(atoms, CorrelationStatus.MovedDestination, 2, 'move2');
    });

    await then('the atom has MovedDestination status and correct move properties', () => {
      const atom0 = atoms[0];
      assertDefined(atom0, 'atoms[0]');
      expect(atom0.correlationStatus).toBe(CorrelationStatus.MovedDestination);
      expect(atom0.moveGroupId).toBe(2);
      expect(atom0.moveName).toBe('move2');
    });
  });
});

describe('detectMovesInAtomList', () => {
  test('does nothing when detectMoves is false', async ({ given, when, then }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];

    await given('matching deleted and inserted atoms with detectMoves disabled', () => {
      atoms = [
        createTestAtom('deleted text here for move', CorrelationStatus.Deleted),
        createTestAtom('deleted text here for move', CorrelationStatus.Inserted),
      ];
    });

    await when('moves are detected', () => {
      detectMovesInAtomList(atoms, {
        detectMoves: false,
        moveSimilarityThreshold: 0.8,
        moveMinimumWordCount: 1,
        caseInsensitiveMove: true,
      });
    });

    await then('atom statuses are unchanged', () => {
      const atom0 = atoms[0];
      const atom1 = atoms[1];
      assertDefined(atom0, 'atoms[0]');
      assertDefined(atom1, 'atoms[1]');
      expect(atom0.correlationStatus).toBe(CorrelationStatus.Deleted);
      expect(atom1.correlationStatus).toBe(CorrelationStatus.Inserted);
    });
  });

  test('detects exact moves', async ({ given, when, then }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];

    await given('a deleted atom and an inserted atom with the same text', () => {
      atoms = [
        createTestAtom('this is some text that was moved', CorrelationStatus.Deleted),
        createTestAtom('unchanged', CorrelationStatus.Equal),
        createTestAtom('this is some text that was moved', CorrelationStatus.Inserted),
      ];
    });

    await when('moves are detected', () => {
      detectMovesInAtomList(atoms, {
        detectMoves: true,
        moveSimilarityThreshold: 0.8,
        moveMinimumWordCount: 1,
        caseInsensitiveMove: true,
      });
    });

    await then('the atoms are marked as MovedSource and MovedDestination', () => {
      const atom0 = atoms[0];
      const atom2 = atoms[2];
      assertDefined(atom0, 'atoms[0]');
      assertDefined(atom2, 'atoms[2]');
      expect(atom0.correlationStatus).toBe(CorrelationStatus.MovedSource);
      expect(atom0.moveName).toBe('move1');
      expect(atom2.correlationStatus).toBe(CorrelationStatus.MovedDestination);
      expect(atom2.moveName).toBe('move1');
    });
  });

  test('respects minimum word count', async ({ given, when, then }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];

    await given('matching single-word atoms with a minimum word count of 5', () => {
      atoms = [
        createTestAtom('hi', CorrelationStatus.Deleted), // Only 1 word
        createTestAtom('hi', CorrelationStatus.Inserted),
      ];
    });

    await when('moves are detected', () => {
      detectMovesInAtomList(atoms, {
        detectMoves: true,
        moveSimilarityThreshold: 0.8,
        moveMinimumWordCount: 5, // Require 5 words
        caseInsensitiveMove: true,
      });
    });

    await then('atoms are not marked as moved', () => {
      // Should NOT be marked as moved due to word count
      const atom0 = atoms[0];
      const atom1 = atoms[1];
      assertDefined(atom0, 'atoms[0]');
      assertDefined(atom1, 'atoms[1]');
      expect(atom0.correlationStatus).toBe(CorrelationStatus.Deleted);
      expect(atom1.correlationStatus).toBe(CorrelationStatus.Inserted);
    });
  });

  test('respects similarity threshold', async ({ given, when, then }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];

    await given('deleted and inserted atoms with low similarity', () => {
      atoms = [
        createTestAtom('the quick brown fox jumps', CorrelationStatus.Deleted),
        createTestAtom('a slow red cat sleeps', CorrelationStatus.Inserted), // Completely different
      ];
    });

    await when('moves are detected', () => {
      detectMovesInAtomList(atoms, {
        detectMoves: true,
        moveSimilarityThreshold: 0.8,
        moveMinimumWordCount: 1,
        caseInsensitiveMove: true,
      });
    });

    await then('atoms are not marked as moved due to low similarity', () => {
      // Should NOT be marked as moved due to low similarity
      const atom0 = atoms[0];
      const atom1 = atoms[1];
      assertDefined(atom0, 'atoms[0]');
      assertDefined(atom1, 'atoms[1]');
      expect(atom0.correlationStatus).toBe(CorrelationStatus.Deleted);
      expect(atom1.correlationStatus).toBe(CorrelationStatus.Inserted);
    });
  });
});

describe('generateMoveSourceMarkup', () => {
  test('generates correct structure', async ({ given, when, then }: AllureBddContext) => {
    let content: Element[];
    let options: Parameters<typeof generateMoveSourceMarkup>[2];
    let markup: ReturnType<typeof generateMoveSourceMarkup>;

    await given('move content and options', () => {
      content = [el('w:r')];
      options = {
        author: 'Test Author',
        dateTime: new Date('2025-01-15T10:00:00Z'),
        startId: 1,
      };
    });

    await when('move source markup is generated', () => {
      markup = generateMoveSourceMarkup('move1', content, options);
    });

    await then('the markup has correct structure with range start/end and wrapper', () => {
      expect(markup.rangeStart.tagName).toBe('w:moveFromRangeStart');
      expect(markup.rangeStart.getAttribute('w:id')).toBe('1');
      expect(markup.rangeStart.getAttribute('w:name')).toBe('move1');
      expect(markup.rangeStart.getAttribute('w:author')).toBe('Test Author');

      expect(markup.moveWrapper.tagName).toBe('w:moveFrom');
      expect(markup.moveWrapper.getAttribute('w:id')).toBe('2');

      expect(markup.rangeEnd.tagName).toBe('w:moveFromRangeEnd');
      expect(markup.rangeEnd.getAttribute('w:id')).toBe('1');

      expect(markup.nextId).toBe(3);
    });
  });
});

describe('generateMoveDestinationMarkup', () => {
  test('generates correct structure', async ({ given, when, then }: AllureBddContext) => {
    let content: Element[];
    let options: Parameters<typeof generateMoveDestinationMarkup>[2];
    let markup: ReturnType<typeof generateMoveDestinationMarkup>;

    await given('move content and options', () => {
      content = [el('w:r')];
      options = {
        author: 'Test Author',
        dateTime: new Date('2025-01-15T10:00:00Z'),
        startId: 3,
      };
    });

    await when('move destination markup is generated', () => {
      markup = generateMoveDestinationMarkup('move1', content, options);
    });

    await then('the markup has correct structure with range start/end and wrapper', () => {
      expect(markup.rangeStart.tagName).toBe('w:moveToRangeStart');
      expect(markup.rangeStart.getAttribute('w:id')).toBe('3');
      expect(markup.rangeStart.getAttribute('w:name')).toBe('move1');

      expect(markup.moveWrapper.tagName).toBe('w:moveTo');
      expect(markup.moveWrapper.getAttribute('w:id')).toBe('4');

      expect(markup.rangeEnd.tagName).toBe('w:moveToRangeEnd');
      expect(markup.rangeEnd.getAttribute('w:id')).toBe('3');

      expect(markup.nextId).toBe(5);
    });
  });
});

describe('RevisionIdState', () => {
  test('creates initial state', async ({ given, when, then }: AllureBddContext) => {
    let state: ReturnType<typeof createRevisionIdState>;

    await given('no initial state', () => {});

    await when('createRevisionIdState is called', () => {
      state = createRevisionIdState();
    });

    await then('state starts at 1 with no move range IDs', () => {
      expect(state.nextId).toBe(1);
      expect(state.moveRangeIds.size).toBe(0);
    });
  });

  test('creates state with custom starting ID', async ({ given, when, then }: AllureBddContext) => {
    let state: ReturnType<typeof createRevisionIdState>;

    await given('a custom starting ID of 100', () => {});

    await when('createRevisionIdState is called', () => {
      state = createRevisionIdState(100);
    });

    await then('state starts at 100', () => {
      expect(state.nextId).toBe(100);
    });
  });

  test('allocates consistent IDs for moves', async ({ given, when, then }: AllureBddContext) => {
    let state: ReturnType<typeof createRevisionIdState>;
    let ids1: ReturnType<typeof allocateMoveIds>;
    let ids2: ReturnType<typeof allocateMoveIds>;

    await given('a fresh revision ID state', () => {
      state = createRevisionIdState();
    });

    await when('IDs are allocated for two different moves', () => {
      ids1 = allocateMoveIds(state, 'move1');
      ids2 = allocateMoveIds(state, 'move2');
    });

    await then('each move gets unique sequential IDs and the same move returns same IDs', () => {
      expect(ids1.sourceRangeId).toBe(1);
      expect(ids1.sourceMoveId).toBe(2);
      expect(ids1.destRangeId).toBe(3);
      expect(ids1.destMoveId).toBe(4);

      // Same move name returns same IDs
      const ids1Again = allocateMoveIds(state, 'move1');
      expect(ids1Again).toEqual(ids1);

      // Different move name gets new IDs
      expect(ids2.sourceRangeId).toBe(5);
      expect(ids2.destRangeId).toBe(7);
    });
  });
});
