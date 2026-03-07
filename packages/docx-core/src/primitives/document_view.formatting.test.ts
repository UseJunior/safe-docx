import { describe, expect } from 'vitest';
import { testAllure, allureStep } from './testing/allure-test.js';
import { buildNodesForDocumentView, renderToon } from './document_view.js';
import { parseXml } from './xml.js';
import type { RelsMap } from './relationships.js';

const TEST_FEATURE = 'add-run-level-formatting-visibility';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });
const humanReadableTest = test.allure({
  tags: ['human-readable'],
  parameters: { audience: 'non-technical' },
});

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function wrapInDoc(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

function makeParagraphs(bodyXml: string): Array<{ id: string; p: Element }> {
  const doc = parseXml(wrapInDoc(bodyXml));
  const ps = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));
  return ps.map((p, i) => ({ id: `_bk_${i + 1}`, p }));
}

function makeStylesXml(styles: string): Document {
  return parseXml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:styles xmlns:w="${W_NS}">${styles}</w:styles>`,
  );
}

describe('document_view formatting tags', () => {
  test('show_formatting=false produces output identical to legacy path', () => {
    const bodyXml =
      `<w:p>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Bold Header.</w:t></w:r>` +
      `<w:r><w:t> Normal body text here.</w:t></w:r>` +
      `</w:p>`;
    const paragraphs = makeParagraphs(bodyXml);

    const withFmt = buildNodesForDocumentView({
      paragraphs,
      stylesXml: null,
      numberingXml: null,
      show_formatting: false,
      include_semantic_tags: true,
    });
    const withoutFmt = buildNodesForDocumentView({
      paragraphs,
      stylesXml: null,
      numberingXml: null,
      include_semantic_tags: true,
    });

    expect(withFmt.nodes.length).toBe(withoutFmt.nodes.length);
    for (let i = 0; i < withFmt.nodes.length; i++) {
      expect(withFmt.nodes[i]!.tagged_text).toBe(withoutFmt.nodes[i]!.tagged_text);
      expect(withFmt.nodes[i]!.clean_text).toBe(withoutFmt.nodes[i]!.clean_text);
    }
  });

  humanReadableTest.openspec('extract bold, italic, underline, highlight tuple per run')(
    'extract bold, italic, underline, highlight tuple per run',
    async () => {
      const nodes = await allureStep('Given a paragraph with bold, italic, underline, highlight, and plain runs', () => {
        const bodyXml =
          `<w:p>` +
          `<w:r><w:rPr><w:b/></w:rPr><w:t>BBBBBBBBBBBBBBBBBBBB</w:t></w:r>` +
          `<w:r><w:rPr><w:i/></w:rPr><w:t>IIIIIIIIIIIIIIIIIIII</w:t></w:r>` +
          `<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>UUUUUUUUUUUUUUUUUUUU</w:t></w:r>` +
          `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>HHHHHHHHHHHHHHHHHHHH</w:t></w:r>` +
          `<w:r><w:t>PPPPPPPPPPPPPPPPPPPP</w:t></w:r>` +
          `</w:p>`;
        const paragraphs = makeParagraphs(bodyXml);
        return buildNodesForDocumentView({
          paragraphs,
          stylesXml: null,
          numberingXml: null,
          show_formatting: true,
          include_semantic_tags: true,
        }).nodes;
      });

      await allureStep('Then each formatting type emits its own inline tag', () => {
        expect(nodes.length).toBe(1);
        expect(nodes[0]!.tagged_text).toContain('<b>BBBBBBBBBBBBBBBBBBBB</b>');
        expect(nodes[0]!.tagged_text).toContain('<i>IIIIIIIIIIIIIIIIIIII</i>');
        expect(nodes[0]!.tagged_text).toContain('<u>UUUUUUUUUUUUUUUUUUUU</u>');
        expect(nodes[0]!.tagged_text).toContain('<highlight>HHHHHHHHHHHHHHHHHHHH</highlight>');
      });
    },
  );

  test('uniform formatting paragraph suppresses tags (all bold)', () => {
    const bodyXml =
      `<w:p>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>All bold text here and more body text.</w:t></w:r>` +
      `</w:p>`;
    const paragraphs = makeParagraphs(bodyXml);
    const { nodes } = buildNodesForDocumentView({
      paragraphs,
      stylesXml: null,
      numberingXml: null,
      show_formatting: true,
      include_semantic_tags: true,
    });

    expect(nodes.length).toBe(1);
    // When 100% of chars are bold, baseline suppression should hide <b> tags.
    expect(nodes[0]!.tagged_text).not.toContain('<b>');
    expect(nodes[0]!.tagged_text).not.toContain('</b>');
  });

  humanReadableTest.openspec('detect hyperlink runs and extract href')(
    'detect hyperlink runs and extract href',
    async () => {
      const nodes = await allureStep('Given a paragraph with a hyperlink run referencing rId1', () => {
        const relsMap: RelsMap = new Map([['rId1', 'https://example.com']]);
        const bodyXml =
          `<w:p>` +
          `<w:r><w:t>Click </w:t></w:r>` +
          `<w:hyperlink r:id="rId1"><w:r><w:t>here</w:t></w:r></w:hyperlink>` +
          `<w:r><w:t> for details.</w:t></w:r>` +
          `</w:p>`;
        const paragraphs = makeParagraphs(bodyXml);
        return buildNodesForDocumentView({
          paragraphs,
          stylesXml: null,
          numberingXml: null,
          show_formatting: true,
          include_semantic_tags: true,
          relsMap,
        }).nodes;
      });

      await allureStep('Then the hyperlink is emitted as an <a> tag with the resolved href', () => {
        expect(nodes.length).toBe(1);
        expect(nodes[0]!.tagged_text).toContain('<a href="https://example.com">here</a>');
        expect(nodes[0]!.tagged_text).toContain('Click ');
      });
    },
  );

  test('run-in header prefix is emitted plain (no formatting tags)', () => {
    // Bold header followed by normal body.
    const bodyXml =
      `<w:p>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Definitions.</w:t></w:r>` +
      `<w:r><w:t> The following terms shall apply.</w:t></w:r>` +
      `</w:p>`;
    const paragraphs = makeParagraphs(bodyXml);
    const { nodes } = buildNodesForDocumentView({
      paragraphs,
      stylesXml: null,
      numberingXml: null,
      show_formatting: true,
      include_semantic_tags: true,
    });

    expect(nodes.length).toBe(1);
    // The header "Definitions" should be detected and stripped from tagged_text by renderToon.
    // But in tagged_text it should be present as plain text (no <b> tags on it).
    const toon = renderToon(nodes);
    expect(toon).toContain('Definitions');
    // The body part should not have <b> tags on it (since body is not bold).
    expect(nodes[0]!.tagged_text).not.toMatch(/<b>Definitions/);
  });

  test('rStyle character style resolves bold from style definition', () => {
    const stylesDoc = makeStylesXml(
      `<w:style w:type="character" w:styleId="Strong">` +
      `<w:name w:val="Strong"/>` +
      `<w:rPr><w:b/></w:rPr>` +
      `</w:style>`,
    );
    const bodyXml =
      `<w:p>` +
      `<w:r><w:t>Normal text </w:t></w:r>` +
      `<w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>strong text</w:t></w:r>` +
      `</w:p>`;
    const paragraphs = makeParagraphs(bodyXml);
    const { nodes } = buildNodesForDocumentView({
      paragraphs,
      stylesXml: stylesDoc,
      numberingXml: null,
      show_formatting: true,
      include_semantic_tags: true,
    });

    expect(nodes.length).toBe(1);
    expect(nodes[0]!.tagged_text).toContain('<b>strong text</b>');
  });

  test('highlight emits <highlight> tags when show_formatting=true', () => {
    const bodyXml =
      `<w:p>` +
      `<w:r><w:t>Normal text </w:t></w:r>` +
      `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>highlighted</w:t></w:r>` +
      `<w:r><w:t> text end for padding to ensure body baseline.</w:t></w:r>` +
      `</w:p>`;
    const paragraphs = makeParagraphs(bodyXml);
    const { nodes } = buildNodesForDocumentView({
      paragraphs,
      stylesXml: null,
      numberingXml: null,
      show_formatting: true,
      include_semantic_tags: true,
    });

    expect(nodes.length).toBe(1);
    expect(nodes[0]!.tagged_text).toContain('<highlight>highlighted</highlight>');
  });

  humanReadableTest.openspec('suppression disabled when baseline coverage below 60%')(
    'suppression disabled when baseline coverage below 60%',
    async () => {
    const plain59 = 'A'.repeat(59);
    const bold41 = 'B'.repeat(41);
    const plain61 = 'A'.repeat(61);
    const bold39 = 'B'.repeat(39);

    const nodes59 = await allureStep('Given a paragraph with 59% plain and 41% bold (below 60% threshold)', () => {
      const bodyXml59 =
        `<w:p>` +
        `<w:r><w:t>${plain59}</w:t></w:r>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>${bold41}</w:t></w:r>` +
        `</w:p>`;
      const paragraphs59 = makeParagraphs(bodyXml59);
      return buildNodesForDocumentView({
        paragraphs: paragraphs59,
        stylesXml: null,
        numberingXml: null,
        show_formatting: true,
        include_semantic_tags: true,
      }).nodes;
    });

    await allureStep('Then suppression is disabled and bold text gets <b> tags', () => {
      expect(nodes59[0]!.tagged_text).toContain(`<b>${bold41}</b>`);
    });

    const nodes61 = await allureStep('Given a paragraph with 61% plain and 39% bold (above 60% threshold)', () => {
      const bodyXml61 =
        `<w:p>` +
        `<w:r><w:t>${plain61}</w:t></w:r>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>${bold39}</w:t></w:r>` +
        `</w:p>`;
      const paragraphs61 = makeParagraphs(bodyXml61);
      return buildNodesForDocumentView({
        paragraphs: paragraphs61,
        stylesXml: null,
        numberingXml: null,
        show_formatting: true,
        include_semantic_tags: true,
      }).nodes;
    });

    await allureStep('Then suppression is enabled — only deviations get tags', () => {
      expect(nodes61[0]!.tagged_text).toContain(`<b>${bold39}</b>`);
      expect(nodes61[0]!.tagged_text).not.toMatch(new RegExp(`<b>${plain61}`));
    });
    },
  );

  humanReadableTest.openspec('tags nested in consistent order')(
    'tags nested in consistent order',
    async () => {
    const nodes = await allureStep('Given a paragraph with a run having both italic and underline', () => {
      const bodyXml =
        `<w:p>` +
        `<w:r><w:t>Start text for baseline padding longer text. </w:t></w:r>` +
        `<w:r><w:rPr><w:i/><w:u w:val="single"/></w:rPr><w:t>styled</w:t></w:r>` +
        `<w:r><w:t> end.</w:t></w:r>` +
        `</w:p>`;
      const paragraphs = makeParagraphs(bodyXml);
      return buildNodesForDocumentView({
        paragraphs,
        stylesXml: null,
        numberingXml: null,
        show_formatting: true,
        include_semantic_tags: true,
      }).nodes;
    });

    await allureStep('Then tags are nested in canonical order: <a> → <b> → <i> → <u> → <highlight>', () => {
      expect(nodes.length).toBe(1);
      expect(nodes[0]!.tagged_text).toContain('<i><u>styled</u></i>');
    });
    },
  );
});
