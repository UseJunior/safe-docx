/**
 * Characterization tests for structural helpers of documentReconstructor:
 * the legacy `buildDocument` splicer, the "no w:body" guards, and the
 * paragraph/run-group boundary fallbacks in `shouldStartNewParagraph` /
 * `shouldStartNewRunGroup`.
 *
 * These paths are reachable either directly (the exported legacy
 * `buildDocument`) or by handing `reconstructDocument` atom streams whose
 * `paragraphIndex` / `moveName` shapes drive the grouping fallbacks that
 * pipeline-sourced atoms never produce.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { el } from '../../testing/dom-test-helpers.js';
import { buildDocument, reconstructDocument } from './documentReconstructor.js';
import type { ComparisonUnitAtom, OpcPart } from '@usejunior/docx-core';
import { CorrelationStatus } from '@usejunior/docx-core';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Document Reconstructor Structure' });

const PART: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
const OPTS = { author: 'Comparison', date: new Date('2025-01-01T00:00:00Z') };

function docXml(bodyInner: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    bodyInner,
    '</w:body>',
    '</w:document>',
  ].join('');
}

const MINIMAL_BODY = docXml('<w:p><w:r><w:t>placeholder</w:t></w:r></w:p>');

/** Build a simple text atom with the given status and paragraph index. */
function atom(
  text: string,
  opts: {
    status?: CorrelationStatus;
    paragraphIndex?: number | undefined;
    moveName?: string;
  } = {},
): ComparisonUnitAtom {
  const textEl = el('w:t', {}, undefined, text);
  const run = el('w:r', {}, [textEl]);
  const paragraph = el('w:p', {}, [run]);
  const a: ComparisonUnitAtom = {
    sha1Hash: `hash-${text}`,
    correlationStatus: opts.status ?? CorrelationStatus.Equal,
    contentElement: textEl,
    ancestorElements: [paragraph, run],
    ancestorUnids: [],
    part: PART,
    sourceDocument: 'revised',
    rPr: null,
  };
  if ('paragraphIndex' in opts) a.paragraphIndex = opts.paragraphIndex;
  else a.paragraphIndex = 0;
  if (opts.moveName !== undefined) a.moveName = opts.moveName;
  return a;
}

describe('legacy buildDocument splicer', () => {
  test('splices reconstructed paragraphs between the original w:body tags', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let result: string;

    await given('an original document and two reconstructed paragraph fragments', () => {});

    await when('buildDocument splices them in', () => {
      result = buildDocument(
        docXml('<w:p><w:r><w:t>old</w:t></w:r></w:p>'),
        ['<w:p><w:r><w:t>one</w:t></w:r></w:p>', '<w:p><w:r><w:t>two</w:t></w:r></w:p>'],
      );
    });

    await then('both new paragraphs appear inside the body', () => {
      expect(result).toContain('<w:body>');
      expect(result).toContain('one');
      expect(result).toContain('two');
    });

    await and('the original body content is replaced, not appended', () => {
      expect(result).not.toContain('old');
    });
  });

  test('throws when the original document has no w:body', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let thrown: Error | undefined;

    await given('an original XML string with no w:body element', () => {});

    await when('buildDocument is invoked', () => {
      try {
        buildDocument('<w:document xmlns:w="http://x"/>', ['<w:p/>']);
      } catch (e) {
        thrown = e as Error;
      }
    });

    await then('it throws a "Could not find w:body" error', () => {
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown?.message).toContain('Could not find w:body');
    });
  });
});

describe('reconstructDocument body guard', () => {
  test('throws when the original XML lacks a w:body', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let thrown: Error | undefined;

    await given('a valid atom stream but an original XML with no w:body', () => {});

    await when('reconstructDocument is invoked', () => {
      try {
        reconstructDocument([atom('text')], '<w:document xmlns:w="http://x"/>', OPTS);
      } catch (e) {
        thrown = e as Error;
      }
    });

    await then('it throws a "Could not find w:body" error', () => {
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown?.message).toContain('Could not find w:body');
    });
  });
});

describe('paragraph / run-group boundary fallbacks', () => {
  test('an atom with no paragraphIndex stays in the current paragraph', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml: string;

    await given('two atoms where the second has an undefined paragraphIndex', () => {});

    await when('the document is reconstructed', () => {
      const atoms = [
        atom('first', { paragraphIndex: 0 }),
        atom('second', { paragraphIndex: undefined }),
      ];
      xml = reconstructDocument(atoms, MINIMAL_BODY, OPTS);
    });

    await then('both atoms land in a single paragraph (no split on the undefined index)', () => {
      const paraCount = (xml.match(/<w:p\b/g) ?? []).length;
      expect(paraCount).toBe(1);
      expect(xml).toContain('first');
      expect(xml).toContain('second');
    });
  });

  test('adjacent same-status atoms with different move names split into separate run groups', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml: string;

    await given('two Equal atoms in one paragraph carrying different move names', () => {});

    await when('the document is reconstructed', () => {
      const atoms = [
        atom('alpha', { status: CorrelationStatus.Equal, moveName: 'moveA' }),
        atom('beta', { status: CorrelationStatus.Equal, moveName: 'moveB' }),
      ];
      xml = reconstructDocument(atoms, MINIMAL_BODY, OPTS);
    });

    await then('both texts survive as distinct runs (grouping split on move name)', () => {
      expect(xml).toContain('alpha');
      expect(xml).toContain('beta');
      // Distinct move names force distinct run groups → two <w:r> runs.
      const runCount = (xml.match(/<w:r\b/g) ?? []).length;
      expect(runCount).toBeGreaterThanOrEqual(2);
    });
  });
});
