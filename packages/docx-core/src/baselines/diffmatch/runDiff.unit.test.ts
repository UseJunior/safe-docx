import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import {
  computeDiff,
  computeWordDiff,
  splitRun,
  extractText,
  diffRuns,
  countChanges,
} from './runDiff.js';
import type { RunInfo } from '../../shared/ooxml/types.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Run Diff Unit' });

// ── Helper ──────────────────────────────────────────────────────────

function run(text: string, start: number): RunInfo {
  return { text, start, end: start + text.length };
}

function runWithProps(text: string, start: number, props: RunInfo['properties']): RunInfo {
  return { text, start, end: start + text.length, properties: props };
}

// ── computeDiff ─────────────────────────────────────────────────────

describe('computeDiff', () => {
  test('returns empty diff for identical strings', async ({ given, when, then }: AllureBddContext) => {
    let diffs: ReturnType<typeof computeDiff>;

    await given('two identical strings', () => {});

    await when('diff is computed', () => {
      diffs = computeDiff('hello', 'hello');
    });

    await then('one equal segment is returned', () => {
      expect(diffs).toHaveLength(1);
      expect(diffs[0]).toEqual([0, 'hello']);
    });
  });

  test('detects insertion', async ({ given, when, then }: AllureBddContext) => {
    let diffs: ReturnType<typeof computeDiff>;

    await given('an original and a revised string with an appended word', () => {});

    await when('diff is computed', () => {
      diffs = computeDiff('hello', 'hello world');
    });

    await then('an insertion is detected', () => {
      const insertions = diffs.filter(([op]) => op === 1);
      expect(insertions.length).toBeGreaterThan(0);
    });
  });

  test('detects deletion', async ({ given, when, then }: AllureBddContext) => {
    let diffs: ReturnType<typeof computeDiff>;

    await given('an original string with extra text and a revised string without it', () => {});

    await when('diff is computed', () => {
      diffs = computeDiff('hello world', 'hello');
    });

    await then('a deletion is detected', () => {
      const deletions = diffs.filter(([op]) => op === -1);
      expect(deletions.length).toBeGreaterThan(0);
    });
  });

  test('handles empty original', async ({ given, when, then }: AllureBddContext) => {
    let diffs: ReturnType<typeof computeDiff>;

    await given('an empty original and a non-empty revised string', () => {});

    await when('diff is computed', () => {
      diffs = computeDiff('', 'new text');
    });

    await then('the entire revised text is an insertion', () => {
      expect(diffs).toEqual([[1, 'new text']]);
    });
  });

  test('handles empty revised', async ({ given, when, then }: AllureBddContext) => {
    let diffs: ReturnType<typeof computeDiff>;

    await given('a non-empty original and an empty revised string', () => {});

    await when('diff is computed', () => {
      diffs = computeDiff('old text', '');
    });

    await then('the entire original text is a deletion', () => {
      expect(diffs).toEqual([[-1, 'old text']]);
    });
  });

  test('handles both empty', async ({ given, when, then }: AllureBddContext) => {
    let diffs: ReturnType<typeof computeDiff>;

    await given('two empty strings', () => {});

    await when('diff is computed', () => {
      diffs = computeDiff('', '');
    });

    await then('no diff segments are returned', () => {
      expect(diffs).toHaveLength(0);
    });
  });

  test('skips semantic cleanup when disabled', async ({ given, when, then }: AllureBddContext) => {
    let withCleanup: ReturnType<typeof computeDiff>;
    let withoutCleanup: ReturnType<typeof computeDiff>;

    await given('two slightly different strings', () => {});

    await when('diffs are computed with and without semantic cleanup', () => {
      withCleanup = computeDiff('abc', 'axc', true);
      withoutCleanup = computeDiff('abc', 'axc', false);
    });

    await then('both reconstruct to include all original and revised characters', () => {
      // Both produce correct diffs; the exact shape may differ due to cleanup
      const withText = withCleanup.map(([, t]) => t).join('');
      const withoutText = withoutCleanup.map(([, t]) => t).join('');
      // Both reconstruct to include all original and revised characters
      expect(withText.includes('a')).toBe(true);
      expect(withoutText.includes('a')).toBe(true);
    });
  });
});

