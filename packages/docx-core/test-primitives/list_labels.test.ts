import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { extractListLabel, stripListLabel, LabelType } from '../src/primitives/list_labels.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'List Labels' });

describe('extractListLabel', () => {
  // ── Letter labels ────────────────────────────────────────────────────
  describe('letter labels', () => {
    test('extracts lowercase letter label (a)', async ({ given, when, then, and }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with (a)', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('(a) First item');
      });
      await then('the label is (a) with type LETTER', () => {
        expect(result.label).toBe('(a)');
        expect(result.label_type).toBe(LabelType.LETTER);
      });
      await and('match_end is greater than zero', () => {
        expect(result.match_end).toBeGreaterThan(0);
      });
    });

    test('extracts uppercase letter label (A)', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with (A)', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('(A) First item');
      });
      await then('the label is (A) with type LETTER', () => {
        expect(result.label).toBe('(A)');
        expect(result.label_type).toBe(LabelType.LETTER);
      });
    });

    test('treats single-char roman-like letters as letter labels', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with (i) which is a single character', async () => {});
      await when('extractListLabel is called', async () => {
        // Single-char "i" is treated as letter, not roman
        result = extractListLabel('(i) item text');
      });
      await then('the label is (i) with type LETTER', () => {
        expect(result.label).toBe('(i)');
        expect(result.label_type).toBe(LabelType.LETTER);
      });
    });

    test('treats single-char "v" as letter label', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with (v) which is a single character', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('(v) item text');
      });
      await then('the label is (v) with type LETTER', () => {
        expect(result.label).toBe('(v)');
        expect(result.label_type).toBe(LabelType.LETTER);
      });
    });
  });

  // ── Roman labels ─────────────────────────────────────────────────────
  describe('roman labels', () => {
    test('extracts lowercase roman label (ii)', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with (ii)', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('(ii) Second item');
      });
      await then('the label is (ii) with type ROMAN', () => {
        expect(result.label).toBe('(ii)');
        expect(result.label_type).toBe(LabelType.ROMAN);
      });
    });

    test('extracts lowercase roman label (iv)', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with (iv)', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('(iv) Fourth item');
      });
      await then('the label is (iv) with type ROMAN', () => {
        expect(result.label).toBe('(iv)');
        expect(result.label_type).toBe(LabelType.ROMAN);
      });
    });

    test('extracts longer roman numeral (xiii)', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with (xiii)', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('(xiii) Thirteenth item');
      });
      await then('the label is (xiii) with type ROMAN', () => {
        expect(result.label).toBe('(xiii)');
        expect(result.label_type).toBe(LabelType.ROMAN);
      });
    });
  });

  // ── Number labels ────────────────────────────────────────────────────
  describe('number labels', () => {
    test('extracts parenthesized number (1)', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with (1)', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('(1) First item');
      });
      await then('the label is (1) with type NUMBER', () => {
        expect(result.label).toBe('(1)');
        expect(result.label_type).toBe(LabelType.NUMBER);
      });
    });

    test('extracts multi-digit number (10)', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with (10)', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('(10) Tenth item');
      });
      await then('the label is (10) with type NUMBER', () => {
        expect(result.label).toBe('(10)');
        expect(result.label_type).toBe(LabelType.NUMBER);
      });
    });
  });

  // ── Section labels ───────────────────────────────────────────────────
  describe('section labels', () => {
    test('extracts Section 1', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with Section 1', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('Section 1 Content here');
      });
      await then('the label is Section 1 with type SECTION', () => {
        expect(result.label).toBe('Section 1');
        expect(result.label_type).toBe(LabelType.SECTION);
      });
    });

    test('extracts Section 1.2', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with Section 1.2', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('Section 1.2 Content here');
      });
      await then('the label is Section 1.2 with type SECTION', () => {
        expect(result.label).toBe('Section 1.2');
        expect(result.label_type).toBe(LabelType.SECTION);
      });
    });

    test('extracts Section with sub-paragraph', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with Section 3.1(a)', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('Section 3.1(a) Some text');
      });
      await then('the label is Section 3.1(a) with type SECTION', () => {
        expect(result.label).toBe('Section 3.1(a)');
        expect(result.label_type).toBe(LabelType.SECTION);
      });
    });

    test('is case insensitive for Section', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with SECTION 5 in uppercase', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('SECTION 5 Content');
      });
      await then('the label type is SECTION', () => {
        expect(result.label_type).toBe(LabelType.SECTION);
      });
    });
  });

  // ── Article labels ───────────────────────────────────────────────────
  describe('article labels', () => {
    test('extracts Article 1', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with Article 1', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('Article 1 Content here');
      });
      await then('the label is Article 1 with type ARTICLE', () => {
        expect(result.label).toBe('Article 1');
        expect(result.label_type).toBe(LabelType.ARTICLE);
      });
    });

    test('extracts Article IV', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with Article IV', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('Article IV Content here');
      });
      await then('the label is Article IV with type ARTICLE', () => {
        expect(result.label).toBe('Article IV');
        expect(result.label_type).toBe(LabelType.ARTICLE);
      });
    });

    test('is case insensitive for Article', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with ARTICLE 3 in uppercase', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('ARTICLE 3 Content');
      });
      await then('the label type is ARTICLE', () => {
        expect(result.label_type).toBe(LabelType.ARTICLE);
      });
    });
  });

  // ── Numbered heading labels ──────────────────────────────────────────
  describe('numbered heading labels', () => {
    test('extracts 1. heading', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with 1.', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('1. Introduction');
      });
      await then('the label is 1. with type NUMBERED_HEADING', () => {
        expect(result.label_type).toBe(LabelType.NUMBERED_HEADING);
        expect(result.label).toBe('1.');
      });
    });

    test('extracts 1.1 sub-heading', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with 1.1', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('1.1 Background');
      });
      await then('the label type is NUMBERED_HEADING', () => {
        expect(result.label_type).toBe(LabelType.NUMBERED_HEADING);
      });
    });

    test('extracts 2.3.1 nested heading', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a paragraph text starting with 2.3.1', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('2.3.1 Detailed section');
      });
      await then('the label type is NUMBERED_HEADING', () => {
        expect(result.label_type).toBe(LabelType.NUMBERED_HEADING);
      });
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────
  describe('edge cases', () => {
    test('returns null label for empty string', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('an empty string input', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('');
      });
      await then('label and label_type are null and match_end is zero', () => {
        expect(result.label).toBeNull();
        expect(result.label_type).toBeNull();
        expect(result.match_end).toBe(0);
      });
    });

    test('returns null label for plain text', async ({ given, when, then }: AllureBddContext) => {
      let result!: ReturnType<typeof extractListLabel>;
      await given('a plain text string with no list label pattern', async () => {});
      await when('extractListLabel is called', async () => {
        result = extractListLabel('Just some regular text');
      });
      await then('label and label_type are both null', () => {
        expect(result.label).toBeNull();
        expect(result.label_type).toBeNull();
      });
    });
  });
});

