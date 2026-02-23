import { describe, expect } from 'vitest';
import { itAllure as it } from '../test/helpers/allure-test.js';
import { parseXml } from './xml.js';
import { OOXML, W } from './namespaces.js';
import { SafeDocxError } from './errors.js';
import { getParagraphRuns, getParagraphText, replaceParagraphTextRange } from './text.js';

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
  it('extracts paragraph runs and tracks field-result visibility', () => {
    const doc = makeDoc(
      `<w:p>` +
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText>REF Clause_1</w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/><w:t>Visible</w:t></w:r>` +
      `<w:r><w:t> Result</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
      `<w:r><w:t> tail</w:t><w:tab/><w:br/></w:r>` +
      `</w:p>`
    );

    const runs = getParagraphRuns(firstParagraph(doc));
    expect(runs.map((r) => r.text)).toEqual(['Visible', ' Result', ' tail\t\n']);
    expect(runs.map((r) => r.isFieldResult)).toEqual([true, true, false]);
    expect(getParagraphText(firstParagraph(doc))).toBe('Visible Result tail\t\n');
  });

  it('replaces a cross-run range and applies additive run props', () => {
    const doc = makeDoc(
      `<w:p>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r>` +
      `<w:r><w:rPr><w:i/></w:rPr><w:t> world</w:t></w:r>` +
      `</w:p>`
    );
    const p = firstParagraph(doc);

    replaceParagraphTextRange(p, 3, 8, [
      {
        text: 'X\tY',
        addRunProps: { underline: true, highlight: true },
      },
    ]);

    expect(getParagraphText(p)).toBe('HelX\tYrld');
    const xml = p.toString();
    expect(xml).toContain('<w:u w:val="single"/>');
    expect(xml).toContain('<w:highlight w:val="yellow"/>');
  });

  it('throws UNSUPPORTED_EDIT when a multi-run edit intersects field results', () => {
    const doc = makeDoc(
      `<w:p>` +
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText>REF X</w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/><w:t>Visible</w:t></w:r>` +
      `<w:r><w:t> Result</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
      `</w:p>`
    );
    const p = firstParagraph(doc);

    expect(() => replaceParagraphTextRange(p, 0, 13, 'Updated')).toThrowError(SafeDocxError);
    try {
      replaceParagraphTextRange(p, 0, 13, 'Updated');
    } catch (e: unknown) {
      if (!(e instanceof SafeDocxError)) throw e;
      expect(e.code).toBe('UNSUPPORTED_EDIT');
    }
  });

  it('throws UNSAFE_CONTAINER_BOUNDARY when replacement spans different run containers', () => {
    const doc = makeDoc(
      `<w:p>` +
      `<w:hyperlink r:id="rId1"><w:r><w:t>Link</w:t></w:r></w:hyperlink>` +
      `<w:r><w:t>Tail</w:t></w:r>` +
      `</w:p>`
    );
    const p = firstParagraph(doc);

    expect(() => replaceParagraphTextRange(p, 2, 6, 'Changed')).toThrowError(SafeDocxError);
    try {
      replaceParagraphTextRange(p, 2, 6, 'Changed');
    } catch (e: unknown) {
      if (!(e instanceof SafeDocxError)) throw e;
      expect(e.code).toBe('UNSAFE_CONTAINER_BOUNDARY');
    }
  });
});
