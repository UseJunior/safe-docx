import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { parseXml } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { defaultPdfRenderTools } from '../pdf/tools.js';
import { requiredPdfText, runCreateCommand } from './cli-create.js';
import { createDocumentFromMarkdoc, type CreationCertificate } from './create.js';
import { lowerCreationMarkdoc, type CreationLowering } from './lower.js';
import { PAGE_COUNT_FIELD, PAGE_NUMBER_FIELD, comparePdfWords, compareParagraphs, projectSourceText } from './oracle.js';
import { CREATION_BLOCK_TAGS, CREATION_FRONTMATTER_KEYS, RUNNING_TEXT_KEYS } from './validate.js';

const TEST_FEATURE = 'add-created-running-headers';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1223 running headers, footer layout and first pages in created documents',
  severity: 'critical',
});
const conforming = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.6' });

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** The synthetic letter of issue 1223: a right-aligned running header, a centred "Page 1 of N" and a bold Re: line. */
const LETTER_FRONTMATTER = [
  '---',
  'title: Engagement Letter',
  'header: Acme Matter | Engagement Letter',
  'header-align: right',
  'page-numbers: true',
  'page-number-format: page-of-total',
  '---',
  '',
].join('\n');
const LETTER_BODY = ['Dear Client:', '', '**Re: Acme Matter**', '', 'This letter confirms the terms of our engagement.', ''].join('\n');
const LETTER = `${LETTER_FRONTMATTER}${LETTER_BODY}`;

/** A two-page letter whose running header starts on page 2; the centred page number is on every page. */
const PARAGRAPH = 'This letter confirms the terms of our engagement and sets out the scope of the work we will do for you in this matter. '.repeat(6).trim();
const TWO_PAGE_LETTER = [
  '---',
  'header: Client Group | Engagement Letter',
  'header-align: right',
  'header-first: none',
  'page-numbers: true',
  '---',
  '',
  '# FIRM NAME',
  '',
  'Dear Client:',
  '',
  ...Array.from({ length: 9 }, () => [PARAGRAPH, '']).flat(),
].join('\n');

/** A section's header and footer references and its w:titlePg, read from the DOCX through the DOM. */
type SectionView = { references: Record<string, string>; titlePg: boolean };
/** Each referenced part's paragraphs: their w:jc, tab stops and runs (text, a tab as \t, a field as its instruction). */
type PartView = Array<{ jc?: string; tabs: string[]; runs: Array<{ text: string; italic?: true }> }>;

async function packageView(docx: Buffer): Promise<{ sections: SectionView[]; parts: Record<string, PartView>; styles: string[] }> {
  const zip = await JSZip.loadAsync(docx);
  const document = parseXml(await zip.file('word/document.xml')!.async('string'));
  const rels = parseXml(await zip.file('word/_rels/document.xml.rels')!.async('string'));
  const targets = new Map(Array.from(rels.getElementsByTagName('Relationship')).map((rel) => [rel.getAttribute('Id') ?? '', rel.getAttribute('Target') ?? '']));
  const sections: SectionView[] = [];
  const parts: Record<string, PartView> = {};
  for (const sectPr of Array.from(document.getElementsByTagNameNS(W, 'sectPr'))) {
    const references: Record<string, string> = {};
    for (const child of Array.from(sectPr.childNodes).filter((node): node is Element => node.nodeType === 1)) {
      if (child.localName !== 'headerReference' && child.localName !== 'footerReference') continue;
      const target = targets.get(child.getAttributeNS(R, 'id') ?? '')!;
      references[`${child.localName.replace('Reference', '')}:${child.getAttributeNS(W, 'type')}`] = target;
      if (!parts[target]) parts[target] = partView(parseXml(await zip.file(`word/${target}`)!.async('string')));
    }
    sections.push({ references, titlePg: sectPr.getElementsByTagNameNS(W, 'titlePg').length > 0 });
  }
  const styles = Array.from(parseXml(await zip.file('word/styles.xml')!.async('string')).getElementsByTagNameNS(W, 'style')).map((style) => style.getAttributeNS(W, 'styleId') ?? '');
  return { sections, parts, styles };
}

