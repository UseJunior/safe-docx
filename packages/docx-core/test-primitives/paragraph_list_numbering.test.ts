import { describe, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml } from '../src/primitives/xml.js';
import { parseNumberingXml } from '../src/primitives/numbering.js';
import { parseStylesXml } from '../src/primitives/styles.js';
import {
  computeParagraphListLabels,
  resolveParagraphNumbering,
} from '../src/primitives/paragraph_list_numbering.js';
import { buildNodesForDocumentView } from '../src/primitives/document_view.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Numbering' });
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Word for Mac 16.114 list strings for paragraphs numbered through their
 * paragraph style, recorded with the AppleScript oracle (see the evidence
 * file's `procedure`). Every fixture is replayed here, so the expected
 * labels are Word's, not ours.
 */
const EVIDENCE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/oracle/word/evidence/issue-1244-word-16.114.json',
);
type Evidence = {
  numberingXml: string;
  stylesXml: string;
  stylesXmlWithNumberedNormal: string;
  stylesXmlWithNumberedNormalUsedBy: string[];
  fixtures: Record<string, { bodyXml: string; paragraphs: Array<{ text: string; word: string }> }>;
};
const evidence = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) as Evidence;

function bodyParagraphs(bodyXml: string): Element[] {
  const doc = parseXml(`<w:document xmlns:w="${W_NS}"><w:body>${bodyXml}</w:body></w:document>`);
  return Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));
}

describe('style-inherited list numbering', () => {
  const styleNumberingTest = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.19' });

  for (const [name, fixture] of Object.entries(evidence.fixtures)) {
    styleNumberingTest(`labels match the Word oracle: ${name}`, async ({ given, when, then }: AllureBddContext) => {
      let paragraphs!: Element[];
      let labels!: string[];
      await given(`the ${name} fixture: ${fixture.paragraphs.map((p) => p.text).join(' / ')}`, async () => {
        paragraphs = bodyParagraphs(fixture.bodyXml);
      });
      await when('every paragraph is numbered in document order', async () => {
        const stylesXml = evidence.stylesXmlWithNumberedNormalUsedBy.includes(name)
          ? evidence.stylesXmlWithNumberedNormal
          : evidence.stylesXml;
        const byParagraph = computeParagraphListLabels(
          paragraphs,
          parseNumberingXml(parseXml(evidence.numberingXml)),
          parseStylesXml(parseXml(stylesXml)),
        );
        labels = paragraphs.map((p) => byParagraph.get(p)?.label ?? '');
      });
      await then(`the labels are Word's: ${fixture.paragraphs.map((p) => p.word || '∅').join(' ')}`, () => {
        expect(labels).toEqual(fixture.paragraphs.map((p) => p.word));
      });
    });
  }

  test('reports where the numbering came from and ignores a w:pPrChange numPr', async ({ given, then, and }: AllureBddContext) => {
    let numbering!: ReturnType<typeof parseNumberingXml>;
    let styles!: ReturnType<typeof parseStylesXml>;
    const para = (pPr: string) => bodyParagraphs(`<w:p><w:pPr>${pPr}</w:pPr></w:p>`)[0]!;
    await given('the oracle numbering part and heading styles', async () => {
      numbering = parseNumberingXml(parseXml(evidence.numberingXml));
      styles = parseStylesXml(parseXml(evidence.stylesXml));
    });
    await then('style, direct, and mixed sources are distinguished', () => {
      expect(resolveParagraphNumbering(para('<w:pStyle w:val="Heading2"/>'), styles, numbering)).toEqual({ numId: '10', ilvl: 1, source: 'style' });
      expect(
        resolveParagraphNumbering(para('<w:pStyle w:val="Heading2"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'), styles, numbering),
      ).toEqual({ numId: '1', ilvl: 0, source: 'direct' });
      expect(
        resolveParagraphNumbering(para('<w:pStyle w:val="Heading2"/><w:numPr><w:ilvl w:val="2"/></w:numPr>'), styles, numbering),
      ).toEqual({ numId: '10', ilvl: 2, source: 'direct+style' });
      expect(resolveParagraphNumbering(para('<w:numPr><w:numId w:val="1"/></w:numPr>'), styles, numbering)).toEqual({ numId: '1', ilvl: 0, source: 'direct' });
    });
    await and('a numPr that only the tracked prior properties carry does not number the paragraph', () => {
      const tracked = para(
        '<w:pPrChange w:id="1" w:author="A" w:date="2026-11-02T00:00:00Z"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:pPrChange>',
      );
      expect(resolveParagraphNumbering(tracked, styles, numbering)).toBeNull();
    });
    await and('a paragraph without styles or numbering resolves to nothing', () => {
      expect(resolveParagraphNumbering(bodyParagraphs('<w:p/>')[0]!, parseStylesXml(null), numbering)).toBeNull();
    });
  });

  test('document_view labels heading paragraphs numbered through their style', async ({ given, when, then }: AllureBddContext) => {
    let labels!: string[];
    const fixture = evidence.fixtures['s_d_mixed_style_direct']!;
    await given('headings numbered by style interleaved with directly numbered paragraphs', async () => {});
    await when('the document view is built', async () => {
      const paragraphs = bodyParagraphs(fixture.bodyXml).map((p, i) => ({ id: `_bk_${i + 1}`, p }));
      labels = buildNodesForDocumentView({
        paragraphs,
        stylesXml: parseXml(evidence.stylesXml),
        numberingXml: parseXml(evidence.numberingXml),
        include_semantic_tags: false,
      }).nodes.map((n) => n.list_label);
    });
    await then('each node carries the label Word shows', () => {
      expect(labels).toEqual(fixture.paragraphs.map((p) => p.word));
    });
  });

  test('document_view counts empty numbered paragraphs it omits', async ({ given, when, then }: AllureBddContext) => {
    let viewLabels!: Array<[string, string]>;
    const fixture = evidence.fixtures['e1_empty_numbered']!;
    await given('empty paragraphs numbered by style and directly, each followed by a numbered paragraph with text', async () => {});
    await when('the document view is built', async () => {
      const paragraphs = bodyParagraphs(fixture.bodyXml).map((p, i) => ({ id: `_bk_${i + 1}`, p }));
      viewLabels = buildNodesForDocumentView({
        paragraphs,
        stylesXml: parseXml(evidence.stylesXml),
        numberingXml: parseXml(evidence.numberingXml),
        include_semantic_tags: false,
      }).nodes.map((n) => [n.clean_text, n.list_label]);
    });
    await then('the empty paragraphs are omitted but still advance the counters, as in Word', () => {
      const expected = fixture.paragraphs.filter((p) => p.text !== '').map((p): [string, string] => [p.text, p.word]);
      expect(viewLabels).toEqual(expected);
      expect(expected).toEqual([['Title', 'ARTICLE II'], ['Sub', 'Section 2.02'], ['Item', '2.']]);
    });
  });
});
