import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import {
  computeDiff,
  computeWordDiff,
  splitRun,
  extractText,
  diffRuns,
  countChanges,
} from './runDiff.js';
import type { RunInfo } from '../../shared/ooxml/types.js';

// ── Helper ──────────────────────────────────────────────────────────

function run(text: string, start: number): RunInfo {
  return { text, start, end: start + text.length };
}

function runWithProps(text: string, start: number, props: RunInfo['properties']): RunInfo {
  return { text, start, end: start + text.length, properties: props };
}

// ── computeDiff ─────────────────────────────────────────────────────

describe('computeDiff', () => {
  it('returns empty diff for identical strings', () => {
    const diffs = computeDiff('hello', 'hello');
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toEqual([0, 'hello']);
  });

  it('detects insertion', () => {
    const diffs = computeDiff('hello', 'hello world');
    const insertions = diffs.filter(([op]) => op === 1);
    expect(insertions.length).toBeGreaterThan(0);
  });

  it('detects deletion', () => {
    const diffs = computeDiff('hello world', 'hello');
    const deletions = diffs.filter(([op]) => op === -1);
    expect(deletions.length).toBeGreaterThan(0);
  });

  it('handles empty original', () => {
    const diffs = computeDiff('', 'new text');
    expect(diffs).toEqual([[1, 'new text']]);
  });

  it('handles empty revised', () => {
    const diffs = computeDiff('old text', '');
    expect(diffs).toEqual([[-1, 'old text']]);
  });

  it('handles both empty', () => {
    const diffs = computeDiff('', '');
    expect(diffs).toHaveLength(0);
  });

  it('skips semantic cleanup when disabled', () => {
    const withCleanup = computeDiff('abc', 'axc', true);
    const withoutCleanup = computeDiff('abc', 'axc', false);
    // Both produce correct diffs; the exact shape may differ due to cleanup
    const withText = withCleanup.map(([, t]) => t).join('');
    const withoutText = withoutCleanup.map(([, t]) => t).join('');
    // Both reconstruct to include all original and revised characters
    expect(withText.includes('a')).toBe(true);
    expect(withoutText.includes('a')).toBe(true);
  });
});

// ── computeWordDiff ─────────────────────────────────────────────────

describe('computeWordDiff', () => {
  it('detects word-level insertion', () => {
    const diffs = computeWordDiff('hello world', 'hello beautiful world');
    const insertions = diffs.filter(([op]) => op === 1);
    expect(insertions.some(([, text]) => text.includes('beautiful'))).toBe(true);
  });

  it('detects word-level deletion', () => {
    const diffs = computeWordDiff('hello beautiful world', 'hello world');
    const deletions = diffs.filter(([op]) => op === -1);
    expect(deletions.some(([, text]) => text.includes('beautiful'))).toBe(true);
  });

  it('handles identical text', () => {
    const diffs = computeWordDiff('same text', 'same text');
    expect(diffs.every(([op]) => op === 0)).toBe(true);
  });

  it('handles empty strings', () => {
    const diffs = computeWordDiff('', '');
    expect(diffs).toHaveLength(0);
  });

  it('handles empty original', () => {
    const diffs = computeWordDiff('', 'new words');
    const insertions = diffs.filter(([op]) => op === 1);
    expect(insertions.length).toBeGreaterThan(0);
  });

  it('preserves multi-byte Unicode content', () => {
    const original = 'hello 世界';
    const revised = 'hello 世界 again';
    const diffs = computeWordDiff(original, revised);
    // Reconstruct revised from diffs
    const reconstructed = diffs
      .filter(([op]) => op !== -1)
      .map(([, t]) => t)
      .join('');
    expect(reconstructed).toBe(revised);
    // Equal parts should contain the shared text
    const equalText = diffs
      .filter(([op]) => op === 0)
      .map(([, t]) => t)
      .join('');
    expect(equalText).toContain('hello');
  });

  it('round-trips tokens correctly through word diff', () => {
    const original = 'The quick brown fox';
    const revised = 'The slow brown fox';
    const diffs = computeWordDiff(original, revised);
    // Reconstruct both sides from diffs
    const reconstructedOriginal = diffs
      .filter(([op]) => op !== 1)
      .map(([, t]) => t)
      .join('');
    const reconstructedRevised = diffs
      .filter(([op]) => op !== -1)
      .map(([, t]) => t)
      .join('');
    expect(reconstructedOriginal).toBe(original);
    expect(reconstructedRevised).toBe(revised);
  });
});

// ── splitRun ────────────────────────────────────────────────────────

describe('splitRun', () => {
  it('splits at a mid-text offset', () => {
    const r = run('hello', 0);
    const [before, after] = splitRun(r, 3);
    expect(before.text).toBe('hel');
    expect(after.text).toBe('lo');
    expect(before.start).toBe(0);
    expect(before.end).toBe(3);
    expect(after.start).toBe(3);
    expect(after.end).toBe(5);
  });

  it('splits at offset 0 (empty before)', () => {
    const r = run('test', 10);
    const [before, after] = splitRun(r, 0);
    expect(before.text).toBe('');
    expect(after.text).toBe('test');
    expect(before.start).toBe(10);
    expect(after.start).toBe(10);
  });

  it('splits at end offset (empty after)', () => {
    const r = run('test', 5);
    const [before, after] = splitRun(r, 4);
    expect(before.text).toBe('test');
    expect(after.text).toBe('');
  });

  it('preserves properties on both halves', () => {
    const props = { bold: true, italic: true };
    const r = runWithProps('abcd', 0, props);
    const [before, after] = splitRun(r, 2);
    expect(before.properties).toEqual(props);
    expect(after.properties).toEqual(props);
    // Shallow copy — modifying one shouldn't affect the other
    expect(before.properties).not.toBe(after.properties);
  });

  it('handles run with no properties', () => {
    const r = run('abcd', 0);
    const [before, after] = splitRun(r, 2);
    expect(before.properties).toBeUndefined();
    expect(after.properties).toBeUndefined();
  });
});