function partView(part: Document): PartView {
  return Array.from(part.getElementsByTagNameNS(W, 'p')).map((paragraph) => {
    const jc = paragraph.getElementsByTagNameNS(W, 'jc')[0]?.getAttributeNS(W, 'val') ?? undefined;
    const tabs = Array.from(paragraph.getElementsByTagNameNS(W, 'tabs')[0]?.getElementsByTagNameNS(W, 'tab') ?? []).map((tab) => `${tab.getAttributeNS(W, 'val')}@${tab.getAttributeNS(W, 'pos')}`);
    const runs = Array.from(paragraph.getElementsByTagNameNS(W, 'r')).map((run) => {
      const text = Array.from(run.childNodes).filter((node): node is Element => node.nodeType === 1)
        .map((node) => (node.localName === 't' ? node.textContent ?? '' : node.localName === 'tab' ? '\t' : node.localName === 'instrText' ? `{${(node.textContent ?? '').trim()}}` : ''))
        .join('');
      return { text, ...(run.getElementsByTagNameNS(W, 'i').length > 0 ? { italic: true as const } : {}) };
    }).filter((run) => run.text);
    return { ...(jc ? { jc } : {}), tabs, runs };
  });
}

/** The paragraphs of a part as text: fields as {INSTRUCTION}, cached results dropped (they sit between separate and end). */
function partText(view: PartView | undefined): string[] {
  return (view ?? []).map((paragraph) => paragraph.runs.map((run) => run.text).join('').replace(/\}1/gu, '}'));
}

async function failure(source: string): Promise<{ code?: string; message: string } | undefined> {
  return createDocumentFromMarkdoc(source).then(() => undefined, (error: { code?: string; message: string }) => error);
}

async function verificationFailure(promise: Promise<unknown>): Promise<CreationCertificate> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught as { code?: string; details?: unknown });
  expect(error?.code).toBe('CREATION_VERIFICATION_FAILED');
  return error!.details as CreationCertificate;
}

/** Rewrite the lowering's spec and projection alike, so only the independent round trip can catch the edit. */
function corrupt(edit: (json: string) => string): (lowering: CreationLowering) => CreationLowering {
  return (lowering) => ({ ...lowering, spec: JSON.parse(edit(JSON.stringify(lowering.spec))), projection: JSON.parse(edit(JSON.stringify(lowering.projection))) });
}

