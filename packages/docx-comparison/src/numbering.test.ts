import { describe, expect } from 'vitest';
import { itAllure as it } from './testing/allure-test.js';
import {
  detectContinuationPattern,
  getEffectiveLevel,
  createNumberingState,
  getCounters,
  processNumberedParagraph,
  formatNumber,
  expandLevelText,
  expandLevelTextWithLegal,
  isLegalNumberingActive,
  parseLevelElement,
  parseAbstractNumElement,
} from './numbering.js';
import { WmlElement, ListLevelInfo } from './core-types.js';
import { assertDefined } from './testing/test-utils.js';

describe('detectContinuationPattern', () => {
  it('returns no continuation for ilvl 0', () => {
    const result = detectContinuationPattern(0, 1, [0, 0, 0]);
    expect(result.isContinuation).toBe(false);
    expect(result.effectiveLevel).toBe(0);
  });

  it('detects continuation pattern', () => {
    // Level numbers [3, 0] means level 0 is at "3"
    // ilvl 1 with start=4 continues from level 0
    const result = detectContinuationPattern(1, 4, [3, 0, 0]);
    expect(result.isContinuation).toBe(true);
    expect(result.effectiveLevel).toBe(0);
  });

  it('returns no continuation when start does not match', () => {
    // Level 0 is at 3, but ilvl 1 starts at 1 (normal nested list)
    const result = detectContinuationPattern(1, 1, [3, 0, 0]);
    expect(result.isContinuation).toBe(false);
    expect(result.effectiveLevel).toBe(1);
  });

  it('handles deeper levels', () => {
    // [5, 3, 0] - level 0 at 5, level 1 at 3
    // ilvl 2 with start=4 continues from level 1
    const result = detectContinuationPattern(2, 4, [5, 3, 0]);
    expect(result.isContinuation).toBe(true);
    expect(result.effectiveLevel).toBe(0);
  });

  it('treats missing parent counters as zero for sparse level arrays', () => {
    const result = detectContinuationPattern(2, 1, []);
    expect(result.isContinuation).toBe(true);
    expect(result.effectiveLevel).toBe(0);
  });
});

describe('getEffectiveLevel', () => {
  it('returns original level for non-continuation', () => {
    expect(getEffectiveLevel(0, 1, [0, 0])).toBe(0);
    expect(getEffectiveLevel(1, 1, [3, 0])).toBe(1);
  });

  it('returns 0 for continuation patterns', () => {
    expect(getEffectiveLevel(1, 4, [3, 0])).toBe(0);
  });
});

describe('NumberingState', () => {
  it('creates empty state', () => {
    const state = createNumberingState();
    expect(state.counters.size).toBe(0);
    expect(state.levelUsed.size).toBe(0);
  });

  it('initializes counters on first access', () => {
    const state = createNumberingState();
    const counters = getCounters(state, 1);

    expect(counters).toHaveLength(9);
    expect(counters.every((c) => c === 0)).toBe(true);
  });

  it('returns same counters on subsequent access', () => {
    const state = createNumberingState();
    const counters1 = getCounters(state, 1);
    counters1[0] = 5;

    const counters2 = getCounters(state, 1);
    expect(counters2[0]).toBe(5);
  });

  it('separates counters by numId', () => {
    const state = createNumberingState();
    const counters1 = getCounters(state, 1);
    counters1[0] = 10;

    const counters2 = getCounters(state, 2);
    expect(counters2[0]).toBe(0);
  });
});

