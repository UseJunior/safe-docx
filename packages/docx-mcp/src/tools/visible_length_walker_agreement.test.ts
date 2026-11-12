import { expect } from 'vitest';
import {
  addFootnote,
  bootstrapFootnoteParts,
  buildParagraphIndex,
  DocxZip,
  extractTables,
  getComments,
  getDirectContentElements,
  getFootnoteMarkersForParagraph,
  getParagraphRuns,
  getParagraphText,
  OOXML,
  parseXml,
  visibleLengthForEl,
} from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { buildParagraphRunLengths } from './read_file.js';

// Core's test fixtures are excluded from its published build. Resolve the
// source at test runtime so MCP's composite build does not require unpublished
// declarations; keep package shapes owned by the shared fixtures.
const { buildDocxFromBodyXml }: {
  buildDocxFromBodyXml(body: string): Promise<Buffer>;
} = await import(new URL('../../../docx-core/src/testing/ooxml-fixtures.ts', import.meta.url).href);

const test = testAllure.epic('Document Reading').withLabels({ feature: 'Paragraph Text Coordinates' });

/**
 * One paragraph whose runs mix w:t, w:tab and w:br — within a run and across
 * runs — with a comment range and a footnote reference between runs. It sits
 * in a table cell so table cell text is checked against the same paragraph.
 *
 * Raw text: "Alpha\tBe" (run 0, 8) + "ta\nGa" (run 2, 5) + footnote ref
 * (run 3, 0) + "\tmma\n" (run 4, 5) + comment ref (run 5, 0) + "Tail" (run 6, 4).
 * Run 1 holds nothing visible (an empty run between the comment start and
 * the text), so read_file's run list and the paragraph index both count it.
 *
 * The symbol variant adds a w:sym mid-run (after "ta") and a sym-only run
 * (after the footnote reference): each is one character (issue #1046).
 */
type AgreementFixture = {
  name: string;
  paragraphXml: string;
  text: string;
  runLengths: number[];
};

const SYM = '<w:sym w:font="Wingdings" w:char="F0A8"/>';
const GLYPH = '\uF0A8';

function paragraphXml(midRunSymbol: string, symbolRun: string): string {
  return '<w:p><w:bookmarkStart w:id="9" w:name="_bk_agree"/>' +
    '<w:r><w:t>Alpha</w:t><w:tab/><w:t>Be</w:t></w:r>' +
    '<w:commentRangeStart w:id="0"/>' +
    '<w:r><w:rPr><w:b/></w:rPr></w:r>' +
    `<w:r><w:t>ta</w:t>${midRunSymbol}<w:br/><w:t>Ga</w:t></w:r>` +
    '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="7"/></w:r>' +
    symbolRun +
    '<w:r><w:tab/><w:t>mma</w:t><w:br/></w:r>' +
    '<w:commentRangeEnd w:id="0"/>' +
    '<w:r><w:commentReference w:id="0"/></w:r>' +
    '<w:r><w:t>Tail</w:t></w:r>' +
    '<w:bookmarkEnd w:id="9"/></w:p>';
}

const FIXTURES: AgreementFixture[] = [
  {
    name: 'w:t, w:tab and w:br',
    paragraphXml: paragraphXml('', ''),
    text: 'Alpha\tBeta\nGa\tmma\nTail',
    runLengths: [8, 0, 5, 0, 5, 0, 4],
  },
  {
    name: 'w:t, w:tab, w:br and w:sym (mid-run and in its own run)',
    paragraphXml: paragraphXml(SYM, `<w:r><w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/></w:rPr>${SYM}</w:r>`),
    text: `Alpha\tBeta${GLYPH}\nGa${GLYPH}\tmma\nTail`,
    runLengths: [8, 0, 6, 0, 1, 5, 0, 4],
  },
];

const COMMENTS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${OOXML.W_NS}">` +
  '<w:comment w:id="0" w:author="Alice" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:comment>' +
  '</w:comments>';

