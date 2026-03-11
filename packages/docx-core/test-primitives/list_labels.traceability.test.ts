import { describe, expect } from 'vitest';
import { extractListLabel, stripListLabel, LabelType } from '../src/primitives/list_labels.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'List Labels' });

describe('Traceability: docx-primitives — List Label Extraction', () => {
  test.openspec('extract parenthesized letter labels')('Scenario: extract parenthesized letter labels', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const text = '(a) First item of the agreement';

    let result!: ReturnType<typeof extractListLabel>;
    await when('extractListLabel is called', async () => {
      result = extractListLabel(text);
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL have label_type LETTER', () => {
      expect(result.label_type).toBe(LabelType.LETTER);
      expect(result.label).toBe('(a)');
    });
  });

  test.openspec('single-char roman-like letters classified as LETTER not ROMAN')('Scenario: single-char roman-like letters classified as LETTER not ROMAN', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const text = '(i) First roman-like item';

    let result!: ReturnType<typeof extractListLabel>;
    await when('extractListLabel is called', async () => {
      result = extractListLabel(text);
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL have label_type LETTER', () => {
      expect(result.label_type).toBe(LabelType.LETTER);
    });
  });

  test.openspec('extract multi-char roman numeral labels')('Scenario: extract multi-char roman numeral labels', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const text = '(ii) Second item';

    let result!: ReturnType<typeof extractListLabel>;
    await when('extractListLabel is called', async () => {
      result = extractListLabel(text);
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL have label_type ROMAN', () => {
      expect(result.label_type).toBe(LabelType.ROMAN);
    });
  });

  test.openspec('extract section labels with sub-paragraph support')('Scenario: extract section labels with sub-paragraph support', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const text = 'Section 3.1(a) of the agreement';

    let result!: ReturnType<typeof extractListLabel>;
    await when('extractListLabel is called', async () => {
      result = extractListLabel(text);
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL have label_type SECTION', () => {
      expect(result.label_type).toBe(LabelType.SECTION);
    });
  });

  test.openspec('extract article labels with roman numeral support')('Scenario: extract article labels with roman numeral support', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const text = 'Article IV';

    let result!: ReturnType<typeof extractListLabel>;
    await when('extractListLabel is called', async () => {
      result = extractListLabel(text);
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL have label_type ARTICLE', () => {
      expect(result.label_type).toBe(LabelType.ARTICLE);
    });
  });

  test.openspec('extract numbered heading labels')('Scenario: extract numbered heading labels', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const text = '2.3.1 Subsection heading';

    let result!: ReturnType<typeof extractListLabel>;
    await when('extractListLabel is called', async () => {
      result = extractListLabel(text);
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL have label_type NUMBERED_HEADING', () => {
      expect(result.label_type).toBe(LabelType.NUMBERED_HEADING);
    });
  });

  test.openspec('null label for plain text without list patterns')('Scenario: null label for plain text without list patterns', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const text = 'This is just a normal paragraph with no list label.';

    let result!: ReturnType<typeof extractListLabel>;
    await when('extractListLabel is called', async () => {
      result = extractListLabel(text);
      await attachPrettyJson('Result', result);
    });

    await then('label and label_type SHALL be null', () => {
      expect(result.label).toBeNull();
      expect(result.label_type).toBeNull();
    });
  });

  test.openspec('stripListLabel removes label and leading whitespace')('Scenario: stripListLabel removes label and leading whitespace', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const text = '(a) First item of the agreement';

    let result!: ReturnType<typeof stripListLabel>;
    await when('stripListLabel is called', async () => {
      result = stripListLabel(text);
      await attachPrettyJson('Result', result);
    });

    await then('stripped_text SHALL have label and leading whitespace removed', () => {
      expect(result.stripped_text).toBe('First item of the agreement');
      expect(result.result.label).toBe('(a)');
    });
  });
});