describe('stripListLabel', () => {
  test('strips letter label and leading whitespace', async ({ given, when, then }: AllureBddContext) => {
    let stripped_text!: string;
    let result!: ReturnType<typeof extractListLabel>;
    await given('a string starting with a letter label (a)', async () => {});
    await when('stripListLabel is called', async () => {
      ({ stripped_text, result } = stripListLabel('(a) First item'));
    });
    await then('the label is removed and the remaining text is returned with correct metadata', () => {
      expect(stripped_text).toBe('First item');
      expect(result.label).toBe('(a)');
      expect(result.label_type).toBe(LabelType.LETTER);
    });
  });

  test('strips section label', async ({ given, when, then }: AllureBddContext) => {
    let stripped_text!: string;
    await given('a string starting with a Section label', async () => {});
    await when('stripListLabel is called', async () => {
      ({ stripped_text } = stripListLabel('Section 1 Content here'));
    });
    await then('the section label and whitespace are removed', () => {
      expect(stripped_text).toBe('Content here');
    });
  });

  test('strips numbered heading label', async ({ given, when, then }: AllureBddContext) => {
    let stripped_text!: string;
    await given('a string starting with a numbered heading label 1.', async () => {});
    await when('stripListLabel is called', async () => {
      ({ stripped_text } = stripListLabel('1. Background info'));
    });
    await then('the numbered heading label and whitespace are removed', () => {
      expect(stripped_text).toBe('Background info');
    });
  });

  test('returns original text when no label', async ({ given, when, then }: AllureBddContext) => {
    let stripped_text!: string;
    let result!: ReturnType<typeof extractListLabel>;
    await given('a string with no recognizable list label', async () => {});
    await when('stripListLabel is called', async () => {
      ({ stripped_text, result } = stripListLabel('No label here'));
    });
    await then('the original text is returned and label is null', () => {
      expect(stripped_text).toBe('No label here');
      expect(result.label).toBeNull();
    });
  });

  test('handles empty string', async ({ given, when, then }: AllureBddContext) => {
    let stripped_text!: string;
    let result!: ReturnType<typeof extractListLabel>;
    await given('an empty string', async () => {});
    await when('stripListLabel is called', async () => {
      ({ stripped_text, result } = stripListLabel(''));
    });
    await then('an empty string is returned and label is null', () => {
      expect(stripped_text).toBe('');
      expect(result.label).toBeNull();
    });
  });

  test('strips roman label', async ({ given, when, then }: AllureBddContext) => {
    let stripped_text!: string;
    await given('a string starting with a roman numeral label (ii)', async () => {});
    await when('stripListLabel is called', async () => {
      ({ stripped_text } = stripListLabel('(ii) Second sub-item'));
    });
    await then('the roman label and whitespace are removed', () => {
      expect(stripped_text).toBe('Second sub-item');
    });
  });
});