async function openFixture(fixture: AgreementFixture): Promise<{ zip: DocxZip; documentXml: Document; paragraph: Element }> {
  const zip = await DocxZip.load(await buildDocxFromBodyXml(
    `<w:tbl><w:tr><w:tc>${fixture.paragraphXml}</w:tc></w:tr></w:tbl><w:p/>`,
  ));
  zip.writeText('word/comments.xml', COMMENTS_XML);
  const documentXml = parseXml(await zip.readText('word/document.xml'));
  const paragraph = documentXml.getElementsByTagNameNS(OOXML.W_NS, 'p').item(0) as Element;
  return { zip, documentXml, paragraph };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

for (const fixture of FIXTURES) {
  test(`paragraph text, run lengths, comment, footnote and table offsets agree on ${fixture.name}`, async () => {
    const { zip, documentXml, paragraph } = await openFixture(fixture);

    // The coordinate space itself.
    const text = getParagraphText(paragraph);
    expect(text).toBe(fixture.text);
    expect(getParagraphRuns(paragraph).map((run) => run.text).join('')).toBe(text);

    // read_file's per-run lengths (comment marker coordinates) match the
    // paragraph index run for run, and per-element lengths, and sum to the text.
    const readFileLengths = buildParagraphRunLengths([paragraph]).get('_bk_agree');
    const indexRuns = buildParagraphIndex(paragraph).runs;
    expect(readFileLengths).toEqual(fixture.runLengths);
    expect(indexRuns.map((run) => run.visibleText.length)).toEqual(readFileLengths);
    expect(indexRuns.map((run) =>
      sum(getDirectContentElements(run.element).map((el) => visibleLengthForEl(el))))).toEqual(readFileLengths);
    expect(sum(readFileLengths!)).toBe(text.length);

    // Comment range metadata: the text offset and the (run, char) pair resolved
    // through read_file's run lengths address the same characters.
    const [comment] = await getComments(zip, documentXml);
    expect(comment!.startTextOffset).toBe(text.indexOf('ta'));
    expect(comment!.endTextOffset).toBe(text.indexOf('Tail'));
    const resolve = (runIndex: number | undefined, charOffset: number | undefined): number =>
      sum(readFileLengths!.slice(0, runIndex!)) + charOffset!;
    expect(resolve(comment!.startRunIndex, comment!.startCharOffset)).toBe(comment!.startTextOffset);
    expect(resolve(comment!.endRunIndex, comment!.endCharOffset)).toBe(comment!.endTextOffset);

    // The document view's footnote marker sits right after "Ga".
    expect(getFootnoteMarkersForParagraph(paragraph, new Map([[7, 1]]))).toEqual([
      { offset: text.indexOf('Ga') + 2, id: 7, display: 1 },
    ]);

    // Table cell text is the paragraph text.
    const [table] = extractTables(documentXml, { rejectMergedCells: false, trimCellText: false }).tables;
    expect(table!.rawRows[0]!.cells[0]!.paragraphs[0]).toBe(text);
  });

  test(`a footnote inserted at a raw offset after a break lands at that offset (${fixture.name})`, async () => {
    const { zip, documentXml, paragraph } = await openFixture(fixture);
    await bootstrapFootnoteParts(zip);
    const offset = fixture.text.indexOf('Ga'); // inside run 2, after its w:br (and its w:sym)
    const { noteId } = await addFootnote(documentXml, zip, { paragraphEl: paragraph, visibleOffset: offset, text: 'Inserted' });

    expect(getParagraphText(paragraph)).toBe(fixture.text);
    const markers = getFootnoteMarkersForParagraph(paragraph, new Map([[7, 2], [noteId, 1]]));
    expect(markers).toEqual([
      { offset, id: noteId, display: 1 },
      { offset: fixture.text.indexOf('Ga') + 2, id: 7, display: 2 },
    ]);
  });
}
