import { readFile, mkdir, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { expect } from 'vitest';
import { DocxDocument, childElements, getParagraphText, parseXml } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { createDocumentFromMarkdoc } from './create.js';
import { lowerCreationMarkdoc } from './lower.js';
import { pullCreationEdits } from './pull.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: 'Created section break layout', story: 'Issue 1425 justified section endings',
}).conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.18' });
const section = '\n\n{% section footer="Exhibit A" /%}\n\nExhibit text.';

test('uses a dedicated break only for a table or an effectively justified final paragraph', () => {
  for (const [source, profile, expected] of [
    ['Final prose.', {}, 'ownParagraph'],
    ['Final prose.', { justify: false }, 'lastParagraph'],
    ['{% paragraph-layout align="justify" %}Final prose.{% /paragraph-layout %}', { justify: false }, 'ownParagraph'],
    ['{% paragraph-layout align="left" %}Final prose.{% /paragraph-layout %}', {}, 'lastParagraph'],
    ['{% paragraph-layout align="center" %}Final prose.{% /paragraph-layout %}', {}, 'lastParagraph'],
    ['> Final quotation.', {}, 'ownParagraph'],
    ['- Final list item.', {}, 'ownParagraph'],
    ['# Final heading', {}, 'lastParagraph'],
    ['{% center %}Final legend.{% /center %}', {}, 'lastParagraph'],
    ['{% table %}\n| A | B |\n| --- | --- |\n| X | Y |\n{% /table %}', {}, 'ownParagraph'],
    ['## Heading\n\n{% toc /%}', {}, 'lastParagraph'],
  ] as const) {
    const lowering = lowerCreationMarkdoc(source + section, profile);
    expect(lowering.spec.sections[0]!.breakPlacement, source).toBe(expected);
    expect(lowering.paragraphEntries.filter(entry => entry === -1), source)
      .toHaveLength(expected === 'ownParagraph' ? 1 : 0);
    expect(lowering.projection.paragraphs.at(-2) === '', source)
      .toBe(expected === 'ownParagraph');
  }
});

test('keeps a justified section mark on a collapsed generated paragraph and preserves pull mapping', async () => {
  const source = 'Original final prose.' + section;
  const created = await createDocumentFromMarkdoc(source);
  expect(created.certificate.passed).toBe(true);
  expect(created.readback.paragraphs).toEqual(['Original final prose.', '', 'Exhibit text.']);
  expect(created.lowering.paragraphEntries).toEqual([0, -1, 2]);
  const zip = await JSZip.loadAsync(created.docx);
  const xml = parseXml(await zip.file('word/document.xml')!.async('string'));
  const paragraphs = childElements(xml.getElementsByTagNameNS(W, 'body')[0]!).filter(n => n.localName === 'p');
  expect(paragraphs[0]!.getElementsByTagNameNS(W, 'sectPr')).toHaveLength(0);
  const breakProperties = childElements(paragraphs[1]!)[0]!;
  expect(childElements(breakProperties).map(n => n.localName)).toEqual(['spacing', 'rPr', 'sectPr']);
  const spacing = breakProperties.getElementsByTagNameNS(W, 'spacing')[0]!;
  expect(['before', 'after', 'line', 'lineRule'].map(name => spacing.getAttributeNS(W, name)))
    .toEqual(['0', '0', '1', 'exact']);
  expect(breakProperties.getElementsByTagNameNS(W, 'sz')[0]!.getAttributeNS(W, 'val')).toBe('2');
  expect(breakProperties.getElementsByTagNameNS(W, 'szCs')[0]!.getAttributeNS(W, 'val')).toBe('2');
  zip.file('word/document.xml', (await zip.file('word/document.xml')!.async('string')).replace('Exhibit text.', 'Revised exhibit text.'));
  const pulled = await pullCreationEdits({ source, base: created, edited: await zip.generateAsync({ type: 'nodebuffer' }) });
  expect(pulled).toMatchObject({ complete: true, diagnostics: [], pulledSource: source.replace('Exhibit text.', 'Revised exhibit text.') });
});

test('creates verified sections from the public Mutual NDA without making the break editable content', async () => {
  const received = await DocxDocument.load(await readFile(new URL('../../../../tests/test_documents/open-agreements/mutual-nda.docx', import.meta.url)));
  const text = received.getParagraphs().map(getParagraphText).find(value => value.length > 200 && !/[`*_[\]{}<>\\]/u.test(value))!;
  expect(text).toBeDefined();
  const source = text + section;
  const created = await createDocumentFromMarkdoc(source);
  expect(created.certificate.passed).toBe(true);
  expect(created.readback.paragraphs).toEqual([text, '', 'Exhibit text.']);
  const replay = await pullCreationEdits({ source, base: created, edited: created.docx });
  expect(replay).toMatchObject({ complete: true, diagnostics: [], changes: [] });
  expect(replay.pulledSource).toBeUndefined();
  if (process.env.SAFE_DOCX_SECTION_BREAK_ARTIFACTS) {
    const directory = process.env.SAFE_DOCX_SECTION_BREAK_ARTIFACTS;
    await mkdir(directory, { recursive: true });
    await writeFile(directory + '/real-nda-section.docx', created.docx);
    await writeFile(directory + '/real-nda-section.mdoc', source);
  }
}, 30000);