describe('processNumberedParagraph', () => {
  it('starts at start value on first use', () => {
    const state = createNumberingState();
    const levelInfo: ListLevelInfo = { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' };

    const result = processNumberedParagraph(state, 1, 0, levelInfo);
    expect(result).toBe(1);
  });

  it('increments on subsequent use', () => {
    const state = createNumberingState();
    const levelInfo: ListLevelInfo = { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' };

    processNumberedParagraph(state, 1, 0, levelInfo);
    const result = processNumberedParagraph(state, 1, 0, levelInfo);
    expect(result).toBe(2);
  });

  it('handles continuation pattern', () => {
    const state = createNumberingState();
    const level0: ListLevelInfo = { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' };
    const level1: ListLevelInfo = { ilvl: 1, start: 4, numFmt: 'decimal', lvlText: '%1.%2' };

    // Process three level 0 items
    processNumberedParagraph(state, 1, 0, level0); // 1
    processNumberedParagraph(state, 1, 0, level0); // 2
    processNumberedParagraph(state, 1, 0, level0); // 3

    // Level 1 with start=4 should continue as 4 (not 3.1)
    const result = processNumberedParagraph(state, 1, 1, level1);
    expect(result).toBe(4);
  });

  it('resets deeper levels when moving to shallower level', () => {
    const state = createNumberingState();
    const level0: ListLevelInfo = { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' };
    const level1: ListLevelInfo = { ilvl: 1, start: 1, numFmt: 'decimal', lvlText: '%1.%2' };

    // 1.
    processNumberedParagraph(state, 1, 0, level0);
    // 1.1
    processNumberedParagraph(state, 1, 1, level1);
    // 1.2
    processNumberedParagraph(state, 1, 1, level1);

    // 2. - should reset level 1
    processNumberedParagraph(state, 1, 0, level0);

    // 2.1 - should restart at 1
    const result = processNumberedParagraph(state, 1, 1, level1);
    expect(result).toBe(1);
  });
});

describe('formatNumber', () => {
  describe('decimal', () => {
    it('formats as decimal', () => {
      expect(formatNumber(1, 'decimal')).toBe('1');
      expect(formatNumber(42, 'decimal')).toBe('42');
    });
  });

  describe('lowerLetter', () => {
    it('formats single letters', () => {
      expect(formatNumber(1, 'lowerLetter')).toBe('a');
      expect(formatNumber(26, 'lowerLetter')).toBe('z');
    });

    it('formats double letters', () => {
      expect(formatNumber(27, 'lowerLetter')).toBe('aa');
      expect(formatNumber(28, 'lowerLetter')).toBe('ab');
    });
  });

  describe('upperLetter', () => {
    it('formats as uppercase', () => {
      expect(formatNumber(1, 'upperLetter')).toBe('A');
      expect(formatNumber(26, 'upperLetter')).toBe('Z');
    });
  });

  describe('lowerRoman', () => {
    it('formats common numerals', () => {
      expect(formatNumber(1, 'lowerRoman')).toBe('i');
      expect(formatNumber(4, 'lowerRoman')).toBe('iv');
      expect(formatNumber(5, 'lowerRoman')).toBe('v');
      expect(formatNumber(9, 'lowerRoman')).toBe('ix');
      expect(formatNumber(10, 'lowerRoman')).toBe('x');
    });
  });

  describe('upperRoman', () => {
    it('formats as uppercase', () => {
      expect(formatNumber(1, 'upperRoman')).toBe('I');
      expect(formatNumber(50, 'upperRoman')).toBe('L');
      expect(formatNumber(100, 'upperRoman')).toBe('C');
    });
  });

  describe('ordinal', () => {
    it('formats with correct suffix', () => {
      expect(formatNumber(1, 'ordinal')).toBe('1st');
      expect(formatNumber(2, 'ordinal')).toBe('2nd');
      expect(formatNumber(3, 'ordinal')).toBe('3rd');
      expect(formatNumber(4, 'ordinal')).toBe('4th');
      expect(formatNumber(11, 'ordinal')).toBe('11th');
      expect(formatNumber(21, 'ordinal')).toBe('21st');
    });
  });

  describe('bullet', () => {
    it('returns bullet character', () => {
      expect(formatNumber(1, 'bullet')).toBe('•');
    });
  });

  describe('none', () => {
    it('returns empty string', () => {
      expect(formatNumber(1, 'none')).toBe('');
    });
  });
});

describe('expandLevelText', () => {
  it('expands single placeholder', () => {
    const levels: ListLevelInfo[] = [{ ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' }];
    expect(expandLevelText('%1.', [5], levels)).toBe('5.');
  });

  it('expands multiple placeholders', () => {
    const levels: ListLevelInfo[] = [
      { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' },
      { ilvl: 1, start: 1, numFmt: 'decimal', lvlText: '%1.%2' },
    ];
    expect(expandLevelText('%1.%2', [3, 2], levels)).toBe('3.2');
  });

  it('uses format from level definition', () => {
    const levels: ListLevelInfo[] = [{ ilvl: 0, start: 1, numFmt: 'lowerLetter', lvlText: '%1)' }];
    expect(expandLevelText('%1)', [1], levels)).toBe('a)');
  });

  it('handles missing levels gracefully', () => {
    expect(expandLevelText('%1.', [5], [])).toBe('5.');
  });
});

describe('isLegalNumberingActive', () => {
  it('returns false when no levels have isLgl', () => {
    const levels: ListLevelInfo[] = [
      { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' },
      { ilvl: 1, start: 1, numFmt: 'lowerLetter', lvlText: '%1.%2' },
    ];

    expect(isLegalNumberingActive(levels, 0)).toBe(false);
    expect(isLegalNumberingActive(levels, 1)).toBe(false);
  });

  it('returns true when any ancestor level has isLgl', () => {
    const levels: ListLevelInfo[] = [
      { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.', isLgl: true },
      { ilvl: 1, start: 1, numFmt: 'lowerLetter', lvlText: '%1.%2' },
    ];

    expect(isLegalNumberingActive(levels, 0)).toBe(true);
    expect(isLegalNumberingActive(levels, 1)).toBe(true);
  });
});

describe('expandLevelTextWithLegal', () => {
  it('uses decimal for all levels when legal is active', () => {
    const levels: ListLevelInfo[] = [
      { ilvl: 0, start: 1, numFmt: 'upperRoman', lvlText: '%1.', isLgl: true },
      { ilvl: 1, start: 1, numFmt: 'lowerLetter', lvlText: '%1.%2' },
    ];

    // Without legal, would be "I.a", but with legal becomes "1.1"
    expect(expandLevelTextWithLegal('%1.%2', [1, 1], levels, 1)).toBe('1.1');
  });

  it('uses defined format when legal is not active', () => {
    const levels: ListLevelInfo[] = [
      { ilvl: 0, start: 1, numFmt: 'upperRoman', lvlText: '%1.' },
      { ilvl: 1, start: 1, numFmt: 'lowerLetter', lvlText: '%1.%2' },
    ];

    expect(expandLevelTextWithLegal('%1.%2', [1, 1], levels, 1)).toBe('I.a');
  });
});

describe('parseLevelElement', () => {
  it('parses level with all properties', () => {
    const lvlElement: WmlElement = {
      tagName: 'w:lvl',
      attributes: { 'w:ilvl': '1' },
      children: [
        { tagName: 'w:start', attributes: { 'w:val': '5' } },
        { tagName: 'w:numFmt', attributes: { 'w:val': 'lowerRoman' } },
        { tagName: 'w:lvlText', attributes: { 'w:val': '%2)' } },
        { tagName: 'w:isLgl', attributes: {} },
      ],
    };

    const result = parseLevelElement(lvlElement);

    expect(result.ilvl).toBe(1);
    expect(result.start).toBe(5);
    expect(result.numFmt).toBe('lowerRoman');
    expect(result.lvlText).toBe('%2)');
    expect(result.isLgl).toBe(true);
  });

  it('uses defaults for missing properties', () => {
    const lvlElement: WmlElement = {
      tagName: 'w:lvl',
      attributes: {},
      children: [],
    };

    const result = parseLevelElement(lvlElement);

    expect(result.ilvl).toBe(0);
    expect(result.start).toBe(1);
    expect(result.numFmt).toBe('decimal');
    expect(result.lvlText).toBe('');
    expect(result.isLgl).toBeFalsy();
  });

  it('parses isLgl=false correctly', () => {
    const lvlElement: WmlElement = {
      tagName: 'w:lvl',
      attributes: { 'w:ilvl': '0' },
      children: [{ tagName: 'w:isLgl', attributes: { 'w:val': 'false' } }],
    };

    const result = parseLevelElement(lvlElement);
    expect(result.isLgl).toBe(false);
  });
});

describe('parseAbstractNumElement', () => {
  it('parses multiple levels', () => {
    const abstractNum: WmlElement = {
      tagName: 'w:abstractNum',
      attributes: { 'w:abstractNumId': '0' },
      children: [
        {
          tagName: 'w:lvl',
          attributes: { 'w:ilvl': '0' },
          children: [
            { tagName: 'w:start', attributes: { 'w:val': '1' } },
            { tagName: 'w:numFmt', attributes: { 'w:val': 'decimal' } },
            { tagName: 'w:lvlText', attributes: { 'w:val': '%1.' } },
          ],
        },
        {
          tagName: 'w:lvl',
          attributes: { 'w:ilvl': '1' },
          children: [
            { tagName: 'w:start', attributes: { 'w:val': '1' } },
            { tagName: 'w:numFmt', attributes: { 'w:val': 'lowerLetter' } },
            { tagName: 'w:lvlText', attributes: { 'w:val': '%2)' } },
          ],
        },
      ],
    };

    const levels = parseAbstractNumElement(abstractNum);

    const level0 = levels[0];
    const level1 = levels[1];
    assertDefined(level0, 'levels[0]');
    assertDefined(level1, 'levels[1]');
    expect(level0.numFmt).toBe('decimal');
    expect(level0.lvlText).toBe('%1.');
    expect(level1.numFmt).toBe('lowerLetter');
    expect(level1.lvlText).toBe('%2)');
  });
});

describe('additional numbering branches', () => {
  it('covers cardinal/ordinal text formats and unknown fallback', () => {
    expect(formatNumber(21, 'cardinalText')).toBe('twenty-one');
    expect(formatNumber(105, 'cardinalText')).toBe('105');
    expect(formatNumber(12, 'ordinalText')).toBe('twelfth');
    expect(formatNumber(32, 'ordinalText')).toBe('32nd');
    expect(formatNumber(7, 'unknown-format')).toBe('7');
    expect(formatNumber(9, 'decimalZero')).toBe('9');
  });

  it('treats isLgl="0" as false and drops unresolved placeholders safely', () => {
    const lvlElement: WmlElement = {
      tagName: 'w:lvl',
      attributes: { 'w:ilvl': '2' },
      children: [
        { tagName: 'w:isLgl', attributes: { 'w:val': '0' } },
        { tagName: 'w:lvlText', attributes: { 'w:val': '%1.%3' } },
      ],
    };
    const parsed = parseLevelElement(lvlElement);
    expect(parsed.isLgl).toBe(false);

    const levels: ListLevelInfo[] = [
      { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1' },
      { ilvl: 1, start: 1, numFmt: 'upperRoman', lvlText: '%2' },
      { ilvl: 2, start: 1, numFmt: 'lowerLetter', lvlText: '%3' },
    ];
    expect(expandLevelText('%1.%3', [5], levels)).toBe('5.');
  });

  it('processes independent numbering states per numId', () => {
    const state = createNumberingState();
    const levelInfo: ListLevelInfo = { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' };

    const n1a = processNumberedParagraph(state, 100, 0, levelInfo);
    const n1b = processNumberedParagraph(state, 100, 0, levelInfo);
    const n2a = processNumberedParagraph(state, 200, 0, levelInfo);
    expect(n1a).toBe(1);
    expect(n1b).toBe(2);
    expect(n2a).toBe(1);
  });
});
