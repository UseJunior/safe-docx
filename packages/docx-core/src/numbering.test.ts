import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
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
import { ListLevelInfo } from './core-types.js';
import { el } from './testing/dom-test-helpers.js';
import { assertDefined } from './testing/test-utils.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Numbering' });

describe('detectContinuationPattern', () => {
  test('returns no continuation for ilvl 0', async ({ given, when, then }: AllureBddContext) => {
    let result: ReturnType<typeof detectContinuationPattern>;

    await given('ilvl 0, start 1, and empty level numbers', () => {});

    await when('continuation pattern is detected', () => {
      result = detectContinuationPattern(0, 1, [0, 0, 0]);
    });

    await then('no continuation is reported', () => {
      expect(result.isContinuation).toBe(false);
      expect(result.effectiveLevel).toBe(0);
    });
  });

  test('detects continuation pattern', async ({ given, when, then }: AllureBddContext) => {
    let result: ReturnType<typeof detectContinuationPattern>;

    await given('ilvl 1 with start=4 and level 0 at count 3', () => {});

    await when('continuation pattern is detected', () => {
      // Level numbers [3, 0] means level 0 is at "3"
      // ilvl 1 with start=4 continues from level 0
      result = detectContinuationPattern(1, 4, [3, 0, 0]);
    });

    await then('continuation is detected with effectiveLevel 0', () => {
      expect(result.isContinuation).toBe(true);
      expect(result.effectiveLevel).toBe(0);
    });
  });

  test('returns no continuation when start does not match', async ({ given, when, then }: AllureBddContext) => {
    let result: ReturnType<typeof detectContinuationPattern>;

    await given('ilvl 1 with start=1 while level 0 is at count 3', () => {});

    await when('continuation pattern is detected', () => {
      // Level 0 is at 3, but ilvl 1 starts at 1 (normal nested list)
      result = detectContinuationPattern(1, 1, [3, 0, 0]);
    });

    await then('no continuation is reported', () => {
      expect(result.isContinuation).toBe(false);
      expect(result.effectiveLevel).toBe(1);
    });
  });

  test('handles deeper levels', async ({ given, when, then }: AllureBddContext) => {
    let result: ReturnType<typeof detectContinuationPattern>;

    await given('ilvl 2 with start=4 when level 1 is at count 3', () => {});

    await when('continuation pattern is detected', () => {
      // [5, 3, 0] - level 0 at 5, level 1 at 3
      // ilvl 2 with start=4 continues from level 1
      result = detectContinuationPattern(2, 4, [5, 3, 0]);
    });

    await then('continuation is detected', () => {
      expect(result.isContinuation).toBe(true);
      expect(result.effectiveLevel).toBe(0);
    });
  });

  test('treats missing parent counters as zero for sparse level arrays', async ({ given, when, then }: AllureBddContext) => {
    let result: ReturnType<typeof detectContinuationPattern>;

    await given('ilvl 2 with start=1 and an empty level array', () => {});

    await when('continuation pattern is detected', () => {
      result = detectContinuationPattern(2, 1, []);
    });

    await then('continuation is detected', () => {
      expect(result.isContinuation).toBe(true);
      expect(result.effectiveLevel).toBe(0);
    });
  });
});

describe('getEffectiveLevel', () => {
  test('returns original level for non-continuation', async ({ given, when, then }: AllureBddContext) => {
    await given('levels that do not form a continuation pattern', () => {});
    await when('effective level is retrieved', () => {});
    await then('the original level is returned', () => {
      expect(getEffectiveLevel(0, 1, [0, 0])).toBe(0);
      expect(getEffectiveLevel(1, 1, [3, 0])).toBe(1);
    });
  });

  test('returns 0 for continuation patterns', async ({ given, when, then }: AllureBddContext) => {
    await given('a continuation pattern', () => {});
    await when('effective level is retrieved', () => {});
    await then('level 0 is returned', () => {
      expect(getEffectiveLevel(1, 4, [3, 0])).toBe(0);
    });
  });
});

