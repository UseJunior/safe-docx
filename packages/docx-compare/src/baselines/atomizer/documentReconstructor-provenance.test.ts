/**
 * Characterization tests for the rebuild-side original-`w:ins` provenance
 * threading in documentReconstructor (issue #358).
 *
 * When merged atoms whose ORIGINAL lineage sat inside a pre-tracked `<w:ins>`
 * are reconstructed on the rebuild path, the reconstructor must nest the fresh
 * comparison deletion inside a restored insertion —
 * `<w:ins original-author><w:del>…</w:del></w:ins>` — so that reject-all drops
 * the content together with the original insertion (INV-RT-001), while
 * accept-all unwraps the emptied insertion. These paths
 * (`partitionAtomsByInsProvenance`, `buildRunGroupXmlWithInsProvenance`, and the
 * whole-paragraph provenance branch of `buildParagraphXml`) are reachable only
 * by handing `reconstructDocument` atoms that carry an original `w:ins`
 * `revTrackElement`, which no pipeline-driven sibling test produces.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/358
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { el } from '../../testing/dom-test-helpers.js';
import { reconstructDocument } from './documentReconstructor.js';
import type { ComparisonUnitAtom, OpcPart } from '@usejunior/docx-core';
import { CorrelationStatus } from '@usejunior/docx-core';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Document Reconstructor Provenance' });

const PART: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
const OPTS = { author: 'Comparison', date: new Date('2025-01-01T00:00:00Z') };

const MINIMAL_BODY = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
  '<w:body>',
  '<w:p><w:r><w:t>placeholder</w:t></w:r></w:p>',
  '</w:body>',
  '</w:document>',
].join('');

/**
 * Build a Deleted atom. When `insAuthor` is provided the atom is annotated as
 * an original-tree atom whose lineage sat inside a pre-tracked `<w:ins>`, so
 * `getOriginalInsProvenance` resolves to that author.
 */
function deletedAtom(
  text: string,
  opts: { insAuthor?: string; insDate?: string; paragraphIndex?: number } = {},
): ComparisonUnitAtom {
  const textEl = el('w:t', {}, undefined, text);
  const run = el('w:r', {}, [textEl]);
  const paragraph = el('w:p', {}, [run]);
  const atom: ComparisonUnitAtom = {
    sha1Hash: `hash-${text}`,
    correlationStatus: CorrelationStatus.Deleted,
    contentElement: textEl,
    ancestorElements: [paragraph, run],
    ancestorUnids: [],
    part: PART,
    paragraphIndex: opts.paragraphIndex ?? 0,
    sourceDocument: 'original',
    rPr: null,
  };
  if (opts.insAuthor) {
    const insAttrs: Record<string, string> = { 'w:author': opts.insAuthor };
    if (opts.insDate) insAttrs['w:date'] = opts.insDate;
    atom.revTrackElement = el('w:ins', insAttrs);
  }
  return atom;
}

describe('documentReconstructor original-ins provenance (issue #358, rebuild path)', () => {
  test('whole-paragraph delete of pre-tracked-inserted text nests w:del inside a restored w:ins', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let xml: string;

    await given('a fully-deleted paragraph whose words came from an original w:ins by "Alice"', () => {});

    await when('the document is reconstructed', () => {
      const atoms = [
        deletedAtom('deleted', { insAuthor: 'Alice', insDate: '2024-06-01T00:00:00Z' }),
        deletedAtom('words', { insAuthor: 'Alice', insDate: '2024-06-01T00:00:00Z' }),
      ];
      xml = reconstructDocument(atoms, MINIMAL_BODY, OPTS);
    });

    await then('the deletion is wrapped in a restored insertion attributed to the original author', () => {
      expect(xml).toContain('<w:ins');
      expect(xml).toContain('w:author="Alice"');
      expect(xml).toContain('w:date="2024-06-01T00:00:00Z"');
      expect(xml).toContain('<w:del');
      expect(xml).toContain('<w:delText');
    });

    await and('the restored insertion directly encloses the content deletion (ins outside, del inside)', () => {
      // The pPr carries an independent paragraph-mark w:del; the content
      // nesting is the w:ins by Alice immediately wrapping a w:del.
      expect(xml).toMatch(/<w:ins\b[^>]*w:author="Alice"[^>]*>\s*<w:del\b/);
    });
  });

  test('a provenance boundary splits one run group into separate w:del spans', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let xml: string;

    await given('a deleted run mixing pre-tracked-inserted words with plain words', () => {});

    await when('the paragraph is NOT wholly deleted so the inline provenance path runs', () => {
      // A trailing Equal atom keeps the paragraph from being an entire-paragraph
      // delete, routing the deleted run through buildRunGroupXmlWithInsProvenance.
      const equalTextEl = el('w:t', {}, undefined, 'kept');
      const equalRun = el('w:r', {}, [equalTextEl]);
      const equalPara = el('w:p', {}, [equalRun]);
      const equal: ComparisonUnitAtom = {
        sha1Hash: 'hash-kept',
        correlationStatus: CorrelationStatus.Equal,
        contentElement: equalTextEl,
        ancestorElements: [equalPara, equalRun],
        ancestorUnids: [],
        part: PART,
        paragraphIndex: 0,
        sourceDocument: 'revised',
        rPr: null,
      };
      const atoms = [
        deletedAtom('fromIns', { insAuthor: 'Bob', insDate: '2024-02-02T00:00:00Z' }),
        deletedAtom('plain'),
        equal,
      ];
      xml = reconstructDocument(atoms, MINIMAL_BODY, OPTS);
    });

    await then('the pre-tracked span is wrapped in a restored w:ins by "Bob"', () => {
      expect(xml).toContain('w:author="Bob"');
      expect(xml).toContain('<w:ins');
    });

    await and('the plain deleted span and the equal text are still emitted', () => {
      expect(xml).toContain('<w:del');
      expect(xml).toContain('plain');
      expect(xml).toContain('kept');
    });
  });

  test('provenance atoms sharing one author collapse into a single restored insertion span', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml: string;

    await given('two adjacent deleted atoms from the same original w:ins author+date', () => {});

    await when('the whole paragraph is reconstructed', () => {
      const atoms = [
        deletedAtom('one', { insAuthor: 'Carol', insDate: '2024-03-03T00:00:00Z' }),
        deletedAtom('two', { insAuthor: 'Carol', insDate: '2024-03-03T00:00:00Z' }),
      ];
      xml = reconstructDocument(atoms, MINIMAL_BODY, OPTS);
    });

    await then('the two atoms share a single w:ins wrapper (one restored insertion)', () => {
      const insCount = (xml.match(/<w:ins\b/g) ?? []).length;
      expect(insCount).toBe(1);
      expect(xml).toContain('w:author="Carol"');
    });
  });
});
