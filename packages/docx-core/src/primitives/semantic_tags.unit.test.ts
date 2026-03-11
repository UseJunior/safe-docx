import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  hasFormattingTags,
  stripFormattingTags,
  hasHyperlinkTags,
  stripHyperlinkTags,
  hasHighlightTags,
  stripHighlightTags,
  hasFontTags,
  stripFontTags,
  stripAllInlineTags,
} from './semantic_tags.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Semantic Tags' });

// ── Formatting tags ─────────────────────────────────────────────────

describe('hasFormattingTags / stripFormattingTags', () => {
  test('detects <b>, <i>, <u> tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string containing bold, italic, and underline tags', () => {});
    await when('hasFormattingTags is called', () => {});
    await then('true is returned', () => {
      // Test all three in one call to avoid global regex lastIndex interference.
      // hasFormattingTags uses a global regex without resetting lastIndex,
      // so consecutive calls from separate tests can produce misleading results.
      expect(hasFormattingTags('<b>bold</b> <i>italic</i> <u>underline</u>')).toBe(true);
    });
  });

  test('returns false when no formatting tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a plain text string', () => {});
    await when('hasFormattingTags is called', () => {});
    await then('false is returned', () => {
      expect(hasFormattingTags('plain text')).toBe(false);
    });
  });

  test('strips <b> tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with bold tags', () => {});
    await when('stripFormattingTags is called', () => {});
    await then('the tags are removed', () => {
      expect(stripFormattingTags('<b>bold</b>')).toBe('bold');
    });
  });

  test('strips <i> tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with italic tags', () => {});
    await when('stripFormattingTags is called', () => {});
    await then('the tags are removed', () => {
      expect(stripFormattingTags('<i>italic</i>')).toBe('italic');
    });
  });

  test('strips <u> tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with underline tags', () => {});
    await when('stripFormattingTags is called', () => {});
    await then('the tags are removed', () => {
      expect(stripFormattingTags('<u>underline</u>')).toBe('underline');
    });
  });

  test('strips nested formatting tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with nested bold-italic tags', () => {});
    await when('stripFormattingTags is called', () => {});
    await then('all tags are removed', () => {
      expect(stripFormattingTags('<b><i>bold italic</i></b>')).toBe('bold italic');
    });
  });

  test('strips multiple formatting tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with multiple formatting tags', () => {});
    await when('stripFormattingTags is called', () => {});
    await then('all tags are removed', () => {
      expect(stripFormattingTags('<b>A</b> and <i>B</i> and <u>C</u>')).toBe('A and B and C');
    });
  });

  test('preserves non-formatting content', async ({ given, when, then }: AllureBddContext) => {
    await given('a string without formatting tags', () => {});
    await when('stripFormattingTags is called', () => {});
    await then('the string is unchanged', () => {
      expect(stripFormattingTags('no tags here')).toBe('no tags here');
    });
  });

  test('handles consecutive strip calls (global regex lastIndex reset)', async ({ given, when, then }: AllureBddContext) => {
    await given('two separate strings with bold tags', () => {});
    await when('stripFormattingTags is called consecutively', () => {});
    await then('both calls return correct results', () => {
      // stripFormattingTags resets lastIndex before each call
      expect(stripFormattingTags('<b>first</b>')).toBe('first');
      expect(stripFormattingTags('<b>second</b>')).toBe('second');
    });
  });
});

// ── Hyperlink tags ──────────────────────────────────────────────────