describe('Traceability: running headers in created documents', () => {
  conforming.openspec('[SDX-MDOC-RUNHEAD-01] a running header is declared in the frontmatter or on a section and inherits like the footer')(
    'Scenario: a running header is declared in the frontmatter or on a section and inherits like the footer',
    async () => {
      const source = [
        '---',
        'header: Acme Matter | Engagement Letter',
        'header-align: right',
        '---',
        '',
        'First section.',
        '',
        '{% section /%}',
        '',
        'Second section inherits the header.',
        '',
        '{% section header="Schedule A" header-align="left" /%}',
        '',
        'Third section has its own header.',
        '',
        '{% section header=false /%}',
        '',
        'Fourth section has an empty header.',
        '',
      ].join('\n');
      const created = await createDocumentFromMarkdoc(source);
      expect(created.certificate.passed).toBe(true);
      const view = await packageView(created.docx);
      // Declaring sections reference a header part of their own; the inheriting section references none.
      expect(view.sections.map((section) => Object.keys(section.references))).toEqual([['header:default'], [], ['header:default'], ['header:default']]);
      expect(view.sections.every((section) => !section.titlePg)).toBe(true);
      const [first, , third, fourth] = view.sections.map((section) => view.parts[section.references['header:default'] ?? '']);
      expect(first).toEqual([{ jc: 'right', tabs: [], runs: [{ text: 'Acme Matter | Engagement Letter' }] }]);
      expect(third).toEqual([{ jc: 'left', tabs: [], runs: [{ text: 'Schedule A' }] }]);
      expect(fourth).toEqual([{ tabs: [], runs: [] }]);
      // The default alignment is centred, written on the paragraph.
      const centred = await packageView((await createDocumentFromMarkdoc('---\nheader: Running Head\n---\n\nBody.\n')).docx);
      expect(Object.values(centred.parts)[0]![0]!.jc).toBe('center');
      expect(view.styles).toContain('Header');

      // Read-back, certificate and text mirror.
      expect(created.readback.headers).toEqual([['Acme Matter | Engagement Letter'], null, ['Schedule A'], ['']]);
      expect(created.certificate.headers).toEqual(created.readback.headers);
      expect(created.certificate.checks.headers).toMatchObject({ passed: true, sections: 4, firstPageSections: 0, negativeControlDetected: true });
      expect(created.certificate.checks.roundTrip.headers!.map((entry) => [entry.expected, entry.actual, entry.passed]))
        .toEqual([[['Acme Matter | Engagement Letter'], ['Acme Matter | Engagement Letter'], true], [null, null, true], [['Schedule A'], ['Schedule A'], true], [[], [''], true]]);
      expect(created.certificate.checks.roundTrip.negativeControls.deletedHeaderText).toBe(true);
      expect(requiredPdfText(created)).toEqual(expect.arrayContaining(['Acme Matter | Engagement Letter', 'Schedule A']));
    },
  );

  conforming.openspec('[SDX-MDOC-RUNHEAD-02] footer text and page numbers take an alignment, a format, an upright choice and a one-line layout')(
    'Scenario: footer text and page numbers take an alignment, a format, an upright choice and a one-line layout',
    async () => {
      const stacked = await createDocumentFromMarkdoc([
        '---',
        'footer: Confidential',
        'footer-align: left',
        'footer-italic: false',
        'page-numbers: true',
        'page-number-align: right',
        'page-number-format: dashed',
        '---',
        '',
        'Body.',
        '',
        '{% section footer="Schedule" page-numbers=true page-number-format="page-of-total" /%}',
        '',
        'Schedule body.',
        '',
      ].join('\n'));
      expect(stacked.certificate.passed).toBe(true);
      let view = await packageView(stacked.docx);
      const [one, two] = view.sections.map((section) => view.parts[section.references['footer:default']!]!);
      expect(one).toEqual([
        { jc: 'left', tabs: [], runs: [{ text: 'Confidential' }] },
        { jc: 'right', tabs: [], runs: [{ text: '- ' }, { text: '{PAGE}' }, { text: '1' }, { text: ' -' }] },
      ]);
      // Without the keys: the footer style centres both paragraphs, and the text is italic.
      expect(two).toEqual([
        { tabs: [], runs: [{ text: 'Schedule', italic: true }] },
        { tabs: [], runs: [{ text: 'Page ' }, { text: '{PAGE}' }, { text: '1' }, { text: ' of ' }, { text: '{NUMPAGES}' }, { text: '1' }] },
      ]);
      expect(stacked.readback.footers).toEqual([['Confidential', '- <PAGE> -'], ['Schedule', 'Page <PAGE> of <NUMPAGES>']]);
      expect(stacked.certificate.checks.roundTrip.footers.map((entry) => entry.actual)).toEqual([['Confidential', '- 1 -'], ['Schedule', 'Page 1 of 1']]);
      // The PDF must show the literal pieces; the generated numbers are checked word by word.
      expect(requiredPdfText(stacked)).toEqual(expect.arrayContaining(['Confidential', 'Schedule', 'Page', 'of']));

      const oneLine = await createDocumentFromMarkdoc('---\nfooter: Acme Matter\nfooter-layout: one-line\npage-numbers: true\npage-number-format: page-of-total\n---\n\nBody.\n');
      expect(oneLine.certificate.passed).toBe(true);
      view = await packageView(oneLine.docx);
      // Text at the left margin, the number after a right tab stop at the right margin (6.5" = 9360 twips).
      expect(Object.values(view.parts)[0]).toEqual([{ jc: 'left', tabs: ['right@9360'], runs: [{ text: 'Acme Matter', italic: true }, { text: '\t' }, { text: 'Page ' }, { text: '{PAGE}' }, { text: '1' }, { text: ' of ' }, { text: '{NUMPAGES}' }, { text: '1' }] }]);
      expect(oneLine.readback.footers).toEqual([['Acme Matter\tPage <PAGE> of <NUMPAGES>']]);
      expect(oneLine.certificate.checks.roundTrip.negativeControls.deletedFooterText).toBe(true);

      // The independent oracle reads each format with field markers that any decimal number satisfies.
      expect(projectSourceText('---\npage-numbers: true\npage-number-format: page-of-total\n---\n\nBody.\n').footers).toEqual([[`Page ${PAGE_NUMBER_FIELD} of ${PAGE_COUNT_FIELD}`]]);
      expect(compareParagraphs([{ text: `Page ${PAGE_NUMBER_FIELD} of ${PAGE_COUNT_FIELD}` }], ['Page 2 of 3']).passed).toBe(true);
      expect(compareParagraphs([{ text: `Page ${PAGE_NUMBER_FIELD} of ${PAGE_COUNT_FIELD}` }], ['Page 2']).passed).toBe(false);
      expect(compareParagraphs([{ text: `- ${PAGE_NUMBER_FIELD} -` }], ['2']).passed).toBe(false);
      expect(compareParagraphs([{ text: `Text\t${PAGE_NUMBER_FIELD}` }], ['Text 4']).passed).toBe(true);
    },
  );

  conforming.openspec('[SDX-MDOC-RUNHEAD-03] first-page header and footer variants are independent and the other first-page slot copies its default')(
    'Scenario: first-page header and footer variants are independent and the other first-page slot copies its default',
    async () => {
      // header-first: none alone. The first-page footer is a copy of the default, so page 1 keeps its number.
      const letter = await createDocumentFromMarkdoc(TWO_PAGE_LETTER);
      expect(letter.certificate.passed).toBe(true);
      let view = await packageView(letter.docx);
      expect(view.sections[0]).toEqual({ titlePg: true, references: expect.objectContaining({}) });
      expect(Object.keys(view.sections[0]!.references).sort()).toEqual(['footer:default', 'footer:first', 'header:default', 'header:first']);
      const part = (slot: string) => view.parts[view.sections[0]!.references[slot]!];
      expect(partText(part('header:first'))).toEqual(['']);
      expect(partText(part('header:default'))).toEqual(['Client Group | Engagement Letter']);
      expect(part('footer:first')).toEqual(part('footer:default'));
      expect(partText(part('footer:first'))).toEqual(['{PAGE}']);
      expect(letter.readback.firstPage).toEqual([{ header: [''], footer: ['<PAGE>'] }]);
      expect(letter.certificate.checks.headers).toMatchObject({ passed: true, firstPageSections: 1, negativeControlDetected: true, firstPageNegativeControlDetected: true });
      expect(letter.certificate.checks.roundTrip.negativeControls).toMatchObject({ changedFirstPageHeader: true, changedFirstPageFooter: true });
      expect(letter.certificate.checks.roundTrip.firstPage!.map((entry) => [entry.slot, entry.expected, entry.actual, entry.passed]))
        .toEqual([['header', [], [''], true], ['footer', [PAGE_NUMBER_FIELD], ['1'], true]]);

      // footer-first text alone: the first-page header is a copy of the default header; the first-page footer keeps the number.
      const footerOnly = await createDocumentFromMarkdoc('---\nheader: Running Head\nfooter: Draft\nfooter-first: Privileged and Confidential\npage-numbers: true\n---\n\nBody.\n');
      expect(footerOnly.certificate.passed).toBe(true);
      expect(footerOnly.readback.firstPage).toEqual([{ header: ['Running Head'], footer: ['Privileged and Confidential', '<PAGE>'] }]);
      view = await packageView(footerOnly.docx);
      expect(part('header:first')).toEqual(part('header:default'));

      // Both variants, and `none` for the footer: an empty first-page footer, a first-page header of its own.
      const both = await createDocumentFromMarkdoc('---\nheader: Running Head\nheader-first: Letterhead\nheader-align: left\npage-numbers: true\nfooter-first: none\n---\n\nBody.\n');
      expect(both.certificate.passed).toBe(true);
      expect(both.readback.firstPage).toEqual([{ header: ['Letterhead'], footer: [''] }]);
      view = await packageView(both.docx);
      expect(part('header:first')).toEqual([{ jc: 'left', tabs: [], runs: [{ text: 'Letterhead' }] }]);

      // First-page text alone declares an otherwise empty header: a letterhead on page 1 only.
      const letterhead = await createDocumentFromMarkdoc('---\nheader-first: Letterhead\npage-numbers: true\n---\n\nBody.\n');
      expect(letterhead.certificate.passed).toBe(true);
      expect(letterhead.readback.headers).toEqual([['']]);
      expect(letterhead.readback.firstPage).toEqual([{ header: ['Letterhead'], footer: ['<PAGE>'] }]);

      // Variants are inherited with their header or footer; a section that declares a header without one turns w:titlePg off,
      // unless its inherited footer still has a variant.
      const sections = await createDocumentFromMarkdoc([
        '---', 'header: Running Head', 'header-first: none', 'page-numbers: true', '---', '',
        'One.', '', '{% section /%}', '', 'Two inherits the first-page rule.', '',
        '{% section header="Plain Head" /%}', '', 'Three shows its header on every page.', '',
        '{% section footer="Annex" footer-first="Annex Cover" /%}', '', 'Four inherits the plain header and has a footer variant.', '',
      ].join('\n'));
      expect(sections.certificate.passed).toBe(true);
      expect(sections.readback.firstPage).toEqual([
        { header: [''], footer: ['<PAGE>'] },
        { header: [''], footer: ['<PAGE>'] },
        null,
        { header: ['Plain Head'], footer: ['Annex Cover'] },
      ]);
      view = await packageView(sections.docx);
      expect(view.sections.map((section) => section.titlePg)).toEqual([true, true, false, true]);
      // An inheriting section with w:titlePg writes its first-page slots itself, never relying on inheritance.
      expect(Object.keys(view.sections[1]!.references).sort()).toEqual(['footer:first', 'header:first']);
      expect(sections.certificate.checks.roundTrip.firstPage!.filter((entry) => entry.section === 3).map((entry) => entry.expected)).toEqual([['Plain Head'], ['Annex Cover']]);

      // The PDF must show only what each section is sure to show: with w:titlePg, its first-page slots; its other
      // header and footer appear only from its second page, which the page-aware word check holds them to.
      expect(requiredPdfText(both)).toEqual(['Body.', 'Letterhead']);
      expect(requiredPdfText(sections)).not.toContain('Running Head');
      expect(requiredPdfText(sections)).toEqual(expect.arrayContaining(['Plain Head', 'Annex Cover']));
      expect(requiredPdfText(sections)).not.toContain('Annex');

      // By default nothing has a first page of its own.
      const plain = await createDocumentFromMarkdoc(LETTER);
      expect((await packageView(plain.docx)).sections[0]!.titlePg).toBe(false);
      expect(plain.readback.firstPage).toEqual([null]);
      expect(plain.certificate.firstPage).toBeUndefined();
      expect(plain.certificate.checks.roundTrip.firstPage).toBeUndefined();
    },
  );

  test.openspec('[SDX-MDOC-RUNHEAD-04] verification catches a lost header, a lost first-page slot and wrong generated page words')(
    'Scenario: verification catches a lost header, a lost first-page slot and wrong generated page words',
    async () => {
      // A header dropped from both the spec and the lowering's projection is still caught by the round trip from the source.
      let certificate = await verificationFailure(createDocumentFromMarkdoc(LETTER, { transformLowering: corrupt((json) => json.replaceAll('Acme Matter | Engagement Letter', 'Acme Matter')) }));
      expect(certificate.checks.headers!.passed).toBe(true);
      expect(certificate.checks.roundTrip.headers![0]).toMatchObject({ expected: ['Acme Matter | Engagement Letter'], actual: ['Acme Matter'], passed: false });

      // The first-page footer losing its page number, in the spec and the projection alike.
      const dropNumber = (lowering: CreationLowering): CreationLowering => {
        const first = lowering.spec.sections[0]!.footers!.first!;
        return {
          ...lowering,
          spec: { ...lowering.spec, sections: [{ ...lowering.spec.sections[0]!, footers: { ...lowering.spec.sections[0]!.footers, first: { blocks: [{ kind: 'paragraph', ...first.blocks[0]!, runs: [] } as never] } } }, ...lowering.spec.sections.slice(1)] },
          projection: { ...lowering.projection, firstPage: [{ header: [''], footer: [''] }] },
        };
      };
      certificate = await verificationFailure(createDocumentFromMarkdoc(TWO_PAGE_LETTER, { transformLowering: dropNumber }));
      expect(certificate.checks.headers!.passed).toBe(true);
      expect(certificate.checks.roundTrip.firstPage!.find((entry) => entry.slot === 'footer')).toMatchObject({ expected: [PAGE_NUMBER_FIELD], passed: false });

      // The running header leaking onto the first page, likewise.
      const leak = corrupt((json) => json.replace('"first":{"blocks":[{"kind":"paragraph","styleId":"Header","runs":[]}]}', '"first":{"blocks":[{"kind":"paragraph","styleId":"Header","alignment":"right","runs":[{"kind":"text","text":"Client Group | Engagement Letter"}]}]}')
        .replace('"firstPage":[{"header":[""]', '"firstPage":[{"header":["Client Group | Engagement Letter"]'));
      certificate = await verificationFailure(createDocumentFromMarkdoc(TWO_PAGE_LETTER, { transformLowering: leak }));
      expect(certificate.checks.roundTrip.firstPage!.find((entry) => entry.slot === 'header')).toMatchObject({ expected: [], actual: ['Client Group | Engagement Letter'], passed: false });

      // The PDF word check expects each page's header and footer: the header, then the footer, at the head of the
      // page, as LibreOffice writes them, with the generated words "Page", the number, "of" and the total.
      const source = projectSourceText(`${LETTER_FRONTMATTER}${LETTER_BODY}`, { reader: 'libreoffice' });
      const page = (head: string) => [head, 'Dear Client:', 'Re: Acme Matter', 'This letter confirms the terms of our engagement.'].join('\n');
      expect(comparePdfWords(source, [page('Acme Matter | Engagement Letter\nPage 1 of 1')]).passed).toBe(true);
      for (const wrong of ['Acme Matter | Engagement Letter\nPage 1', 'Acme Matter | Engagement Letter\n1 of 1', 'Acme Matter | Engagement Letter\nPage 1 of 2', 'Page 1 of 1', 'Acme Matter | Letter\nPage 1 of 1']) {
        expect(comparePdfWords(source, [page(wrong)]).passed, wrong).toBe(false);
      }
      // First pages: page 1 shows no header, page 2 does; the header shown on page 1, or missing from page 2, fails.
      const twoPage = projectSourceText(TWO_PAGE_LETTER, { reader: 'libreoffice' });
      const words = ['FIRM NAME', 'Dear Client:', ...Array.from({ length: 9 }, () => PARAGRAPH)].join('\n');
      const split = words.indexOf('This letter', 3000);
      const [top, rest] = [words.slice(0, split), words.slice(split)];
      expect(comparePdfWords(twoPage, [`1\n${top}`, `Client Group | Engagement Letter\n2\n${rest}`]).passed).toBe(true);
      expect(comparePdfWords(twoPage, [`Client Group | Engagement Letter\n1\n${top}`, `Client Group | Engagement Letter\n2\n${rest}`]).passed).toBe(false);
      expect(comparePdfWords(twoPage, [`1\n${top}`, `2\n${rest}`]).passed).toBe(false);
      expect(comparePdfWords(twoPage, [top, `Client Group | Engagement Letter\n2\n${rest}`]).passed).toBe(false);
    },
  );

  test.openspec('[SDX-MDOC-RUNHEAD-05] malformed running-text keys fail closed')(
    'Scenario: malformed running-text keys fail closed',
    async () => {
      const frontmatter = async (lines: string[]) => failure(`---\n${lines.join('\n')}\n---\n\nBody.\n`);
      const cases: Array<[string[], string]> = [
        [['header-align: middle', 'header: H'], 'header-align must be left, center or right'],
        [['header-align: right'], 'header-align needs header text'],
        [['header-first: none'], 'header-first: none needs a header'],
        [['footer-first: none'], 'footer-first: none needs a footer'],
        [['footer-align: left', 'page-numbers: true'], 'footer-align needs footer text'],
        [['footer-italic: maybe', 'footer: F'], 'footer-italic must be true or false'],
        [['page-number-format: roman', 'page-numbers: true'], 'page-number-format must be plain, dashed or page-of-total'],
        [['page-number-format: dashed'], 'page-number-format needs page-numbers: true'],
        [['page-number-align: left', 'page-numbers: false'], 'page-number-align needs page-numbers: true'],
        [['footer-layout: one-line', 'page-numbers: true'], 'footer-layout one-line puts footer text and the page number on one line'],
        [['footer-layout: one-line', 'footer: F', 'page-numbers: true', 'page-number-align: right'], 'takes no page-number-align'],
        [['footer-layout: sideways', 'footer: F'], 'footer-layout must be stacked or one-line'],
        [['header: false'], 'leave the key out for no header'],
        [['header-first:'], 'header-first must be'],
      ];
      for (const [lines, message] of cases) {
        const error = await frontmatter(lines);
        expect(error?.code, lines.join('; ')).toBe('UNSUPPORTED_CREATION_FRONTMATTER');
        expect(error?.message, lines.join('; ')).toContain(message);
      }
      const section = async (attributes: string) => failure(`Body.\n\n{% section ${attributes} /%}\n\nMore.\n`);
      const sectionCases: Array<[string, string]> = [
        ['header=""', 'section header="…" must be a non-empty string, or header=false'],
        ['header=true', 'section header="…" must be a non-empty string, or header=false'],
        ['header="H" header-align="top"', 'section header-align must be "left", "center" or "right"'],
        ['footer-align="left"', 'footer-align needs footer text'],
        ['header=false header-align="right"', 'header-align needs header text'],
        ['header-first="none"', 'header-first: none needs a header'],
        ['footer-first=""', 'section footer-first="…" must be the first page\'s text'],
        ['page-numbers=true page-number-format="roman"', 'section page-number-format must be "plain", "dashed" or "page-of-total"'],
        ['page-numbers=true footer-italic="no"', 'section footer-italic must be true or false'],
        ['footer="F" footer-layout="one-line"', 'footer-layout one-line puts footer text and the page number on one line'],
      ];
      for (const [attributes, message] of sectionCases) {
        const error = await section(attributes);
        expect(error?.code, attributes).toBe('INVALID_SECTION');
        expect(error?.message, attributes).toContain(message);
        expect(error?.message, attributes).toContain('(line 3)');
      }
      // The admitted keys are listed by the grammar's own constants, which the frontmatter error message names.
      expect([...CREATION_BLOCK_TAGS.section!]).toEqual([...RUNNING_TEXT_KEYS]);
      expect([...RUNNING_TEXT_KEYS].every((key) => CREATION_FRONTMATTER_KEYS.has(key))).toBe(true);
      expect((await frontmatter(['headers: H']))?.message).toContain(`Allowed keys: ${[...CREATION_FRONTMATTER_KEYS].join(', ')}.`);
    },
  );

  test.openspec('[SDX-MDOC-RUNHEAD-06] a source without the new keys builds what it built before')(
    'Scenario: a source without the new keys builds what it built before',
    async () => {
      const source = '---\ntitle: Consent\nfooter: Confidential\npage-numbers: true\n---\n\nBody.\n\n{% section footer="Signature Page" /%}\n\nSigned.\n';
      const created = await createDocumentFromMarkdoc(source);
      const view = await packageView(created.docx);
      // No header part, no w:titlePg, no Header style, and the footer as before: centred by the footer style, italic text, a bare PAGE field.
      expect(view.sections.map((section) => [Object.keys(section.references), section.titlePg])).toEqual([[['footer:default'], false], [['footer:default'], false]]);
      expect(view.styles).not.toContain('Header');
      expect(view.parts[view.sections[0]!.references['footer:default']!]).toEqual([
        { tabs: [], runs: [{ text: 'Confidential', italic: true }] },
        { tabs: [], runs: [{ text: '{PAGE}' }, { text: '1' }] },
      ]);
      const zip = await JSZip.loadAsync(created.docx);
      expect(Object.keys(zip.files).filter((name) => /header/u.test(name))).toEqual([]);
      // The certificate gains no header keys: its checks and controls are the ones it had
      // (properties, the document-properties read-back, is recorded for every document).
      expect(Object.keys(created.certificate.checks)).toEqual(['package', 'determinism', 'readback', 'footers', 'footnotes', 'roundTrip', 'brownfield', 'properties']);
      expect(Object.keys(created.certificate.checks.roundTrip.negativeControls)).toEqual(['deletedWord', 'deletedParagraph', 'deletedTableCell', 'deletedFooterText']);
      expect(created.certificate.headers).toBeUndefined();
      expect(created.lowering.spec.sections.every((section) => section.headers === undefined && section.titlePg === undefined)).toBe(true);
      expect(lowerCreationMarkdoc(source).spec.styles!.map((style) => style.styleId)).not.toContain('Header');
    },
  );
});

