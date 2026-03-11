import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import type { RunInfo } from '../../shared/ooxml/types.js';
import {
  computeDiff,
  computeWordDiff,
  countChanges,
  diffRuns,
  extractText,
  splitRun,
} from './runDiff.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Run Diff' });

describe('runDiff helpers', () => {
  test('computes semantic and non-semantic diffs', async ({ given, when, then }: AllureBddContext) => {
    let semantic: ReturnType<typeof computeDiff>;
    let raw: ReturnType<typeof computeDiff>;

    await given('two strings with a word difference', () => {});

    await when('diffs are computed with and without semantic cleanup', () => {
      semantic = computeDiff('The quick fox', 'The slow fox', true);
      raw = computeDiff('The quick fox', 'The slow fox', false);
    });

    await then('both diffs contain insertions and deletions', () => {
      expect(semantic.length).toBeGreaterThan(0);
      expect(raw.length).toBeGreaterThan(0);
      expect(semantic.some(([op]) => op === -1)).toBe(true);
      expect(semantic.some(([op]) => op === 1)).toBe(true);
    });
  });

  test('computes word-level diffs with token reconstruction', async ({ given, when, then }: AllureBddContext) => {
    let diffs: ReturnType<typeof computeWordDiff>;

    await given('two sentences with a word substitution', () => {});

    await when('word-level diff is computed', () => {
      diffs = computeWordDiff('Alpha beta gamma delta', 'Alpha beta epsilon delta');
    });

    await then('the substituted word is detected as deleted and inserted', () => {
      expect(diffs.some(([op, text]) => op === -1 && text.includes('gamma'))).toBe(true);
      expect(diffs.some(([op, text]) => op === 1 && text.includes('epsilon'))).toBe(true);
    });
  });

  test('splits runs while preserving offsets and run properties', async ({ given, when, then }: AllureBddContext) => {
    let run: RunInfo;
    let left: RunInfo;
    let right: RunInfo;

    await given('a run with properties and an offset', () => {
      run = {
        text: 'abcdef',
        start: 10,
        end: 16,
        properties: { bold: true, fontFamily: 'Calibri' },
      };
    });

    await when('the run is split at position 2', () => {
      [left, right] = splitRun(run, 2);
    });

    await then('both halves preserve properties and correct offsets', () => {
      expect(left).toEqual({
        text: 'ab',
        start: 10,
        end: 12,
        properties: { bold: true, fontFamily: 'Calibri' },
      });
      expect(right).toEqual({
        text: 'cdef',
        start: 12,
        end: 16,
        properties: { bold: true, fontFamily: 'Calibri' },
      });
    });
  });

  test('extracts text and counts insertion/deletion lengths', async ({ given, when, then }: AllureBddContext) => {
    let runs: RunInfo[];
    let extracted: string;
    let changes: ReturnType<typeof countChanges>;

    await given('an array of runs and a diff result', () => {
      runs = [
        { text: 'foo', start: 0, end: 3 },
        { text: 'bar', start: 3, end: 6 },
      ];
    });

    await when('text is extracted and changes are counted', () => {
      extracted = extractText(runs);
      changes = countChanges([[0, 'same'], [-1, 'old'], [1, 'newer']]);
    });

    await then('extracted text is concatenated and counts are correct', () => {
      expect(extracted).toBe('foobar');
      expect(changes).toEqual({ insertions: 5, deletions: 3 });
    });
  });

  test('maps character diffs back to run boundaries for insertion/deletion', async ({ given, when, then }: AllureBddContext) => {
    let originalRuns: RunInfo[];
    let revisedRuns: RunInfo[];
    let result: ReturnType<typeof diffRuns>;

    await given('original and revised runs with different second runs', () => {
      originalRuns = [
        { text: 'Alpha ', start: 0, end: 6, properties: { italic: true } },
        { text: 'beta', start: 6, end: 10, properties: { bold: true } },
      ];
      revisedRuns = [
        { text: 'Alpha ', start: 0, end: 6, properties: { italic: true } },
        { text: 'epsilon', start: 6, end: 13, properties: { underline: 'single' } },
      ];
    });

    await when('runs are diffed', () => {
      result = diffRuns(originalRuns, revisedRuns);
    });

    await then('the merged runs contain the changed text with revision markers', () => {
      const mergedText = result.mergedRuns.map((r) => r.text).join('');
      expect(mergedText).toContain('Alpha ');
      expect(mergedText).toContain('epsilon');
      expect(result.mergedRuns.some((r) => r.revision?.type === 'insertion')).toBe(true);
      expect(result.mergedRuns.some((r) => r.revision?.type === 'deletion')).toBe(true);
    });
  });

  test('handles insertions at end-of-run offsets', async ({ given, when, then }: AllureBddContext) => {
    let originalRuns: RunInfo[];
    let revisedRuns: RunInfo[];
    let result: ReturnType<typeof diffRuns>;

    await given('original run and revised run with appended text', () => {
      originalRuns = [{ text: 'Hello', start: 0, end: 5 }];
      revisedRuns = [{ text: 'Hello world', start: 0, end: 11 }];
    });

    await when('runs are diffed', () => {
      result = diffRuns(originalRuns, revisedRuns);
    });

    await then('the appended text is detected as an insertion', () => {
      const insertions = result.mergedRuns.filter((r) => r.revision?.type === 'insertion');
      expect(insertions.length).toBeGreaterThan(0);
      expect(insertions.map((r) => r.text).join('')).toContain(' world');
    });
  });
});
