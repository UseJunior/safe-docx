import { describe, expect } from 'vitest';
import { itAllure as it } from './helpers/allure-test.js';
import {
  emitDefinitionTagsFromString,
  stripDefinitionTags,
  hasDefinitionTags,
  stripHighlightTags,
  hasHighlightTags,
  DEFINITION_TAG,
  HIGHLIGHT_TAG,
} from '../src/primitives/semantic_tags.js';

describe('emitDefinitionTagsFromString', () => {
  it('wraps a quoted term before "means"', () => {
    const input = '"Company" means the entity described herein';
    const result = emitDefinitionTagsFromString(input);
    expect(result).toBe('<definition>Company</definition> means the entity described herein');
  });

  it('wraps a quoted term before "shall mean"', () => {
    const input = '"Term" shall mean the following';
    const result = emitDefinitionTagsFromString(input);
    expect(result).toBe('<definition>Term</definition> shall mean the following');
  });

  it('wraps a quoted term before "is defined as"', () => {
    const input = '"Effective Date" is defined as the date of signing';
    const result = emitDefinitionTagsFromString(input);
    expect(result).toBe('<definition>Effective Date</definition> is defined as the date of signing');
  });

  it('wraps a quoted term before "refers to"', () => {
    const input = '"Agreement" refers to this contract';
    const result = emitDefinitionTagsFromString(input);
    expect(result).toBe('<definition>Agreement</definition> refers to this contract');
  });

  it('handles smart/curly double quotes', () => {
    const input = '\u201CCompany\u201D means the entity';
    const result = emitDefinitionTagsFromString(input);
    expect(result).toBe('<definition>Company</definition> means the entity');
  });

  it('handles smart/curly single quotes', () => {
    const input = '\u2018Company\u2019 means the entity';
    const result = emitDefinitionTagsFromString(input);
    expect(result).toBe('<definition>Company</definition> means the entity');
  });

  it('returns unchanged text when no definitions are present', () => {
    const input = 'This is a regular sentence with no definitions.';
    const result = emitDefinitionTagsFromString(input);
    expect(result).toBe(input);
  });

  it('returns empty string for empty input', () => {
    expect(emitDefinitionTagsFromString('')).toBe('');
  });

  it('handles "has the meaning" verb pattern', () => {
    const input = '"Affiliate" has the meaning given in Section 1';
    const result = emitDefinitionTagsFromString(input);
    expect(result).toContain('<definition>Affiliate</definition>');
  });

  it('handles "shall have the meaning" verb pattern', () => {
    const input = '"Party" shall have the meaning set forth in the preamble';
    const result = emitDefinitionTagsFromString(input);
    expect(result).toContain('<definition>Party</definition>');
  });
});

describe('stripDefinitionTags', () => {
  it('removes definition tags and replaces with quotes', () => {
    const input = '<definition>Company</definition> means the entity';
    const result = stripDefinitionTags(input);
    expect(result).toBe('"Company" means the entity');
  });

  it('handles multiple definition tags', () => {
    const input = '<definition>Company</definition> and <definition>Employee</definition>';
    const result = stripDefinitionTags(input);
    expect(result).toBe('"Company" and "Employee"');
  });

  it('returns unchanged string when no tags present', () => {
    const input = 'No tags here';
    expect(stripDefinitionTags(input)).toBe(input);
  });
});

describe('hasDefinitionTags', () => {
  it('returns true when definition tags are present', () => {
    expect(hasDefinitionTags('<definition>Term</definition> means something')).toBe(true);
  });

  it('returns false when no definition tags present', () => {
    expect(hasDefinitionTags('plain text without any tags')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasDefinitionTags('')).toBe(false);
  });
});

describe('stripHighlightTags', () => {
  it('removes highlight tags leaving content intact', () => {
    const input = `some <${HIGHLIGHT_TAG}>highlighted</${HIGHLIGHT_TAG}> text`;
    const result = stripHighlightTags(input);
    expect(result).toBe('some highlighted text');
  });

  it('handles multiple highlight regions', () => {
    const input = `<${HIGHLIGHT_TAG}>first</${HIGHLIGHT_TAG}> and <${HIGHLIGHT_TAG}>second</${HIGHLIGHT_TAG}>`;
    const result = stripHighlightTags(input);
    expect(result).toBe('first and second');
  });

  it('returns unchanged string when no highlight tags', () => {
    const input = 'no highlights';
    expect(stripHighlightTags(input)).toBe(input);
  });
});

describe('hasHighlightTags', () => {
  it('returns true when highlight tags are present', () => {
    expect(hasHighlightTags(`<${HIGHLIGHT_TAG}>text</${HIGHLIGHT_TAG}>`)).toBe(true);
  });

  it('returns false when no highlight tags present', () => {
    expect(hasHighlightTags('plain text')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasHighlightTags('')).toBe(false);
  });
});
