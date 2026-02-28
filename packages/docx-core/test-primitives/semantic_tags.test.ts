import { describe, expect, it } from 'vitest';
import {
  stripHighlightTags,
  hasHighlightTags,
  HIGHLIGHT_TAG,
} from '../src/primitives/semantic_tags.js';

describe('stripHighlightTags', () => {
  it('removes highlight tags leaving content intact', () => {
    const input = `some <${HIGHLIGHT_TAG}>highlighted</${HIGHLIGHT_TAG}> text`;
    const result = stripHighlightTags(input);
    expect(result).toBe('some highlighted text');
  });

  it('removes legacy highlighting tags', () => {
    const input = 'some <highlighting>highlighted</highlighting> text';
    const result = stripHighlightTags(input);
    expect(result).toBe('some highlighted text');
  });

  it('handles multiple highlight regions mixed', () => {
    const input = `<${HIGHLIGHT_TAG}>first</${HIGHLIGHT_TAG}> and <highlight>second</highlight>`;
    const result = stripHighlightTags(input);
    expect(result).toBe('first and second');
  });

  it('returns unchanged string when no highlight tags', () => {
    const input = 'no highlights';
    expect(stripHighlightTags(input)).toBe(input);
  });
});

describe('hasHighlightTags', () => {
  it('returns true when new highlight tags are present', () => {
    expect(hasHighlightTags(`<${HIGHLIGHT_TAG}>text</${HIGHLIGHT_TAG}>`)).toBe(true);
  });

  it('returns true when legacy highlight tags are present', () => {
    expect(hasHighlightTags('<highlight>text</highlight>')).toBe(true);
  });

  it('returns false when no highlight tags present', () => {
    expect(hasHighlightTags('plain text')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasHighlightTags('')).toBe(false);
  });
});