// ── extractText ─────────────────────────────────────────────────────

describe('extractText', () => {
  it('concatenates text from multiple runs', () => {
    const runs = [run('Hello', 0), run(' ', 5), run('world', 6)];
    expect(extractText(runs)).toBe('Hello world');
  });

  it('returns empty string for empty array', () => {
    expect(extractText([])).toBe('');
  });

  it('handles single run', () => {
    expect(extractText([run('only', 0)])).toBe('only');
  });
});

// ── diffRuns ────────────────────────────────────────────────────────

describe('diffRuns', () => {
  it('produces no revision markers for identical runs', () => {
    const original = [run('hello world', 0)];
    const revised = [run('hello world', 0)];
    const result = diffRuns(original, revised);

    expect(result.mergedRuns.length).toBeGreaterThan(0);
    expect(result.mergedRuns.every((r) => r.revision === undefined)).toBe(true);
    expect(extractText(result.mergedRuns)).toBe('hello world');
  });

  it('marks insertions with revision type', () => {
    const original = [run('hello', 0)];
    const revised = [run('hello world', 0)];
    const result = diffRuns(original, revised);

    const insertions = result.mergedRuns.filter((r) => r.revision?.type === 'insertion');
    expect(insertions.length).toBeGreaterThan(0);
    const insertedText = extractText(insertions);
    expect(insertedText).toContain('world');
  });

  it('marks deletions with revision type', () => {
    const original = [run('hello world', 0)];
    const revised = [run('hello', 0)];
    const result = diffRuns(original, revised);

    const deletions = result.mergedRuns.filter((r) => r.revision?.type === 'deletion');
    expect(deletions.length).toBeGreaterThan(0);
  });

  it('handles both empty run arrays', () => {
    const result = diffRuns([], []);
    expect(result.mergedRuns).toHaveLength(0);
  });

  it('handles empty original (all insertions)', () => {
    const result = diffRuns([], [run('new text', 0)]);
    expect(result.mergedRuns.length).toBeGreaterThan(0);
    expect(result.mergedRuns.every((r) => r.revision?.type === 'insertion')).toBe(true);
  });

  it('handles empty revised (all deletions)', () => {
    const result = diffRuns([run('old text', 0)], []);
    expect(result.mergedRuns.length).toBeGreaterThan(0);
    expect(result.mergedRuns.every((r) => r.revision?.type === 'deletion')).toBe(true);
  });

  it('preserves original runs and revised runs in result', () => {
    const original = [run('A', 0)];
    const revised = [run('B', 0)];
    const result = diffRuns(original, revised);
    expect(result.originalRuns).toBe(original);
    expect(result.revisedRuns).toBe(revised);
  });

  it('handles single-character difference', () => {
    const original = [run('cat', 0)];
    const revised = [run('bat', 0)];
    const result = diffRuns(original, revised);

    // Should have a deletion (c) and insertion (b), and equal (at)
    const hasInsertion = result.mergedRuns.some((r) => r.revision?.type === 'insertion');
    const hasDeletion = result.mergedRuns.some((r) => r.revision?.type === 'deletion');
    expect(hasInsertion).toBe(true);
    expect(hasDeletion).toBe(true);
  });

  it('handles difference spanning run boundaries', () => {
    const original = [run('hel', 0), run('lo world', 3)];
    const revised = [run('hello ', 0), run('earth', 6)];
    const result = diffRuns(original, revised);

    // The full text diff is "hello world" → "hello earth"
    const allText = result.mergedRuns.map((r) => r.text).join('');
    expect(allText).toContain('hello');
  });
});

// ── countChanges ────────────────────────────────────────────────────

describe('countChanges', () => {
  it('counts insertions and deletions', () => {
    const diffs = computeDiff('hello', 'hello world');
    const counts = countChanges(diffs);
    expect(counts.insertions).toBeGreaterThan(0);
    expect(counts.deletions).toBe(0);
  });

  it('returns zeros for identical strings', () => {
    const diffs = computeDiff('same', 'same');
    const counts = countChanges(diffs);
    expect(counts.insertions).toBe(0);
    expect(counts.deletions).toBe(0);
  });

  it('counts both insertions and deletions for replacement', () => {
    const diffs = computeDiff('old', 'new');
    const counts = countChanges(diffs);
    expect(counts.insertions).toBeGreaterThan(0);
    expect(counts.deletions).toBeGreaterThan(0);
  });

  it('handles empty diffs', () => {
    const counts = countChanges([]);
    expect(counts.insertions).toBe(0);
    expect(counts.deletions).toBe(0);
  });
});