const realTools = defaultPdfRenderTools();
const pdftotext = realTools.resolve('pdftotext');
const describeWithLibreOffice = realTools.resolve('soffice') && pdftotext ? describe : describe.skip;
const run = promisify(execFile);

describeWithLibreOffice('Traceability: running headers in a real LibreOffice PDF', () => {
  test.openspec('[SDX-MDOC-RUNHEAD-07] the synthetic letters build with create --require-pdf and every check passes')(
    'Scenario: the synthetic letters build with create --require-pdf and every check passes',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-runhead-'));
      try {
        // The one-page letter of issue 1223: right-aligned header, centred "Page 1 of 1", bold Re: line.
        await writeFile(path.join(dir, 'letter.mdoc'), LETTER);
        const result = await runCreateCommand([path.join(dir, 'letter.mdoc'), path.join(dir, 'out'), '--require-pdf']);
        expect(result.pdf).toMatchObject({ status: 'passed', pageCount: 1, words: { passed: true } });
        expect(result.summary).toContain('headers ok (1 section; negative control ok)');
        const certificate = JSON.parse(await readFile(path.join(dir, 'out', 'letter.verification.json'), 'utf8')) as CreationCertificate & { pdf: { words: { knownGenerated: { footerRegions: string[] } } } };
        expect(certificate.passed).toBe(true);
        expect(certificate.pdf.words.knownGenerated.footerRegions).toEqual(['Acme Matter | Engagement Letter Page 1 of 1']);
        const text = (await run(pdftotext!, ['-raw', path.join(dir, 'out', 'letter.pdf'), '-'])).stdout;
        expect(text).toContain('Acme Matter | Engagement Letter');
        expect(text).toContain('Page 1 of 1');

        // The two-page letter: no header on page 1, the header on page 2, the centred page number on both.
        await writeFile(path.join(dir, 'two-page.mdoc'), TWO_PAGE_LETTER);
        const two = await runCreateCommand([path.join(dir, 'two-page.mdoc'), path.join(dir, 'out'), '--require-pdf']);
        expect(two.pdf).toMatchObject({ status: 'passed', pageCount: 2, words: { passed: true } });
        const pdf = path.join(dir, 'out', 'two-page.pdf');
        const pageText = async (page: number) => (await run(pdftotext!, ['-raw', '-f', String(page), '-l', String(page), pdf, '-'])).stdout;
        const [first, second] = [await pageText(1), await pageText(2)];
        expect(first).not.toContain('Client Group | Engagement Letter');
        expect(first.split('\n')[0]).toBe('1');
        expect(second.split('\n').slice(0, 2)).toEqual(['Client Group | Engagement Letter', '2']);

        // One-page sections never show their other header and footer; each of these builds and passes. The last
        // section of the last source inherits footer-first: none with its footer, so its one page has no footer.
        const short: Array<[string, string, string]> = [
          ['header-none', '---\nheader: RUNNING_ONLY\nheader-first: none\npage-numbers: true\n---\n\nShort body.\n', '1'],
          ['both-replaced', '---\nheader: RUNNING_ONLY\nheader-first: COVER_ONLY\nfooter: DEFAULT_FOOTER\nfooter-first: COVER_FOOTER\npage-numbers: true\n---\n\nShort body.\n', 'COVER_ONLY COVER_FOOTER 1'],
          ['footer-none', '---\nheader: Running Head\nfooter: DEFAULT_FOOTER\nfooter-first: none\npage-numbers: true\n---\n\nShort body.\n', 'Running Head'],
          ['inner-section', '---\nheader: Running Head\npage-numbers: true\n---\n\nFirst section.\n\n{% section header="ANNEX_HEAD" header-first="ANNEX_COVER" footer="ANNEX_FOOT" footer-first="none" /%}\n\nOne-page annex.\n\n{% section header="Last Head" /%}\n\nLast section.\n', 'Running Head 1|ANNEX_COVER|Last Head'],
        ];
        for (const [name, source, regions] of short) {
          await writeFile(path.join(dir, `${name}.mdoc`), source);
          const built = await runCreateCommand([path.join(dir, `${name}.mdoc`), path.join(dir, 'out'), '--require-pdf']);
          expect(built.pdf, name).toMatchObject({ status: 'passed', words: { passed: true, knownGenerated: { footerRegions: regions.split('|') } } });
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
