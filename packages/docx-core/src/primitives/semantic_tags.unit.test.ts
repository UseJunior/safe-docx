import { describe, expect } from 'vitest';
import { itAllure as it } from './testing/allure-test.js';
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

// ── Formatting tags ─────────────────────────────────────────────────

describe('hasFormattingTags / stripFormattingTags', () => {
  it('detects <b>, <i>, <u> tags', () => {
    // Test all three in one call to avoid global regex lastIndex interference.
    // hasFormattingTags uses a global regex without resetting lastIndex,
    // so consecutive calls from separate tests can produce misleading results.
    expect(hasFormattingTags('<b>bold</b> <i>italic</i> <u>underline</u>')).toBe(true);
  });

  it('returns false when no formatting tags', () => {
    expect(hasFormattingTags('plain text')).toBe(false);
  });

  it('strips <b> tags', () => {
    expect(stripFormattingTags('<b>bold</b>')).toBe('bold');
  });

  it('strips <i> tags', () => {
    expect(stripFormattingTags('<i>italic</i>')).toBe('italic');
  });

  it('strips <u> tags', () => {
    expect(stripFormattingTags('<u>underline</u>')).toBe('underline');
  });

  it('strips nested formatting tags', () => {
    expect(stripFormattingTags('<b><i>bold italic</i></b>')).toBe('bold italic');
  });

  it('strips multiple formatting tags', () => {
    expect(stripFormattingTags('<b>A</b> and <i>B</i> and <u>C</u>')).toBe('A and B and C');
  });

  it('preserves non-formatting content', () => {
    expect(stripFormattingTags('no tags here')).toBe('no tags here');
  });

  it('handles consecutive strip calls (global regex lastIndex reset)', () => {
    // stripFormattingTags resets lastIndex before each call
    expect(stripFormattingTags('<b>first</b>')).toBe('first');
    expect(stripFormattingTags('<b>second</b>')).toBe('second');
  });
});

// ── Hyperlink tags ──────────────────────────────────────────────────

describe('hasHyperlinkTags / stripHyperlinkTags', () => {
  it('detects <a href> tag', () => {
    expect(hasHyperlinkTags('<a href="https://example.com">link</a>')).toBe(true);
  });

  it('detects closing </a> tag alone', () => {
    expect(hasHyperlinkTags('text</a>')).toBe(true);
  });

  it('returns false when no hyperlink tags', () => {
    expect(hasHyperlinkTags('plain text')).toBe(false);
  });

  it('strips hyperlink tags preserving text', () => {
    expect(stripHyperlinkTags('<a href="https://example.com">click here</a>')).toBe('click here');
  });

  it('strips multiple hyperlink tags', () => {
    expect(
      stripHyperlinkTags('<a href="https://a.com">A</a> and <a href="https://b.com">B</a>')
    ).toBe('A and B');
  });
});

// ── Highlight tags ──────────────────────────────────────────────────

describe('hasHighlightTags / stripHighlightTags', () => {
  it('detects <highlight> tag', () => {
    expect(hasHighlightTags('<highlight>marked</highlight>')).toBe(true);
  });

  it('detects <highlighting> variant', () => {
    expect(hasHighlightTags('<highlighting>marked</highlighting>')).toBe(true);
  });

  it('returns false when no highlight tags', () => {
    expect(hasHighlightTags('plain text')).toBe(false);
  });

  it('strips <highlight> tags', () => {
    expect(stripHighlightTags('<highlight>marked</highlight>')).toBe('marked');
  });

  it('strips <highlighting> tags', () => {
    expect(stripHighlightTags('<highlighting>marked</highlighting>')).toBe('marked');
  });

  it('strips both variants together', () => {
    expect(
      stripHighlightTags('<highlight>A</highlight> and <highlighting>B</highlighting>')
    ).toBe('A and B');
  });
});

// ── Font tags ───────────────────────────────────────────────────────

describe('hasFontTags / stripFontTags', () => {
  it('detects <font> tag with attributes', () => {
    expect(hasFontTags('<font name="Arial" size="12">text</font>')).toBe(true);
  });

  it('detects closing </font> tag', () => {
    expect(hasFontTags('text</font>')).toBe(true);
  });

  it('returns false when no font tags', () => {
    expect(hasFontTags('plain text')).toBe(false);
  });

  it('strips <font> tags preserving text', () => {
    expect(stripFontTags('<font name="Arial" size="12">styled text</font>')).toBe('styled text');
  });

  it('strips multiple font tags', () => {
    expect(
      stripFontTags('<font name="Arial">A</font> and <font name="Times">B</font>')
    ).toBe('A and B');
  });

  it('handles consecutive calls (global regex lastIndex reset)', () => {
    stripFontTags('<font name="Arial">first</font>');
    expect(stripFontTags('<font name="Arial">second</font>')).toBe('second');
  });
});

// ── stripAllInlineTags ──────────────────────────────────────────────

describe('stripAllInlineTags', () => {
  it('strips formatting tags', () => {
    expect(stripAllInlineTags('<b>bold</b> <i>italic</i> <u>underline</u>')).toBe(
      'bold italic underline'
    );
  });

  it('strips hyperlink tags', () => {
    expect(stripAllInlineTags('<a href="https://example.com">link</a>')).toBe('link');
  });

  it('strips highlight tags', () => {
    expect(stripAllInlineTags('<highlight>A</highlight> <highlighting>B</highlighting>')).toBe(
      'A B'
    );
  });

  it('strips font tags', () => {
    expect(stripAllInlineTags('<font name="Arial">styled</font>')).toBe('styled');
  });

  it('strips header tags', () => {
    expect(stripAllInlineTags('<header>heading</header>')).toBe('heading');
  });

  it('strips RunInHeader tags', () => {
    expect(stripAllInlineTags('<RunInHeader>content</RunInHeader>')).toBe('content');
  });

  it('strips definition tags', () => {
    expect(stripAllInlineTags('<definition>term</definition>')).toBe('term');
  });

  it('strips all tag types combined', () => {
    const input =
      '<b>bold</b> <i>italic</i> <a href="https://x.com">link</a> ' +
      '<highlight>hl</highlight> <font name="Arial">font</font> ' +
      '<header>hdr</header> <RunInHeader>rih</RunInHeader> <definition>def</definition>';
    expect(stripAllInlineTags(input)).toBe('bold italic link hl font hdr rih def');
  });

  it('handles empty tags', () => {
    expect(stripAllInlineTags('<b></b>')).toBe('');
  });

  it('handles text with special chars in attributes', () => {
    expect(stripAllInlineTags('<a href="https://x.com/a?b=1&c=2">link</a>')).toBe('link');
  });

  it('preserves text without any tags', () => {
    expect(stripAllInlineTags('no tags at all')).toBe('no tags at all');
  });

  it('handles consecutive calls (global regex lastIndex reset)', () => {
    stripAllInlineTags('<b>first</b>');
    expect(stripAllInlineTags('<b>second</b>')).toBe('second');
  });
});
