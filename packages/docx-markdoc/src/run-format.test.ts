import { describe, expect } from 'vitest';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import { buildSyntheticDocx, DocxDocument, getParagraphRuns } from '@usejunior/docx-core';
import { compileMarkdoc } from './compile.js';
import { importDocxToMarkdoc } from './import.js';
import { requireMarkdoc } from './markdoc.js';

function directChild(parent: Element, localName: string): Element | undefined {
  return Array.from(parent.childNodes)
    .find((child): child is Element => child.nodeType === 1 && (child as Element).localName === localName);
}

function firstRun(paragraph: Element): Element {
  const run = Array.from(paragraph.childNodes)
    .find((child): child is Element => child.nodeType === 1 && (child as Element).localName === 'r');
  if (!run) throw new Error('Expected paragraph run.');
  return run;
}

function runContaining(paragraph: Element, text: string): Element {
  const run = getParagraphRuns(paragraph).find((candidate) => candidate.text.includes(text));
  if (!run) throw new Error(`Expected run containing ${text}.`);
  return run.r;
}

function assertDirectRunProperty(run: Element, name: string, value?: string): void {
  const property = directChild(directChild(run, 'rPr') ?? run, name);
  expect(property, `Expected direct ${name} property.`).toBeDefined();
  if (value !== undefined) expect(property?.getAttribute('w:val')).toBe(value);
}

function changeMarkdoc(markdoc: string, before: string, after: string, attributes = ''): string {
  const source = requireMarkdoc(markdoc).scaffold.find((paragraph) => paragraph.originalText === before);
  if (!source) throw new Error(`Source paragraph not found: ${before}`);
  const escapedId = source.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\{% para (id="${escapedId}"[^\\n]*) %\\}[\\s\\S]*?\\{% /para %\\}`);
  return markdoc.replace(pattern, [
    `{% change $1 operation="format-replacement" format="inherit-source-paragraph"${attributes} %}`,
    '{% before %}', before, '{% /before %}',
    // Underscores are operative text here, not CommonMark emphasis syntax.
    '{% after %}', after.replaceAll('_', '\\_'), '{% /after %}',
    '{% /change %}',
  ].join('\n'));
}

function changeMarkdocWithInlineFormats(markdoc: string, before: string, afterMarkup: string): string {
  const source = requireMarkdoc(markdoc).scaffold.find((paragraph) => paragraph.originalText === before);
  if (!source) throw new Error(`Source paragraph not found: ${before}`);
  const escapedId = source.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\{% para (id="${escapedId}"[^\\n]*) %\\}[\\s\\S]*?\\{% /para %\\}`);
  return markdoc.replace(pattern, [
    '{% change $1 operation="format-two-spans" format="inherit-source-paragraph" %}',
    '{% before %}', before, '{% /before %}',
    '{% after %}', afterMarkup, '{% /after %}',
    '{% /change %}',
  ].join('\n'));
}

function addInheritedProperties(paragraph: Element): void {
  const doc = paragraph.ownerDocument!;
  const run = firstRun(paragraph);
  const rPr = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rPr');
  const font = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rFonts');
  font.setAttribute('w:ascii', 'Aptos');
  const size = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:sz');
  size.setAttribute('w:val', '24');
  const color = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:color');
  color.setAttribute('w:val', '335577');
  for (const property of [
    doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:b'),
    doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:i'),
    font,
    size,
    color,
  ]) rPr.appendChild(property);
  run.insertBefore(rPr, run.firstChild);
}

