import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import type { RunInfo } from '../../shared/ooxml/types.js';
import {
  computeDiff,
  computeWordDiff,
  countChanges,
  diffRuns,
  extractText,
  splitRun,
} from './runDiff.js';

describe('runDiff helpers', () => {
  it('computes semantic and non-semantic diffs', () => {
    const semantic = computeDiff('The quick fox', 'The slow fox', true);
    const raw = computeDiff('The quick fox', 'The slow fox', false);

    expect(semantic.length).toBeGreaterThan(0);
    expect(raw.length).toBeGreaterThan(0);
    expect(semantic.some(([op]) => op === -1)).toBe(true);
    expect(semantic.some(([op]) => op === 1)).toBe(true);
  });

  it('computes word-level diffs with token reconstruction', () => {
    const diffs = computeWordDiff(
      'Alpha beta gamma delta',
      'Alpha beta epsilon delta'
    );
    expect(diffs.some(([op, text]) => op === -1 && text.includes('gamma'))).toBe(true);
    expect(diffs.some(([op, text]) => op === 1 && text.includes('epsilon'))).toBe(true);
  });

  it('splits runs while preserving offsets and run properties', () => {
    const run: RunInfo = {
      text: 'abcdef',
      start: 10,
      end: 16,
      properties: { bold: true, font: 'Calibri' },
    };
    const [left, right] = splitRun(run, 2);

    expect(left).toEqual({
      text: 'ab',
      start: 10,
      end: 12,
      properties: { bold: true, font: 'Calibri' },
    });
    expect(right).toEqual({
      text: 'cdef',
      start: 12,
      end: 16,
      properties: { bold: true, font: 'Calibri' },
    });
  });

  it('extracts text and counts insertion/deletion lengths', () => {
    const runs: RunInfo[] = [
      { text: 'foo', start: 0, end: 3 },
      { text: 'bar', start: 3, end: 6 },
    ];
    expect(extractText(runs)).toBe('foobar');

    const changes = countChanges([
      [0, 'same'],
      [-1, 'old'],
      [1, 'newer'],
    ]);
    expect(changes).toEqual({ insertions: 5, deletions: 3 });
  });

  it('maps character diffs back to run boundaries for insertion/deletion', () => {
    const originalRuns: RunInfo[] = [
      { text: 'Alpha ', start: 0, end: 6, properties: { italic: true } },
      { text: 'beta', start: 6, end: 10, properties: { bold: true } },
    ];
    const revisedRuns: RunInfo[] = [
      { text: 'Alpha ', start: 0, end: 6, properties: { italic: true } },
      { text: 'epsilon', start: 6, end: 13, properties: { underline: true } },
    ];

    const result = diffRuns(originalRuns, revisedRuns);
    const mergedText = result.mergedRuns.map((r) => r.text).join('');
    expect(mergedText).toContain('Alpha ');
    expect(mergedText).toContain('epsilon');
    expect(result.mergedRuns.some((r) => r.revision?.type === 'insertion')).toBe(true);
    expect(result.mergedRuns.some((r) => r.revision?.type === 'deletion')).toBe(true);
  });

  it('handles insertions at end-of-run offsets', () => {
    const originalRuns: RunInfo[] = [
      { text: 'Hello', start: 0, end: 5 },
    ];
    const revisedRuns: RunInfo[] = [
      { text: 'Hello world', start: 0, end: 11 },
    ];

    const result = diffRuns(originalRuns, revisedRuns);
    const insertions = result.mergedRuns.filter((r) => r.revision?.type === 'insertion');
    expect(insertions.length).toBeGreaterThan(0);
    expect(insertions.map((r) => r.text).join('')).toContain(' world');
  });
});
