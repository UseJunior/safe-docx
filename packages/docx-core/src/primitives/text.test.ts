import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { parseXml } from './xml.js';
import { OOXML, W } from './namespaces.js';
import { SafeDocxError } from './errors.js';
import {
  getParagraphRuns,
  getParagraphText,
  splitRunAtVisibleOffset,
  replaceParagraphTextRange,
  visibleLengthForEl,
  getDirectContentElements,
} from './text.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Text Primitives' });

const W_NS = OOXML.W_NS;

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="${OOXML.R_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

function firstParagraph(doc: Document): Element {
  const p = doc.getElementsByTagNameNS(W_NS, W.p).item(0);
  if (!p) throw new Error('missing paragraph');
  return p as Element;
}

// ── getParagraphRuns — field-code state machine ─────────────────────

describe('getParagraphRuns', () => {
  test('extracts simple text runs', async ({ given, then }: AllureBddContext) => {
    let doc: Document;
    let runs: ReturnType<typeof getParagraphRuns>;

    await given('a paragraph with two text runs', () => {
      doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t> World</w:t></w:r></w:p>');
    });

    await then('each run is extracted with correct text and field flag', () => {
      runs = getParagraphRuns(firstParagraph(doc));
      expect(runs).toHaveLength(2);
      expect(runs[0]!.text).toBe('Hello');
      expect(runs[1]!.text).toBe(' World');
      expect(runs[0]!.isFieldResult).toBe(false);
      expect(runs[1]!.isFieldResult).toBe(false);
    });
  });

  test('tracks field-code state: begin → IN_FIELD_CODE → separate → IN_FIELD_RESULT → end', async ({ given, then }: AllureBddContext) => {
    let doc: Document;

    await given('a paragraph with a complete field sequence', () => {
      doc = makeDoc(
        `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>REF Clause_1</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>Visible Result</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`,
      );
    });

    await then('only the field result text run is returned', () => {
      const runs = getParagraphRuns(firstParagraph(doc));
      expect(runs).toHaveLength(1);
      expect(runs[0]!.text).toBe('Visible Result');
      expect(runs[0]!.isFieldResult).toBe(true);
    });
  });

  test('skips field instruction text (instrText)', async ({ given, then }: AllureBddContext) => {
    let doc: Document;

    await given('a paragraph with plain text around a PAGE field', () => {
      doc = makeDoc(
        `<w:p>` +
        `<w:r><w:t>Before </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>PAGE</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>3</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t> After</w:t></w:r>` +
        `</w:p>`,
      );
    });

    await then('instrText is skipped and field result is flagged', () => {
      const runs = getParagraphRuns(firstParagraph(doc));
      expect(runs.map((r) => r.text)).toEqual(['Before ', '3', ' After']);
      expect(runs.map((r) => r.isFieldResult)).toEqual([false, true, false]);
    });
  });

  test('handles w:tab as tab character', async ({ given, then }: AllureBddContext) => {
    let doc: Document;

    await given('a run containing a tab element', () => {
      doc = makeDoc('<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p>');
    });

    await then('the tab is represented as a tab character in the run text', () => {
      const runs = getParagraphRuns(firstParagraph(doc));
      expect(runs).toHaveLength(1);
      expect(runs[0]!.text).toBe('A\tB');
    });
  });

  test('handles w:br as newline character', async ({ given, then }: AllureBddContext) => {
    let doc: Document;

    await given('a run containing a break element', () => {
      doc = makeDoc('<w:p><w:r><w:t>Line1</w:t><w:br/><w:t>Line2</w:t></w:r></w:p>');
    });

    await then('the break is represented as a newline in the run text', () => {
      const runs = getParagraphRuns(firstParagraph(doc));
      expect(runs).toHaveLength(1);
      expect(runs[0]!.text).toBe('Line1\nLine2');
    });
  });

  test('handles fldChar and result text in the same run', async ({ given, then }: AllureBddContext) => {
    let doc: Document;

    await given('a run that combines a fldChar separate and result text', () => {
      doc = makeDoc(
        `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>REF X</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/><w:t>InlineResult</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`,
      );
    });

    await then('the inline result text is extracted and flagged as field result', () => {
      const runs = getParagraphRuns(firstParagraph(doc));
      expect(runs).toHaveLength(1);
      expect(runs[0]!.text).toBe('InlineResult');
      expect(runs[0]!.isFieldResult).toBe(true);
    });
  });

  test('returns empty array for empty paragraph', async ({ given, then }: AllureBddContext) => {
    let doc: Document;

    await given('an empty paragraph element', () => {
      doc = makeDoc('<w:p></w:p>');
    });

    await then('no runs are returned', () => {
      const runs = getParagraphRuns(firstParagraph(doc));
      expect(runs).toHaveLength(0);
    });
  });

  test('returns empty array for paragraph with only pPr', async ({ given, then }: AllureBddContext) => {
    let doc: Document;

    await given('a paragraph containing only paragraph properties', () => {
      doc = makeDoc('<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>');
    });

    await then('no runs are returned', () => {
      const runs = getParagraphRuns(firstParagraph(doc));
      expect(runs).toHaveLength(0);
    });
  });

  test('handles paragraph with only tabs and breaks', async ({ given, then }: AllureBddContext) => {
    let doc: Document;

    await given('a run containing only a tab and break', () => {
      doc = makeDoc('<w:p><w:r><w:tab/><w:br/></w:r></w:p>');
    });

    await then('the run text reflects both whitespace characters', () => {
      const runs = getParagraphRuns(firstParagraph(doc));
      expect(runs).toHaveLength(1);
      expect(runs[0]!.text).toBe('\t\n');
    });
  });
});

