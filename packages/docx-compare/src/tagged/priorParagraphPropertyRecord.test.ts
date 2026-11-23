/**
 * A revised input whose paragraph carries a prior `w:pPrChange` (or whose
 * paragraph mark carries a prior `w:rPrChange`) used to come out of a
 * comparison with that record re-authored by the comparison author, losing
 * the prior author and date. These tests pin the prior record kept as
 * written whenever its old-value snapshot is the original's properties, a
 * comparison record otherwise, schema validity, and both PRESERVE laws under
 * both acceptors.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1566
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { DocxArchive, DocxDocument, parseXml } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { compareDocuments, acceptAllChanges, rejectAllChanges } from '../index.js';

const TEST_FEATURE = 'Prior paragraph property record in a comparison input';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SCHEMA_SCRIPT = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));
const DATE = 'w:date="2026-01-01T00:00:00Z"';

const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (xml: string, pPr = '') => `<w:p>${pPr}${xml}</w:p>`;
const priorPPr = (base: string, old = '') =>
  `<w:pPr>${base}<w:pPrChange w:id="8" w:author="Reviewer" ${DATE}><w:pPr>${old}</w:pPr></w:pPrChange></w:pPr>`;

const elements = (node: Node): Element[] =>
  Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
/** Namespace-aware form of a property, independent of attribute order and prefixes. */
const serialize = (element: Element): string => {
  const attributes = Array.from(element.attributes).filter(attribute => !attribute.name.startsWith('xmlns'))
    .map(attribute => `${attribute.namespaceURI}:${attribute.localName}=${attribute.value}`).sort();
  return `${element.namespaceURI}:${element.localName}{${attributes.join(';')}}`;
};

/** Per paragraph: text, base paragraph properties and paragraph-mark formatting, records excluded. */
function paragraphProjection(xml: string): string[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W, 'p')).map(paragraph => {
    const pPr = elements(paragraph).find(child => child.localName === 'pPr');
    const base = pPr ? elements(pPr).filter(child => !['rPr', 'sectPr', 'pPrChange'].includes(child.localName)).map(serialize).join('') : '';
    const mark = pPr && elements(pPr).find(child => child.localName === 'rPr');
    const markFormat = mark ? elements(mark).filter(child => child.localName !== 'rPrChange').map(child => child.localName).join(',') : '';
    const text = Array.from(paragraph.getElementsByTagNameNS(W, 't')).map(node => node.textContent ?? '').join('');
    return `${base}|${markFormat}|${text}`;
  });
}

/** Author and ID of every record of the given local name. */
function records(xml: string, localName: string): string[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W, localName))
    .map(record => `${record.getAttributeNS(W, 'author')}#${record.getAttributeNS(W, 'id')}`);
}

async function nativeDocumentXml(docx: Buffer, operation: 'acceptChanges' | 'rejectChanges'): Promise<string> {
  const document = await DocxDocument.load(docx);
  await document[operation]();
  return (await DocxArchive.load((await document.toBuffer()).buffer)).getDocumentXml();
}

