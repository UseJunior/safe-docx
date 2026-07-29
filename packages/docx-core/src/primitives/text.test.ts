import { XMLSerializer } from '@xmldom/xmldom';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { parseXml } from './xml.js';
import { OOXML, W } from './namespaces.js';
import { SafeDocxError } from './errors.js';
import { createRevisionContext, createRevisionIdState } from './track-changes-emitter.js';
import { revisionEvidence, revisionEvidenceCases } from '../testing/revision-evidence.js';
import {
  fldChar,
  instrText,
  resultText,
} from '../testing/ooxml-fixtures.js';
import {
  getParagraphRuns,
  getParagraphText,
  splitRunAtVisibleOffset,
  replaceParagraphTextRange,
  visibleLengthForEl,
  getDirectContentElements,
} from './text.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Text Primitives' });
const paragraphDeletionTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
);

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

function paragraphAt(doc: Document, index: number): Element {
  const p = doc.getElementsByTagNameNS(W_NS, W.p).item(index);
  if (!p) throw new Error(`missing paragraph at index ${index}`);
  return p as Element;
}

function serialize(node: Node): string {
  return new XMLSerializer().serializeToString(node);
}

function getDirectElement(parent: Element, localName: string): Element | null {
  return Array.from(parent.childNodes).find(
    (child): child is Element =>
      child.nodeType === 1 &&
      (child as Element).namespaceURI === W_NS &&
      (child as Element).localName === localName,
  ) ?? null;
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

  test('restores the enclosing result identity after a nested field ends', async ({ given, then }: AllureBddContext) => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });
    let doc: Document;

    await given('an outer result containing a complete nested field', () => {
      doc = makeDoc(
        `<w:p>` +
        fldChar('begin') +
        instrText(' IF 1 = 1 ') +
        fldChar('separate') +
        resultText('Outer A') +
        fldChar('begin') +
        instrText(' REF X ') +
        fldChar('separate') +
        resultText('Inner') +
        fldChar('end') +
        resultText('Outer B') +
        fldChar('end') +
        `</w:p>`,
      );
    });

    await then('the outer runs share an identity distinct from the nested result', () => {
      const runs = getParagraphRuns(firstParagraph(doc));
      expect(runs.map((run) => run.text)).toEqual(['Outer A', 'Inner', 'Outer B']);
      expect(runs[0]!.fieldResultId).toBe(runs[2]!.fieldResultId);
      expect(runs[1]!.fieldResultId).not.toBe(runs[0]!.fieldResultId);
      expect(runs.map((run) => run.fieldInstruction)).toEqual(['IF 1 = 1', 'REF X', 'IF 1 = 1']);
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

  test('edits a cached field result split across multiple runs', async ({ given, when, then }: AllureBddContext) => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });
    let p: Element;

    await given('a PAGEREF cached result split across two runs', () => {
      const doc = makeDoc(
        `<w:p>` +
        fldChar('begin') +
        instrText(' PAGEREF _Toc1 \\h ', { preserve: true }) +
        fldChar('separate') +
        resultText('1') +
        resultText('2') +
        fldChar('end') +
        `</w:p>`,
      );
      p = firstParagraph(doc);
    });

    await when('the entire cached result is replaced', () => {
      replaceParagraphTextRange(p, 0, 2, '13');
    });

    await then('the result changes while all complex-field markers remain', () => {
      expect(getParagraphText(p)).toBe('13');
      const fldChars = p.getElementsByTagNameNS(W_NS, W.fldChar);
      expect(fldChars).toHaveLength(3);
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

  test('maps a field-result edit correctly when it begins at a run boundary', async ({ given, when, then }: AllureBddContext) => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });
    let p: Element;

    await given('literal text immediately followed by a PAGEREF cached result', () => {
      const doc = makeDoc(
        `<w:p>` +
        resultText('Section One') +
        fldChar('begin') +
        instrText(' PAGEREF _Toc1 \\h ', { preserve: true }) +
        fldChar('separate') +
        resultText('8') +
        fldChar('end') +
        `</w:p>`,
      );
      p = firstParagraph(doc);
    });

    await when('the one-character cached result is replaced', () => {
      replaceParagraphTextRange(p, 11, 12, '9');
    });

    await then('only the cached result changes', () => {
      expect(getParagraphText(p)).toBe('Section One9');
      expect(p.getElementsByTagNameNS(W_NS, W.fldChar)).toHaveLength(3);
    });
  });

  test('refuses a replacement that crosses into a cached field result', async ({ given, when, then }: AllureBddContext) => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });
    let p: Element;

    await given('literal text immediately followed by a PAGEREF cached result', () => {
      const doc = makeDoc(
        `<w:p>` +
        resultText('One') +
        fldChar('begin') +
        instrText(' PAGEREF _Toc1 \\h ', { preserve: true }) +
        fldChar('separate') +
        resultText('8') +
        fldChar('end') +
        `</w:p>`,
      );
      p = firstParagraph(doc);
    });

    await when('a raw primitive replacement crosses the field boundary', () => {
      // captured for assertion
    });

    await then('the error identifies the PAGEREF result boundary', () => {
      expect(() => replaceParagraphTextRange(p, 0, 4, 'One9')).toThrowError(
        expect.objectContaining({
          code: 'UNSUPPORTED_EDIT',
          message: expect.stringContaining('PAGEREF field result'),
        }),
      );
    });
  });

  test('refuses a cached-result edit when its separator shares the visible run', async ({ given, when, then }: AllureBddContext) => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });
    let p: Element;

    await given('literal text, a complete field, and its cached result serialized in one run', () => {
      const doc = makeDoc(
        `<w:p>` +
        `<w:r>` +
        `<w:t>Outside</w:t>` +
        `<w:fldChar w:fldCharType="begin"/>` +
        `<w:instrText> REF X </w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/>` +
        `<w:t>Visible</w:t>` +
        `<w:fldChar w:fldCharType="end"/>` +
        `</w:r>` +
        `</w:p>`,
      );
      p = firstParagraph(doc);
    });

    await when('replacement would remove the run that owns the separator', () => {
      // captured for assertion
    });

    await then('the primitive fails closed instead of deleting the separator', () => {
      expect(() => replaceParagraphTextRange(p, 0, 14, 'Changed')).toThrowError(
        expect.objectContaining({ code: 'UNSUPPORTED_EDIT' }),
      );
      expect(p.getElementsByTagNameNS(W_NS, W.fldChar)).toHaveLength(3);
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

describe('replaceParagraphTextRange tracked-change emission', () => {
  test('emits one insertion and one deletion wrapper for a tracked replacement', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let serialized: string;

    await given('a paragraph and a shared revision context', () => {
      const doc = makeDoc('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
      p = firstParagraph(doc);
    });

    await when('the first word is replaced under tracked-change emission', () => {
      replaceParagraphTextRange(
        p,
        0,
        5,
        'NEW',
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-03T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
      serialized = serialize(p);
    });

    await then('exactly one insertion and one deletion wrapper are emitted with revision metadata', () => {
      const insertions = Array.from(p.getElementsByTagNameNS(W_NS, 'ins'));
      const deletions = Array.from(p.getElementsByTagNameNS(W_NS, 'del'));
      expect(insertions).toHaveLength(1);
      expect(deletions).toHaveLength(1);

      const insertion = insertions[0]!;
      const deletion = deletions[0]!;
      expect(insertion.getAttribute('w:id')).toBeTruthy();
      expect(insertion.getAttribute('w:author')).toBe('SafeDocX AI');
      expect(insertion.getAttribute('w:date')).toBe('2026-05-03T14:15:16Z');
      expect(deletion.getAttribute('w:id')).toBeTruthy();
      expect(deletion.getAttribute('w:author')).toBe('SafeDocX AI');
      expect(deletion.getAttribute('w:date')).toBe('2026-05-03T14:15:16Z');
      expect(serialized).toContain('<w:ins ');
      expect(serialized).toContain('<w:del ');
      expect(serialized).toContain('<w:r><w:t>NEW</w:t></w:r>');
      expect(deletion.getElementsByTagNameNS(W_NS, 'delText')).toHaveLength(1);
      expect(deletion.getElementsByTagNameNS(W_NS, W.t)).toHaveLength(0);
    });
  });

  test('emits only an insertion wrapper for pure tracked insertion', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph containing "HelloWorld"', () => {
      const doc = makeDoc('<w:p><w:r><w:t>HelloWorld</w:t></w:r></w:p>');
      p = firstParagraph(doc);
    });

    await when('text is inserted at a zero-length range under tracked changes', () => {
      replaceParagraphTextRange(
        p,
        5,
        5,
        'NEW',
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-03T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
    });

    await then('only one insertion wrapper is emitted', () => {
      expect(getParagraphText(p)).toBe('HelloNEWWorld');
      expect(p.getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(1);
      expect(p.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(0);
    });
  });

  test('emits only a deletion wrapper for pure tracked deletion', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph containing "Hello world"', () => {
      const doc = makeDoc('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
      p = firstParagraph(doc);
    });

    await when('text is deleted with an empty replacement under tracked changes', () => {
      replaceParagraphTextRange(
        p,
        0,
        5,
        '',
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-03T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
    });

    await then('only one deletion wrapper is emitted', () => {
      expect(getParagraphText(p)).toBe(' world');
      expect(p.getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(0);
      expect(p.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(1);
    });
  });

  paragraphDeletionTest('marks the paragraph mark deleted when a tracked replacement empties the paragraph', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let p: Element;

    await given('a numbered paragraph whose entire visible text will be deleted', () => {
      const doc = makeDoc(
        '<w:p>' +
          '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr>' +
          '<w:r><w:t>Delete this item</w:t></w:r>' +
        '</w:p>',
      );
      p = firstParagraph(doc);
    });

    await when('the complete text range is replaced with an empty string under tracked changes', () => {
      replaceParagraphTextRange(
        p,
        0,
        'Delete this item'.length,
        '',
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-07-29T12:00:00Z',
          idState: createRevisionIdState(),
        }),
      );
    });

    await then('the content and paragraph mark carry separate deletion revisions', () => {
      const pPr = getDirectElement(p, W.pPr);
      const paragraphRPr = getDirectElement(pPr!, W.rPr);
      const paragraphMarkDeletion = getDirectElement(paragraphRPr!, 'del');
      const runDeletion = Array.from(p.childNodes).find(
        (child): child is Element =>
          child.nodeType === 1 &&
          (child as Element).namespaceURI === W_NS &&
          (child as Element).localName === 'del',
      );

      expect(runDeletion).toBeTruthy();
      expect(paragraphMarkDeletion).toBeTruthy();
      expect(paragraphMarkDeletion?.getAttribute('w:author')).toBe('SafeDocX AI');
      expect(paragraphMarkDeletion?.getAttribute('w:id')).not.toBe(runDeletion?.getAttribute('w:id'));
      expect(getDirectElement(pPr!, W.numPr)).toBeTruthy();
    });
  });

  test('does not emit rPrChange when explicit replacement formatting leaves run properties unchanged', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph whose source run is already bold', () => {
      const doc = makeDoc(
        '<w:p><w:r><w:rPr><w:b w:val="1"/></w:rPr><w:t>Hello</w:t></w:r></w:p>',
      );
      p = firstParagraph(doc);
    });

    await when('the replacement explicitly asks for the same bold formatting', () => {
      replaceParagraphTextRange(
        p,
        0,
        5,
        [{ text: 'New', addRunProps: { bold: true } }],
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-03T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
    });

    await then('tracked insertion and deletion are emitted without a property-change record', () => {
      expect(p.getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(1);
      expect(p.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(1);
      expect(p.getElementsByTagNameNS(W_NS, 'rPrChange')).toHaveLength(0);
    });
  });

  test('[ADV-RPR-EMISSION-01] emits rPrChange with the prior run properties when replacement formatting changes', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let p: Element;
    let rPrChange: Element;

    await given('a paragraph whose source run is italic', () => {
      const doc = makeDoc(
        '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Hello</w:t></w:r></w:p>',
      );
      p = firstParagraph(doc);
    });

    await when('the replacement adds bold formatting under tracked changes', () => {
      replaceParagraphTextRange(
        p,
        0,
        5,
        [{ text: 'New', addRunProps: { bold: true } }],
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-03T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
      rPrChange = p.getElementsByTagNameNS(W_NS, 'rPrChange').item(0) as Element;
    });

    await then('the inserted run records the previous italic rPr inside w:rPrChange', () => {
      expect(p.getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(1);
      expect(p.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(1);
      expect(p.getElementsByTagNameNS(W_NS, 'rPrChange')).toHaveLength(1);
      expect(rPrChange.getAttribute('w:id')).toBeTruthy();
      expect(rPrChange.getAttribute('w:author')).toBe('SafeDocX AI');
      expect(rPrChange.getAttribute('w:date')).toBe('2026-05-03T14:15:16Z');

      const previousRPr = rPrChange.getElementsByTagNameNS(W_NS, W.rPr).item(0) as Element;
      expect(previousRPr).toBeTruthy();
      expect(previousRPr.getElementsByTagNameNS(W_NS, W.i)).toHaveLength(1);
      expect(previousRPr.getElementsByTagNameNS(W_NS, W.b)).toHaveLength(0);

      const insertedRun = p.getElementsByTagNameNS(W_NS, 'ins').item(0)!.getElementsByTagNameNS(W_NS, W.r).item(0)!;
      expect(insertedRun.getElementsByTagNameNS(W_NS, W.b)).toHaveLength(1);
    });
    await revisionEvidence('ADV-RPR-EMISSION-01', revisionEvidenceCases({
      elements: ['rPrChange'], operations: ['emit'], story: 'main',
      buildFixture: () => ({ tracked: true, priorItalic: true }),
      run: (fixture) => {
        const input = makeDoc(`<w:p><w:r><w:rPr>${fixture.priorItalic ? '<w:i/>' : '<w:u w:val="single"/>'}</w:rPr><w:t>Hello</w:t></w:r></w:p>`);
        const paragraph = firstParagraph(input);
        replaceParagraphTextRange(
          paragraph,
          0,
          5,
          [{ text: 'New', addRunProps: { bold: true } }],
          fixture.tracked ? createRevisionContext({ author: 'SafeDocX AI', date: '2026-05-03T14:15:16Z', idState: createRevisionIdState() }) : undefined,
        );
        return paragraph;
      },
      observe: (output) => {
        const change = output.getElementsByTagNameNS(W_NS, 'rPrChange').item(0);
        return change?.getAttributeNS(W_NS, 'author') === 'SafeDocX AI' &&
          change.getElementsByTagNameNS(W_NS, W.i).length === 1;
      },
      mutations: () => [
        { name: 'remove-target', apply: (fixture, context) => ({ fixture: { ...fixture, tracked: false }, context }) },
        { name: 'corrupt-target', apply: (fixture, context) => ({ fixture: { ...fixture, priorItalic: false }, context }) },
      ],
    }));
  });

  test('does not emit rPrChange when source rPr only differs by pretty-printing whitespace', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph whose source rPr is pretty-printed with whitespace text nodes', () => {
      const doc = makeDoc(
        '<w:p><w:r><w:rPr>\n  <w:b w:val="1"/>\n</w:rPr><w:t>Hello</w:t></w:r></w:p>',
      );
      p = firstParagraph(doc);
    });

    await when('the replacement re-asserts the existing bold formatting', () => {
      replaceParagraphTextRange(
        p,
        0,
        5,
        [{ text: 'New', addRunProps: { bold: true } }],
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-03T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
    });

    await then('insignificant whitespace is ignored and no rPrChange is emitted', () => {
      expect(p.getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(1);
      expect(p.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(1);
      expect(p.getElementsByTagNameNS(W_NS, 'rPrChange')).toHaveLength(0);
    });
  });

  test('does not emit rPrChange when toggle properties differ only by ST_OnOff canonical form', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let p: Element;

    await given('a paragraph whose source bold toggle has no explicit w:val', () => {
      const doc = makeDoc('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r></w:p>');
      p = firstParagraph(doc);
    });

    await when('the replacement asks for the same bold formatting (which normalizes to w:val="1")', () => {
      replaceParagraphTextRange(
        p,
        0,
        5,
        [{ text: 'New', addRunProps: { bold: true } }],
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-03T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
    });

    await then('absent w:val and w:val="1" are treated as equal and no rPrChange is emitted', () => {
      expect(p.getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(1);
      expect(p.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(1);
      expect(p.getElementsByTagNameNS(W_NS, 'rPrChange')).toHaveLength(0);
    });
  });

  test('emits rPrChange when clearHighlight removes a highlight from the source rPr', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let p: Element;
    let rPrChange: Element;

    await given('a paragraph whose source run carries a yellow highlight', () => {
      const doc = makeDoc(
        '<w:p><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>Hello</w:t></w:r></w:p>',
      );
      p = firstParagraph(doc);
    });

    await when('the replacement clears the highlight under tracked changes', () => {
      replaceParagraphTextRange(
        p,
        0,
        5,
        [{ text: 'New', clearHighlight: true }],
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-03T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
      rPrChange = p.getElementsByTagNameNS(W_NS, 'rPrChange').item(0) as Element;
    });

    await then('the inserted run records the previous highlight inside w:rPrChange', () => {
      expect(p.getElementsByTagNameNS(W_NS, 'rPrChange')).toHaveLength(1);
      const previousRPr = rPrChange.getElementsByTagNameNS(W_NS, W.rPr).item(0) as Element;
      expect(previousRPr).toBeTruthy();
      expect(previousRPr.getElementsByTagNameNS(W_NS, W.highlight)).toHaveLength(1);
    });
  });

  test('multi-run deletion snapshots the chosen template run rPr in rPrChange', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let p: Element;
    let rPrChange: Element;

    await given('a paragraph that spans an italic run followed by a bold run', () => {
      const doc = makeDoc(
        '<w:p>' +
          '<w:r><w:rPr><w:i/></w:rPr><w:t>Hello </w:t></w:r>' +
          '<w:r><w:rPr><w:b/></w:rPr><w:t>World</w:t></w:r>' +
        '</w:p>',
      );
      p = firstParagraph(doc);
    });

    await when('a single replacement part covers the full span and requests bold', () => {
      replaceParagraphTextRange(
        p,
        0,
        11,
        [{ text: 'New', addRunProps: { bold: true } }],
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-03T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
      rPrChange = p.getElementsByTagNameNS(W_NS, 'rPrChange').item(0) as Element;
    });

    await then('the rPrChange records the predominant-template prior rPr (italic) and the deleted runs preserve full per-run formatting', () => {
      expect(p.getElementsByTagNameNS(W_NS, 'rPrChange')).toHaveLength(1);
      const previousRPr = rPrChange.getElementsByTagNameNS(W_NS, W.rPr).item(0) as Element;
      expect(previousRPr.getElementsByTagNameNS(W_NS, W.i)).toHaveLength(1);
      expect(previousRPr.getElementsByTagNameNS(W_NS, W.b)).toHaveLength(0);

      const deletion = p.getElementsByTagNameNS(W_NS, 'del').item(0)!;
      const deletedRuns = deletion.getElementsByTagNameNS(W_NS, W.r);
      expect(deletedRuns).toHaveLength(2);
      expect(deletedRuns.item(0)!.getElementsByTagNameNS(W_NS, W.i)).toHaveLength(1);
      expect(deletedRuns.item(1)!.getElementsByTagNameNS(W_NS, W.b)).toHaveLength(1);
    });
  });

  test('preserves per-run formatting inside tracked deletions spanning multiple runs', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let deletion: Element;

    await given('a paragraph with bold, plain, and italic runs', () => {
      const doc = makeDoc(
        `<w:p>` +
          `<w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r>` +
          `<w:r><w:t> </w:t></w:r>` +
          `<w:r><w:rPr><w:i/></w:rPr><w:t>world</w:t></w:r>` +
        `</w:p>`,
      );
      p = firstParagraph(doc);
    });

    await when('the full span is replaced under tracked changes', () => {
      replaceParagraphTextRange(
        p,
        0,
        11,
        'New text',
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-03T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
      deletion = p.getElementsByTagNameNS(W_NS, 'del').item(0) as Element;
    });

    await then('the deletion wrapper keeps the original three runs and their run properties', () => {
      const deletedRuns = Array.from(deletion.getElementsByTagNameNS(W_NS, W.r));
      expect(deletedRuns).toHaveLength(3);
      expect(deletedRuns[0]!.getElementsByTagNameNS(W_NS, W.b)).toHaveLength(1);
      expect(deletedRuns[1]!.getElementsByTagNameNS(W_NS, W.rPr)).toHaveLength(0);
      expect(deletedRuns[2]!.getElementsByTagNameNS(W_NS, W.i)).toHaveLength(1);
      expect(Array.from(deletion.getElementsByTagNameNS(W_NS, 'delText')).map((el) => el.textContent)).toEqual([
        'Hello',
        ' ',
        'world',
      ]);
    });
  });

  test('preserves run formatting on partial-run tracked deletion (split path)', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let deletion: Element;

    await given('a paragraph with a single bold run carrying "HelloWorld"', () => {
      const doc = makeDoc(
        `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>HelloWorld</w:t></w:r></w:p>`,
      );
      p = firstParagraph(doc);
    });

    await when('a tracked replacement targets the middle slice [2, 8) — splitting the run', () => {
      replaceParagraphTextRange(
        p,
        2,
        8,
        'X',
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-03T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
      deletion = p.getElementsByTagNameNS(W_NS, 'del').item(0) as Element;
    });

    await then('the deletion fragment retains the bold rPr from the original run', () => {
      const deletedRuns = Array.from(deletion.getElementsByTagNameNS(W_NS, W.r));
      expect(deletedRuns).toHaveLength(1);
      expect(deletedRuns[0]!.getElementsByTagNameNS(W_NS, W.b)).toHaveLength(1);
      expect(Array.from(deletion.getElementsByTagNameNS(W_NS, 'delText')).map((el) => el.textContent)).toEqual([
        'lloWor',
      ]);
      expect(getParagraphText(p)).toBe('HeXld');
    });
  });

  test('preserves legacy untracked behavior when revision context is omitted', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let serialized: string;

    await given('a paragraph containing "Hello world"', () => {
      const doc = makeDoc('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
      p = firstParagraph(doc);
    });

    await when('the first word is replaced without a revision context', () => {
      replaceParagraphTextRange(p, 0, 5, 'NEW');
      serialized = serialize(p);
    });

    await then('the edit stays untracked and the visible text still changes', () => {
      expect(getParagraphText(p)).toBe('NEW world');
      expect(p.getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(0);
      expect(p.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(0);
      expect(serialized).not.toContain('<w:ins');
      expect(serialized).not.toContain('<w:del');
    });
  });

  test('allocates unique revision IDs across multiple tracked replacements in one document', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let ids: number[];

    await given('a document with two editable paragraphs and a shared revision state', () => {
      doc = makeDoc(
        `<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>` +
          `<w:p><w:r><w:t>Second line</w:t></w:r></w:p>`,
      );
      ids = [];
    });

    await when('two tracked replacements are applied with the same revision context', () => {
      const ctx = createRevisionContext({
        author: 'SafeDocX AI',
        date: '2026-05-03T14:15:16Z',
        idState: createRevisionIdState(),
      });

      replaceParagraphTextRange(paragraphAt(doc, 0), 0, 5, 'NEW', ctx);
      replaceParagraphTextRange(paragraphAt(doc, 1), 0, 6, 'Other', ctx);

      ids = [
        ...Array.from(doc.getElementsByTagNameNS(W_NS, 'ins')),
        ...Array.from(doc.getElementsByTagNameNS(W_NS, 'del')),
      ].map((el) => Number(el.getAttribute('w:id')));
    });

    await then('all emitted insertion and deletion IDs are distinct', () => {
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);
      expect(ids.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    });
  });

  test('allows a tracked edit wholly inside an anchored hyperlink', async ({ given, when, then, and }: AllureBddContext) => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.22' });
    let p: Element;

    await given('literal text followed by a one-run anchored hyperlink and more literal text', () => {
      const doc = makeDoc(
        `<w:p>` +
          `<w:r><w:t xml:space="preserve">See Section </w:t></w:r>` +
          `<w:hyperlink w:anchor="_Ref1"><w:r><w:t>4.2(b)(ix)</w:t></w:r></w:hyperlink>` +
          `<w:r><w:t xml:space="preserve"> for details.</w:t></w:r>` +
        `</w:p>`,
      );
      p = firstParagraph(doc);
    });

    await when('the complete visible hyperlink text is replaced with tracked changes', () => {
      replaceParagraphTextRange(
        p,
        12,
        22,
        '4.2(b)(xii)',
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-07-27T12:00:00Z',
          idState: createRevisionIdState(),
        }),
      );
    });

    await then('the visible paragraph contains the replacement', () => {
      expect(getParagraphText(p)).toBe('See Section 4.2(b)(xii) for details.');
    });

    await and('the tracked deletion and insertion stay inside the original hyperlink', () => {
      const hyperlink = p.getElementsByTagNameNS(W_NS, W.hyperlink).item(0) as Element;
      expect(hyperlink.getAttributeNS(W_NS, 'anchor')).toBe('_Ref1');
      expect(hyperlink.getElementsByTagNameNS(W_NS, W.del)).toHaveLength(1);
      expect(hyperlink.getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(1);
      expect(p.childNodes.item(1)).toBe(hyperlink);
    });
  });

  test('localizes UNSAFE_CONTAINER_BOUNDARY refusal before mutating the paragraph', async ({ given, when, then, and }: AllureBddContext) => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.22' });
    let p: Element;
    let beforeXml: string;
    let error: SafeDocxError | null = null;

    await given('a paragraph whose visible range spans from a hyperlink into plain paragraph content', () => {
      const doc = makeDoc(
        `<w:p>` +
          `<w:hyperlink r:id="rId5"><w:r><w:t>Hello</w:t></w:r></w:hyperlink>` +
          `<w:r><w:t> world</w:t></w:r>` +
        `</w:p>`,
      );
      p = firstParagraph(doc);
      beforeXml = serialize(p);
    });

    await when('a tracked replacement crosses the hyperlink boundary', () => {
      try {
        replaceParagraphTextRange(
          p,
          0,
          6,
          'NEW',
          createRevisionContext({
            author: 'SafeDocX AI',
            date: '2026-05-03T14:15:16Z',
            idState: createRevisionIdState(),
          }),
        );
      } catch (caught) {
        if (!(caught instanceof SafeDocxError)) throw caught;
        error = caught;
      }
    });

    await then('the error identifies the range, boundary, containers, and largest safe sub-span', () => {
      expect(error?.code).toBe('UNSAFE_CONTAINER_BOUNDARY');
      expect(error?.message).toContain('range [0, 6)');
      expect(error?.message).toContain('at offset 5');
      expect(error?.message).toContain('(w:hyperlink → w:p)');
      expect(error?.message).toContain('[0, 5) in w:hyperlink, "Hello"');
      expect(error?.hint).toContain('each side of offset 5');
    });

    await and('the refusal leaves the paragraph XML byte-for-byte unchanged', () => {
      expect(serialize(p)).toBe(beforeXml);
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