// ── getParagraphText ────────────────────────────────────────────────

describe('getParagraphText', () => {
  test('concatenates all visible run texts', async ({ given, then }: AllureBddContext) => {
    let doc: Document;

    await given('a paragraph with two runs', () => {
      doc = makeDoc(
        '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t> World</w:t></w:r></w:p>',
      );
    });

    await then('the full paragraph text is concatenated', () => {
      expect(getParagraphText(firstParagraph(doc))).toBe('Hello World');
    });
  });

  test('returns empty string for empty paragraph', async ({ given, then }: AllureBddContext) => {
    let doc: Document;

    await given('an empty paragraph', () => {
      doc = makeDoc('<w:p></w:p>');
    });

    await then('empty string is returned', () => {
      expect(getParagraphText(firstParagraph(doc))).toBe('');
    });
  });
});

// ── visibleLengthForEl ──────────────────────────────────────────────

describe('visibleLengthForEl', () => {
  test('returns text length for w:t', async ({ given, then }: AllureBddContext) => {
    let t: Element;

    await given('a w:t element containing five characters', () => {
      const doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
      t = doc.getElementsByTagNameNS(W_NS, W.t).item(0) as Element;
    });

    await then('visible length equals character count', () => {
      expect(visibleLengthForEl(t)).toBe(5);
    });
  });

  test('returns 1 for w:tab', async ({ given, then }: AllureBddContext) => {
    let tab: Element;

    await given('a w:tab element', () => {
      const doc = makeDoc('<w:p><w:r><w:tab/></w:r></w:p>');
      tab = doc.getElementsByTagNameNS(W_NS, W.tab).item(0) as Element;
    });

    await then('visible length is 1', () => {
      expect(visibleLengthForEl(tab)).toBe(1);
    });
  });

  test('returns 1 for w:br', async ({ given, then }: AllureBddContext) => {
    let br: Element;

    await given('a w:br element', () => {
      const doc = makeDoc('<w:p><w:r><w:br/></w:r></w:p>');
      br = doc.getElementsByTagNameNS(W_NS, W.br).item(0) as Element;
    });

    await then('visible length is 1', () => {
      expect(visibleLengthForEl(br)).toBe(1);
    });
  });

  test('returns 0 for rPr', async ({ given, then }: AllureBddContext) => {
    let rPr: Element;

    await given('a w:rPr element', () => {
      const doc = makeDoc('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>X</w:t></w:r></w:p>');
      rPr = doc.getElementsByTagNameNS(W_NS, W.rPr).item(0) as Element;
    });

    await then('visible length is 0', () => {
      expect(visibleLengthForEl(rPr)).toBe(0);
    });
  });
});

// ── getDirectContentElements ────────────────────────────────────────

