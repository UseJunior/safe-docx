import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { parseXml } from './xml.js';
import { OOXML, W } from './namespaces.js';
import { buildParagraphIndex } from './paragraph-index.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Paragraph Index' });

function paragraph(xml: string): Element {
  const doc = parseXml(`<w:document xmlns:w="${OOXML.W_NS}"><w:body>${xml}</w:body></w:document>`);
  return doc.getElementsByTagNameNS(OOXML.W_NS, W.p).item(0) as Element;
}

describe('buildParagraphIndex', () => {
  test('uses one field-aware traversal for visible and structural coordinates', async ({ given, then }: AllureBddContext) => {
    let index: ReturnType<typeof buildParagraphIndex>;
    await given('fragmented text around a field and zero-width annotation nodes', () => {
      index = buildParagraphIndex(paragraph(
        `<w:p>` +
        `<w:bookmarkStart w:id="1" w:name="anchor"/>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:r><w:commentReference w:id="9"/></w:r>` +
        `<w:commentRangeStart w:id="1"/>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText> REF X </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/><w:t>B</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:commentRangeEnd w:id="1"/>` +
        `<w:r><w:footnoteReference w:id="2"/></w:r>` +
        `</w:p>`,
      ));
    });
    await then('visible text and every zero-width structural coordinate remain aligned', () => {
      expect(index.text).toBe('AB');
      expect(index.runs).toHaveLength(7);
      expect(index.runs.map((run) => run.runIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(index.nodes.find((node) => node.kind === 'comment-reference')?.visibleStart).toBe(1);
      expect(index.nodes.find((node) => node.kind === 'comment-range-start')?.visibleStart).toBe(1);
      expect(index.nodes.find((node) => node.kind === 'comment-range-end')?.visibleStart).toBe(2);
      expect(index.nodes.find((node) => node.kind === 'footnote-reference')?.visibleStart).toBe(2);
      expect(index.nodes.find((node) => node.kind === 'bookmark')?.visibleStart).toBe(0);
      expect(index.runs.find((run) => run.visibleText === 'B')?.fieldInstruction).toBe('REF X');
    });
  });

  test('does not descend into nested paragraphs', async ({ given, then }: AllureBddContext) => {
    let index: ReturnType<typeof buildParagraphIndex>;
    await given('a malformed nested paragraph beside ordinary text', () => {
      index = buildParagraphIndex(paragraph('<w:p><w:r><w:t>Outer</w:t></w:r><w:p><w:r><w:t>Inner</w:t></w:r></w:p></w:p>'));
    });
    await then('only the requested paragraph contributes coordinates', () => {
      expect(index.text).toBe('Outer');
      expect(index.runs).toHaveLength(1);
    });
  });

  test('keeps one coordinate space through revision, hyperlink, and content-control wrappers', async ({ given, then }: AllureBddContext) => {
    let index: ReturnType<typeof buildParagraphIndex>;
    await given('visible runs and a marker nested under common paragraph wrappers', () => {
      index = buildParagraphIndex(paragraph(
        `<w:p xmlns:r="${OOXML.R_NS}">` +
        `<w:ins w:id="1"><w:r><w:t>A</w:t></w:r></w:ins>` +
        `<w:hyperlink r:id="rId1"><w:r><w:t>B</w:t></w:r><w:commentRangeStart w:id="4"/></w:hyperlink>` +
        `<w:sdt><w:sdtContent><w:r><w:t>C</w:t></w:r></w:sdtContent></w:sdt>` +
        `<w:del w:id="2"><w:r><w:t>D</w:t></w:r></w:del>` +
        `</w:p>`,
      ));
    });
    await then('wrapper boundaries do not fork visible or structural accounting', () => {
      expect(index.text).toBe('ABCD');
      expect(index.runs.map((run) => [run.runIndex, run.visibleStart, run.visibleEnd])).toEqual([
        [0, 0, 1],
        [1, 1, 2],
        [2, 2, 3],
        [3, 3, 4],
      ]);
      const marker = index.nodes.find((node) => node.kind === 'comment-range-start');
      expect(marker?.visibleStart).toBe(2);
      expect(marker?.runIndex).toBeNull();
    });
  });
});
