import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { parseXml, type ParagraphSpec } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { renderMarkdocxToDocumentSpec } from '../markdocx/render.js';
import { createDocumentFromMarkdoc } from './create.js';
import { lowerCreationMarkdoc } from './lower.js';
import { projectSourceText } from './oracle.js';

const TEST_FEATURE = 'add-markdoc-create-inline-underline';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1238 inline underline in created documents',
  severity: 'critical',
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** One body run as Word sees it: its text (a w:tab reads as \t) and its direct formatting. */
type RunView = { text: string; u?: string; b?: true; i?: true; highlight?: string };

function child(parent: Element, localName: string): Element | undefined {
  return Array.from(parent.childNodes).find((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === W && (node as Element).localName === localName);
}

function runView(run: Element): RunView {
  const text = Array.from(run.childNodes)
    .filter((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === W)
    .map((node) => (node.localName === 't' ? node.textContent ?? '' : node.localName === 'tab' ? '\t' : node.localName === 'br' ? '\n' : ''))
    .join('');
  const rPr = child(run, 'rPr');
  const u = rPr && child(rPr, 'u');
  const highlight = rPr && child(rPr, 'highlight');
  return {
    text,
    ...(u ? { u: u.getAttributeNS(W, 'val') ?? '' } : {}),
    ...(rPr && child(rPr, 'b') ? { b: true as const } : {}),
    ...(rPr && child(rPr, 'i') ? { i: true as const } : {}),
    ...(highlight ? { highlight: highlight.getAttributeNS(W, 'val') ?? '' } : {}),
  };
}

/** Every body paragraph (table cells included) as its list of runs, read from the DOCX bytes through the DOM. */
async function bodyRuns(docx: Buffer): Promise<RunView[][]> {
  const document = parseXml(await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string'));
  return Array.from(document.getElementsByTagNameNS(W, 'p'))
    .map((paragraph) => Array.from(paragraph.getElementsByTagNameNS(W, 'r')).map(runView).filter((run) => run.text));
}

async function failure(source: string): Promise<{ code?: string; message: string } | undefined> {
  return createDocumentFromMarkdoc(source).then(() => undefined, (error: { code?: string; message: string }) => error);
}

describe('Traceability: inline underline in created documents', () => {
  test.openspec('[SDX-MDOC-UNDERLINE-01] defined terms, run-in headings and operator words underline only the tagged text')(
    'Scenario: defined terms, run-in headings and operator words underline only the tagged text',
    async () => {
      const source = [
        '{% u %}Purchase Price{% /u %}. The aggregate consideration for the Shares is the Base Amount, {% u %}less{% /u %} the Closing Debt Amount.',
        '',
        'Section 2.04\t{% u %}Closing Deliveries and Payments{% /u %}. At the Closing, Buyer shall pay the Purchase Price.',
      ].join('\n');
      const created = await createDocumentFromMarkdoc(source);
      expect(created.certificate.passed).toBe(true);
      expect(created.certificate.checks.roundTrip.passed).toBe(true);

      const [definition, heading] = await bodyRuns(created.docx);
      expect(definition).toEqual([
        { text: 'Purchase Price', u: 'single' },
        { text: '. The aggregate consideration for the Shares is the Base Amount, ' },
        { text: 'less', u: 'single' },
        { text: ' the Closing Debt Amount.' },
      ]);
      // The section number and tab are not underlined, nor is the period after the caption.
      expect(heading!.map((run) => [run.text, run.u])).toEqual([
        ['Section 2.04\t', undefined],
        ['Closing Deliveries and Payments', 'single'],
        ['. At the Closing, Buyer shall pay the Purchase Price.', undefined],
      ]);
      expect(created.readback.paragraphs).toEqual([
        'Purchase Price. The aggregate consideration for the Shares is the Base Amount, less the Closing Debt Amount.',
        'Section 2.04\tClosing Deliveries and Payments. At the Closing, Buyer shall pay the Purchase Price.',
      ]);
    },
  );

  test.openspec('[SDX-MDOC-UNDERLINE-02] underline nests with other inline formatting and passes the round trip')(
    'Scenario: underline nests with other inline formatting and passes the round trip',
    async () => {
      const source = [
        '## {% u %}Closing{% /u %} Conditions',
        '',
        '{% u %}**Bold** and *italic*{% /u %} then **bold {% u %}inside{% /u %}** and {% u %}a{% /u %}{% u %}djacent{% /u %}.',
        '',
        'Due {% u %}{% fill %}Closing Date{% /fill %}{% /u %} or {% fill %}{% u %}Outside{% /u %} Date{% /fill %}, per {% literal %}[{% u %}sic{% /u %}]{% /literal %}.',
        '',
        '{% u %}Defined Term{% /u %}',
        '',
        '1. Buyer shall deliver the {% u %}Escrow Amount{% /u %}.',
        '',
        '{% table %}',
        '* Term',
        '---',
        '* {% u %}Cash{% /u %}',
        '{% /table %}',
        '',
        '{% signer date="Date: ___" %}{% u %}Jane Roe{% /u %}, Director{% /signer %}',
      ].join('\n');
      const created = await createDocumentFromMarkdoc(source);
      expect(created.certificate.passed).toBe(true);
      expect(created.certificate.checks.roundTrip.passed).toBe(true);

      const [heading, mixed, fills, sole, item, header, cell, signer] = await bodyRuns(created.docx);
      expect(heading).toEqual([{ text: 'Closing', u: 'single' }, { text: ' Conditions' }]);
      // Same-format neighbours merge, so adjacent {% u %} tags give one underlined run.
      expect(mixed).toEqual([
        { text: 'Bold', u: 'single', b: true },
        { text: ' and ', u: 'single' },
        { text: 'italic', u: 'single', i: true },
        { text: ' then ' },
        { text: 'bold ', b: true },
        { text: 'inside', u: 'single', b: true },
        { text: ' and ' },
        { text: 'adjacent', u: 'single' },
        { text: '.' },
      ]);
      // Around a fill the brackets are underlined too; inside one only its text is. Literal content may be underlined.
      expect(fills).toEqual([
        { text: 'Due ' },
        { text: '[Closing Date]', u: 'single', highlight: 'yellow' },
        { text: ' or ' },
        { text: '[', highlight: 'yellow' },
        { text: 'Outside', u: 'single', highlight: 'yellow' },
        { text: ' Date]', highlight: 'yellow' },
        { text: ', per [' },
        { text: 'sic', u: 'single' },
        { text: '].' },
      ]);
      expect(sole).toEqual([{ text: 'Defined Term', u: 'single' }]);
      expect(item).toEqual([{ text: 'Buyer shall deliver the ' }, { text: 'Escrow Amount', u: 'single' }, { text: '.' }]);
      expect(header).toEqual([{ text: 'Term', b: true }]);
      expect(cell).toEqual([{ text: 'Cash', u: 'single' }]);
      expect(signer!.filter((run) => run.u)).toEqual([{ text: 'Jane Roe', u: 'single' }]);

      // A paragraph holding only {% u %} is a body paragraph, both when lowered and in the oracle's own reading of the source.
      expect(created.lowering.blocks.map((block) => block.kind)).toEqual(['heading', 'body', 'body', 'body', 'list', 'table', 'signer']);
      expect(projectSourceText(source).body.map((entry) => entry.text)).toContain('Defined Term');
      const lowered = lowerCreationMarkdoc('{% u %}Defined Term{% /u %}').spec.sections[0]!.blocks[0] as ParagraphSpec;
      expect(lowered.runs).toEqual([{ kind: 'text', text: 'Defined Term', underline: 'single' }]);
    },
  );

  test.openspec('[SDX-MDOC-UNDERLINE-03] malformed underline fails closed')(
    'Scenario: malformed underline fails closed',
    async () => {
      expect(await failure('Pay the {% u %}{% /u %} now.')).toMatchObject({ code: 'INVALID_UNDERLINE', message: expect.stringMatching(/\{% u %\}.*line 1/) });
      expect(await failure('Pay the {% u /%} now.')).toMatchObject({ code: 'INVALID_UNDERLINE' });
      expect(await failure('Pay the {% u style="double" %}Price{% /u %}.')).toMatchObject({ code: 'UNSUPPORTED_CREATION_ATTRIBUTE' });
      expect(await failure('Lead.\n\n{% u %}\nPurchase Price\n{% /u %}')).toMatchObject({ code: 'UNSUPPORTED_CREATION_TAG' });
      const html = await failure('The <u>Purchase Price</u> is due.');
      expect(html).toMatchObject({ code: 'UNSUPPORTED_HTML' });
      expect(html!.message).toContain('{% u %}');
      // Other HTML keeps the generic hint.
      expect((await failure('Hello <b>world</b>.'))!.message).not.toContain('{% u %}');
      // Underlined whitespace is text, not an empty tag.
      const blank = await createDocumentFromMarkdoc('Name: {% u %}   {% /u %}');
      expect((await bodyRuns(blank.docx))[0]).toEqual([{ text: 'Name: ' }, { text: '   ', u: 'single' }]);
    },
  );

  test.openspec('[SDX-MDOC-UNDERLINE-04] the generic engine underlines for any theme')(
    'Scenario: the generic engine underlines for any theme',
    () => {
      const spec = renderMarkdocxToDocumentSpec('Pay {% u %}**the**\n`Price`{% /u %} now.');
      const runs = (spec.sections[0]!.blocks[0] as ParagraphSpec).runs;
      expect(runs).toEqual([
        { kind: 'text', text: 'Pay ', bold: undefined, italic: undefined },
        { kind: 'text', text: 'the', bold: true, italic: undefined, underline: 'single' },
        { kind: 'text', text: ' ', bold: undefined, italic: undefined, underline: 'single' },
        { kind: 'text', text: 'Price', bold: undefined, italic: undefined, underline: 'single' },
        { kind: 'text', text: ' now.', bold: undefined, italic: undefined },
      ]);
      expect(runs.filter((run) => run.kind === 'text' && !('underline' in run)).map((run) => (run.kind === 'text' ? run.text : ''))).toEqual(['Pay ', ' now.']);
      // A field inside {% u %} is underlined by the default preset as well.
      const field = renderMarkdocxToDocumentSpec('{% u %}{% field name="price" /%}{% /u %}', { resolveField: () => ({ text: 'Price', filled: false }) });
      expect((field.sections[0]!.blocks[0] as ParagraphSpec).runs).toEqual([{ kind: 'text', text: '[Price]', bold: true, italic: undefined, underline: 'single' }]);
    },
  );
});