describe('getDirectContentElements', () => {
  test('excludes rPr from direct children', async ({ given, then }: AllureBddContext) => {
    let r: Element;

    await given('a run with rPr, a text node, and a tab', () => {
      const doc = makeDoc(
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t><w:tab/></w:r></w:p>',
      );
      r = doc.getElementsByTagNameNS(W_NS, W.r).item(0) as Element;
    });

    await then('only the content elements excluding rPr are returned', () => {
      const content = getDirectContentElements(r);
      expect(content).toHaveLength(2);
      expect(content[0]!.localName).toBe(W.t);
      expect(content[1]!.localName).toBe(W.tab);
    });
  });
});

// ── splitRunAtVisibleOffset ─────────────────────────────────────────

describe('splitRunAtVisibleOffset', () => {
  test('splits at mid-text position', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let r: Element;
    let left: Element;
    let right: Element;

    await given('a run containing "Hello World"', () => {
      doc = makeDoc('<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>');
      r = doc.getElementsByTagNameNS(W_NS, W.r).item(0) as Element;
    });

    await when('the run is split at visible offset 5', () => {
      ({ left, right } = splitRunAtVisibleOffset(r, 5));
    });

    await then('left gets "Hello" and right gets " World"', () => {
      const p = firstParagraph(doc);
      expect(getParagraphText(p)).toBe('Hello World');
      const leftText = left.getElementsByTagNameNS(W_NS, W.t).item(0) as Element;
      const rightText = right.getElementsByTagNameNS(W_NS, W.t).item(0) as Element;
      expect(leftText.textContent).toBe('Hello');
      expect(rightText.textContent).toBe(' World');
    });
  });

  test('splits at tab boundary', async ({ given, when, then }: AllureBddContext) => {
    let r: Element;
    let left: Element;
    let right: Element;

    await given('a run with text "A", a tab, and text "B"', () => {
      const doc = makeDoc('<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p>');
      r = doc.getElementsByTagNameNS(W_NS, W.r).item(0) as Element;
    });

    await when('the run is split at visible offset 1', () => {
      ({ left, right } = splitRunAtVisibleOffset(r, 1));
    });

    await then('left gets "A" and right gets tab + "B"', () => {
      const leftContent = getDirectContentElements(left);
      const rightContent = getDirectContentElements(right);
      expect(leftContent.length).toBeGreaterThan(0);
      expect(rightContent.length).toBeGreaterThan(0);
    });
  });

  test('splits at break boundary', async ({ given, when, then }: AllureBddContext) => {
    let r: Element;
    let left: Element;
    let right: Element;

    await given('a run with text "X", a break, and text "Y"', () => {
      const doc = makeDoc('<w:p><w:r><w:t>X</w:t><w:br/><w:t>Y</w:t></w:r></w:p>');
      r = doc.getElementsByTagNameNS(W_NS, W.r).item(0) as Element;
    });

    await when('the run is split at visible offset 1', () => {
      ({ left, right } = splitRunAtVisibleOffset(r, 1));
    });

    await then('both halves contain content', () => {
      const leftContent = getDirectContentElements(left);
      const rightContent = getDirectContentElements(right);
      expect(leftContent.length).toBeGreaterThan(0);
      expect(rightContent.length).toBeGreaterThan(0);
    });
  });

  test('split at offset 0 puts all content in right', async ({ given, when, then }: AllureBddContext) => {
    let r: Element;
    let right: Element;

    await given('a run containing "ABCDE"', () => {
      const doc = makeDoc('<w:p><w:r><w:t>ABCDE</w:t></w:r></w:p>');
      r = doc.getElementsByTagNameNS(W_NS, W.r).item(0) as Element;
    });

    await when('the run is split at offset 0', () => {
      ({ right } = splitRunAtVisibleOffset(r, 0));
    });

    await then('right run contains all text', () => {
      const rightText = right.getElementsByTagNameNS(W_NS, W.t).item(0) as Element;
      expect(rightText.textContent).toBe('ABCDE');
    });
  });

  test('split at end puts all content in left', async ({ given, when, then }: AllureBddContext) => {
    let r: Element;
    let left: Element;

    await given('a run containing "ABCDE"', () => {
      const doc = makeDoc('<w:p><w:r><w:t>ABCDE</w:t></w:r></w:p>');
      r = doc.getElementsByTagNameNS(W_NS, W.r).item(0) as Element;
    });

    await when('the run is split at offset 5 (end)', () => {
      ({ left } = splitRunAtVisibleOffset(r, 5));
    });

    await then('left run contains all text', () => {
      const leftText = left.getElementsByTagNameNS(W_NS, W.t).item(0) as Element;
      expect(leftText.textContent).toBe('ABCDE');
    });
  });

  test('preserves rPr formatting in both halves', async ({ given, when, then }: AllureBddContext) => {
    let r: Element;
    let left: Element;
    let right: Element;

    await given('a bold italic run containing "HelloWorld"', () => {
      const doc = makeDoc(
        '<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>HelloWorld</w:t></w:r></w:p>',
      );
      r = doc.getElementsByTagNameNS(W_NS, W.r).item(0) as Element;
    });

    await when('the run is split at offset 5', () => {
      ({ left, right } = splitRunAtVisibleOffset(r, 5));
    });

    await then('both halves inherit the bold formatting', () => {
      const leftRPr = left.getElementsByTagNameNS(W_NS, W.rPr).item(0) as Element;
      const rightRPr = right.getElementsByTagNameNS(W_NS, W.rPr).item(0) as Element;
      expect(leftRPr).toBeTruthy();
      expect(rightRPr).toBeTruthy();
      expect(leftRPr.getElementsByTagNameNS(W_NS, W.b).length).toBe(1);
      expect(rightRPr.getElementsByTagNameNS(W_NS, W.b).length).toBe(1);
    });
  });
});

