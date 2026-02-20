import { describe, expect } from 'vitest';
import { itAllure as it } from './testing/allure-test.js';
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

// Helper to create test atoms
function createTestAtom(
  text: string,
  status: CorrelationStatus = CorrelationStatus.Unknown
): ComparisonUnitAtom {
  const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
  return {
    sha1Hash: 'test-hash',
    correlationStatus: status,
    contentElement: { tagName: 'w:t', attributes: {}, textContent: text },
    ancestorElements: [],
    ancestorUnids: [],
    part,
  };
}

describe('jaccardWordSimilarity', () => {
  it('returns 1 for identical texts', () => {
    expect(jaccardWordSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('returns 0 for completely different texts', () => {
    expect(jaccardWordSimilarity('hello world', 'foo bar')).toBe(0);
  });

  it('returns 1 for both empty strings', () => {
    expect(jaccardWordSimilarity('', '')).toBe(1);
  });

  it('returns 0 when one text is empty', () => {
    expect(jaccardWordSimilarity('hello', '')).toBe(0);
    expect(jaccardWordSimilarity('', 'world')).toBe(0);
  });

  it('calculates correct similarity for partial overlap', () => {
    // "the quick brown fox" vs "the quick brown dog"
    // Intersection: {the, quick, brown} = 3
    // Union: {the, quick, brown, fox, dog} = 5
    // Similarity: 3/5 = 0.6
    expect(
      jaccardWordSimilarity('the quick brown fox', 'the quick brown dog')
    ).toBe(0.6);
  });

  it('is order-independent', () => {
    const sim1 = jaccardWordSimilarity('fox quick brown', 'brown quick fox');
    expect(sim1).toBe(1); // Same words, different order
  });

  it('handles case insensitive comparison by default', () => {
    expect(jaccardWordSimilarity('Hello World', 'hello world')).toBe(1);
  });

  it('handles case sensitive comparison when specified', () => {
    const similarity = jaccardWordSimilarity('Hello World', 'hello world', false);
    expect(similarity).toBe(0); // Different when case sensitive
  });

  it('handles multiple spaces and whitespace', () => {
    expect(jaccardWordSimilarity('hello   world', 'hello world')).toBe(1);
    expect(jaccardWordSimilarity('hello\tworld', 'hello world')).toBe(1);
  });

  it('handles duplicate words', () => {
    // "the the the" and "the" should have similarity 1 (same unique word set)
    expect(jaccardWordSimilarity('the the the', 'the')).toBe(1);
  });
});

describe('getAtomText', () => {
  it('returns text content for w:t elements', () => {
    const atom = createTestAtom('Hello');
    expect(getAtomText(atom)).toBe('Hello');
  });

  it('returns newline for w:br elements', () => {
    const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
    const atom: ComparisonUnitAtom = {
      sha1Hash: 'test',
      correlationStatus: CorrelationStatus.Unknown,
      contentElement: { tagName: 'w:br', attributes: {} },
      ancestorElements: [],
      ancestorUnids: [],
      part,
    };
    expect(getAtomText(atom)).toBe('\n');
  });

  it('returns tab for w:tab elements', () => {
    const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
    const atom: ComparisonUnitAtom = {
      sha1Hash: 'test',
      correlationStatus: CorrelationStatus.Unknown,
      contentElement: { tagName: 'w:tab', attributes: {} },
      ancestorElements: [],
      ancestorUnids: [],
      part,
    };
    expect(getAtomText(atom)).toBe('\t');
  });

  it('returns empty string for unknown elements', () => {
    const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
    const atom: ComparisonUnitAtom = {
      sha1Hash: 'test',
      correlationStatus: CorrelationStatus.Unknown,
      contentElement: { tagName: 'w:drawing', attributes: {} },
      ancestorElements: [],
      ancestorUnids: [],
      part,
    };
    expect(getAtomText(atom)).toBe('');
  });
});

describe('countWords', () => {
  it('counts words correctly', () => {
    expect(countWords('hello world')).toBe(2);
    expect(countWords('one two three four five')).toBe(5);
  });

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('handles multiple spaces', () => {
    expect(countWords('hello   world')).toBe(2);
  });

  it('handles leading/trailing whitespace', () => {
    expect(countWords('  hello world  ')).toBe(2);
  });
});

describe('groupIntoBlocks', () => {
  it('groups consecutive deleted atoms', () => {
    const atoms = [
      createTestAtom('one', CorrelationStatus.Deleted),
      createTestAtom(' ', CorrelationStatus.Deleted),
      createTestAtom('two', CorrelationStatus.Deleted),
    ];

    const blocks = groupIntoBlocks(atoms);

    expect(blocks).toHaveLength(1);
    const block0 = blocks[0];
    assertDefined(block0, 'blocks[0]');
    expect(block0.status).toBe(CorrelationStatus.Deleted);
    expect(block0.atoms).toHaveLength(3);
    expect(block0.text).toBe('one two');
  });

  it('groups consecutive inserted atoms', () => {
    const atoms = [
      createTestAtom('new', CorrelationStatus.Inserted),
      createTestAtom(' ', CorrelationStatus.Inserted),
      createTestAtom('text', CorrelationStatus.Inserted),
    ];

    const blocks = groupIntoBlocks(atoms);

    expect(blocks).toHaveLength(1);
    const block0 = blocks[0];
    assertDefined(block0, 'blocks[0]');
    expect(block0.status).toBe(CorrelationStatus.Inserted);
  });

  it('separates blocks by status change', () => {
    const atoms = [
      createTestAtom('deleted', CorrelationStatus.Deleted),
      createTestAtom('inserted', CorrelationStatus.Inserted),
    ];

    const blocks = groupIntoBlocks(atoms);

    expect(blocks).toHaveLength(2);
    const block0 = blocks[0];
    const block1 = blocks[1];
    assertDefined(block0, 'blocks[0]');
    assertDefined(block1, 'blocks[1]');
    expect(block0.status).toBe(CorrelationStatus.Deleted);
    expect(block1.status).toBe(CorrelationStatus.Inserted);
  });

  it('separates blocks by equal atoms', () => {
    const atoms = [
      createTestAtom('deleted', CorrelationStatus.Deleted),
      createTestAtom('equal', CorrelationStatus.Equal),
      createTestAtom('deleted again', CorrelationStatus.Deleted),
    ];

    const blocks = groupIntoBlocks(atoms);

    expect(blocks).toHaveLength(2);
    const block0 = blocks[0];
    const block1 = blocks[1];
    assertDefined(block0, 'blocks[0]');
    assertDefined(block1, 'blocks[1]');
    expect(block0.text).toBe('deleted');
    expect(block1.text).toBe('deleted again');
  });

  it('calculates word count for each block', () => {
    const atoms = [
      createTestAtom('one two three', CorrelationStatus.Deleted),
    ];

    const blocks = groupIntoBlocks(atoms);

    const block0 = blocks[0];
    assertDefined(block0, 'blocks[0]');
    expect(block0.wordCount).toBe(3);
  });
});

describe('findBestMatch', () => {
  const defaultSettings: MoveDetectionSettings = {
    detectMoves: true,
    moveSimilarityThreshold: 0.8,
    moveMinimumWordCount: 1,
    caseInsensitiveMove: true,
  };

  it('finds exact match', () => {
    const deleted = {
      status: CorrelationStatus.Deleted,
      atoms: [createTestAtom('hello world', CorrelationStatus.Deleted)],
      text: 'hello world',
      wordCount: 2,
    };

    const insertedBlocks = [
      {
        status: CorrelationStatus.Inserted,
        atoms: [createTestAtom('hello world', CorrelationStatus.Inserted)],
        text: 'hello world',
        wordCount: 2,
      },
    ];

    const match = findBestMatch(deleted, insertedBlocks, defaultSettings);

    expect(match).toBeDefined();
    expect(match!.similarity).toBe(1);
  });

  it('returns undefined for no match above threshold', () => {
    const deleted = {
      status: CorrelationStatus.Deleted,
      atoms: [createTestAtom('hello world', CorrelationStatus.Deleted)],
      text: 'hello world',
      wordCount: 2,
    };

    const insertedBlocks = [
      {
        status: CorrelationStatus.Inserted,
        atoms: [createTestAtom('foo bar', CorrelationStatus.Inserted)],
        text: 'foo bar',
        wordCount: 2,
      },
    ];

    const match = findBestMatch(deleted, insertedBlocks, defaultSettings);

    expect(match).toBeUndefined();
  });

  it('finds best match among multiple candidates', () => {
    // Use a lower threshold to test the matching logic
    const testSettings: MoveDetectionSettings = {
      ...defaultSettings,
      moveSimilarityThreshold: 0.5, // Lower threshold for this test
    };

    const deleted = {
      status: CorrelationStatus.Deleted,
      atoms: [createTestAtom('the quick brown fox', CorrelationStatus.Deleted)],
      text: 'the quick brown fox',
      wordCount: 4,
    };

    const insertedBlocks = [
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

    const match = findBestMatch(deleted, insertedBlocks, testSettings);

    expect(match).toBeDefined();
    expect(match!.index).toBe(1); // Second block is better match
    expect(match!.similarity).toBeGreaterThan(0.5);
  });

  it('skips already matched blocks', () => {
    const deleted = {
      status: CorrelationStatus.Deleted,
      atoms: [createTestAtom('hello world', CorrelationStatus.Deleted)],
      text: 'hello world',
      wordCount: 2,
    };

    // First block is already marked as MovedDestination
    const insertedBlocks = [
      {
        status: CorrelationStatus.Inserted,
        atoms: [createTestAtom('hello world', CorrelationStatus.MovedDestination)],
        text: 'hello world',
        wordCount: 2,
      },
    ];

    const match = findBestMatch(deleted, insertedBlocks, defaultSettings);

    expect(match).toBeUndefined();
  });
});

describe('markAsMove', () => {
  it('marks atoms as moved source', () => {
    const atoms = [
      createTestAtom('hello', CorrelationStatus.Deleted),
      createTestAtom(' world', CorrelationStatus.Deleted),
    ];

    markAsMove(atoms, CorrelationStatus.MovedSource, 1, 'move1');

    const atom0 = atoms[0];
    const atom1 = atoms[1];
    assertDefined(atom0, 'atoms[0]');
    assertDefined(atom1, 'atoms[1]');
    expect(atom0.correlationStatus).toBe(CorrelationStatus.MovedSource);
    expect(atom0.moveGroupId).toBe(1);
    expect(atom0.moveName).toBe('move1');
    expect(atom1.correlationStatus).toBe(CorrelationStatus.MovedSource);
  });

  it('marks atoms as moved destination', () => {
    const atoms = [createTestAtom('new text', CorrelationStatus.Inserted)];

    markAsMove(atoms, CorrelationStatus.MovedDestination, 2, 'move2');

    const atom0 = atoms[0];
    assertDefined(atom0, 'atoms[0]');
    expect(atom0.correlationStatus).toBe(CorrelationStatus.MovedDestination);
    expect(atom0.moveGroupId).toBe(2);
    expect(atom0.moveName).toBe('move2');
  });
});

describe('detectMovesInAtomList', () => {
  it('does nothing when detectMoves is false', () => {
    const atoms = [
      createTestAtom('deleted text here for move', CorrelationStatus.Deleted),
      createTestAtom('deleted text here for move', CorrelationStatus.Inserted),
    ];

    detectMovesInAtomList(atoms, {
      detectMoves: false,
      moveSimilarityThreshold: 0.8,
      moveMinimumWordCount: 1,
      caseInsensitiveMove: true,
    });

    const atom0 = atoms[0];
    const atom1 = atoms[1];
    assertDefined(atom0, 'atoms[0]');
    assertDefined(atom1, 'atoms[1]');
    expect(atom0.correlationStatus).toBe(CorrelationStatus.Deleted);
    expect(atom1.correlationStatus).toBe(CorrelationStatus.Inserted);
  });

  it('detects exact moves', () => {
    const atoms = [
      createTestAtom('this is some text that was moved', CorrelationStatus.Deleted),
      createTestAtom('unchanged', CorrelationStatus.Equal),
      createTestAtom('this is some text that was moved', CorrelationStatus.Inserted),
    ];

    detectMovesInAtomList(atoms, {
      detectMoves: true,
      moveSimilarityThreshold: 0.8,
      moveMinimumWordCount: 1,
      caseInsensitiveMove: true,
    });

    const atom0 = atoms[0];
    const atom2 = atoms[2];
    assertDefined(atom0, 'atoms[0]');
    assertDefined(atom2, 'atoms[2]');
    expect(atom0.correlationStatus).toBe(CorrelationStatus.MovedSource);
    expect(atom0.moveName).toBe('move1');
    expect(atom2.correlationStatus).toBe(CorrelationStatus.MovedDestination);
    expect(atom2.moveName).toBe('move1');
  });

  it('respects minimum word count', () => {
    const atoms = [
      createTestAtom('hi', CorrelationStatus.Deleted), // Only 1 word
      createTestAtom('hi', CorrelationStatus.Inserted),
    ];

    detectMovesInAtomList(atoms, {
      detectMoves: true,
      moveSimilarityThreshold: 0.8,
      moveMinimumWordCount: 5, // Require 5 words
      caseInsensitiveMove: true,
    });

    // Should NOT be marked as moved due to word count
    const atom0 = atoms[0];
    const atom1 = atoms[1];
    assertDefined(atom0, 'atoms[0]');
    assertDefined(atom1, 'atoms[1]');
    expect(atom0.correlationStatus).toBe(CorrelationStatus.Deleted);
    expect(atom1.correlationStatus).toBe(CorrelationStatus.Inserted);
  });

  it('respects similarity threshold', () => {
    const atoms = [
      createTestAtom('the quick brown fox jumps', CorrelationStatus.Deleted),
      createTestAtom('a slow red cat sleeps', CorrelationStatus.Inserted), // Completely different
    ];

    detectMovesInAtomList(atoms, {
      detectMoves: true,
      moveSimilarityThreshold: 0.8,
      moveMinimumWordCount: 1,
      caseInsensitiveMove: true,
    });

    // Should NOT be marked as moved due to low similarity
    const atom0 = atoms[0];
    const atom1 = atoms[1];
    assertDefined(atom0, 'atoms[0]');
    assertDefined(atom1, 'atoms[1]');
    expect(atom0.correlationStatus).toBe(CorrelationStatus.Deleted);
    expect(atom1.correlationStatus).toBe(CorrelationStatus.Inserted);
  });
});

describe('generateMoveSourceMarkup', () => {
  it('generates correct structure', () => {
    const content = [{ tagName: 'w:r', attributes: {}, children: [] }];
    const options = {
      author: 'Test Author',
      dateTime: new Date('2025-01-15T10:00:00Z'),
      startId: 1,
    };

    const markup = generateMoveSourceMarkup('move1', content, options);

    expect(markup.rangeStart.tagName).toBe('w:moveFromRangeStart');
    expect(markup.rangeStart.attributes['w:id']).toBe('1');
    expect(markup.rangeStart.attributes['w:name']).toBe('move1');
    expect(markup.rangeStart.attributes['w:author']).toBe('Test Author');

    expect(markup.moveWrapper.tagName).toBe('w:moveFrom');
    expect(markup.moveWrapper.attributes['w:id']).toBe('2');
    expect(markup.moveWrapper.children).toBe(content);

    expect(markup.rangeEnd.tagName).toBe('w:moveFromRangeEnd');
    expect(markup.rangeEnd.attributes['w:id']).toBe('1');

    expect(markup.nextId).toBe(3);
  });
});

describe('generateMoveDestinationMarkup', () => {
  it('generates correct structure', () => {
    const content = [{ tagName: 'w:r', attributes: {}, children: [] }];
    const options = {
      author: 'Test Author',
      dateTime: new Date('2025-01-15T10:00:00Z'),
      startId: 3,
    };

    const markup = generateMoveDestinationMarkup('move1', content, options);

    expect(markup.rangeStart.tagName).toBe('w:moveToRangeStart');
    expect(markup.rangeStart.attributes['w:id']).toBe('3');
    expect(markup.rangeStart.attributes['w:name']).toBe('move1');

    expect(markup.moveWrapper.tagName).toBe('w:moveTo');
    expect(markup.moveWrapper.attributes['w:id']).toBe('4');

    expect(markup.rangeEnd.tagName).toBe('w:moveToRangeEnd');
    expect(markup.rangeEnd.attributes['w:id']).toBe('3');

    expect(markup.nextId).toBe(5);
  });
});

describe('RevisionIdState', () => {
  it('creates initial state', () => {
    const state = createRevisionIdState();
    expect(state.nextId).toBe(1);
    expect(state.moveRangeIds.size).toBe(0);
  });

  it('creates state with custom starting ID', () => {
    const state = createRevisionIdState(100);
    expect(state.nextId).toBe(100);
  });

  it('allocates consistent IDs for moves', () => {
    const state = createRevisionIdState();

    const ids1 = allocateMoveIds(state, 'move1');
    expect(ids1.sourceRangeId).toBe(1);
    expect(ids1.sourceMoveId).toBe(2);
    expect(ids1.destRangeId).toBe(3);
    expect(ids1.destMoveId).toBe(4);

    // Same move name returns same IDs
    const ids1Again = allocateMoveIds(state, 'move1');
    expect(ids1Again).toEqual(ids1);

    // Different move name gets new IDs
    const ids2 = allocateMoveIds(state, 'move2');
    expect(ids2.sourceRangeId).toBe(5);
    expect(ids2.destRangeId).toBe(7);
  });
});