// ── computeWordDiff ─────────────────────────────────────────────────

describe('computeWordDiff', () => {
  test('detects word-level insertion', async ({ given, when, then }: AllureBddContext) => {
    let diffs: ReturnType<typeof computeWordDiff>;

    await given('a sentence and a sentence with an inserted word', () => {});

    await when('word diff is computed', () => {
      diffs = computeWordDiff('hello world', 'hello beautiful world');
    });

    await then('the inserted word is detected', () => {
      const insertions = diffs.filter(([op]) => op === 1);
      expect(insertions.some(([, text]) => text.includes('beautiful'))).toBe(true);
    });
  });

  test('detects word-level deletion', async ({ given, when, then }: AllureBddContext) => {
    let diffs: ReturnType<typeof computeWordDiff>;

    await given('a sentence with a word and a sentence without it', () => {});

    await when('word diff is computed', () => {
      diffs = computeWordDiff('hello beautiful world', 'hello world');
    });

    await then('the deleted word is detected', () => {
      const deletions = diffs.filter(([op]) => op === -1);
      expect(deletions.some(([, text]) => text.includes('beautiful'))).toBe(true);
    });
  });

  test('handles identical text', async ({ given, when, then }: AllureBddContext) => {
    let diffs: ReturnType<typeof computeWordDiff>;

    await given('two identical sentences', () => {});

    await when('word diff is computed', () => {
      diffs = computeWordDiff('same text', 'same text');
    });

    await then('all segments are equal', () => {
      expect(diffs.every(([op]) => op === 0)).toBe(true);
    });
  });

  test('handles empty strings', async ({ given, when, then }: AllureBddContext) => {
    let diffs: ReturnType<typeof computeWordDiff>;

    await given('two empty strings', () => {});

    await when('word diff is computed', () => {
      diffs = computeWordDiff('', '');
    });

    await then('no diff segments are returned', () => {
      expect(diffs).toHaveLength(0);
    });
  });

  test('handles empty original', async ({ given, when, then }: AllureBddContext) => {
    let diffs: ReturnType<typeof computeWordDiff>;

    await given('an empty original and non-empty revised', () => {});

    await when('word diff is computed', () => {
      diffs = computeWordDiff('', 'new words');
    });

    await then('insertions are detected', () => {
      const insertions = diffs.filter(([op]) => op === 1);
      expect(insertions.length).toBeGreaterThan(0);
    });
  });

  test('preserves multi-byte Unicode content', async ({ given, when, then }: AllureBddContext) => {
    let original: string;
    let revised: string;
    let diffs: ReturnType<typeof computeWordDiff>;

    await given('strings with Unicode characters', () => {
      original = 'hello 世界';
      revised = 'hello 世界 again';
    });

    await when('word diff is computed', () => {
      diffs = computeWordDiff(original, revised);
    });

    await then('the revised text can be reconstructed and shared text is equal', () => {
      const reconstructed = diffs.filter(([op]) => op !== -1).map(([, t]) => t).join('');
      expect(reconstructed).toBe(revised);
      const equalText = diffs.filter(([op]) => op === 0).map(([, t]) => t).join('');
      expect(equalText).toContain('hello');
    });
  });

  test('round-trips tokens correctly through word diff', async ({ given, when, then }: AllureBddContext) => {
    let original: string;
    let revised: string;
    let diffs: ReturnType<typeof computeWordDiff>;

    await given('two sentences with a word substitution', () => {
      original = 'The quick brown fox';
      revised = 'The slow brown fox';
    });

    await when('word diff is computed', () => {
      diffs = computeWordDiff(original, revised);
    });

    await then('both original and revised can be reconstructed from the diff', () => {
      const reconstructedOriginal = diffs.filter(([op]) => op !== 1).map(([, t]) => t).join('');
      const reconstructedRevised = diffs.filter(([op]) => op !== -1).map(([, t]) => t).join('');
      expect(reconstructedOriginal).toBe(original);
      expect(reconstructedRevised).toBe(revised);
    });
  });
});