describe('NumberingState', () => {
  test('creates empty state', async ({ given, when, then }: AllureBddContext) => {
    let state: ReturnType<typeof createNumberingState>;

    await given('no initial state', () => {});

    await when('createNumberingState is called', () => {
      state = createNumberingState();
    });

    await then('state has empty counters and levelUsed maps', () => {
      expect(state.counters.size).toBe(0);
      expect(state.levelUsed.size).toBe(0);
    });
  });

  test('initializes counters on first access', async ({ given, when, then }: AllureBddContext) => {
    let state: ReturnType<typeof createNumberingState>;
    let counters: number[];

    await given('a fresh numbering state', () => {
      state = createNumberingState();
    });

    await when('counters are first accessed for numId 1', () => {
      counters = getCounters(state, 1);
    });

    await then('an array of 9 zeros is returned', () => {
      expect(counters).toHaveLength(9);
      expect(counters.every((c) => c === 0)).toBe(true);
    });
  });

  test('returns same counters on subsequent access', async ({ given, when, then }: AllureBddContext) => {
    let state: ReturnType<typeof createNumberingState>;

    await given('a numbering state with modified counters', () => {
      state = createNumberingState();
      const counters1 = getCounters(state, 1);
      counters1[0] = 5;
    });

    await when('counters are accessed again', () => {});

    await then('the modified value is persisted', () => {
      const counters2 = getCounters(state, 1);
      expect(counters2[0]).toBe(5);
    });
  });

  test('separates counters by numId', async ({ given, when, then }: AllureBddContext) => {
    let state: ReturnType<typeof createNumberingState>;

    await given('a numbering state with counters for numId 1 modified', () => {
      state = createNumberingState();
      const counters1 = getCounters(state, 1);
      counters1[0] = 10;
    });

    await when('counters for a different numId are accessed', () => {});

    await then('the new numId starts at zero', () => {
      const counters2 = getCounters(state, 2);
      expect(counters2[0]).toBe(0);
    });
  });
});

