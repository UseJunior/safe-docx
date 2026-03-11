import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML, W } from '../src/primitives/namespaces.js';
import { SafeDocxError } from '../src/primitives/errors.js';
import { getParagraphRuns, getParagraphText, replaceParagraphTextRange } from '../src/primitives/text.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Text Primitives' });

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${OOXML.W_NS}" xmlns:r="${OOXML.R_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

function firstParagraph(doc: Document): Element {
  const p = doc.getElementsByTagNameNS(OOXML.W_NS, W.p).item(0);
  if (!p) throw new Error('missing paragraph');
  return p;
}

describe('text primitives', () => {
  test('extracts paragraph runs and tracks field-result visibility', async ({ given, when, then, and }: AllureBddContext) => {
    let doc!: Document;
    let runs!: ReturnType<typeof getParagraphRuns>;
    await given('a paragraph with a REF field, field result runs, and a tail run', async () => {
      doc = makeDoc(
        `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>REF Clause_1</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/><w:t>Visible</w:t></w:r>` +
        `<w:r><w:t> Result</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t> tail</w:t><w:tab/><w:br/></w:r>` +
        `</w:p>`
      );
    });
    await when('getParagraphRuns is called on the paragraph', async () => {
      runs = getParagraphRuns(firstParagraph(doc));
    });
    await then('visible run texts are Visible, space-Result, and tail with tab and newline', () => {
      expect(runs.map((r) => r.text)).toEqual(['Visible', ' Result', ' tail\t\n']);
    });
    await and('field result flags are true for the first two runs and false for the tail', () => {
      expect(runs.map((r) => r.isFieldResult)).toEqual([true, true, false]);
    });
    await and('getParagraphText returns the concatenated visible text', () => {
      expect(getParagraphText(firstParagraph(doc))).toBe('Visible Result tail\t\n');
    });
  });

  test('replaces a cross-run range and applies additive run props', async ({ given, when, then, and }: AllureBddContext) => {
    let p!: Element;
    await given('a paragraph with a bold run Hello and an italic run space-world', async () => {
      const doc = makeDoc(
        `<w:p>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r>` +
        `<w:r><w:rPr><w:i/></w:rPr><w:t> world</w:t></w:r>` +
        `</w:p>`
      );
      p = firstParagraph(doc);
    });
    await when('replaceParagraphTextRange replaces chars 3-8 with X-tab-Y plus underline and highlight', async () => {
      replaceParagraphTextRange(p, 3, 8, [
        {
          text: 'X\tY',
          addRunProps: { underline: true, highlight: true },
        },
      ]);
    });
    await then('paragraph text is HelX-tab-Yrld', () => {
      expect(getParagraphText(p)).toBe('HelX\tYrld');
    });
    await and('the XML contains underline and highlight run properties', () => {
      const xml = p.toString();
      expect(xml).toContain('<w:u w:val="single"/>');
      expect(xml).toContain('<w:highlight w:val="yellow"/>');
    });
  });

  test('throws UNSUPPORTED_EDIT when a multi-run edit intersects field results', async ({ given, when, then, and }: AllureBddContext) => {
    let p!: Element;
    await given('a paragraph whose only visible text spans field result runs', async () => {
      const doc = makeDoc(
        `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>REF X</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/><w:t>Visible</w:t></w:r>` +
        `<w:r><w:t> Result</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
      );
      p = firstParagraph(doc);
    });
    await when('replaceParagraphTextRange is called spanning field result runs', async () => {});
    await then('it throws a SafeDocxError', () => {
      expect(() => replaceParagraphTextRange(p, 0, 13, 'Updated')).toThrowError(SafeDocxError);
    });
    await and('the error code is UNSUPPORTED_EDIT', () => {
      try {
        replaceParagraphTextRange(p, 0, 13, 'Updated');
      } catch (e: unknown) {
        if (!(e instanceof SafeDocxError)) throw e;
        expect(e.code).toBe('UNSUPPORTED_EDIT');
      }
    });
  });

  test('throws UNSAFE_CONTAINER_BOUNDARY when replacement spans different run containers', async ({ given, when, then, and }: AllureBddContext) => {
    let p!: Element;
    await given('a paragraph with a hyperlink run followed by a plain run', async () => {
      const doc = makeDoc(
        `<w:p>` +
        `<w:hyperlink r:id="rId1"><w:r><w:t>Link</w:t></w:r></w:hyperlink>` +
        `<w:r><w:t>Tail</w:t></w:r>` +
        `</w:p>`
      );
      p = firstParagraph(doc);
    });
    await when('replaceParagraphTextRange is called spanning the hyperlink boundary', async () => {});
    await then('it throws a SafeDocxError', () => {
      expect(() => replaceParagraphTextRange(p, 2, 6, 'Changed')).toThrowError(SafeDocxError);
    });
    await and('the error code is UNSAFE_CONTAINER_BOUNDARY', () => {
      try {
        replaceParagraphTextRange(p, 2, 6, 'Changed');
      } catch (e: unknown) {
        if (!(e instanceof SafeDocxError)) throw e;
        expect(e.code).toBe('UNSAFE_CONTAINER_BOUNDARY');
      }
    });
  });
});