async function expectSchemaValid(docx: Buffer): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sdx-1566-'));
  try {
    const path = join(dir, 'out.docx');
    await writeFile(path, docx);
    const check = spawnSync(process.execPath, [SCHEMA_SCRIPT, path], { encoding: 'utf8' });
    expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Compare, then check schema validity and both PRESERVE laws under both acceptors. */
async function compareAndCheck(originalBody: string, revisedBody: string): Promise<string> {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  const result = await compareDocuments(original, revised, { author: 'cmp' });
  const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
  await expectSchemaValid(result.document);

  const expectedAccepted = paragraphProjection(acceptAllChanges(await (await DocxArchive.load(revised)).getDocumentXml()));
  const expectedRejected = paragraphProjection(rejectAllChanges(await (await DocxArchive.load(original)).getDocumentXml()));
  expect(paragraphProjection(acceptAllChanges(xml))).toEqual(expectedAccepted);
  expect(paragraphProjection(rejectAllChanges(xml))).toEqual(expectedRejected);
  expect(paragraphProjection(await nativeDocumentXml(result.document, 'acceptChanges'))).toEqual(expectedAccepted);
  expect(paragraphProjection(await nativeDocumentXml(result.document, 'rejectChanges'))).toEqual(expectedRejected);
  return xml;
}

const CLEAN = p(t('Para text'));
const PRIOR = p(t('Para text'), priorPPr('<w:jc w:val="center"/>'));

describe('a prior paragraph property record in a comparison input', () => {
  const pPrChange = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.29' });
  const markRPrChange = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.30' });

  pPrChange('keeps the prior pPrChange author, date and ID when its snapshot is the clean original', async () => {
    const xml = await compareAndCheck(CLEAN, PRIOR);
    expect(records(xml, 'pPrChange')).toEqual(['Reviewer#8']);
    expect(parseXml(xml).getElementsByTagNameNS(W, 'pPrChange')[0]!.getAttributeNS(W, 'date')).toBe('2026-01-01T00:00:00Z');
  });

  pPrChange('keeps the prior pPrChange beside a comparison text edit in the same paragraph', async () => {
    const xml = await compareAndCheck(CLEAN, p(t('Para text more'), priorPPr('<w:jc w:val="center"/>')));
    expect(records(xml, 'pPrChange')).toEqual(['Reviewer#8']);
    expect(records(xml, 'ins')).toEqual([expect.stringMatching(/^cmp#/)]);
  });

  pPrChange('keeps the prior pPrChange when both redlines carry it, with and without a further base change', async () => {
    expect(records(await compareAndCheck(PRIOR, PRIOR), 'pPrChange')).toEqual(['Reviewer#8']);
    const indented = p(t('Para text'), priorPPr('<w:ind w:left="720"/><w:jc w:val="center"/>'));
    expect(records(await compareAndCheck(PRIOR, indented), 'pPrChange')).toEqual(['Reviewer#8']);
  });

  pPrChange('keeps the original prior pPrChange in the reverse direction', async () => {
    expect(records(await compareAndCheck(PRIOR, CLEAN), 'pPrChange')).toEqual(['Reviewer#8']);
  });

  pPrChange('records the comparison change when the prior snapshot is not the original properties', async () => {
    const xml = await compareAndCheck(p(t('Para text'), '<w:pPr><w:jc w:val="left"/></w:pPr>'), PRIOR);
    expect(records(xml, 'pPrChange')).toEqual([expect.stringMatching(/^cmp#/)]);
  });

  markRPrChange('keeps a prior paragraph-mark rPrChange whose snapshot is the clean original mark', async () => {
    const revised = p(t('Para text'), `<w:pPr><w:rPr><w:b/><w:rPrChange w:id="7" w:author="Reviewer" ${DATE}><w:rPr/></w:rPrChange></w:rPr></w:pPr>`);
    const xml = await compareAndCheck(CLEAN, revised);
    expect(records(xml, 'rPrChange')).toEqual(['Reviewer#7']);
  });
  pPrChange('matches the prior snapshot regardless of attribute order and namespace prefix', async () => {
    const original = p(t('Para text'), '<w:pPr><w:ind w:left="720" w:right="360"/></w:pPr>');
    const reordered = p(t('Para text'), priorPPr('<w:ind w:left="720" w:right="360"/><w:jc w:val="center"/>', '<w:ind w:right="360" w:left="720"/>'));
    expect(records(await compareAndCheck(original, reordered), 'pPrChange')).toEqual(['Reviewer#8']);
    const prefixed = p(t('Para text'), priorPPr('<w:jc w:val="center"/>', `<x:jc xmlns:x="${W}" x:val="left"/>`));
    expect(records(await compareAndCheck(p(t('Para text'), '<w:pPr><w:jc w:val="left"/></w:pPr>'), prefixed), 'pPrChange')).toEqual(['Reviewer#8']);
  });

  markRPrChange('matches a prior mark snapshot regardless of attribute order', async () => {
    const original = p(t('Para text'), '<w:pPr><w:rPr><w:lang w:val="en-US" w:eastAsia="ja-JP"/></w:rPr></w:pPr>');
    const revised = p(t('Para text'), `<w:pPr><w:rPr><w:b/><w:lang w:val="en-US" w:eastAsia="ja-JP"/><w:rPrChange w:id="7" w:author="Reviewer" ${DATE}><w:rPr><w:lang w:eastAsia="ja-JP" w:val="en-US"/></w:rPr></w:rPrChange></w:rPr></w:pPr>`);
    expect(records(await compareAndCheck(original, revised), 'rPrChange')).toEqual(['Reviewer#7']);
  });
});