function setMixedRuns(paragraph: Element): void {
  const doc = paragraph.ownerDocument!;
  for (const child of Array.from(paragraph.childNodes)) {
    if (!(child.nodeType === 1 && (child as Element).localName === 'pPr')) paragraph.removeChild(child);
  }
  const append = (text: string, property?: 'b' | 'i'): void => {
    const run = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:r');
    if (property) {
      const rPr = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rPr');
      rPr.appendChild(doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', `w:${property}`));
      run.appendChild(rPr);
    }
    const node = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
    node.appendChild(doc.createTextNode(text));
    run.appendChild(node);
    paragraph.appendChild(run);
  };
  append('Date: ', 'b');
  append('2026-08-12');
  append(' witnessed', 'i');
}

describe('explicit Markdoc run formatting', () => {
  itAllure('[SDX-MDOC-21][SDX-MDOC-26] overlays exactly declared formatting without dropping inherited properties', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['2026-08-12'] });
    const styled = await DocxDocument.load(original);
    addInheritedProperties(styled.getParagraphs()[0]!);
    const imported = await importDocxToMarkdoc((await styled.toBuffer({ cleanBookmarks: false })).buffer);
    const markdoc = changeMarkdoc(
      imported.markdoc,
      '2026-08-12',
      '________________',
      ' underline="single" highlight="yellow"',
    );

    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    const clean = await DocxDocument.load(result.clean);
    const accepted = await DocxDocument.load(result.tracked);
    const rejected = await DocxDocument.load(result.tracked);
    await accepted.acceptChanges();
    await rejected.rejectChanges();
    const cleanRun = runContaining(clean.getParagraphs()[0]!, '________________');
    const acceptedRun = runContaining(accepted.getParagraphs()[0]!, '________________');

    for (const run of [cleanRun, acceptedRun]) {
      assertDirectRunProperty(run, 'u', 'single');
      assertDirectRunProperty(run, 'highlight', 'yellow');
      assertDirectRunProperty(run, 'b');
      assertDirectRunProperty(run, 'i');
      assertDirectRunProperty(run, 'rFonts');
      assertDirectRunProperty(run, 'sz', '24');
      assertDirectRunProperty(run, 'color', '335577');
    }
    expect(getParagraphRuns(rejected.getParagraphs()[0]!).map((run) => run.text).join('')).toBe('2026-08-12');
    const rejectedRun = runContaining(rejected.getParagraphs()[0]!, '2026-08-12');
    expect(directChild(directChild(rejectedRun, 'rPr') ?? rejectedRun, 'u')).toBeUndefined();
    expect(directChild(directChild(rejectedRun, 'rPr') ?? rejectedRun, 'highlight')).toBeUndefined();
  });

  itAllure('[SDX-MDOC-21][SDX-MDOC-26] formats only the replacement inside a mixed-format paragraph', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Date: 2026-08-12 witnessed'] });
    const styled = await DocxDocument.load(original);
    setMixedRuns(styled.getParagraphs()[0]!);
    const imported = await importDocxToMarkdoc((await styled.toBuffer({ cleanBookmarks: false })).buffer);
    const markdoc = changeMarkdoc(
      imported.markdoc,
      'Date: 2026-08-12 witnessed',
      'Date: ________________ witnessed',
      ' underline="single" highlight="yellow"',
    );

    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    const paragraph = (await DocxDocument.load(result.clean)).getParagraphs()[0]!;
    const label = runContaining(paragraph, 'Date: ');
    const blank = runContaining(paragraph, '________________');
    const suffix = runContaining(paragraph, ' witnessed');
    assertDirectRunProperty(label, 'b');
    assertDirectRunProperty(suffix, 'i');
    assertDirectRunProperty(blank, 'u', 'single');
    assertDirectRunProperty(blank, 'highlight', 'yellow');
    expect(directChild(directChild(label, 'rPr') ?? label, 'highlight')).toBeUndefined();
    expect(directChild(directChild(suffix, 'rPr') ?? suffix, 'highlight')).toBeUndefined();
  });

  itAllure('[SDX-MDOC-22][SDX-MDOC-25] does not infer an overlay from fill-in text', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['2026-08-12'] });
    const imported = await importDocxToMarkdoc(original);
    const result = await compileMarkdoc(
      imported.anchoredSource,
      changeMarkdoc(imported.markdoc, '2026-08-12', '________________', ' format-source="2026-08-12"'),
    );
    const run = firstRun((await DocxDocument.load(result.clean)).getParagraphs()[0]!);
    expect(directChild(directChild(run, 'rPr') ?? run, 'u')).toBeUndefined();
    expect(directChild(directChild(run, 'rPr') ?? run, 'highlight')).toBeUndefined();
  });

  itAllure('[SDX-MDOC-23] rejects unknown direct-format values and ambiguous multi-hunk scope before output', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Alpha beta gamma.'] });
    const imported = await importDocxToMarkdoc(original);

    expect(() => requireMarkdoc(changeMarkdoc(imported.markdoc, 'Alpha beta gamma.', 'Alpha revised beta gamma.', ' underline="double"')))
      .toThrow(/Markdoc validation failed/);
    expect(() => requireMarkdoc(changeMarkdoc(imported.markdoc, 'Alpha beta gamma.', 'Alpha revised beta gamma.', ' color="FF0000"')))
      .toThrow(/Markdoc validation failed/);
    await expect(compileMarkdoc(
      imported.anchoredSource,
      changeMarkdoc(imported.markdoc, 'Alpha beta gamma.', 'Alpha revised beta updated gamma.', ' underline="single"'),
    )).rejects.toMatchObject({ code: 'AMBIGUOUS_RUN_FORMAT_SCOPE' });
    const deletion = changeMarkdoc(imported.markdoc, 'Alpha beta gamma.', '', ' underline="single"');
    await expect(compileMarkdoc(imported.anchoredSource, deletion))
      .rejects.toMatchObject({ code: 'AMBIGUOUS_RUN_FORMAT_SCOPE' });
  });

  itAllure('[SDX-MDOC-24] applies an overlay to one zero-width paragraph insertion', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Anchor.'] });
    const imported = await importDocxToMarkdoc(original);
    const anchor = requireMarkdoc(imported.markdoc).scaffold[0]!;
    const insertion = [
      imported.markdoc,
      `{% insert-after anchor="${anchor.id}" operation="insert-formatted" underline="single" highlight="yellow" %}`,
      '{% after %}',
      'Inserted text.',
      '{% /after %}',
      '{% /insert-after %}',
    ].join('\n');

    const result = await compileMarkdoc(imported.anchoredSource, insertion);
    const clean = await DocxDocument.load(result.clean);
    expect(getParagraphRuns(clean.getParagraphs()[1]!).map((run) => run.text).join('')).toBe('Inserted text.');
    const run = firstRun(clean.getParagraphs()[1]!);
    assertDirectRunProperty(run, 'u', 'single');
    assertDirectRunProperty(run, 'highlight', 'yellow');
  });

  itAllure('[SDX-MDOC-23] rejects formatted multi-paragraph insertion before mutation', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Anchor.'] });
    const imported = await importDocxToMarkdoc(original);
    const anchor = requireMarkdoc(imported.markdoc).scaffold[0]!;
    const insertion = [
      imported.markdoc,
      `{% insert-after anchor="${anchor.id}" operation="insert-many" underline="single" %}`,
      '{% after %}',
      'First paragraph.',
      '',
      'Second paragraph.',
      '{% /after %}',
      '{% /insert-after %}',
    ].join('\n');
    await expect(compileMarkdoc(imported.anchoredSource, insertion))
      .rejects.toMatchObject({
        code: 'INVALID_MARKDOC',
        issues: expect.arrayContaining([expect.objectContaining({ code: 'AMBIGUOUS_RUN_FORMAT_SCOPE' })]),
      });
  });

  itAllure('[SDX-MDOC-30][SDX-MDOC-31] formats two identical generated spans by exact inline position', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Dates: first and second.'] });
    const imported = await importDocxToMarkdoc(original);
    const blank = '\\_\\_\\_\\_';
    const markdoc = changeMarkdocWithInlineFormats(
      imported.markdoc,
      'Dates: first and second.',
      `Dates: {% run-format underline="single" highlight="yellow" %}${blank}{% /run-format %} and {% run-format underline="single" highlight="yellow" %}${blank}{% /run-format %}.`,
    );

    const parsed = requireMarkdoc(markdoc).operations[0]!;
    expect(parsed.runFormatSpans).toEqual([
      { start: 7, end: 11, format: { underline: 'single', highlight: 'yellow' } },
      { start: 16, end: 20, format: { underline: 'single', highlight: 'yellow' } },
    ]);
    const result = await compileMarkdoc(imported.anchoredSource, markdoc);
    const paragraph = (await DocxDocument.load(result.clean)).getParagraphs()[0]!;
    const runs = getParagraphRuns(paragraph);
    const blankRuns = runs.filter((run) => run.text === '____');
    expect(blankRuns).toHaveLength(2);
    for (const run of blankRuns) {
      assertDirectRunProperty(run.r, 'u', 'single');
      assertDirectRunProperty(run.r, 'highlight', 'yellow');
    }
    const unchanged = runs.find((run) => run.text.includes(' and '));
    expect(unchanged).toBeDefined();
    expect(directChild(directChild(unchanged!.r, 'rPr') ?? unchanged!.r, 'highlight')).toBeUndefined();
    expect(result.certificate.projectionPassed).toBe(true);
  });

  itAllure('[SDX-MDOC-32][SDX-MDOC-33] rejects inline formatting outside generated text and malformed spans', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Alpha first omega.'] });
    const imported = await importDocxToMarkdoc(original);
    const unchanged = changeMarkdocWithInlineFormats(
      imported.markdoc,
      'Alpha first omega.',
      'Alpha {% run-format underline="single" %}first{% /run-format %} revised omega.',
    );
    await expect(compileMarkdoc(imported.anchoredSource, unchanged))
      .rejects.toMatchObject({ code: 'RUN_FORMAT_SPAN_OUTSIDE_GENERATED_TEXT' });

    const crossing = changeMarkdocWithInlineFormats(
      imported.markdoc,
      'Alpha first omega.',
      'Alpha {% run-format underline="single" %}new first revised{% /run-format %} omega.',
    );
    await expect(compileMarkdoc(imported.anchoredSource, crossing))
      .rejects.toMatchObject({ code: 'RUN_FORMAT_SPAN_OUTSIDE_GENERATED_TEXT' });

    const empty = changeMarkdocWithInlineFormats(
      imported.markdoc,
      'Alpha first omega.',
      'Alpha first {% run-format underline="single" %}{% /run-format %}omega.',
    );
    expect(() => requireMarkdoc(empty)).toThrow(/Markdoc validation failed/);

    const nested = changeMarkdocWithInlineFormats(
      imported.markdoc,
      'Alpha first omega.',
      'Alpha {% run-format underline="single" %}{% run-format highlight="yellow" %}new{% /run-format %}{% /run-format %} omega.',
    );
    expect(() => requireMarkdoc(nested)).toThrow(/Markdoc validation failed/);
  });
});
