import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import {
  stripHighlightTags,
  hasHighlightTags,
  HIGHLIGHT_TAG,
} from '../src/primitives/semantic_tags.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Semantic Tags' });

describe('stripHighlightTags', () => {
  test('removes highlight tags leaving content intact', async ({ given, when, then }: AllureBddContext) => {
    let input: string;
    let result: string;
    await given('text with highlight tags around "highlighted"', async () => {
      input = `some <${HIGHLIGHT_TAG}>highlighted</${HIGHLIGHT_TAG}> text`;
    });
    await when('stripHighlightTags is applied', async () => {
      result = stripHighlightTags(input);
    });
    await then('the tags are removed but content is preserved', () => {
      expect(result).toBe('some highlighted text');
    });
  });

  test('removes legacy highlighting tags', async ({ given, when, then }: AllureBddContext) => {
    let input: string;
    let result: string;
    await given('text with legacy <highlighting> tags', async () => {
      input = 'some <highlighting>highlighted</highlighting> text';
    });
    await when('stripHighlightTags is applied', async () => {
      result = stripHighlightTags(input);
    });
    await then('the legacy tags are removed but content is preserved', () => {
      expect(result).toBe('some highlighted text');
    });
  });

  test('handles multiple highlight regions mixed', async ({ given, when, then }: AllureBddContext) => {
    let input: string;
    let result: string;
    await given('text with mixed highlight tag variants', async () => {
      input = `<${HIGHLIGHT_TAG}>first</${HIGHLIGHT_TAG}> and <highlight>second</highlight>`;
    });
    await when('stripHighlightTags is applied', async () => {
      result = stripHighlightTags(input);
    });
    await then('all tag variants are stripped leaving only content', () => {
      expect(result).toBe('first and second');
    });
  });

  test('returns unchanged string when no highlight tags', async ({ given, when, then }: AllureBddContext) => {
    let input: string;
    let result: string;
    await given('plain text with no highlight tags', async () => {
      input = 'no highlights';
    });
    await when('stripHighlightTags is applied', async () => {
      result = stripHighlightTags(input);
    });
    await then('the string is returned unchanged', () => {
      expect(result).toBe(input);
    });
  });
});

describe('hasHighlightTags', () => {
  test('returns true when new highlight tags are present', async ({ given, when, then }: AllureBddContext) => {
    let input: string;
    let result: boolean;
    await given('text containing the current highlight tag', async () => {
      input = `<${HIGHLIGHT_TAG}>text</${HIGHLIGHT_TAG}>`;
    });
    await when('hasHighlightTags is called', async () => {
      result = hasHighlightTags(input);
    });
    await then('it returns true', () => {
      expect(result).toBe(true);
    });
  });

  test('returns true when legacy highlight tags are present', async ({ given, when, then }: AllureBddContext) => {
    let input: string;
    let result: boolean;
    await given('text containing legacy <highlight> tags', async () => {
      input = '<highlight>text</highlight>';
    });
    await when('hasHighlightTags is called', async () => {
      result = hasHighlightTags(input);
    });
    await then('it returns true', () => {
      expect(result).toBe(true);
    });
  });

  test('returns false when no highlight tags present', async ({ given, when, then }: AllureBddContext) => {
    let input: string;
    let result: boolean;
    await given('plain text with no highlight tags', async () => {
      input = 'plain text';
    });
    await when('hasHighlightTags is called', async () => {
      result = hasHighlightTags(input);
    });
    await then('it returns false', () => {
      expect(result).toBe(false);
    });
  });

  test('returns false for empty string', async ({ given, when, then }: AllureBddContext) => {
    let input: string;
    let result: boolean;
    await given('an empty string', async () => {
      input = '';
    });
    await when('hasHighlightTags is called', async () => {
      result = hasHighlightTags(input);
    });
    await then('it returns false', () => {
      expect(result).toBe(false);
    });
  });
});
