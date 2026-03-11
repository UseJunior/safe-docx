import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { buildNodesForDocumentView, renderToon } from '../src/primitives/document_view.js';
import { parseXml } from '../src/primitives/xml.js';
import type { RelsMap } from '../src/primitives/relationships.js';
import { computeModalBaseline, type AnnotatedRun } from '../src/primitives/formatting_tags.js';

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
  test('show_formatting=false produces output identical to legacy path', async ({ given, when, then }: AllureBddContext) => {
    const bodyXml =
      `<w:p>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Bold Header.</w:t></w:r>` +
      `<w:r><w:t> Normal body text here.</w:t></w:r>` +
      `</w:p>`;
    let paragraphs: Array<{ id: string; p: Element }>;
    let withFmt: ReturnType<typeof buildNodesForDocumentView>;
    let withoutFmt: ReturnType<typeof buildNodesForDocumentView>;

    await given('a paragraph with bold and normal runs', async () => {
      paragraphs = makeParagraphs(bodyXml);
    });

    await when('buildNodesForDocumentView is called both ways', async () => {
      withFmt = buildNodesForDocumentView({
        paragraphs,
        stylesXml: null,
        numberingXml: null,
        show_formatting: false,
        include_semantic_tags: true,
      });
      withoutFmt = buildNodesForDocumentView({
        paragraphs,
        stylesXml: null,
        numberingXml: null,
        include_semantic_tags: true,
      });
    });

    await then('both outputs are identical', async () => {
      expect(withFmt.nodes.length).toBe(withoutFmt.nodes.length);
      for (let i = 0; i < withFmt.nodes.length; i++) {
        expect(withFmt.nodes[i]!.tagged_text).toBe(withoutFmt.nodes[i]!.tagged_text);
        expect(withFmt.nodes[i]!.clean_text).toBe(withoutFmt.nodes[i]!.clean_text);
      }
    });
  });

  humanReadableTest.openspec('extract bold, italic, underline, highlight tuple per run')(
    'extract bold, italic, underline, highlight tuple per run',
    async ({ given, when, then, and }: AllureBddContext) => {
      const bodyXml =
        `<w:p>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>BBBBBBBBBBBBBBBBBBBB</w:t></w:r>` +
        `<w:r><w:rPr><w:i/></w:rPr><w:t>IIIIIIIIIIIIIIIIIIII</w:t></w:r>` +
        `<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>UUUUUUUUUUUUUUUUUUUU</w:t></w:r>` +
        `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>HHHHHHHHHHHHHHHHHHHH</w:t></w:r>` +
        `<w:r><w:t>PPPPPPPPPPPPPPPPPPPP</w:t></w:r>` +
        `</w:p>`;
      let nodes: ReturnType<typeof buildNodesForDocumentView>['nodes'];

      await given('a paragraph with b/i/u/highlight/plain runs', async () => {
        // setup is in bodyXml above
      });

      await when('buildNodesForDocumentView with formatting', async () => {
        const paragraphs = makeParagraphs(bodyXml);
        const result = buildNodesForDocumentView({
          paragraphs,
          stylesXml: null,
          numberingXml: null,
          show_formatting: true,
          include_semantic_tags: true,
        });
        nodes = result.nodes;
      });

      await then('bold run is wrapped in <b> tags', async () => {
        expect(nodes.length).toBe(1);
        expect(nodes[0]!.tagged_text).toContain('<b>BBBBBBBBBBBBBBBBBBBB</b>');
      });

      await and('italic run is wrapped in <i> tags', async () => {
        expect(nodes[0]!.tagged_text).toContain('<i>IIIIIIIIIIIIIIIIIIII</i>');
      });

      await and('underline run is wrapped in <u> tags', async () => {
        expect(nodes[0]!.tagged_text).toContain('<u>UUUUUUUUUUUUUUUUUUUU</u>');
      });

      await and('highlight run is wrapped in <highlight> tags', async () => {
        expect(nodes[0]!.tagged_text).toContain('<highlight>HHHHHHHHHHHHHHHHHHHH</highlight>');
      });
    },
  );

  test('uniform formatting paragraph suppresses tags (all bold)', async ({ given, when, then }: AllureBddContext) => {
    const bodyXml =
      `<w:p>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>All bold text here and more body text.</w:t></w:r>` +
      `</w:p>`;
    let nodes: ReturnType<typeof buildNodesForDocumentView>['nodes'];

    await given('a paragraph where all text is bold', async () => {
      // setup is in bodyXml above
    });

    await when('buildNodesForDocumentView with formatting', async () => {
      const paragraphs = makeParagraphs(bodyXml);
      const result = buildNodesForDocumentView({
        paragraphs,
        stylesXml: null,
        numberingXml: null,
        show_formatting: true,
        include_semantic_tags: true,
      });
      nodes = result.nodes;
    });

    await then('bold tags are suppressed', async () => {
      expect(nodes.length).toBe(1);
      // When 100% of chars are bold, baseline suppression should hide <b> tags.
      expect(nodes[0]!.tagged_text).not.toContain('<b>');
      expect(nodes[0]!.tagged_text).not.toContain('</b>');
    });
  });

  humanReadableTest.openspec('char-weighted modal baseline selects dominant formatting tuple')(
    'char-weighted modal baseline selects dominant formatting tuple',
    async ({ given, when, then, and }: AllureBddContext) => {
      let runs: AnnotatedRun[];
      let baseline: ReturnType<typeof computeModalBaseline>;

      await given('runs with 10 bold chars and 4 plain chars', async () => {
        runs = [
          {
            text: 'AAAAAAAAAA',
            formatting: { bold: true, italic: false, underline: false, highlightVal: null, fontName: 'Arial', fontSizePt: 12, colorHex: null },
            hyperlinkUrl: null,
            charCount: 10,
            isHeaderRun: false,
          },
          {
            text: 'BBBB',
            formatting: { bold: false, italic: false, underline: false, highlightVal: null, fontName: 'Arial', fontSizePt: 12, colorHex: null },
            hyperlinkUrl: null,
            charCount: 4,
            isHeaderRun: false,
          },
        ];
      });

      await when('computeModalBaseline is called', async () => {
        baseline = computeModalBaseline(runs);
      });

      await then('baseline selects bold as dominant', async () => {
        expect(baseline.bold).toBe(true);
        expect(baseline.italic).toBe(false);
        expect(baseline.underline).toBe(false);
      });

      await and('suppression is enabled', async () => {
        expect(baseline.suppressed).toBe(true);
      });
    },
  );

  humanReadableTest.openspec('tie-break by earliest run when modal weights are equal')(
    'tie-break by earliest run when modal weights are equal',
    async ({ given, when, then }: AllureBddContext) => {
      let runs: AnnotatedRun[];
      let baseline: ReturnType<typeof computeModalBaseline>;

      await given('two runs with equal char weights', async () => {
        runs = [
          {
            text: 'AAAAAA',
            formatting: { bold: true, italic: false, underline: false, highlightVal: null, fontName: 'Arial', fontSizePt: 12, colorHex: null },
            hyperlinkUrl: null,
            charCount: 6,
            isHeaderRun: false,
          },
          {
            text: 'BBBBBB',
            formatting: { bold: false, italic: false, underline: false, highlightVal: null, fontName: 'Arial', fontSizePt: 12, colorHex: null },
            hyperlinkUrl: null,
            charCount: 6,
            isHeaderRun: false,
          },
        ];
      });

      await when('computeModalBaseline is called', async () => {
        baseline = computeModalBaseline(runs);
      });

      await then('earliest run (bold) wins the tie-break', async () => {
        expect(baseline.bold).toBe(true);
        expect(baseline.suppressed).toBe(false);
      });
    },
  );

  humanReadableTest.openspec('detect hyperlink runs and extract href')(
    'detect hyperlink runs and extract href',
    async ({ given, when, then, and }: AllureBddContext) => {
      let nodes: ReturnType<typeof buildNodesForDocumentView>['nodes'];

      await given('a paragraph with a hyperlink run', async () => {
        // setup happens in when step with relsMap
      });

      await when('buildNodesForDocumentView with formatting', async () => {
        const relsMap: RelsMap = new Map([['rId1', 'https://example.com']]);
        const bodyXml =
          `<w:p>` +
          `<w:r><w:t>Click </w:t></w:r>` +
          `<w:hyperlink r:id="rId1"><w:r><w:t>here</w:t></w:r></w:hyperlink>` +
          `<w:r><w:t> for details.</w:t></w:r>` +
          `</w:p>`;
        const paragraphs = makeParagraphs(bodyXml);
        const result = buildNodesForDocumentView({
          paragraphs,
          stylesXml: null,
          numberingXml: null,
          show_formatting: true,
          include_semantic_tags: true,
          relsMap,
        });
        nodes = result.nodes;
      });

      await then('hyperlink is rendered as <a> tag', async () => {
        expect(nodes.length).toBe(1);
        expect(nodes[0]!.tagged_text).toContain('<a href="https://example.com">here</a>');
      });

      await and('surrounding text is preserved', async () => {
        expect(nodes[0]!.tagged_text).toContain('Click ');
      });
    },
  );

  test('run-in header prefix is emitted plain (no formatting tags)', async ({ given, when, then, and }: AllureBddContext) => {
    let nodes: ReturnType<typeof buildNodesForDocumentView>['nodes'];

    await given('a paragraph with bold header and normal body', async () => {
      // setup is inline
    });

    await when('buildNodesForDocumentView with formatting', async () => {
      // Bold header followed by normal body.
      const bodyXml =
        `<w:p>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>Definitions.</w:t></w:r>` +
        `<w:r><w:t> The following terms shall apply.</w:t></w:r>` +
        `</w:p>`;
      const paragraphs = makeParagraphs(bodyXml);
      const result = buildNodesForDocumentView({
        paragraphs,
        stylesXml: null,
        numberingXml: null,
        show_formatting: true,
        include_semantic_tags: true,
      });
      nodes = result.nodes;
    });

    await then('header text appears in rendered toon', async () => {
      expect(nodes.length).toBe(1);
      // The header "Definitions" should be detected and stripped from tagged_text by renderToon.
      // But in tagged_text it should be present as plain text (no <b> tags on it).
      const toon = renderToon(nodes);
      expect(toon).toContain('Definitions');
    });

    await and('header text has no <b> tags', async () => {
      // The body part should not have <b> tags on it (since body is not bold).
      expect(nodes[0]!.tagged_text).not.toMatch(/<b>Definitions/);
    });
  });

  test('rStyle character style resolves bold from style definition', async ({ given, when, then }: AllureBddContext) => {
    let nodes: ReturnType<typeof buildNodesForDocumentView>['nodes'];

    await given('a styles document defining Strong as bold', async () => {
      // setup is inline
    });

    await when('buildNodesForDocumentView with rStyle Strong run', async () => {
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
      const result = buildNodesForDocumentView({
        paragraphs,
        stylesXml: stylesDoc,
        numberingXml: null,
        show_formatting: true,
        include_semantic_tags: true,
      });
      nodes = result.nodes;
    });

    await then('strong text is wrapped in <b> tags', async () => {
      expect(nodes.length).toBe(1);
      expect(nodes[0]!.tagged_text).toContain('<b>strong text</b>');
    });
  });

  test('highlight emits <highlight> tags when show_formatting=true', async ({ given, when, then }: AllureBddContext) => {
    let nodes: ReturnType<typeof buildNodesForDocumentView>['nodes'];

    await given('a paragraph with a highlighted run', async () => {
      // setup is inline
    });

    await when('buildNodesForDocumentView with formatting', async () => {
      const bodyXml =
        `<w:p>` +
        `<w:r><w:t>Normal text </w:t></w:r>` +
        `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>highlighted</w:t></w:r>` +
        `<w:r><w:t> text end for padding to ensure body baseline.</w:t></w:r>` +
        `</w:p>`;
      const paragraphs = makeParagraphs(bodyXml);
      const result = buildNodesForDocumentView({
        paragraphs,
        stylesXml: null,
        numberingXml: null,
        show_formatting: true,
        include_semantic_tags: true,
      });
      nodes = result.nodes;
    });

    await then('highlighted text has <highlight> tags', async () => {
      expect(nodes.length).toBe(1);
      expect(nodes[0]!.tagged_text).toContain('<highlight>highlighted</highlight>');
    });
  });

  humanReadableTest.openspec('suppression disabled when baseline coverage below 60%')(
    'suppression disabled when baseline coverage below 60%',
    async ({ given, when, then, and }: AllureBddContext) => {
      let nodes59: ReturnType<typeof buildNodesForDocumentView>['nodes'];
      let nodes61: ReturnType<typeof buildNodesForDocumentView>['nodes'];
      const plain59 = 'A'.repeat(59);
      const bold41 = 'B'.repeat(41);
      const plain61 = 'A'.repeat(61);
      const bold39 = 'B'.repeat(39);

      await given('paragraphs at 59% and 61% plain coverage', async () => {
        // 59 chars plain + 41 chars bold = 59% plain = suppressed=false (because 59 < 60 threshold)
        // Actually 59% IS < 60%, so suppressed should be false.
      });

      await when('buildNodesForDocumentView is called on both', async () => {
        const bodyXml59 =
          `<w:p>` +
          `<w:r><w:t>${plain59}</w:t></w:r>` +
          `<w:r><w:rPr><w:b/></w:rPr><w:t>${bold41}</w:t></w:r>` +
          `</w:p>`;
        const paragraphs59 = makeParagraphs(bodyXml59);
        const result59 = buildNodesForDocumentView({
          paragraphs: paragraphs59,
          stylesXml: null,
          numberingXml: null,
          show_formatting: true,
          include_semantic_tags: true,
        });
        nodes59 = result59.nodes;

        const bodyXml61 =
          `<w:p>` +
          `<w:r><w:t>${plain61}</w:t></w:r>` +
          `<w:r><w:rPr><w:b/></w:rPr><w:t>${bold39}</w:t></w:r>` +
          `</w:p>`;
        const paragraphs61 = makeParagraphs(bodyXml61);
        const result61 = buildNodesForDocumentView({
          paragraphs: paragraphs61,
          stylesXml: null,
          numberingXml: null,
          show_formatting: true,
          include_semantic_tags: true,
        });
        nodes61 = result61.nodes;
      });

      await then('59% paragraph has bold tags on bold run', async () => {
        // With 59% plain, suppressed=false -> all runs get absolute tags.
        // The plain text gets no tags (bold=false), the bold text gets <b>.
        expect(nodes59[0]!.tagged_text).toContain(`<b>${bold41}</b>`);
      });

      await and('61% paragraph has bold tags on bold run', async () => {
        // With 61% plain, suppressed=true -> only deviations get tags.
        // Bold is a deviation, so it gets <b>.
        expect(nodes61[0]!.tagged_text).toContain(`<b>${bold39}</b>`);
      });

      await and('61% paragraph plain text is not tagged', async () => {
        // The plain portion should NOT be tagged.
        expect(nodes61[0]!.tagged_text).not.toMatch(new RegExp(`<b>${plain61}`));
      });
    },
  );

  humanReadableTest.openspec('tags nested in consistent order')(
    'tags nested in consistent order',
    async ({ given, when, then }: AllureBddContext) => {
      let nodes: ReturnType<typeof buildNodesForDocumentView>['nodes'];

      await given('a paragraph with italic+underline styled run', async () => {
        // setup is inline
      });

      await when('buildNodesForDocumentView with formatting', async () => {
        const bodyXml =
          `<w:p>` +
          `<w:r><w:t>Start text for baseline padding longer text. </w:t></w:r>` +
          `<w:r><w:rPr><w:i/><w:u w:val="single"/></w:rPr><w:t>styled</w:t></w:r>` +
          `<w:r><w:t> end.</w:t></w:r>` +
          `</w:p>`;
        const paragraphs = makeParagraphs(bodyXml);
        const result = buildNodesForDocumentView({
          paragraphs,
          stylesXml: null,
          numberingXml: null,
          show_formatting: true,
          include_semantic_tags: true,
        });
        nodes = result.nodes;
      });

      await then('tags nest as <i><u>styled</u></i>', async () => {
        expect(nodes.length).toBe(1);
        // Nesting order: <a> -> <b> -> <i> -> <u> -> <highlight>
        expect(nodes[0]!.tagged_text).toContain('<i><u>styled</u></i>');
      });
    },
  );
});
