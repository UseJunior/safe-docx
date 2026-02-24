import { describe, expect } from 'vitest';
import { itAllure as it } from './helpers/allure-test.js';
import { extractListLabel, stripListLabel, LabelType } from '../src/primitives/list_labels.js';

describe('extractListLabel', () => {
  // ── Letter labels ────────────────────────────────────────────────────
  describe('letter labels', () => {
    it('extracts lowercase letter label (a)', () => {
      const result = extractListLabel('(a) First item');
      expect(result.label).toBe('(a)');
      expect(result.label_type).toBe(LabelType.LETTER);
      expect(result.match_end).toBeGreaterThan(0);
    });

    it('extracts uppercase letter label (A)', () => {
      const result = extractListLabel('(A) First item');
      expect(result.label).toBe('(A)');
      expect(result.label_type).toBe(LabelType.LETTER);
    });

    it('treats single-char roman-like letters as letter labels', () => {
      // Single-char "i" is treated as letter, not roman
      const result = extractListLabel('(i) item text');
      expect(result.label).toBe('(i)');
      expect(result.label_type).toBe(LabelType.LETTER);
    });

    it('treats single-char "v" as letter label', () => {
      const result = extractListLabel('(v) item text');
      expect(result.label).toBe('(v)');
      expect(result.label_type).toBe(LabelType.LETTER);
    });
  });

  // ── Roman labels ─────────────────────────────────────────────────────
  describe('roman labels', () => {
    it('extracts lowercase roman label (ii)', () => {
      const result = extractListLabel('(ii) Second item');
      expect(result.label).toBe('(ii)');
      expect(result.label_type).toBe(LabelType.ROMAN);
    });

    it('extracts lowercase roman label (iv)', () => {
      const result = extractListLabel('(iv) Fourth item');
      expect(result.label).toBe('(iv)');
      expect(result.label_type).toBe(LabelType.ROMAN);
    });

    it('extracts longer roman numeral (xiii)', () => {
      const result = extractListLabel('(xiii) Thirteenth item');
      expect(result.label).toBe('(xiii)');
      expect(result.label_type).toBe(LabelType.ROMAN);
    });
  });

  // ── Number labels ────────────────────────────────────────────────────
  describe('number labels', () => {
    it('extracts parenthesized number (1)', () => {
      const result = extractListLabel('(1) First item');
      expect(result.label).toBe('(1)');
      expect(result.label_type).toBe(LabelType.NUMBER);
    });

    it('extracts multi-digit number (10)', () => {
      const result = extractListLabel('(10) Tenth item');
      expect(result.label).toBe('(10)');
      expect(result.label_type).toBe(LabelType.NUMBER);
    });
  });

  // ── Section labels ───────────────────────────────────────────────────
  describe('section labels', () => {
    it('extracts Section 1', () => {
      const result = extractListLabel('Section 1 Content here');
      expect(result.label).toBe('Section 1');
      expect(result.label_type).toBe(LabelType.SECTION);
    });

    it('extracts Section 1.2', () => {
      const result = extractListLabel('Section 1.2 Content here');
      expect(result.label).toBe('Section 1.2');
      expect(result.label_type).toBe(LabelType.SECTION);
    });

    it('extracts Section with sub-paragraph', () => {
      const result = extractListLabel('Section 3.1(a) Some text');
      expect(result.label).toBe('Section 3.1(a)');
      expect(result.label_type).toBe(LabelType.SECTION);
    });

    it('is case insensitive for Section', () => {
      const result = extractListLabel('SECTION 5 Content');
      expect(result.label_type).toBe(LabelType.SECTION);
    });
  });

  // ── Article labels ───────────────────────────────────────────────────
  describe('article labels', () => {
    it('extracts Article 1', () => {
      const result = extractListLabel('Article 1 Content here');
      expect(result.label).toBe('Article 1');
      expect(result.label_type).toBe(LabelType.ARTICLE);
    });

    it('extracts Article IV', () => {
      const result = extractListLabel('Article IV Content here');
      expect(result.label).toBe('Article IV');
      expect(result.label_type).toBe(LabelType.ARTICLE);
    });

    it('is case insensitive for Article', () => {
      const result = extractListLabel('ARTICLE 3 Content');
      expect(result.label_type).toBe(LabelType.ARTICLE);
    });
  });

  // ── Numbered heading labels ──────────────────────────────────────────
  describe('numbered heading labels', () => {
    it('extracts 1. heading', () => {
      const result = extractListLabel('1. Introduction');
      expect(result.label_type).toBe(LabelType.NUMBERED_HEADING);
      expect(result.label).toBe('1.');
    });

    it('extracts 1.1 sub-heading', () => {
      const result = extractListLabel('1.1 Background');
      expect(result.label_type).toBe(LabelType.NUMBERED_HEADING);
    });

    it('extracts 2.3.1 nested heading', () => {
      const result = extractListLabel('2.3.1 Detailed section');
      expect(result.label_type).toBe(LabelType.NUMBERED_HEADING);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('returns null label for empty string', () => {
      const result = extractListLabel('');
      expect(result.label).toBeNull();
      expect(result.label_type).toBeNull();
      expect(result.match_end).toBe(0);
    });

    it('returns null label for plain text', () => {
      const result = extractListLabel('Just some regular text');
      expect(result.label).toBeNull();
      expect(result.label_type).toBeNull();
    });
  });
});

describe('stripListLabel', () => {
  it('strips letter label and leading whitespace', () => {
    const { stripped_text, result } = stripListLabel('(a) First item');
    expect(stripped_text).toBe('First item');
    expect(result.label).toBe('(a)');
    expect(result.label_type).toBe(LabelType.LETTER);
  });

  it('strips section label', () => {
    const { stripped_text } = stripListLabel('Section 1 Content here');
    expect(stripped_text).toBe('Content here');
  });

  it('strips numbered heading label', () => {
    const { stripped_text } = stripListLabel('1. Background info');
    expect(stripped_text).toBe('Background info');
  });

  it('returns original text when no label', () => {
    const { stripped_text, result } = stripListLabel('No label here');
    expect(stripped_text).toBe('No label here');
    expect(result.label).toBeNull();
  });

  it('handles empty string', () => {
    const { stripped_text, result } = stripListLabel('');
    expect(stripped_text).toBe('');
    expect(result.label).toBeNull();
  });

  it('strips roman label', () => {
    const { stripped_text } = stripListLabel('(ii) Second sub-item');
    expect(stripped_text).toBe('Second sub-item');
  });
});
