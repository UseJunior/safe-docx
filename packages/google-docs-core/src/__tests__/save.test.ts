import { describe, it, expect } from 'vitest';
import { validateSaveMode, MAX_PINNED_REVISIONS } from '../save.js';

describe('Save', () => {
  describe('validateSaveMode', () => {
    it('defaults to checkpoint', () => {
      expect(validateSaveMode()).toBe('checkpoint');
      expect(validateSaveMode(undefined)).toBe('checkpoint');
      expect(validateSaveMode('checkpoint')).toBe('checkpoint');
    });

    it('accepts pin mode', () => {
      expect(validateSaveMode('pin')).toBe('pin');
    });

    it('accepts snapshot mode', () => {
      expect(validateSaveMode('snapshot')).toBe('snapshot');
    });

    it('throws on invalid mode', () => {
      expect(() => validateSaveMode('invalid')).toThrow('Invalid save_mode');
    });
  });

  it('MAX_PINNED_REVISIONS is 200', () => {
    expect(MAX_PINNED_REVISIONS).toBe(200);
  });
});
