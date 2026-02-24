import { describe, expect } from 'vitest';
import { extractListLabel, stripListLabel, LabelType } from '../src/primitives/list_labels.js';
import { itAllure, allureStep, allureJsonAttachment } from './helpers/allure-test.js';

const TEST_FEATURE = 'docx-primitives';

const it = itAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });

const humanReadableIt = it.allure({
  
  tags: ['human-readable'],
  
  parameters: { audience: 'non-technical' },
  
});

describe('Traceability: docx-primitives — List Label Extraction', () => {
  humanReadableIt.openspec('extract parenthesized letter labels')('Scenario: extract parenthesized letter labels', async () => {
    const text = '(a) First item of the agreement';

    const result = await allureStep('When extractListLabel is called', async () => {
      const r = extractListLabel(text);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL have label_type LETTER', () => {
      expect(result.label_type).toBe(LabelType.LETTER);
      expect(result.label).toBe('(a)');
    });
  });

  humanReadableIt.openspec('single-char roman-like letters classified as LETTER not ROMAN')('Scenario: single-char roman-like letters classified as LETTER not ROMAN', async () => {
    const text = '(i) First roman-like item';

    const result = await allureStep('When extractListLabel is called', async () => {
      const r = extractListLabel(text);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL have label_type LETTER', () => {
      expect(result.label_type).toBe(LabelType.LETTER);
    });
  });

  humanReadableIt.openspec('extract multi-char roman numeral labels')('Scenario: extract multi-char roman numeral labels', async () => {
    const text = '(ii) Second item';

    const result = await allureStep('When extractListLabel is called', async () => {
      const r = extractListLabel(text);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL have label_type ROMAN', () => {
      expect(result.label_type).toBe(LabelType.ROMAN);
    });
  });

  humanReadableIt.openspec('extract section labels with sub-paragraph support')('Scenario: extract section labels with sub-paragraph support', async () => {
    const text = 'Section 3.1(a) of the agreement';

    const result = await allureStep('When extractListLabel is called', async () => {
      const r = extractListLabel(text);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL have label_type SECTION', () => {
      expect(result.label_type).toBe(LabelType.SECTION);
    });
  });

  humanReadableIt.openspec('extract article labels with roman numeral support')('Scenario: extract article labels with roman numeral support', async () => {
    const text = 'Article IV';

    const result = await allureStep('When extractListLabel is called', async () => {
      const r = extractListLabel(text);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL have label_type ARTICLE', () => {
      expect(result.label_type).toBe(LabelType.ARTICLE);
    });
  });

  humanReadableIt.openspec('extract numbered heading labels')('Scenario: extract numbered heading labels', async () => {
    const text = '2.3.1 Subsection heading';

    const result = await allureStep('When extractListLabel is called', async () => {
      const r = extractListLabel(text);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL have label_type NUMBERED_HEADING', () => {
      expect(result.label_type).toBe(LabelType.NUMBERED_HEADING);
    });
  });

  humanReadableIt.openspec('null label for plain text without list patterns')('Scenario: null label for plain text without list patterns', async () => {
    const text = 'This is just a normal paragraph with no list label.';

    const result = await allureStep('When extractListLabel is called', async () => {
      const r = extractListLabel(text);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then label and label_type SHALL be null', () => {
      expect(result.label).toBeNull();
      expect(result.label_type).toBeNull();
    });
  });

  humanReadableIt.openspec('stripListLabel removes label and leading whitespace')('Scenario: stripListLabel removes label and leading whitespace', async () => {
    const text = '(a) First item of the agreement';

    const result = await allureStep('When stripListLabel is called', async () => {
      const r = stripListLabel(text);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then stripped_text SHALL have label and leading whitespace removed', () => {
      expect(result.stripped_text).toBe('First item of the agreement');
      expect(result.result.label).toBe('(a)');
    });
  });
});
