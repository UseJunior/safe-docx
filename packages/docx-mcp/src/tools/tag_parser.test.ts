import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import {
  splitTaggedText,
  segmentAddRunProps,
  hasAnyMarkupTags,
  hasHeaderTags,
  hasInlineStyleTags,
  stripAllInlineTags,
  type ParsedReplacementSegment,
} from './tag_parser.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a default-state segment with optional overrides. */
function seg(text: string, overrides: Partial<ParsedReplacementSegment> = {}): ParsedReplacementSegment {
  return {
    text,
    bold: false,
    italic: false,
    underline: false,
    highlighting: false,
    header: false,
    color: null,
    fontSize: null,
    fontName: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('tag_parser', () => {
  // ─── splitTaggedText: plain text passthrough ────────────────────

  describe('splitTaggedText — plain text passthrough', () => {
    it('returns a single segment with all-false state for plain text', () => {
      const result = splitTaggedText('hello world');
      expect(result).toEqual([seg('hello world')]);
    });

    it('returns a single empty-text segment for empty string', () => {
      const result = splitTaggedText('');
      expect(result).toEqual([seg('')]);
    });
  });

  // ─── splitTaggedText: boolean tags ─────────────────────────────

  describe('splitTaggedText — boolean tags', () => {
    it('<b> sets bold to true', () => {
      const result = splitTaggedText('<b>bold text</b>');
      expect(result).toEqual([seg('bold text', { bold: true })]);
    });

    it('<i> sets italic to true', () => {
      const result = splitTaggedText('<i>italic text</i>');
      expect(result).toEqual([seg('italic text', { italic: true })]);
    });

    it('<u> sets underline to true', () => {
      const result = splitTaggedText('<u>underlined</u>');
      expect(result).toEqual([seg('underlined', { underline: true })]);
    });

    it('<highlight> sets highlighting to true', () => {
      const result = splitTaggedText('<highlight>marked</highlight>');
      expect(result).toEqual([seg('marked', { highlighting: true })]);
    });

    it('<header> sets header to true', () => {
      const result = splitTaggedText('<header>heading</header>');
      expect(result).toEqual([seg('heading', { header: true })]);
    });
  });

  // ─── splitTaggedText: <font> tag ───────────────────────────────

  describe('splitTaggedText — <font> tag', () => {
    it('<font> with all attributes sets color, fontSize (half-points), and fontName', () => {
      const result = splitTaggedText('<font color="FF0000" size="14" face="Arial">text</font>');
      expect(result).toEqual([
        seg('text', { color: 'FF0000', fontSize: 28, fontName: 'Arial' }),
      ]);
    });

    it('<font> with partial attributes sets only provided properties', () => {
      const result = splitTaggedText('<font color="00FF00">green</font>');
      expect(result).toEqual([seg('green', { color: '00FF00' })]);
    });

    it('<font> with no attributes leaves font properties at null', () => {
      const result = splitTaggedText('<font>text</font>');
      expect(result).toEqual([seg('text')]);
    });

    it('<font> with only size converts pt to half-points', () => {
      const result = splitTaggedText('<font size="12">sized</font>');
      expect(result).toEqual([seg('sized', { fontSize: 24 })]);
    });

    it('<font> with only face sets fontName', () => {
      const result = splitTaggedText('<font face="Times New Roman">serif</font>');
      expect(result).toEqual([seg('serif', { fontName: 'Times New Roman' })]);
    });
  });

  // ─── splitTaggedText: mixed and nested tags ────────────────────

  describe('splitTaggedText — mixed and nested tags', () => {
    it('nested boolean + font produces combined state', () => {
      const result = splitTaggedText('<b><font color="0000FF">bold blue</font></b>');
      expect(result).toEqual([
        seg('bold blue', { bold: true, color: '0000FF' }),
      ]);
    });

    it('font wrapping boolean tag', () => {
      const result = splitTaggedText('<font color="FF0000"><i>red italic</i></font>');
      expect(result).toEqual([
        seg('red italic', { italic: true, color: 'FF0000' }),
      ]);
    });

    it('multiple boolean tags nested', () => {
      const result = splitTaggedText('<b><i><u>all three</u></i></b>');
      expect(result).toEqual([
        seg('all three', { bold: true, italic: true, underline: true }),
      ]);
    });
  });

  // ─── splitTaggedText: literal characters ───────────────────────

  describe('splitTaggedText — literal characters in text', () => {
    it('literal < in text is preserved', () => {
      const result = splitTaggedText('if x < 10');
      expect(result).toHaveLength(1);
      expect(result[0]!.text).toBe('if x < 10');
    });

    it('literal & in text is preserved', () => {
      const result = splitTaggedText('R&D Business');
      expect(result).toHaveLength(1);
      expect(result[0]!.text).toBe('R&D Business');
    });

    it('multiple literal < and & in one string', () => {
      const result = splitTaggedText('a < b & c < d');
      expect(result).toHaveLength(1);
      expect(result[0]!.text).toBe('a < b & c < d');
    });

    it('literal < immediately before known tag', () => {
      const result = splitTaggedText('x < <b>bold</b>');
      expect(result).toHaveLength(2);
      expect(result[0]!.text).toBe('x < ');
      expect(result[1]!.text).toBe('bold');
      expect(result[1]!.bold).toBe(true);
    });
  });

  // ─── splitTaggedText: attributes containing > ─────────────────

  describe('splitTaggedText — attributes containing >', () => {
    it('font face attribute with > inside quoted value', () => {
      const result = splitTaggedText('<font face="A>B">text</font>');
      expect(result).toHaveLength(1);
      expect(result[0]!.fontName).toBe('A>B');
      expect(result[0]!.text).toBe('text');
    });
  });

  // ─── splitTaggedText: cross-nesting ────────────────────────────

  describe('splitTaggedText — cross-nesting', () => {
    it('cross-nested tags do not throw', () => {
      // <b><i>text</b></i> — counters: b 0→1→0, i 0→1→0, all end at 0
      expect(() => splitTaggedText('<b><i>text</b></i>')).not.toThrow();
    });
  });

  // ─── splitTaggedText: unbalanced tags ──────────────────────────

  describe('splitTaggedText — unbalanced tags', () => {
    it('orphan close </b> throws UNBALANCED_BOLD_TAGS', () => {
      expect(() => splitTaggedText('</b>bad')).toThrow('UNBALANCED_BOLD_TAGS');
    });

    it('unclosed <b> throws UNBALANCED_BOLD_TAGS', () => {
      expect(() => splitTaggedText('<b>bad')).toThrow('UNBALANCED_BOLD_TAGS');
    });

    it('orphan close </i> throws UNBALANCED_ITALIC_TAGS', () => {
      expect(() => splitTaggedText('</i>bad')).toThrow('UNBALANCED_ITALIC_TAGS');
    });

    it('unclosed <i> throws UNBALANCED_ITALIC_TAGS', () => {
      expect(() => splitTaggedText('<i>bad')).toThrow('UNBALANCED_ITALIC_TAGS');
    });

    it('orphan close </u> throws UNBALANCED_UNDERLINE_TAGS', () => {
      expect(() => splitTaggedText('</u>bad')).toThrow('UNBALANCED_UNDERLINE_TAGS');
    });

    it('unclosed <u> throws UNBALANCED_UNDERLINE_TAGS', () => {
      expect(() => splitTaggedText('<u>bad')).toThrow('UNBALANCED_UNDERLINE_TAGS');
    });

    it('orphan close </highlight> throws UNBALANCED_HIGHLIGHT_TAGS', () => {
      expect(() => splitTaggedText('</highlight>x')).toThrow('UNBALANCED_HIGHLIGHT_TAGS');
    });

    it('unclosed <highlight> throws UNBALANCED_HIGHLIGHT_TAGS', () => {
      expect(() => splitTaggedText('<highlight>bad')).toThrow('UNBALANCED_HIGHLIGHT_TAGS');
    });

    it('orphan close </font> throws UNBALANCED_FONT_TAGS', () => {
      expect(() => splitTaggedText('</font>x')).toThrow('UNBALANCED_FONT_TAGS');
    });

    it('unclosed <font> throws UNBALANCED_FONT_TAGS', () => {
      expect(() => splitTaggedText('<font>unterminated')).toThrow('UNBALANCED_FONT_TAGS');
    });

    it('orphan close </header> throws UNBALANCED_HEADER_TAGS', () => {
      expect(() => splitTaggedText('</header>bad')).toThrow('UNBALANCED_HEADER_TAGS');
    });

    it('unclosed <header> throws UNBALANCED_HEADER_TAGS', () => {
      expect(() => splitTaggedText('<header>bad')).toThrow('UNBALANCED_HEADER_TAGS');
    });

    it('orphan close </highlighting> throws UNBALANCED_HIGHLIGHT_TAGS', () => {
      expect(() => splitTaggedText('</highlighting>x')).toThrow('UNBALANCED_HIGHLIGHT_TAGS');
    });

    it('unclosed <highlighting> throws UNBALANCED_HIGHLIGHT_TAGS', () => {
      expect(() => splitTaggedText('<highlighting>bad')).toThrow('UNBALANCED_HIGHLIGHT_TAGS');
    });
  });

  // ─── splitTaggedText: legacy aliases ───────────────────────────

  describe('splitTaggedText — legacy aliases', () => {
    it('<highlighting> alias sets highlighting to true', () => {
      const result = splitTaggedText('<highlighting>text</highlighting>');
      expect(result).toEqual([seg('text', { highlighting: true })]);
    });

    it('<RunInHeader> alias sets header to true', () => {
      const result = splitTaggedText('<RunInHeader>text</RunInHeader>');
      expect(result).toEqual([seg('text', { header: true })]);
    });
  });

  // ─── splitTaggedText: CR/CRLF normalization ────────────────────

  describe('splitTaggedText — CR/CRLF normalization', () => {
    it('CRLF is normalized to LF by xmldom', () => {
      const result = splitTaggedText('line1\r\nline2');
      expect(result).toHaveLength(1);
      expect(result[0]!.text).toBe('line1\nline2');
    });

    it('standalone CR is normalized to LF', () => {
      const result = splitTaggedText('line1\rline2');
      expect(result).toHaveLength(1);
      expect(result[0]!.text).toBe('line1\nline2');
    });
  });

  // ─── splitTaggedText: coalescing ───────────────────────────────

  describe('splitTaggedText — coalescing', () => {
    it('adjacent segments with identical state are coalesced', () => {
      const result = splitTaggedText('<b>A</b><b>B</b>');
      expect(result).toEqual([seg('AB', { bold: true })]);
    });

    it('adjacent plain text segments are coalesced', () => {
      // After a tag pair that yields identical state, text should merge
      const result = splitTaggedText('hello world');
      expect(result).toHaveLength(1);
      expect(result[0]!.text).toBe('hello world');
    });
  });

  // ─── splitTaggedText: multiple segments ────────────────────────

  describe('splitTaggedText — multiple segments', () => {
    it('plain-bold-plain produces 3 segments', () => {
      const result = splitTaggedText('plain <b>bold</b> plain');
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(seg('plain '));
      expect(result[1]).toEqual(seg('bold', { bold: true }));
      expect(result[2]).toEqual(seg(' plain'));
    });

    it('interleaved formatting produces correct segments', () => {
      const result = splitTaggedText('normal <b>bold</b> <i>italic</i> end');
      expect(result).toHaveLength(5);
      expect(result[0]).toEqual(seg('normal '));
      expect(result[1]).toEqual(seg('bold', { bold: true }));
      expect(result[2]).toEqual(seg(' '));
      expect(result[3]).toEqual(seg('italic', { italic: true }));
      expect(result[4]).toEqual(seg(' end'));
    });
  });

  // ─── splitTaggedText: unknown tags treated as plain text ───────

  describe('splitTaggedText — unknown tags', () => {
    it('unknown tag like <xyz> is escaped and appears as literal text', () => {
      const result = splitTaggedText('<xyz>content</xyz>');
      // The tokenizer does not recognize <xyz>, so < is escaped to &lt;
      // and the text appears literally
      expect(result).toHaveLength(1);
      expect(result[0]!.text).toContain('<xyz>');
    });
  });

  // ─── segmentAddRunProps ────────────────────────────────────────

  describe('segmentAddRunProps', () => {
    it('returns undefined for a segment with no formatting', () => {
      const result = segmentAddRunProps(seg('plain'));
      expect(result).toBeUndefined();
    });

    it('maps bold to bold', () => {
      const result = segmentAddRunProps(seg('', { bold: true }));
      expect(result).toEqual({ bold: true });
    });

    it('maps italic to italic', () => {
      const result = segmentAddRunProps(seg('', { italic: true }));
      expect(result).toEqual({ italic: true });
    });

    it('maps underline to underline', () => {
      const result = segmentAddRunProps(seg('', { underline: true }));
      expect(result).toEqual({ underline: true });
    });

    it('maps highlighting to highlight', () => {
      const result = segmentAddRunProps(seg('', { highlighting: true }));
      expect(result).toEqual({ highlight: true });
    });

    it('maps color to color', () => {
      const result = segmentAddRunProps(seg('', { color: 'FF0000' }));
      expect(result).toEqual({ color: 'FF0000' });
    });

    it('maps fontSize to fontSize', () => {
      const result = segmentAddRunProps(seg('', { fontSize: 28 }));
      expect(result).toEqual({ fontSize: 28 });
    });

    it('maps fontName to fontName', () => {
      const result = segmentAddRunProps(seg('', { fontName: 'Arial' }));
      expect(result).toEqual({ fontName: 'Arial' });
    });

    it('maps multiple properties together', () => {
      const result = segmentAddRunProps(
        seg('', { bold: true, italic: true, color: '0000FF', fontSize: 24, fontName: 'Courier' }),
      );
      expect(result).toEqual({
        bold: true,
        italic: true,
        color: '0000FF',
        fontSize: 24,
        fontName: 'Courier',
      });
    });
  });

  // ─── hasAnyMarkupTags ──────────────────────────────────────────

  describe('hasAnyMarkupTags', () => {
    it('returns true for string containing <b>', () => {
      expect(hasAnyMarkupTags('some <b>bold</b> text')).toBe(true);
    });

    it('returns true for string containing <i>', () => {
      expect(hasAnyMarkupTags('<i>italic</i>')).toBe(true);
    });

    it('returns true for string containing <u>', () => {
      expect(hasAnyMarkupTags('<u>underline</u>')).toBe(true);
    });

    it('returns true for string containing <highlight>', () => {
      expect(hasAnyMarkupTags('<highlight>hi</highlight>')).toBe(true);
    });

    it('returns true for string containing <highlighting>', () => {
      expect(hasAnyMarkupTags('<highlighting>hi</highlighting>')).toBe(true);
    });

    it('returns true for string containing <header>', () => {
      expect(hasAnyMarkupTags('<header>h</header>')).toBe(true);
    });

    it('returns true for string containing <RunInHeader>', () => {
      expect(hasAnyMarkupTags('<RunInHeader>h</RunInHeader>')).toBe(true);
    });

    it('returns true for string containing <font ...>', () => {
      expect(hasAnyMarkupTags('<font color="red">text</font>')).toBe(true);
    });

    it('returns false for plain text', () => {
      expect(hasAnyMarkupTags('just plain text')).toBe(false);
    });

    it('returns false for unknown tags', () => {
      expect(hasAnyMarkupTags('<div>not matched</div>')).toBe(false);
    });

    it('returns true for closing tags', () => {
      expect(hasAnyMarkupTags('</b>')).toBe(true);
    });
  });

  // ─── hasHeaderTags ─────────────────────────────────────────────

  describe('hasHeaderTags', () => {
    it('returns true for <header>', () => {
      expect(hasHeaderTags('<header>text</header>')).toBe(true);
    });

    it('returns true for </header>', () => {
      expect(hasHeaderTags('text</header>')).toBe(true);
    });

    it('returns true for <RunInHeader>', () => {
      expect(hasHeaderTags('<RunInHeader>text</RunInHeader>')).toBe(true);
    });

    it('returns true for </RunInHeader>', () => {
      expect(hasHeaderTags('text</RunInHeader>')).toBe(true);
    });

    it('returns false for non-header tags', () => {
      expect(hasHeaderTags('<b>bold</b>')).toBe(false);
    });

    it('returns false for plain text', () => {
      expect(hasHeaderTags('plain text')).toBe(false);
    });
  });

  // ─── hasInlineStyleTags ────────────────────────────────────────

  describe('hasInlineStyleTags', () => {
    it('returns true for <b>', () => {
      expect(hasInlineStyleTags('<b>text</b>')).toBe(true);
    });

    it('returns true for </b> alone', () => {
      expect(hasInlineStyleTags('text</b>')).toBe(true);
    });

    it('returns true for <i>', () => {
      expect(hasInlineStyleTags('<i>text</i>')).toBe(true);
    });

    it('returns true for <u>', () => {
      expect(hasInlineStyleTags('<u>text</u>')).toBe(true);
    });

    it('returns false for <highlight>', () => {
      expect(hasInlineStyleTags('<highlight>text</highlight>')).toBe(false);
    });

    it('returns false for <font>', () => {
      expect(hasInlineStyleTags('<font>text</font>')).toBe(false);
    });

    it('returns false for plain text', () => {
      expect(hasInlineStyleTags('just text')).toBe(false);
    });
  });

  // ─── stripAllInlineTags ────────────────────────────────────────

  describe('stripAllInlineTags', () => {
    it('removes <b> and </b>', () => {
      expect(stripAllInlineTags('<b>bold</b>')).toBe('bold');
    });

    it('removes multiple tags', () => {
      expect(stripAllInlineTags('<b><i>text</i></b>')).toBe('text');
    });

    it('removes <header> tags', () => {
      expect(stripAllInlineTags('<header>heading</header>')).toBe('heading');
    });

    it('removes <highlight> tags', () => {
      expect(stripAllInlineTags('<highlight>marked</highlight>')).toBe('marked');
    });

    it('returns plain text unchanged', () => {
      expect(stripAllInlineTags('no tags here')).toBe('no tags here');
    });
  });
});