describe('processNumberedParagraph', () => {
  test('starts at start value on first use', async ({ given, when, then }: AllureBddContext) => {
    let state: ReturnType<typeof createNumberingState>;
    let result: number;

    await given('a fresh numbering state and a level with start=1', () => {
      state = createNumberingState();
    });

    await when('the first paragraph is processed', () => {
      const levelInfo: ListLevelInfo = { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' };
      result = processNumberedParagraph(state, 1, 0, levelInfo);
    });

    await then('the result is 1', () => {
      expect(result).toBe(1);
    });
  });

  test('increments on subsequent use', async ({ given, when, then }: AllureBddContext) => {
    let state: ReturnType<typeof createNumberingState>;
    let result: number;

    await given('a numbering state after processing one paragraph', () => {
      state = createNumberingState();
      const levelInfo: ListLevelInfo = { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' };
      processNumberedParagraph(state, 1, 0, levelInfo);
    });

    await when('the second paragraph is processed', () => {
      const levelInfo: ListLevelInfo = { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' };
      result = processNumberedParagraph(state, 1, 0, levelInfo);
    });

    await then('the result is 2', () => {
      expect(result).toBe(2);
    });
  });

  test('handles continuation pattern', async ({ given, when, then }: AllureBddContext) => {
    let state: ReturnType<typeof createNumberingState>;
    let result: number;

    await given('a state where level 0 has been processed three times', () => {
      state = createNumberingState();
      const level0: ListLevelInfo = { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' };
      processNumberedParagraph(state, 1, 0, level0); // 1
      processNumberedParagraph(state, 1, 0, level0); // 2
      processNumberedParagraph(state, 1, 0, level0); // 3
    });

    await when('level 1 with start=4 is processed', () => {
      const level1: ListLevelInfo = { ilvl: 1, start: 4, numFmt: 'decimal', lvlText: '%1.%2' };
      result = processNumberedParagraph(state, 1, 1, level1);
    });

    await then('the result is 4 (continuing level 0)', () => {
      // Level 1 with start=4 should continue as 4 (not 3.1)
      expect(result).toBe(4);
    });
  });

  test('resets deeper levels when moving to shallower level', async ({ given, when, then }: AllureBddContext) => {
    let state: ReturnType<typeof createNumberingState>;
    let result: number;

    await given('a state with items at both level 0 and level 1', () => {
      state = createNumberingState();
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
    });

    await when('the next level 1 paragraph is processed', () => {
      const level1: ListLevelInfo = { ilvl: 1, start: 1, numFmt: 'decimal', lvlText: '%1.%2' };
      result = processNumberedParagraph(state, 1, 1, level1);
    });

    await then('level 1 restarts at 1', () => {
      // 2.1 - should restart at 1
      expect(result).toBe(1);
    });
  });
});

describe('formatNumber', () => {
  describe('decimal', () => {
    test('formats as decimal', async ({ given, when, then }: AllureBddContext) => {
      await given('decimal numbers', () => {});
      await when('formatNumber is called', () => {});
      await then('the number is returned as a string', () => {
        expect(formatNumber(1, 'decimal')).toBe('1');
        expect(formatNumber(42, 'decimal')).toBe('42');
      });
    });
  });

  describe('lowerLetter', () => {
    test('formats single letters', async ({ given, when, then }: AllureBddContext) => {
      await given('numbers 1 and 26', () => {});
      await when('formatNumber is called with lowerLetter', () => {});
      await then('a and z are returned', () => {
        expect(formatNumber(1, 'lowerLetter')).toBe('a');
        expect(formatNumber(26, 'lowerLetter')).toBe('z');
      });
    });

    test('formats double letters', async ({ given, when, then }: AllureBddContext) => {
      await given('numbers 27 and 28', () => {});
      await when('formatNumber is called with lowerLetter', () => {});
      await then('aa and ab are returned', () => {
        expect(formatNumber(27, 'lowerLetter')).toBe('aa');
        expect(formatNumber(28, 'lowerLetter')).toBe('ab');
      });
    });
  });

  describe('upperLetter', () => {
    test('formats as uppercase', async ({ given, when, then }: AllureBddContext) => {
      await given('numbers 1 and 26', () => {});
      await when('formatNumber is called with upperLetter', () => {});
      await then('A and Z are returned', () => {
        expect(formatNumber(1, 'upperLetter')).toBe('A');
        expect(formatNumber(26, 'upperLetter')).toBe('Z');
      });
    });
  });

  describe('lowerRoman', () => {
    test('formats common numerals', async ({ given, when, then }: AllureBddContext) => {
      await given('common Roman numeral values', () => {});
      await when('formatNumber is called with lowerRoman', () => {});
      await then('correct Roman numerals are returned', () => {
        expect(formatNumber(1, 'lowerRoman')).toBe('i');
        expect(formatNumber(4, 'lowerRoman')).toBe('iv');
        expect(formatNumber(5, 'lowerRoman')).toBe('v');
        expect(formatNumber(9, 'lowerRoman')).toBe('ix');
        expect(formatNumber(10, 'lowerRoman')).toBe('x');
      });
    });
  });

  describe('upperRoman', () => {
    test('formats as uppercase', async ({ given, when, then }: AllureBddContext) => {
      await given('numbers 1, 50, and 100', () => {});
      await when('formatNumber is called with upperRoman', () => {});
      await then('I, L, and C are returned', () => {
        expect(formatNumber(1, 'upperRoman')).toBe('I');
        expect(formatNumber(50, 'upperRoman')).toBe('L');
        expect(formatNumber(100, 'upperRoman')).toBe('C');
      });
    });
  });

  describe('ordinal', () => {
    test('formats with correct suffix', async ({ given, when, then }: AllureBddContext) => {
      await given('ordinal numbers', () => {});
      await when('formatNumber is called with ordinal', () => {});
      await then('correct suffixes are applied', () => {
        expect(formatNumber(1, 'ordinal')).toBe('1st');
        expect(formatNumber(2, 'ordinal')).toBe('2nd');
        expect(formatNumber(3, 'ordinal')).toBe('3rd');
        expect(formatNumber(4, 'ordinal')).toBe('4th');
        expect(formatNumber(11, 'ordinal')).toBe('11th');
        expect(formatNumber(21, 'ordinal')).toBe('21st');
      });
    });
  });

  describe('bullet', () => {
    test('returns bullet character', async ({ given, when, then }: AllureBddContext) => {
      await given('any number', () => {});
      await when('formatNumber is called with bullet', () => {});
      await then('a bullet character is returned', () => {
        expect(formatNumber(1, 'bullet')).toBe('\u2022');
      });
    });
  });

  describe('none', () => {
    test('returns empty string', async ({ given, when, then }: AllureBddContext) => {
      await given('any number', () => {});
      await when('formatNumber is called with none', () => {});
      await then('an empty string is returned', () => {
        expect(formatNumber(1, 'none')).toBe('');
      });
    });
  });
});

describe('expandLevelText', () => {
  test('expands single placeholder', async ({ given, when, then }: AllureBddContext) => {
    await given('a level text with a single placeholder', () => {});
    await when('the level text is expanded', () => {});
    await then('the placeholder is replaced with the counter value', () => {
      const levels: ListLevelInfo[] = [{ ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' }];
      expect(expandLevelText('%1.', [5], levels)).toBe('5.');
    });
  });

  test('expands multiple placeholders', async ({ given, when, then }: AllureBddContext) => {
    await given('a level text with two placeholders', () => {});
    await when('the level text is expanded', () => {});
    await then('both placeholders are replaced', () => {
      const levels: ListLevelInfo[] = [
        { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' },
        { ilvl: 1, start: 1, numFmt: 'decimal', lvlText: '%1.%2' },
      ];
      expect(expandLevelText('%1.%2', [3, 2], levels)).toBe('3.2');
    });
  });

  test('uses format from level definition', async ({ given, when, then }: AllureBddContext) => {
    await given('a level with lowerLetter format', () => {});
    await when('the level text is expanded', () => {});
    await then('the counter is formatted as a letter', () => {
      const levels: ListLevelInfo[] = [{ ilvl: 0, start: 1, numFmt: 'lowerLetter', lvlText: '%1)' }];
      expect(expandLevelText('%1)', [1], levels)).toBe('a)');
    });
  });

  test('handles missing levels gracefully', async ({ given, when, then }: AllureBddContext) => {
    await given('a level text with a placeholder but no level definitions', () => {});
    await when('the level text is expanded', () => {});
    await then('the placeholder falls back to decimal', () => {
      expect(expandLevelText('%1.', [5], [])).toBe('5.');
    });
  });
});

describe('isLegalNumberingActive', () => {
  test('returns false when no levels have isLgl', async ({ given, when, then }: AllureBddContext) => {
    await given('levels without isLgl', () => {});
    await when('isLegalNumberingActive is called', () => {});
    await then('false is returned', () => {
      const levels: ListLevelInfo[] = [
        { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' },
        { ilvl: 1, start: 1, numFmt: 'lowerLetter', lvlText: '%1.%2' },
      ];
      expect(isLegalNumberingActive(levels, 0)).toBe(false);
      expect(isLegalNumberingActive(levels, 1)).toBe(false);
    });
  });

  test('returns true when any ancestor level has isLgl', async ({ given, when, then }: AllureBddContext) => {
    await given('a level with isLgl=true', () => {});
    await when('isLegalNumberingActive is called', () => {});
    await then('true is returned for that level and its children', () => {
      const levels: ListLevelInfo[] = [
        { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.', isLgl: true },
        { ilvl: 1, start: 1, numFmt: 'lowerLetter', lvlText: '%1.%2' },
      ];
      expect(isLegalNumberingActive(levels, 0)).toBe(true);
      expect(isLegalNumberingActive(levels, 1)).toBe(true);
    });
  });
});

describe('expandLevelTextWithLegal', () => {
  test('uses decimal for all levels when legal is active', async ({ given, when, then }: AllureBddContext) => {
    await given('levels where level 0 has isLgl=true', () => {});
    await when('the level text is expanded with legal mode', () => {});
    await then('all levels use decimal formatting', () => {
      const levels: ListLevelInfo[] = [
        { ilvl: 0, start: 1, numFmt: 'upperRoman', lvlText: '%1.', isLgl: true },
        { ilvl: 1, start: 1, numFmt: 'lowerLetter', lvlText: '%1.%2' },
      ];
      // Without legal, would be "I.a", but with legal becomes "1.1"
      expect(expandLevelTextWithLegal('%1.%2', [1, 1], levels, 1)).toBe('1.1');
    });
  });

  test('uses defined format when legal is not active', async ({ given, when, then }: AllureBddContext) => {
    await given('levels without isLgl', () => {});
    await when('the level text is expanded', () => {});
    await then('the defined formats are used', () => {
      const levels: ListLevelInfo[] = [
        { ilvl: 0, start: 1, numFmt: 'upperRoman', lvlText: '%1.' },
        { ilvl: 1, start: 1, numFmt: 'lowerLetter', lvlText: '%1.%2' },
      ];
      expect(expandLevelTextWithLegal('%1.%2', [1, 1], levels, 1)).toBe('I.a');
    });
  });
});

describe('parseLevelElement', () => {
  test('parses level with all properties', async ({ given, when, then }: AllureBddContext) => {
    let lvlElement: Element;
    let result: ReturnType<typeof parseLevelElement>;

    await given('a w:lvl element with all properties', () => {
      lvlElement = el('w:lvl', { 'w:ilvl': '1' }, [
        el('w:start', { 'w:val': '5' }),
        el('w:numFmt', { 'w:val': 'lowerRoman' }),
        el('w:lvlText', { 'w:val': '%2)' }),
        el('w:isLgl'),
      ]);
    });

    await when('the level element is parsed', () => {
      result = parseLevelElement(lvlElement);
    });

    await then('all properties are correctly parsed', () => {
      expect(result.ilvl).toBe(1);
      expect(result.start).toBe(5);
      expect(result.numFmt).toBe('lowerRoman');
      expect(result.lvlText).toBe('%2)');
      expect(result.isLgl).toBe(true);
    });
  });

  test('uses defaults for missing properties', async ({ given, when, then }: AllureBddContext) => {
    let lvlElement: Element;
    let result: ReturnType<typeof parseLevelElement>;

    await given('an empty w:lvl element', () => {
      lvlElement = el('w:lvl');
    });

    await when('the level element is parsed', () => {
      result = parseLevelElement(lvlElement);
    });

    await then('default values are returned', () => {
      expect(result.ilvl).toBe(0);
      expect(result.start).toBe(1);
      expect(result.numFmt).toBe('decimal');
      expect(result.lvlText).toBe('');
      expect(result.isLgl).toBeFalsy();
    });
  });

  test('parses isLgl=false correctly', async ({ given, when, then }: AllureBddContext) => {
    let lvlElement: Element;
    let result: ReturnType<typeof parseLevelElement>;

    await given('a w:lvl element with isLgl set to false', () => {
      lvlElement = el('w:lvl', { 'w:ilvl': '0' }, [
        el('w:isLgl', { 'w:val': 'false' }),
      ]);
    });

    await when('the level element is parsed', () => {
      result = parseLevelElement(lvlElement);
    });

    await then('isLgl is false', () => {
      expect(result.isLgl).toBe(false);
    });
  });
});

describe('parseAbstractNumElement', () => {
  test('parses multiple levels', async ({ given, when, then }: AllureBddContext) => {
    let abstractNum: Element;
    let levels: ReturnType<typeof parseAbstractNumElement>;

    await given('an abstractNum element with two levels', () => {
      abstractNum = el('w:abstractNum', { 'w:abstractNumId': '0' }, [
        el('w:lvl', { 'w:ilvl': '0' }, [
          el('w:start', { 'w:val': '1' }),
          el('w:numFmt', { 'w:val': 'decimal' }),
          el('w:lvlText', { 'w:val': '%1.' }),
        ]),
        el('w:lvl', { 'w:ilvl': '1' }, [
          el('w:start', { 'w:val': '1' }),
          el('w:numFmt', { 'w:val': 'lowerLetter' }),
          el('w:lvlText', { 'w:val': '%2)' }),
        ]),
      ]);
    });

    await when('the abstractNum element is parsed', () => {
      levels = parseAbstractNumElement(abstractNum);
    });

    await then('both levels are correctly parsed', () => {
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
});

describe('additional numbering branches', () => {
  test('covers cardinal/ordinal text formats and unknown fallback', async ({ given, when, then }: AllureBddContext) => {
    await given('various non-standard format strings', () => {});
    await when('formatNumber is called with each', () => {});
    await then('appropriate values are returned', () => {
      expect(formatNumber(21, 'cardinalText')).toBe('twenty-one');
      expect(formatNumber(105, 'cardinalText')).toBe('105');
      expect(formatNumber(12, 'ordinalText')).toBe('twelfth');
      expect(formatNumber(32, 'ordinalText')).toBe('32nd');
      expect(formatNumber(7, 'unknown-format')).toBe('7');
      expect(formatNumber(9, 'decimalZero')).toBe('9');
    });
  });

  test('treats isLgl="0" as false and drops unresolved placeholders safely', async ({ given, when, then }: AllureBddContext) => {
    let parsed: ReturnType<typeof parseLevelElement>;

    await given('a level with isLgl="0" and a template with an out-of-range placeholder', () => {});

    await when('the level is parsed and the template is expanded', () => {
      const lvlElement = el('w:lvl', { 'w:ilvl': '2' }, [
        el('w:isLgl', { 'w:val': '0' }),
        el('w:lvlText', { 'w:val': '%1.%3' }),
      ]);
      parsed = parseLevelElement(lvlElement);
    });

    await then('isLgl is false and unresolved placeholder is dropped', () => {
      expect(parsed.isLgl).toBe(false);

      const levels: ListLevelInfo[] = [
        { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1' },
        { ilvl: 1, start: 1, numFmt: 'upperRoman', lvlText: '%2' },
        { ilvl: 2, start: 1, numFmt: 'lowerLetter', lvlText: '%3' },
      ];
      expect(expandLevelText('%1.%3', [5], levels)).toBe('5.');
    });
  });

  test('processes independent numbering states per numId', async ({ given, when, then }: AllureBddContext) => {
    let state: ReturnType<typeof createNumberingState>;
    let n1a: number;
    let n1b: number;
    let n2a: number;

    await given('a single numbering state', () => {
      state = createNumberingState();
    });

    await when('paragraphs from two different numIds are processed', () => {
      const levelInfo: ListLevelInfo = { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' };
      n1a = processNumberedParagraph(state, 100, 0, levelInfo);
      n1b = processNumberedParagraph(state, 100, 0, levelInfo);
      n2a = processNumberedParagraph(state, 200, 0, levelInfo);
    });

    await then('each numId has its own independent counter', () => {
      expect(n1a).toBe(1);
      expect(n1b).toBe(2);
      expect(n2a).toBe(1);
    });
  });
});
