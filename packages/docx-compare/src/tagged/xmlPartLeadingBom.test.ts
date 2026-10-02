/**
 * Comparison of packages whose XML parts begin with a UTF-8 byte-order mark,
 * or with whitespace before the `<?xml` declaration (#1024). A BOM is legal
 * XML and Word's ISO-Strict exports emit it; the comparison must treat such a
 * part exactly like the same part without it.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1024
 */

import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import {
  buildDocxFromParts,
  buildSyntheticDocx,
  stripXmlLeadingNoise,
  XmlPartParseError,
} from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments, type CompareResult } from '../index.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'XML part leading BOM tolerance' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const BOM = '﻿';
const OPTIONS = { author: 'BOM Gate', date: new Date('2026-10-01T00:00:00Z') };

const STYLES_XML =
  `${DECL}<w:styles xmlns:w="${W_NS}">` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>` +
  `<w:rPr><w:b/></w:rPr></w:style></w:styles>`;
const NUMBERING_XML =
  `${DECL}<w:numbering xmlns:w="${W_NS}">` +
  `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/>` +
  `<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>` +
  `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
const styledBody = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

async function prefixParts(buffer: Buffer, parts: readonly string[], prefix: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  for (const part of parts) {
    const text = await zip.file(part)!.async('string');
    zip.file(part, prefix + text);
  }
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

/**
 * Every part of a comparison result, with any leading BOM/whitespace removed
 * from XML parts: parts the comparison passes through untouched keep their
 * source bytes, so the BOM may legitimately survive there.
 */
async function resultParts(result: CompareResult): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(result.document);
  const parts: Record<string, string> = {};
  for (const name of Object.keys(zip.files).sort()) {
    const file = zip.files[name]!;
    if (file.dir) continue;
    parts[name] = stripXmlLeadingNoise(await file.async('string'));
  }
  return parts;
}

async function observe(original: Buffer, revised: Buffer) {
  const result = await compareDocuments(original, revised, OPTIONS);
  return { stats: result.stats, parts: await resultParts(result) };
}

interface Scenario {
  name: string;
  build: (text: string) => Promise<Buffer>;
  parts: readonly string[];
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'word/document.xml',
    build: (text) => buildSyntheticDocx({ paragraphs: [text, 'Delta echo foxtrot.'] }),
    parts: ['word/document.xml'],
  },
  {
    name: 'word/styles.xml and word/numbering.xml',
    build: (text) =>
      buildDocxFromParts({ bodyXml: styledBody(text), stylesXml: STYLES_XML, numberingXml: NUMBERING_XML }),
    parts: ['word/styles.xml', 'word/numbering.xml'],
  },
  {
    name: 'word/footnotes.xml',
    build: (text) =>
      buildSyntheticDocx({ paragraphs: [text, 'Delta echo foxtrot.'], footnoteOnParagraph: 1, footnoteText: 'A note.' }),
    parts: ['word/footnotes.xml'],
  },
  {
    name: 'every XML part including relationships and content types',
    build: (text) =>
      buildSyntheticDocx({ paragraphs: [text, 'Delta echo foxtrot.'], footnoteOnParagraph: 1, footnoteText: 'A note.' }),
    parts: [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/footnotes.xml',
    ],
  },
];

const PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['a BOM', BOM],
  ['a leading newline', '\n'],
  ['a BOM and leading whitespace', `${BOM}\r\n  `],
];

describe('compareDocuments with BOM- or whitespace-prefixed XML parts', () => {
  for (const scenario of SCENARIOS) {
    for (const [label, prefix] of PREFIXES) {
      test(`${scenario.name} with ${label}: self-compare and an edit match the clean package`, async () => {
        const original = await scenario.build('Alpha bravo charlie.');
        const revised = await scenario.build('Alpha bravo delta.');
        const prefixedOriginal = await prefixParts(original, scenario.parts, prefix);
        const prefixedRevised = await prefixParts(revised, scenario.parts, prefix);

        const cleanSelf = await observe(original, original);
        const prefixedSelf = await observe(prefixedOriginal, prefixedOriginal);
        expect(prefixedSelf).toEqual(cleanSelf);
        expect(prefixedSelf.stats.insertions + prefixedSelf.stats.deletions + prefixedSelf.stats.modifications).toBe(0);

        const cleanEdit = await observe(original, revised);
        expect(cleanEdit.stats.insertions + cleanEdit.stats.deletions + cleanEdit.stats.modifications).toBeGreaterThan(0);
        expect(await observe(prefixedOriginal, prefixedRevised)).toEqual(cleanEdit);
        // Mixed: only one side carries the prefix.
        expect(await observe(prefixedOriginal, revised)).toEqual(cleanEdit);
      });
    }
  }
});

describe('compareDocuments names a malformed part', () => {
  const MALFORMED: ReadonlyArray<readonly [string, string]> = [
    // The relationships part is where the NVCA Voting Agreement's BOM crashed.
    ['word/_rels/document.xml.rels', '</Relationships>'],
    ['word/document.xml', '</w:document>'],
  ];
  for (const [part, closingTag] of MALFORMED) {
    test(`a parse failure in the revised ${part} names the part and side instead of a raw ParseError`, async () => {
      const original = await buildSyntheticDocx({ paragraphs: ['Alpha bravo charlie.'] });
      const zip = await JSZip.loadAsync(original);
      const xml = await zip.file(part)!.async('string');
      // Drop the closing root tag: a fatal, non-BOM parse error.
      zip.file(part, xml.replace(closingTag, ''));
      const revised = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;

      const failure = await compareDocuments(original, revised, OPTIONS).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(XmlPartParseError);
      expect((failure as XmlPartParseError).partName).toBe(part);
      expect((failure as XmlPartParseError).source).toBe('revised');
      expect((failure as Error).message).toContain(`Failed to parse XML part ${part} in the revised document: `);
      expect(((failure as Error).cause as Error).name).toBe('ParseError');
    });
  }
});
