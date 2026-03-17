import { describe, it, expect } from 'vitest';
import { isRevisionFresh, buildWriteControl, extractRevisionId } from '../concurrency.js';

describe('Concurrency', () => {
  describe('isRevisionFresh', () => {
    it('returns true for recently fetched revision', () => {
      expect(isRevisionFresh({ revisionId: 'rev1', fetchedAt: new Date() })).toBe(true);
    });

    it('returns false for revision older than 23 hours', () => {
      const old = new Date(Date.now() - 24 * 60 * 60 * 1000);
      expect(isRevisionFresh({ revisionId: 'rev1', fetchedAt: old })).toBe(false);
    });

    it('returns true for revision just under 23 hours', () => {
      const recent = new Date(Date.now() - 22 * 60 * 60 * 1000);
      expect(isRevisionFresh({ revisionId: 'rev1', fetchedAt: recent })).toBe(true);
    });
  });

  describe('buildWriteControl', () => {
    it('returns requiredRevisionId field', () => {
      const wc = buildWriteControl('rev_123');
      expect(wc).toEqual({ requiredRevisionId: 'rev_123' });
    });
  });

  describe('extractRevisionId', () => {
    it('extracts revisionId from document', () => {
      expect(extractRevisionId({ revisionId: 'abc123' } as any)).toBe('abc123');
    });
    it('returns empty string when missing', () => {
      expect(extractRevisionId({} as any)).toBe('');
    });
  });
});
