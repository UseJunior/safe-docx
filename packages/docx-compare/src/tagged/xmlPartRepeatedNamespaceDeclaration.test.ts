/**
 * Comparison of packages whose parts repeat a namespace declaration on one
 * start tag (#1032), e.g. `<w:document xmlns:w="…main" xmlns:w="…main">`. An
 * external benchmark hit this on 7 of 803 public pairs and got a raw xmldom
 * `ParseError`. An exact repeat must compare like the clean package; a repeat
 * with a different URI must fail with a typed error naming the part and side.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1032
 */

import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import {
  DocxArchive,
  removeRepeatedNamespaceDeclarations,
  XmlNamespaceRedeclarationError,
  XmlPartParseError,
} from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxWithDefaultFooter } from '../testing/footer-story-fixture.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { compareDocuments, type CompareResult } from '../index.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'XML part repeated namespace declaration tolerance' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const OTHER_NS = 'urn:example:not-wordprocessingml';
const OPTIONS = { author: 'Namespace Gate', date: new Date('2026-11-01T00:00:00Z') };

const body = (text: string) =>
  `<w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:p><w:r><w:t>Delta echo foxtrot.</w:t></w:r></w:p>`;

/** `uri`: repeat `xmlns:w` on every part root with it; null: the clean package. */
type Repeat = string | null;

/** Main part only: the shared builder appends `namespaces` after its own `xmlns:w`. */
function buildMain(text: string, repeat: Repeat): Promise<Buffer> {
  return buildDocxFromBodyXml(body(text), [], repeat === null ? {} : { namespaces: { w: repeat } });
}

/** Main part plus a default footer, both repeating `xmlns:w` when `repeat` is set. */
async function buildMainAndFooter(text: string, repeat: Repeat): Promise<Buffer> {
  const built = await buildDocxWithDefaultFooter(text, 'Footer text.');
  if (repeat === null) return built;
  const archive = await DocxArchive.load(built);
  const repeatOn = (xml: string, root: string) => xml.replace(`<${root} `, `<${root} xmlns:w="${repeat}" `);
  archive.setDocumentXml(repeatOn(await archive.getDocumentXml(), 'w:document'));
  archive.setFile('word/footer1.xml', repeatOn((await archive.getFile('word/footer1.xml'))!, 'w:ftr'));
  return archive.save();
}

/**
 * Every part of a comparison result. Parts the comparison passes through
 * untouched keep their source bytes, so an exact repeat may survive there;
 * it is removed before comparing with the clean result.
 */
async function resultParts(result: CompareResult): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(result.document);
  const parts: Record<string, string> = {};
  for (const name of Object.keys(zip.files).sort()) {
    const file = zip.files[name]!;
    if (file.dir) continue;
    const text = await file.async('string');
    parts[name] = removeRepeatedNamespaceDeclarations(text) ?? text;
  }
  return parts;
}

async function observe(original: Buffer, revised: Buffer) {
  const result = await compareDocuments(original, revised, OPTIONS);
  return { stats: result.stats, parts: await resultParts(result) };
}

const SCENARIOS = [
  { name: 'word/document.xml', build: buildMain, failingPart: 'word/document.xml' },
  { name: 'word/document.xml and a footer', build: buildMainAndFooter, failingPart: 'word/document.xml' },
] as const;

describe('compareDocuments with a repeated namespace declaration', () => {
  for (const scenario of SCENARIOS) {
    test(`${scenario.name} repeating xmlns:w: self-compare and an edit match the clean package`, async () => {
      const original = await scenario.build('Alpha bravo charlie.', null);
      const revised = await scenario.build('Alpha bravo delta.', null);
      const repeatedOriginal = await scenario.build('Alpha bravo charlie.', W_NS);
      const repeatedRevised = await scenario.build('Alpha bravo delta.', W_NS);

      const cleanSelf = await observe(original, original);
      const repeatedSelf = await observe(repeatedOriginal, repeatedOriginal);
      expect(repeatedSelf).toEqual(cleanSelf);
      expect(repeatedSelf.stats.insertions + repeatedSelf.stats.deletions + repeatedSelf.stats.modifications).toBe(0);

      const cleanEdit = await observe(original, revised);
      expect(cleanEdit.stats.insertions + cleanEdit.stats.deletions + cleanEdit.stats.modifications).toBeGreaterThan(0);
      expect(await observe(repeatedOriginal, repeatedRevised)).toEqual(cleanEdit);
      // Mixed: only one side repeats the declaration.
      expect(await observe(original, repeatedRevised)).toEqual(cleanEdit);
    });

    for (const side of ['original', 'revised'] as const) {
      test(`${scenario.name} with a conflicting xmlns:w in the ${side} document fails with a typed error naming the part and side`, async () => {
        const clean = await scenario.build('Alpha bravo charlie.', null);
        const conflicting = await scenario.build('Alpha bravo delta.', OTHER_NS);
        const [original, revised] = side === 'original' ? [conflicting, clean] : [clean, conflicting];

        const failure = await compareDocuments(original, revised, OPTIONS).then(
          () => null,
          (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(XmlPartParseError);
        expect((failure as XmlPartParseError).partName).toBe(scenario.failingPart);
        expect((failure as XmlPartParseError).source).toBe(side);
        expect((failure as Error).message).toContain(
          `Failed to parse XML part ${scenario.failingPart} in the ${side} document: `,
        );
        expect((failure as Error).cause).toBeInstanceOf(XmlNamespaceRedeclarationError);
      });
    }
  }
});