describe('hasHyperlinkTags / stripHyperlinkTags', () => {
  test('detects <a href> tag', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with an anchor tag', () => {});
    await when('hasHyperlinkTags is called', () => {});
    await then('true is returned', () => {
      expect(hasHyperlinkTags('<a href="https://example.com">link</a>')).toBe(true);
    });
  });

  test('detects closing </a> tag alone', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with only a closing anchor tag', () => {});
    await when('hasHyperlinkTags is called', () => {});
    await then('true is returned', () => {
      expect(hasHyperlinkTags('text</a>')).toBe(true);
    });
  });

  test('returns false when no hyperlink tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a plain text string', () => {});
    await when('hasHyperlinkTags is called', () => {});
    await then('false is returned', () => {
      expect(hasHyperlinkTags('plain text')).toBe(false);
    });
  });

  test('strips hyperlink tags preserving text', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with a hyperlink tag', () => {});
    await when('stripHyperlinkTags is called', () => {});
    await then('the tags are removed but text is preserved', () => {
      expect(stripHyperlinkTags('<a href="https://example.com">click here</a>')).toBe('click here');
    });
  });

  test('strips multiple hyperlink tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with multiple hyperlink tags', () => {});
    await when('stripHyperlinkTags is called', () => {});
    await then('all tags are removed', () => {
      expect(
        stripHyperlinkTags('<a href="https://a.com">A</a> and <a href="https://b.com">B</a>')
      ).toBe('A and B');
    });
  });
});

// ── Highlight tags ──────────────────────────────────────────────────

describe('hasHighlightTags / stripHighlightTags', () => {
  test('detects <highlight> tag', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with a highlight tag', () => {});
    await when('hasHighlightTags is called', () => {});
    await then('true is returned', () => {
      expect(hasHighlightTags('<highlight>marked</highlight>')).toBe(true);
    });
  });

  test('detects <highlighting> variant', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with a highlighting tag', () => {});
    await when('hasHighlightTags is called', () => {});
    await then('true is returned', () => {
      expect(hasHighlightTags('<highlighting>marked</highlighting>')).toBe(true);
    });
  });

  test('returns false when no highlight tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a plain text string', () => {});
    await when('hasHighlightTags is called', () => {});
    await then('false is returned', () => {
      expect(hasHighlightTags('plain text')).toBe(false);
    });
  });

  test('strips <highlight> tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with a highlight tag', () => {});
    await when('stripHighlightTags is called', () => {});
    await then('the tags are removed', () => {
      expect(stripHighlightTags('<highlight>marked</highlight>')).toBe('marked');
    });
  });

  test('strips <highlighting> tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with a highlighting tag', () => {});
    await when('stripHighlightTags is called', () => {});
    await then('the tags are removed', () => {
      expect(stripHighlightTags('<highlighting>marked</highlighting>')).toBe('marked');
    });
  });

  test('strips both variants together', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with both highlight variants', () => {});
    await when('stripHighlightTags is called', () => {});
    await then('all tags are removed', () => {
      expect(
        stripHighlightTags('<highlight>A</highlight> and <highlighting>B</highlighting>')
      ).toBe('A and B');
    });
  });
});

// ── Font tags ───────────────────────────────────────────────────────

describe('hasFontTags / stripFontTags', () => {
  test('detects <font> tag with attributes', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with a font tag', () => {});
    await when('hasFontTags is called', () => {});
    await then('true is returned', () => {
      expect(hasFontTags('<font name="Arial" size="12">text</font>')).toBe(true);
    });
  });

  test('detects closing </font> tag', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with only a closing font tag', () => {});
    await when('hasFontTags is called', () => {});
    await then('true is returned', () => {
      expect(hasFontTags('text</font>')).toBe(true);
    });
  });

  test('returns false when no font tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a plain text string', () => {});
    await when('hasFontTags is called', () => {});
    await then('false is returned', () => {
      expect(hasFontTags('plain text')).toBe(false);
    });
  });

  test('strips <font> tags preserving text', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with a font tag', () => {});
    await when('stripFontTags is called', () => {});
    await then('the tags are removed but text is preserved', () => {
      expect(stripFontTags('<font name="Arial" size="12">styled text</font>')).toBe('styled text');
    });
  });

  test('strips multiple font tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with multiple font tags', () => {});
    await when('stripFontTags is called', () => {});
    await then('all tags are removed', () => {
      expect(
        stripFontTags('<font name="Arial">A</font> and <font name="Times">B</font>')
      ).toBe('A and B');
    });
  });

  test('handles consecutive calls (global regex lastIndex reset)', async ({ given, when, then }: AllureBddContext) => {
    await given('two separate strings with font tags', () => {});
    await when('stripFontTags is called consecutively', () => {});
    await then('both calls return correct results', () => {
      stripFontTags('<font name="Arial">first</font>');
      expect(stripFontTags('<font name="Arial">second</font>')).toBe('second');
    });
  });
});