// ── replaceParagraphTextRange ───────────────────────────────────────

describe('replaceParagraphTextRange', () => {
  test('replaces within a single run', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph with "Hello World" in one run', () => {
      const doc = makeDoc('<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>');
      p = firstParagraph(doc);
    });

    await when('range 0–5 is replaced with "Goodbye"', () => {
      replaceParagraphTextRange(p, 0, 5, 'Goodbye');
    });

    await then('paragraph text reads "Goodbye World"', () => {
      expect(getParagraphText(p)).toBe('Goodbye World');
    });
  });

  test('replaces across multiple runs', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph with bold "Hello" and italic " World" in separate runs', () => {
      const doc = makeDoc(
        `<w:p>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r>` +
        `<w:r><w:rPr><w:i/></w:rPr><w:t> World</w:t></w:r>` +
        `</w:p>`,
      );
      p = firstParagraph(doc);
    });

    await when('range 3–8 is replaced with "X"', () => {
      replaceParagraphTextRange(p, 3, 8, 'X');
    });

    await then('paragraph text reads "HelXrld"', () => {
      expect(getParagraphText(p)).toBe('HelXrld');
    });
  });

  test('preserves formatting from template run', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('a bold paragraph with text "Bold Text"', () => {
      const doc = makeDoc(
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold Text</w:t></w:r></w:p>',
      );
      p = firstParagraph(doc);
    });

    await when('the tail "Text" is replaced with "Repl"', () => {
      replaceParagraphTextRange(p, 5, 9, 'Repl');
    });

    await then('the replacement run inherits bold formatting', () => {
      expect(getParagraphText(p)).toBe('Bold Repl');
      const serialized = p.toString();
      expect(serialized).toContain('<w:b');
    });
  });

  test('handles replacement with tabs and breaks', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph with "Hello"', () => {
      const doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
      p = firstParagraph(doc);
    });

    await when('the entire text is replaced with "A\\tB\\nC"', () => {
      replaceParagraphTextRange(p, 0, 5, 'A\tB\nC');
    });

    await then('paragraph text reflects tabs and newlines', () => {
      expect(getParagraphText(p)).toBe('A\tB\nC');
    });
  });

  test('handles replacement with ReplacementPart array', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph with "Hello World"', () => {
      const doc = makeDoc('<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>');
      p = firstParagraph(doc);
    });

    await when('the entire range is replaced with two styled parts', () => {
      replaceParagraphTextRange(p, 0, 11, [
        { text: 'Part1', addRunProps: { bold: true } },
        { text: 'Part2', addRunProps: { italic: true } },
      ]);
    });

    await then('paragraph text concatenates both parts', () => {
      expect(getParagraphText(p)).toBe('Part1Part2');
    });
  });

  test('throws on invalid range (start > end)', async ({ given, when }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph with "Hello"', () => {
      const doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
      p = firstParagraph(doc);
    });

    await when('a range with start > end is provided', () => {
      expect(() => replaceParagraphTextRange(p, 5, 3, 'bad')).toThrow(/Invalid range/);
    });
  });

  test('throws on out-of-bounds range', async ({ given, when }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph with "Hello"', () => {
      const doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
      p = firstParagraph(doc);
    });

    await when('a range exceeding text length is provided', () => {
      expect(() => replaceParagraphTextRange(p, 0, 100, 'bad')).toThrow(/Invalid range/);
    });
  });

  test('throws UNSUPPORTED_EDIT for multi-run edit crossing field results', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph where a field result spans two runs', () => {
      const doc = makeDoc(
        `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>REF X</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>Visible</w:t></w:r>` +
        `<w:r><w:t> Result</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`,
      );
      p = firstParagraph(doc);
    });

    await when('an edit spanning both field result runs is attempted', () => {
      // captured for assertion
    });

    await then('UNSUPPORTED_EDIT error is thrown', () => {
      try {
        replaceParagraphTextRange(p, 0, 14, 'Updated');
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(SafeDocxError);
        expect((e as SafeDocxError).code).toBe('UNSUPPORTED_EDIT');
      }
    });
  });

  test('single-run field result edit is allowed', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph with a single-run field result', () => {
      const doc = makeDoc(
        `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>REF X</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>Visible</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`,
      );
      p = firstParagraph(doc);
    });

    await when('an edit within the single-run field result is applied', () => {
      replaceParagraphTextRange(p, 0, 7, 'Changed');
    });

    await then('the edit succeeds and text is updated', () => {
      expect(getParagraphText(p)).toBe('Changed');
    });
  });

  test('handles empty replacement (deletion)', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph with "Hello World"', () => {
      const doc = makeDoc('<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>');
      p = firstParagraph(doc);
    });

    await when('range 5–11 is replaced with empty string', () => {
      replaceParagraphTextRange(p, 5, 11, '');
    });

    await then('paragraph text reads "Hello"', () => {
      expect(getParagraphText(p)).toBe('Hello');
    });
  });

  test('handles replacement at start of paragraph', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph with "ABCDE"', () => {
      const doc = makeDoc('<w:p><w:r><w:t>ABCDE</w:t></w:r></w:p>');
      p = firstParagraph(doc);
    });

    await when('range 0–3 is replaced with "XY"', () => {
      replaceParagraphTextRange(p, 0, 3, 'XY');
    });

    await then('paragraph text reads "XYDE"', () => {
      expect(getParagraphText(p)).toBe('XYDE');
    });
  });

  test('handles replacement at end of paragraph', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph with "ABCDE"', () => {
      const doc = makeDoc('<w:p><w:r><w:t>ABCDE</w:t></w:r></w:p>');
      p = firstParagraph(doc);
    });

    await when('range 3–5 is replaced with "XYZ"', () => {
      replaceParagraphTextRange(p, 3, 5, 'XYZ');
    });

    await then('paragraph text reads "ABCXYZ"', () => {
      expect(getParagraphText(p)).toBe('ABCXYZ');
    });
  });
});