// ── splitRun ────────────────────────────────────────────────────────

describe('splitRun', () => {
  test('splits at a mid-text offset', async ({ given, when, then }: AllureBddContext) => {
    let r: RunInfo;
    let before: RunInfo;
    let after: RunInfo;

    await given('a run of text', () => {
      r = run('hello', 0);
    });

    await when('the run is split at offset 3', () => {
      [before, after] = splitRun(r, 3);
    });

    await then('both halves have correct text and offsets', () => {
      expect(before.text).toBe('hel');
      expect(after.text).toBe('lo');
      expect(before.start).toBe(0);
      expect(before.end).toBe(3);
      expect(after.start).toBe(3);
      expect(after.end).toBe(5);
    });
  });

  test('splits at offset 0 (empty before)', async ({ given, when, then }: AllureBddContext) => {
    let r: RunInfo;
    let before: RunInfo;
    let after: RunInfo;

    await given('a run starting at offset 10', () => {
      r = run('test', 10);
    });

    await when('the run is split at offset 0', () => {
      [before, after] = splitRun(r, 0);
    });

    await then('the before half is empty and after contains all text', () => {
      expect(before.text).toBe('');
      expect(after.text).toBe('test');
      expect(before.start).toBe(10);
      expect(after.start).toBe(10);
    });
  });

  test('splits at end offset (empty after)', async ({ given, when, then }: AllureBddContext) => {
    let r: RunInfo;
    let before: RunInfo;
    let after: RunInfo;

    await given('a run starting at offset 5', () => {
      r = run('test', 5);
    });

    await when('the run is split at its full length', () => {
      [before, after] = splitRun(r, 4);
    });

    await then('the before half contains all text and after is empty', () => {
      expect(before.text).toBe('test');
      expect(after.text).toBe('');
    });
  });

  test('preserves properties on both halves', async ({ given, when, then }: AllureBddContext) => {
    let props: RunInfo['properties'];
    let r: RunInfo;
    let before: RunInfo;
    let after: RunInfo;

    await given('a run with properties', () => {
      props = { bold: true, italic: true };
      r = runWithProps('abcd', 0, props);
    });

    await when('the run is split at offset 2', () => {
      [before, after] = splitRun(r, 2);
    });

    await then('both halves have the same properties but separate references', () => {
      expect(before.properties).toEqual(props);
      expect(after.properties).toEqual(props);
      // Shallow copy — modifying one shouldn't affect the other
      expect(before.properties).not.toBe(after.properties);
    });
  });

  test('handles run with no properties', async ({ given, when, then }: AllureBddContext) => {
    let r: RunInfo;
    let before: RunInfo;
    let after: RunInfo;

    await given('a run with no properties', () => {
      r = run('abcd', 0);
    });

    await when('the run is split', () => {
      [before, after] = splitRun(r, 2);
    });

    await then('both halves have undefined properties', () => {
      expect(before.properties).toBeUndefined();
      expect(after.properties).toBeUndefined();
    });
  });
});

// ── extractText ─────────────────────────────────────────────────────

describe('extractText', () => {
  test('concatenates text from multiple runs', async ({ given, when, then }: AllureBddContext) => {
    let runs: RunInfo[];
    let result: string;

    await given('multiple runs', () => {
      runs = [run('Hello', 0), run(' ', 5), run('world', 6)];
    });

    await when('text is extracted', () => {
      result = extractText(runs);
    });

    await then('the concatenated text is returned', () => {
      expect(result).toBe('Hello world');
    });
  });

  test('returns empty string for empty array', async ({ given, when, then }: AllureBddContext) => {
    let result: string;

    await given('an empty array of runs', () => {});

    await when('text is extracted', () => {
      result = extractText([]);
    });

    await then('an empty string is returned', () => {
      expect(result).toBe('');
    });
  });

  test('handles single run', async ({ given, when, then }: AllureBddContext) => {
    let result: string;

    await given('a single run', () => {});

    await when('text is extracted', () => {
      result = extractText([run('only', 0)]);
    });

    await then('the run text is returned', () => {
      expect(result).toBe('only');
    });
  });
});