// ── stripAllInlineTags ──────────────────────────────────────────────

describe('stripAllInlineTags', () => {
  test('strips formatting tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with formatting tags', () => {});
    await when('stripAllInlineTags is called', () => {});
    await then('all formatting tags are removed', () => {
      expect(stripAllInlineTags('<b>bold</b> <i>italic</i> <u>underline</u>')).toBe(
        'bold italic underline'
      );
    });
  });

  test('strips hyperlink tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with a hyperlink tag', () => {});
    await when('stripAllInlineTags is called', () => {});
    await then('the hyperlink tags are removed', () => {
      expect(stripAllInlineTags('<a href="https://example.com">link</a>')).toBe('link');
    });
  });

  test('strips highlight tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with highlight tags', () => {});
    await when('stripAllInlineTags is called', () => {});
    await then('the highlight tags are removed', () => {
      expect(stripAllInlineTags('<highlight>A</highlight> <highlighting>B</highlighting>')).toBe(
        'A B'
      );
    });
  });

  test('strips font tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with a font tag', () => {});
    await when('stripAllInlineTags is called', () => {});
    await then('the font tags are removed', () => {
      expect(stripAllInlineTags('<font name="Arial">styled</font>')).toBe('styled');
    });
  });

  test('strips header tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with a header tag', () => {});
    await when('stripAllInlineTags is called', () => {});
    await then('the header tags are removed', () => {
      expect(stripAllInlineTags('<header>heading</header>')).toBe('heading');
    });
  });

  test('strips RunInHeader tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with a RunInHeader tag', () => {});
    await when('stripAllInlineTags is called', () => {});
    await then('the RunInHeader tags are removed', () => {
      expect(stripAllInlineTags('<RunInHeader>content</RunInHeader>')).toBe('content');
    });
  });

  test('strips definition tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with a definition tag', () => {});
    await when('stripAllInlineTags is called', () => {});
    await then('the definition tags are removed', () => {
      expect(stripAllInlineTags('<definition>term</definition>')).toBe('term');
    });
  });

  test('strips all tag types combined', async ({ given, when, then }: AllureBddContext) => {
    let input: string;

    await given('a string with all types of inline tags', () => {
      input =
        '<b>bold</b> <i>italic</i> <a href="https://x.com">link</a> ' +
        '<highlight>hl</highlight> <font name="Arial">font</font> ' +
        '<header>hdr</header> <RunInHeader>rih</RunInHeader> <definition>def</definition>';
    });

    await when('stripAllInlineTags is called', () => {});

    await then('all tags are removed leaving only text', () => {
      expect(stripAllInlineTags(input)).toBe('bold italic link hl font hdr rih def');
    });
  });

  test('handles empty tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a string with empty bold tags', () => {});
    await when('stripAllInlineTags is called', () => {});
    await then('an empty string is returned', () => {
      expect(stripAllInlineTags('<b></b>')).toBe('');
    });
  });

  test('handles text with special chars in attributes', async ({ given, when, then }: AllureBddContext) => {
    await given('a hyperlink with query string attributes', () => {});
    await when('stripAllInlineTags is called', () => {});
    await then('the tag is removed and link text preserved', () => {
      expect(stripAllInlineTags('<a href="https://x.com/a?b=1&c=2">link</a>')).toBe('link');
    });
  });

  test('preserves text without any tags', async ({ given, when, then }: AllureBddContext) => {
    await given('a plain text string without any tags', () => {});
    await when('stripAllInlineTags is called', () => {});
    await then('the string is unchanged', () => {
      expect(stripAllInlineTags('no tags at all')).toBe('no tags at all');
    });
  });

  test('handles consecutive calls (global regex lastIndex reset)', async ({ given, when, then }: AllureBddContext) => {
    await given('two separate strings with bold tags', () => {});
    await when('stripAllInlineTags is called consecutively', () => {});
    await then('both calls return correct results', () => {
      stripAllInlineTags('<b>first</b>');
      expect(stripAllInlineTags('<b>second</b>')).toBe('second');
    });
  });
});