// ── findOffsetInRuns (indirect via replaceParagraphTextRange) ────────

describe('findOffsetInRuns (via replaceParagraphTextRange)', () => {
  test('maps offset across multiple runs correctly', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph with three runs "AB", "CD", "EF"', () => {
      const doc = makeDoc(
        `<w:p>` +
        `<w:r><w:t>AB</w:t></w:r>` +
        `<w:r><w:t>CD</w:t></w:r>` +
        `<w:r><w:t>EF</w:t></w:r>` +
        `</w:p>`,
      );
      p = firstParagraph(doc);
    });

    await when('"CD" (offset 2–4) is replaced with "XX"', () => {
      replaceParagraphTextRange(p, 2, 4, 'XX');
    });

    await then('paragraph text reads "ABXXEF"', () => {
      expect(getParagraphText(p)).toBe('ABXXEF');
    });
  });

  test('handles offset at run boundaries', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph with two runs "AB" and "CD"', () => {
      const doc = makeDoc(
        `<w:p>` +
        `<w:r><w:t>AB</w:t></w:r>` +
        `<w:r><w:t>CD</w:t></w:r>` +
        `</w:p>`,
      );
      p = firstParagraph(doc);
    });

    await when('replacement starts exactly at run boundary offset 2', () => {
      replaceParagraphTextRange(p, 2, 4, 'YY');
    });

    await then('paragraph text reads "ABYY"', () => {
      expect(getParagraphText(p)).toBe('ABYY');
    });
  });
});
