import { describe, it, expect } from 'vitest';
import { IndexTracker } from '../index-tracker.js';

describe('IndexTracker', () => {
  describe('utf16Length', () => {
    it('counts ASCII characters correctly', () => {
      expect(IndexTracker.utf16Length('hello')).toBe(5);
    });
    it('counts empty string as 0', () => {
      expect(IndexTracker.utf16Length('')).toBe(0);
    });
    it('counts emoji (surrogate pair) as 2 code units', () => {
      expect(IndexTracker.utf16Length('\u{1F600}')).toBe(2);
    });
    it('counts mixed ASCII and emoji', () => {
      expect(IndexTracker.utf16Length('hi\u{1F600}bye')).toBe(7); // 2 + 2 + 3
    });
    it('counts CJK supplementary characters as 2 code units', () => {
      // U+20000 is a CJK supplementary character
      expect(IndexTracker.utf16Length('\u{20000}')).toBe(2);
    });
    it('counts BMP CJK characters as 1 code unit', () => {
      expect(IndexTracker.utf16Length('\u4E2D')).toBe(1);
    });
  });

  describe('adjustIndex', () => {
    it('returns original index when no deltas recorded', () => {
      const tracker = new IndexTracker();
      expect(tracker.adjustIndex(10)).toBe(10);
    });
    it('adjusts index after deletion', () => {
      const tracker = new IndexTracker();
      tracker.recordDeletion(5, 10); // Delete 5 chars at index 5
      expect(tracker.adjustIndex(15)).toBe(10); // Shifted back by 5
    });
    it('adjusts index after insertion', () => {
      const tracker = new IndexTracker();
      tracker.recordInsertion(5, 'hello'); // Insert 5 chars at index 5
      expect(tracker.adjustIndex(10)).toBe(15); // Shifted forward by 5
    });
    it('does not adjust indices before the operation', () => {
      const tracker = new IndexTracker();
      tracker.recordDeletion(10, 15);
      expect(tracker.adjustIndex(5)).toBe(5); // Before deletion, unchanged
    });
  });

  describe('recordReplacement', () => {
    it('returns positive shift for longer replacement', () => {
      const tracker = new IndexTracker();
      const shift = tracker.recordReplacement(5, 10, 'hello world'); // 5 -> 11
      expect(shift).toBe(6);
    });
    it('returns negative shift for shorter replacement', () => {
      const tracker = new IndexTracker();
      const shift = tracker.recordReplacement(5, 15, 'hi'); // 10 -> 2
      expect(shift).toBe(-8);
    });
    it('returns zero shift for same-length replacement', () => {
      const tracker = new IndexTracker();
      const shift = tracker.recordReplacement(5, 10, 'abcde'); // 5 -> 5
      expect(shift).toBe(0);
    });
  });

  describe('sortEditsReverseOrder', () => {
    it('sorts edits by startIndex descending', () => {
      const edits = [
        { startIndex: 5, text: 'a' },
        { startIndex: 20, text: 'b' },
        { startIndex: 10, text: 'c' },
      ];
      const sorted = IndexTracker.sortEditsReverseOrder(edits);
      expect(sorted.map(e => e.startIndex)).toEqual([20, 10, 5]);
    });
    it('does not mutate original array', () => {
      const edits = [{ startIndex: 5, text: 'a' }, { startIndex: 1, text: 'b' }];
      IndexTracker.sortEditsReverseOrder(edits);
      expect(edits[0].startIndex).toBe(5);
    });
  });

  describe('isSurrogatePair', () => {
    it('detects high surrogate', () => {
      const emoji = '\u{1F600}';
      expect(IndexTracker.isSurrogatePair(emoji, 0)).toBe(true);
    });
    it('does not flag low surrogate', () => {
      const emoji = '\u{1F600}';
      expect(IndexTracker.isSurrogatePair(emoji, 1)).toBe(false);
    });
    it('does not flag BMP characters', () => {
      expect(IndexTracker.isSurrogatePair('A', 0)).toBe(false);
    });
  });

  describe('countSurrogatePairs', () => {
    it('counts zero for ASCII', () => {
      expect(IndexTracker.countSurrogatePairs('hello')).toBe(0);
    });
    it('counts one for single emoji', () => {
      expect(IndexTracker.countSurrogatePairs('\u{1F600}')).toBe(1);
    });
    it('counts multiple emoji', () => {
      expect(IndexTracker.countSurrogatePairs('\u{1F600}\u{1F389}')).toBe(2);
    });
    it('counts in mixed text', () => {
      expect(IndexTracker.countSurrogatePairs('hi\u{1F600}bye\u{1F389}!')).toBe(2);
    });
  });

  describe('codePointOffsetToUtf16', () => {
    it('converts ASCII offset directly', () => {
      expect(IndexTracker.codePointOffsetToUtf16('hello', 3)).toBe(3);
    });
    it('accounts for emoji before offset', () => {
      // '\u{1F600}abc' - code point 0 is emoji (2 UTF-16 units), so cp offset 1 = utf16 offset 2
      expect(IndexTracker.codePointOffsetToUtf16('\u{1F600}abc', 1)).toBe(2);
    });
    it('handles offset at string boundary', () => {
      expect(IndexTracker.codePointOffsetToUtf16('abc', 3)).toBe(3);
    });
    it('handles zero offset', () => {
      expect(IndexTracker.codePointOffsetToUtf16('\u{1F600}abc', 0)).toBe(0);
    });
  });

  describe('reset', () => {
    it('clears all deltas', () => {
      const tracker = new IndexTracker();
      tracker.recordDeletion(5, 10);
      tracker.reset();
      expect(tracker.adjustIndex(15)).toBe(15); // No adjustment after reset
    });
  });
});
