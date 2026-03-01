import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
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
  it('extracts simple text runs', () => {
    const doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t> World</w:t></w:r></w:p>');
    const runs = getParagraphRuns(firstParagraph(doc));

    expect(runs).toHaveLength(2);
    expect(runs[0]!.text).toBe('Hello');
    expect(runs[1]!.text).toBe(' World');
    expect(runs[0]!.isFieldResult).toBe(false);
    expect(runs[1]!.isFieldResult).toBe(false);
  });

  it('tracks field-code state: begin → IN_FIELD_CODE → separate → IN_FIELD_RESULT → end', () => {
    const doc = makeDoc(
      `<w:p>` +
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText>REF Clause_1</w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
      `<w:r><w:t>Visible Result</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
      `</w:p>`,
    );

    const runs = getParagraphRuns(firstParagraph(doc));
    // Only the field result text should appear
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe('Visible Result');
    expect(runs[0]!.isFieldResult).toBe(true);
  });

  it('skips field instruction text (instrText)', () => {
    const doc = makeDoc(
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

    const runs = getParagraphRuns(firstParagraph(doc));
    expect(runs.map((r) => r.text)).toEqual(['Before ', '3', ' After']);
    expect(runs.map((r) => r.isFieldResult)).toEqual([false, true, false]);
  });

  it('handles w:tab as tab character', () => {
    const doc = makeDoc('<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p>');
    const runs = getParagraphRuns(firstParagraph(doc));

    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe('A\tB');
  });

  it('handles w:br as newline character', () => {
    const doc = makeDoc('<w:p><w:r><w:t>Line1</w:t><w:br/><w:t>Line2</w:t></w:r></w:p>');
    const runs = getParagraphRuns(firstParagraph(doc));

    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe('Line1\nLine2');
  });

  it('handles fldChar and result text in the same run', () => {
    const doc = makeDoc(
      `<w:p>` +
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText>REF X</w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/><w:t>InlineResult</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
      `</w:p>`,
    );

    const runs = getParagraphRuns(firstParagraph(doc));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe('InlineResult');
    expect(runs[0]!.isFieldResult).toBe(true);
  });

  it('returns empty array for empty paragraph', () => {
    const doc = makeDoc('<w:p></w:p>');
    const runs = getParagraphRuns(firstParagraph(doc));
    expect(runs).toHaveLength(0);
  });

  it('returns empty array for paragraph with only pPr', () => {
    const doc = makeDoc('<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>');
    const runs = getParagraphRuns(firstParagraph(doc));
    expect(runs).toHaveLength(0);
  });

  it('handles paragraph with only tabs and breaks', () => {
    const doc = makeDoc('<w:p><w:r><w:tab/><w:br/></w:r></w:p>');
    const runs = getParagraphRuns(firstParagraph(doc));

    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe('\t\n');
  });
});

// ── getParagraphText ────────────────────────────────────────────────

describe('getParagraphText', () => {
  it('concatenates all visible run texts', () => {
    const doc = makeDoc(
      '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t> World</w:t></w:r></w:p>',
    );
    expect(getParagraphText(firstParagraph(doc))).toBe('Hello World');
  });

  it('returns empty string for empty paragraph', () => {
    const doc = makeDoc('<w:p></w:p>');
    expect(getParagraphText(firstParagraph(doc))).toBe('');
  });
});

// ── visibleLengthForEl ──────────────────────────────────────────────

describe('visibleLengthForEl', () => {
  it('returns text length for w:t', () => {
    const doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
    const t = doc.getElementsByTagNameNS(W_NS, W.t).item(0) as Element;
    expect(visibleLengthForEl(t)).toBe(5);
  });

  it('returns 1 for w:tab', () => {
    const doc = makeDoc('<w:p><w:r><w:tab/></w:r></w:p>');
    const tab = doc.getElementsByTagNameNS(W_NS, W.tab).item(0) as Element;
    expect(visibleLengthForEl(tab)).toBe(1);
  });

  it('returns 1 for w:br', () => {
    const doc = makeDoc('<w:p><w:r><w:br/></w:r></w:p>');
    const br = doc.getElementsByTagNameNS(W_NS, W.br).item(0) as Element;
    expect(visibleLengthForEl(br)).toBe(1);
  });

  it('returns 0 for rPr', () => {
    const doc = makeDoc('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>X</w:t></w:r></w:p>');
    const rPr = doc.getElementsByTagNameNS(W_NS, W.rPr).item(0) as Element;
    expect(visibleLengthForEl(rPr)).toBe(0);
  });
});

// ── getDirectContentElements ────────────────────────────────────────

describe('getDirectContentElements', () => {
  it('excludes rPr from direct children', () => {
    const doc = makeDoc(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t><w:tab/></w:r></w:p>',
    );
    const r = doc.getElementsByTagNameNS(W_NS, W.r).item(0) as Element;
    const content = getDirectContentElements(r);

    expect(content).toHaveLength(2);
    expect(content[0]!.localName).toBe(W.t);
    expect(content[1]!.localName).toBe(W.tab);
  });
});

// ── splitRunAtVisibleOffset ─────────────────────────────────────────

describe('splitRunAtVisibleOffset', () => {
  it('splits at mid-text position', () => {
    const doc = makeDoc('<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>');
    const p = firstParagraph(doc);
    const r = doc.getElementsByTagNameNS(W_NS, W.r).item(0) as Element;

    const { left, right } = splitRunAtVisibleOffset(r, 5);

    expect(getParagraphText(p)).toBe('Hello World');
    const leftText = left.getElementsByTagNameNS(W_NS, W.t).item(0) as Element;
    const rightText = right.getElementsByTagNameNS(W_NS, W.t).item(0) as Element;
    expect(leftText.textContent).toBe('Hello');
    expect(rightText.textContent).toBe(' World');
  });

  it('splits at tab boundary', () => {
    const doc = makeDoc('<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p>');
    const r = doc.getElementsByTagNameNS(W_NS, W.r).item(0) as Element;

    const { left, right } = splitRunAtVisibleOffset(r, 1);

    // Left gets "A", right gets tab + "B"
    const leftContent = getDirectContentElements(left);
    const rightContent = getDirectContentElements(right);
    expect(leftContent.length).toBeGreaterThan(0);
    expect(rightContent.length).toBeGreaterThan(0);
  });

  it('splits at break boundary', () => {
    const doc = makeDoc('<w:p><w:r><w:t>X</w:t><w:br/><w:t>Y</w:t></w:r></w:p>');
    const r = doc.getElementsByTagNameNS(W_NS, W.r).item(0) as Element;

    const { left, right } = splitRunAtVisibleOffset(r, 1);

    const leftContent = getDirectContentElements(left);
    const rightContent = getDirectContentElements(right);
    expect(leftContent.length).toBeGreaterThan(0);
    expect(rightContent.length).toBeGreaterThan(0);
  });

  it('split at offset 0 puts all content in right', () => {
    const doc = makeDoc('<w:p><w:r><w:t>ABCDE</w:t></w:r></w:p>');
    const r = doc.getElementsByTagNameNS(W_NS, W.r).item(0) as Element;

    const { right } = splitRunAtVisibleOffset(r, 0);

    const rightText = right.getElementsByTagNameNS(W_NS, W.t).item(0) as Element;
    expect(rightText.textContent).toBe('ABCDE');
  });

  it('split at end puts all content in left', () => {
    const doc = makeDoc('<w:p><w:r><w:t>ABCDE</w:t></w:r></w:p>');
    const r = doc.getElementsByTagNameNS(W_NS, W.r).item(0) as Element;

    const { left } = splitRunAtVisibleOffset(r, 5);

    const leftText = left.getElementsByTagNameNS(W_NS, W.t).item(0) as Element;
    expect(leftText.textContent).toBe('ABCDE');
  });

  it('preserves rPr formatting in both halves', () => {
    const doc = makeDoc(
      '<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>HelloWorld</w:t></w:r></w:p>',
    );
    const r = doc.getElementsByTagNameNS(W_NS, W.r).item(0) as Element;

    const { left, right } = splitRunAtVisibleOffset(r, 5);

    const leftRPr = left.getElementsByTagNameNS(W_NS, W.rPr).item(0) as Element;
    const rightRPr = right.getElementsByTagNameNS(W_NS, W.rPr).item(0) as Element;
    expect(leftRPr).toBeTruthy();
    expect(rightRPr).toBeTruthy();
    expect(leftRPr.getElementsByTagNameNS(W_NS, W.b).length).toBe(1);
    expect(rightRPr.getElementsByTagNameNS(W_NS, W.b).length).toBe(1);
  });
});

// ── replaceParagraphTextRange ───────────────────────────────────────

describe('replaceParagraphTextRange', () => {
  it('replaces within a single run', () => {
    const doc = makeDoc('<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>');
    const p = firstParagraph(doc);

    replaceParagraphTextRange(p, 0, 5, 'Goodbye');

    expect(getParagraphText(p)).toBe('Goodbye World');
  });

  it('replaces across multiple runs', () => {
    const doc = makeDoc(
      `<w:p>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r>` +
      `<w:r><w:rPr><w:i/></w:rPr><w:t> World</w:t></w:r>` +
      `</w:p>`,
    );
    const p = firstParagraph(doc);

    replaceParagraphTextRange(p, 3, 8, 'X');

    expect(getParagraphText(p)).toBe('HelXrld');
  });

  it('preserves formatting from template run', () => {
    const doc = makeDoc(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold Text</w:t></w:r></w:p>',
    );
    const p = firstParagraph(doc);

    replaceParagraphTextRange(p, 5, 9, 'Repl');

    expect(getParagraphText(p)).toBe('Bold Repl');
    const serialized = p.toString();
    // The replacement run should inherit bold formatting
    expect(serialized).toContain('<w:b');
  });

  it('handles replacement with tabs and breaks', () => {
    const doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
    const p = firstParagraph(doc);

    replaceParagraphTextRange(p, 0, 5, 'A\tB\nC');

    expect(getParagraphText(p)).toBe('A\tB\nC');
  });

  it('handles replacement with ReplacementPart array', () => {
    const doc = makeDoc('<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>');
    const p = firstParagraph(doc);

    replaceParagraphTextRange(p, 0, 11, [
      { text: 'Part1', addRunProps: { bold: true } },
      { text: 'Part2', addRunProps: { italic: true } },
    ]);

    expect(getParagraphText(p)).toBe('Part1Part2');
  });

  it('throws on invalid range (start > end)', () => {
    const doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
    const p = firstParagraph(doc);

    expect(() => replaceParagraphTextRange(p, 5, 3, 'bad')).toThrow(/Invalid range/);
  });

  it('throws on out-of-bounds range', () => {
    const doc = makeDoc('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
    const p = firstParagraph(doc);

    expect(() => replaceParagraphTextRange(p, 0, 100, 'bad')).toThrow(/Invalid range/);
  });

  it('throws UNSUPPORTED_EDIT for multi-run edit crossing field results', () => {
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
    const p = firstParagraph(doc);

    try {
      replaceParagraphTextRange(p, 0, 14, 'Updated');
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SafeDocxError);
      expect((e as SafeDocxError).code).toBe('UNSUPPORTED_EDIT');
    }
  });

  it('single-run field result edit is allowed', () => {
    const doc = makeDoc(
      `<w:p>` +
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText>REF X</w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
      `<w:r><w:t>Visible</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
      `</w:p>`,
    );
    const p = firstParagraph(doc);

    // Single-run edit within a field result should work
    replaceParagraphTextRange(p, 0, 7, 'Changed');
    expect(getParagraphText(p)).toBe('Changed');
  });

  it('handles empty replacement (deletion)', () => {
    const doc = makeDoc('<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>');
    const p = firstParagraph(doc);

    replaceParagraphTextRange(p, 5, 11, '');

    expect(getParagraphText(p)).toBe('Hello');
  });

  it('handles replacement at start of paragraph', () => {
    const doc = makeDoc('<w:p><w:r><w:t>ABCDE</w:t></w:r></w:p>');
    const p = firstParagraph(doc);

    replaceParagraphTextRange(p, 0, 3, 'XY');

    expect(getParagraphText(p)).toBe('XYDE');
  });

  it('handles replacement at end of paragraph', () => {
    const doc = makeDoc('<w:p><w:r><w:t>ABCDE</w:t></w:r></w:p>');
    const p = firstParagraph(doc);

    replaceParagraphTextRange(p, 3, 5, 'XYZ');

    expect(getParagraphText(p)).toBe('ABCXYZ');
  });
});

// ── findOffsetInRuns (indirect via replaceParagraphTextRange) ────────

describe('findOffsetInRuns (via replaceParagraphTextRange)', () => {
  it('maps offset across multiple runs correctly', () => {
    const doc = makeDoc(
      `<w:p>` +
      `<w:r><w:t>AB</w:t></w:r>` +
      `<w:r><w:t>CD</w:t></w:r>` +
      `<w:r><w:t>EF</w:t></w:r>` +
      `</w:p>`,
    );
    const p = firstParagraph(doc);

    // Replace "CD" (offset 2-4)
    replaceParagraphTextRange(p, 2, 4, 'XX');
    expect(getParagraphText(p)).toBe('ABXXEF');
  });

  it('handles offset at run boundaries', () => {
    const doc = makeDoc(
      `<w:p>` +
      `<w:r><w:t>AB</w:t></w:r>` +
      `<w:r><w:t>CD</w:t></w:r>` +
      `</w:p>`,
    );
    const p = firstParagraph(doc);

    // Replace starting exactly at run boundary
    replaceParagraphTextRange(p, 2, 4, 'YY');
    expect(getParagraphText(p)).toBe('ABYY');
  });
});