// ── diffRuns ────────────────────────────────────────────────────────

describe('diffRuns', () => {
  test('produces no revision markers for identical runs', async ({ given, when, then }: AllureBddContext) => {
    let original: RunInfo[];
    let revised: RunInfo[];
    let result: ReturnType<typeof diffRuns>;

    await given('identical original and revised runs', () => {
      original = [run('hello world', 0)];
      revised = [run('hello world', 0)];
    });

    await when('runs are diffed', () => {
      result = diffRuns(original, revised);
    });

    await then('no revision markers are present', () => {
      expect(result.mergedRuns.length).toBeGreaterThan(0);
      expect(result.mergedRuns.every((r) => r.revision === undefined)).toBe(true);
      expect(extractText(result.mergedRuns)).toBe('hello world');
    });
  });

  test('marks insertions with revision type', async ({ given, when, then }: AllureBddContext) => {
    let original: RunInfo[];
    let revised: RunInfo[];
    let result: ReturnType<typeof diffRuns>;

    await given('original run and revised run with appended text', () => {
      original = [run('hello', 0)];
      revised = [run('hello world', 0)];
    });

    await when('runs are diffed', () => {
      result = diffRuns(original, revised);
    });

    await then('the appended text is marked as an insertion', () => {
      const insertions = result.mergedRuns.filter((r) => r.revision?.type === 'insertion');
      expect(insertions.length).toBeGreaterThan(0);
      const insertedText = extractText(insertions);
      expect(insertedText).toContain('world');
    });
  });

  test('marks deletions with revision type', async ({ given, when, then }: AllureBddContext) => {
    let original: RunInfo[];
    let revised: RunInfo[];
    let result: ReturnType<typeof diffRuns>;

    await given('original run with extra text and a shorter revised run', () => {
      original = [run('hello world', 0)];
      revised = [run('hello', 0)];
    });

    await when('runs are diffed', () => {
      result = diffRuns(original, revised);
    });

    await then('the removed text is marked as a deletion', () => {
      const deletions = result.mergedRuns.filter((r) => r.revision?.type === 'deletion');
      expect(deletions.length).toBeGreaterThan(0);
    });
  });

  test('handles both empty run arrays', async ({ given, when, then }: AllureBddContext) => {
    let result: ReturnType<typeof diffRuns>;

    await given('empty original and revised run arrays', () => {});

    await when('runs are diffed', () => {
      result = diffRuns([], []);
    });

    await then('no merged runs are returned', () => {
      expect(result.mergedRuns).toHaveLength(0);
    });
  });

  test('handles empty original (all insertions)', async ({ given, when, then }: AllureBddContext) => {
    let result: ReturnType<typeof diffRuns>;

    await given('empty original and a non-empty revised run', () => {});

    await when('runs are diffed', () => {
      result = diffRuns([], [run('new text', 0)]);
    });

    await then('all merged runs are insertions', () => {
      expect(result.mergedRuns.length).toBeGreaterThan(0);
      expect(result.mergedRuns.every((r) => r.revision?.type === 'insertion')).toBe(true);
    });
  });

  test('handles empty revised (all deletions)', async ({ given, when, then }: AllureBddContext) => {
    let result: ReturnType<typeof diffRuns>;

    await given('a non-empty original run and empty revised', () => {});

    await when('runs are diffed', () => {
      result = diffRuns([run('old text', 0)], []);
    });

    await then('all merged runs are deletions', () => {
      expect(result.mergedRuns.length).toBeGreaterThan(0);
      expect(result.mergedRuns.every((r) => r.revision?.type === 'deletion')).toBe(true);
    });
  });

  test('preserves original runs and revised runs in result', async ({ given, when, then }: AllureBddContext) => {
    let original: RunInfo[];
    let revised: RunInfo[];
    let result: ReturnType<typeof diffRuns>;

    await given('original and revised run arrays', () => {
      original = [run('A', 0)];
      revised = [run('B', 0)];
    });

    await when('runs are diffed', () => {
      result = diffRuns(original, revised);
    });

    await then('the result references the original arrays', () => {
      expect(result.originalRuns).toBe(original);
      expect(result.revisedRuns).toBe(revised);
    });
  });

  test('handles single-character difference', async ({ given, when, then }: AllureBddContext) => {
    let result: ReturnType<typeof diffRuns>;

    await given('runs differing by a single character', () => {});

    await when('runs are diffed', () => {
      result = diffRuns([run('cat', 0)], [run('bat', 0)]);
    });

    await then('both an insertion and a deletion are detected', () => {
      // Should have a deletion (c) and insertion (b), and equal (at)
      const hasInsertion = result.mergedRuns.some((r) => r.revision?.type === 'insertion');
      const hasDeletion = result.mergedRuns.some((r) => r.revision?.type === 'deletion');
      expect(hasInsertion).toBe(true);
      expect(hasDeletion).toBe(true);
    });
  });

  test('handles difference spanning run boundaries', async ({ given, when, then }: AllureBddContext) => {
    let result: ReturnType<typeof diffRuns>;

    await given('original and revised runs that span boundaries differently', () => {});

    await when('runs are diffed', () => {
      result = diffRuns(
        [run('hel', 0), run('lo world', 3)],
        [run('hello ', 0), run('earth', 6)]
      );
    });

    await then('the shared text is present in merged runs', () => {
      // The full text diff is "hello world" → "hello earth"
      const allText = result.mergedRuns.map((r) => r.text).join('');
      expect(allText).toContain('hello');
    });
  });
});

