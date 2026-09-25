import { describe, expect } from 'vitest';
import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEST_FEATURE = 'Tab-adjacent word refinement';
const test = testAllure.epic('Document Comparison').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1017 tab-adjacent redline minimality',
  severity: 'critical',
}).conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
);

function body(price: string, runProperties = ''): string {
  return `<w:p><w:r>${runProperties}`
    + `<w:t xml:space="preserve">Section 1. Purchase price is ${price} hundred dollars</w:t>`
    + '<w:tab/><w:t xml:space="preserve">payable at closing.</w:t>'
    + '</w:r></w:p>';
}

function visible(xml: string): string {
  const paragraph = parseXml(xml).getElementsByTagNameNS(W, 'p')[0]!;
  const pieces: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.namespaceURI === W && element.localName === 'tab') { pieces.push('\t'); return; }
    if (element.namespaceURI === W && (element.localName === 't' || element.localName === 'delText')) {
      pieces.push(element.textContent ?? '');
      return;
    }
    for (const child of Array.from(element.childNodes)) visit(child);
  };
  visit(paragraph);
  return pieces.join('');
}

describe('tab-adjacent redline refinement (#1017)', () => {
  test('keeps common words and the structural tab outside one-word replacement wrappers', async () => {
    const original = await buildDocxFromBodyXml(body('one'));
    const revised = await buildDocxFromBodyXml(body('two'));
    const comparison = await compareDocumentsAtomizer(original, revised, {
      date: new Date('2026-09-23T00:00:00Z'),
    });
    const xml = await (await DocxArchive.load(comparison.document)).getDocumentXml();
    const document = parseXml(xml);
    const deleted = Array.from(document.getElementsByTagNameNS(W, 'delText')).map((node) => node.textContent ?? '');
    const inserted = Array.from(document.getElementsByTagNameNS(W, 'ins')).map((node) => node.textContent ?? '');
    expect(deleted).toEqual(['one']);
    expect(inserted).toEqual(['two']);
    expect(document.getElementsByTagNameNS(W, 'tab')).toHaveLength(1);
    expect(visible(acceptAllChanges(xml))).toBe(visible(await (await DocxArchive.load(revised)).getDocumentXml()));
    expect(visible(rejectAllChanges(xml))).toBe(visible(await (await DocxArchive.load(original)).getDocumentXml()));
  });

  test('refines a single text child beside an unchanged leading tab', async () => {
    const tabRun = (word: string) => `<w:p><w:r><w:tab/><w:t>${word} hundred dollars</w:t></w:r></w:p>`;
    const original = await buildDocxFromBodyXml(tabRun('one'));
    const revised = await buildDocxFromBodyXml(tabRun('two'));
    const result = await compareDocumentsAtomizer(original, revised);
    const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
    const document = parseXml(xml);
    expect(Array.from(document.getElementsByTagNameNS(W, 'delText')).map((node) => node.textContent)).toEqual(['one']);
    expect(Array.from(document.getElementsByTagNameNS(W, 'ins')).map((node) => node.textContent)).toEqual(['two']);
    expect(document.getElementsByTagNameNS(W, 'tab')).toHaveLength(1);
    expect(visible(acceptAllChanges(xml))).toBe('\ttwo hundred dollars');
    expect(visible(rejectAllChanges(xml))).toBe('\tone hundred dollars');
  });

  test('refines a legal clause with repeated common words beside a tab', async () => {
    const clause = (word: string) => '<w:p><w:r>'
      + `<w:t>The Buyer shall pay the Seller the sum of ${word} hundred dollars</w:t>`
      + '<w:tab/><w:t>on the date of the closing.</w:t></w:r></w:p>';
    const original = await buildDocxFromBodyXml(clause('one'));
    const revised = await buildDocxFromBodyXml(clause('two'));
    const result = await compareDocumentsAtomizer(original, revised);
    const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
    const document = parseXml(xml);
    const deleted = Array.from(document.getElementsByTagNameNS(W, 'delText')).map((node) => node.textContent ?? '');
    const inserted = Array.from(document.getElementsByTagNameNS(W, 'ins')).map((node) => node.textContent ?? '');
    expect(deleted).toEqual(['one']);
    expect(inserted).toEqual(['two']);
    expect(document.getElementsByTagNameNS(W, 'tab')).toHaveLength(1);
    expect(visible(acceptAllChanges(xml))).toBe(visible(await (await DocxArchive.load(revised)).getDocumentXml()));
    expect(visible(rejectAllChanges(xml))).toBe(visible(await (await DocxArchive.load(original)).getDocumentXml()));
  });

  test('keeps multiple unchanged tabs while refining text on both sides', async () => {
    const multiTab = (first: string, last: string) => '<w:p><w:r>'
      + `<w:t>${first} total</w:t><w:tab/><w:tab/><w:t>${last} due</w:t>`
      + '</w:r></w:p>';
    const original = await buildDocxFromBodyXml(multiTab('one', 'three'));
    const revised = await buildDocxFromBodyXml(multiTab('two', 'four'));
    const result = await compareDocumentsAtomizer(original, revised);
    const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
    const document = parseXml(xml);
    expect(Array.from(document.getElementsByTagNameNS(W, 'delText')).map((node) => node.textContent)).toEqual(['one', 'three']);
    expect(Array.from(document.getElementsByTagNameNS(W, 'ins')).map((node) => node.textContent)).toEqual(['two', 'four']);
    expect(document.getElementsByTagNameNS(W, 'tab')).toHaveLength(2);
    expect(visible(acceptAllChanges(xml))).toBe(visible(await (await DocxArchive.load(revised)).getDocumentXml()));
    expect(visible(rejectAllChanges(xml))).toBe(visible(await (await DocxArchive.load(original)).getDocumentXml()));
  });

  test('does not align a moved word across the tab boundary', async () => {
    const original = await buildDocxFromBodyXml('<w:p><w:r><w:t>alpha beta</w:t><w:tab/><w:t>gamma</w:t></w:r></w:p>');
    const revised = await buildDocxFromBodyXml('<w:p><w:r><w:t>alpha</w:t><w:tab/><w:t>beta gamma</w:t></w:r></w:p>');
    const result = await compareDocumentsAtomizer(original, revised);
    const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
    const document = parseXml(xml);
    expect(Array.from(document.getElementsByTagNameNS(W, 'delText')).map((node) => node.textContent)).toEqual([' beta']);
    expect(Array.from(document.getElementsByTagNameNS(W, 'ins')).map((node) => node.textContent)).toEqual(['beta ']);
    expect(document.getElementsByTagNameNS(W, 'tab')).toHaveLength(1);
    expect(visible(acceptAllChanges(xml))).toBe(visible(await (await DocxArchive.load(revised)).getDocumentXml()));
    expect(visible(rejectAllChanges(xml))).toBe(visible(await (await DocxArchive.load(original)).getDocumentXml()));
  });

  test('does not refine across incompatible direct run formatting', async () => {
    const original = await buildDocxFromBodyXml(body('one', '<w:rPr><w:b/></w:rPr>'));
    const revised = await buildDocxFromBodyXml(body('two', '<w:rPr><w:i/></w:rPr>'));
    const result = await compareDocumentsAtomizer(original, revised);
    const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
    const document = parseXml(xml);
    const deleted = Array.from(document.getElementsByTagNameNS(W, 'delText')).map((node) => node.textContent ?? '');
    expect(deleted).toEqual(['Section 1. Purchase price is one hundred dollars', 'payable at closing.']);
    expect(visible(acceptAllChanges(xml))).toBe(visible(await (await DocxArchive.load(revised)).getDocumentXml()));
    expect(visible(rejectAllChanges(xml))).toBe(visible(await (await DocxArchive.load(original)).getDocumentXml()));
  });
});