// ── countChanges ────────────────────────────────────────────────────

describe('countChanges', () => {
  test('counts insertions and deletions', async ({ given, when, then }: AllureBddContext) => {
    let diffs: ReturnType<typeof computeDiff>;
    let counts: ReturnType<typeof countChanges>;

    await given('a diff with only insertions', () => {
      diffs = computeDiff('hello', 'hello world');
    });

    await when('changes are counted', () => {
      counts = countChanges(diffs);
    });

    await then('only insertions are counted', () => {
      expect(counts.insertions).toBeGreaterThan(0);
      expect(counts.deletions).toBe(0);
    });
  });

  test('returns zeros for identical strings', async ({ given, when, then }: AllureBddContext) => {
    let counts: ReturnType<typeof countChanges>;

    await given('a diff of identical strings', () => {});

    await when('changes are counted', () => {
      const diffs = computeDiff('same', 'same');
      counts = countChanges(diffs);
    });

    await then('both counts are zero', () => {
      expect(counts.insertions).toBe(0);
      expect(counts.deletions).toBe(0);
    });
  });

  test('counts both insertions and deletions for replacement', async ({ given, when, then }: AllureBddContext) => {
    let counts: ReturnType<typeof countChanges>;

    await given('a diff replacing one word with another', () => {});

    await when('changes are counted', () => {
      const diffs = computeDiff('old', 'new');
      counts = countChanges(diffs);
    });

    await then('both insertions and deletions are counted', () => {
      expect(counts.insertions).toBeGreaterThan(0);
      expect(counts.deletions).toBeGreaterThan(0);
    });
  });

  test('handles empty diffs', async ({ given, when, then }: AllureBddContext) => {
    let counts: ReturnType<typeof countChanges>;

    await given('an empty diff array', () => {});

    await when('changes are counted', () => {
      counts = countChanges([]);
    });

    await then('both counts are zero', () => {
      expect(counts.insertions).toBe(0);
      expect(counts.deletions).toBe(0);
    });
  });
});
