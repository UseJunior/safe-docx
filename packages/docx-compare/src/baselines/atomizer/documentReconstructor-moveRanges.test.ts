/**
 * Tests for move-range marker reconstruction (issue #110).
 *
 * Validates that the rebuild reconstructor:
 * - still synthesizes exactly one w:moveFromRangeStart/End (resp.
 *   w:moveToRangeStart/End) pair per detected move when the paragraph carries
 *   no explicit markers, and
 * - suppresses that synthetic emission when explicit move-range marker atoms
 *   (now in PARAGRAPH_LEVEL_TAGS) are present in the same paragraph, so the
 *   explicit pair is emitted exactly once instead of being doubled.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { el } from '../../testing/dom-test-helpers.js';
import { reconstructDocument } from './documentReconstructor.js';
import type { ComparisonUnitAtom, OpcPart } from '@usejunior/docx-core';
import { CorrelationStatus } from '@usejunior/docx-core';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Document Reconstructor Move Ranges' });

const PART: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };

const MINIMAL_DOCXML = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
  '<w:body>',
  '<w:p><w:r><w:t>placeholder</w:t></w:r></w:p>',
  '</w:body>',
  '</w:document>',
].join('');

const OPTS = { author: 'Test', date: new Date('2025-01-01T00:00:00Z') };

function makeTextAtom(
  text: string,
  status: CorrelationStatus,
  paragraphIndex = 0
): ComparisonUnitAtom {
  const textEl = el('w:t', {}, undefined, text);
  const run = el('w:r', {}, [textEl]);
  const paragraph = el('w:p', {}, [run]);

  return {
    sha1Hash: `hash-${text}`,
    correlationStatus: status,
    contentElement: textEl,
    ancestorElements: [paragraph, run],
    ancestorUnids: [],
    part: PART,
    paragraphIndex,
    rPr: null,
  };
}

/**
 * Explicit paragraph-level move-range marker atom, as produced by
 * atomizeTree with atomizeParagraphLevelMarkers: true. The marker is a
 * direct child of <w:p> in the source, so its ancestry has no <w:r>.
 */
function makeMarkerAtom(
  tagName: string,
  attrs: Record<string, string>,
  status: CorrelationStatus,
  paragraphIndex = 0
): ComparisonUnitAtom {
  const markerEl = el(tagName, attrs);
  const paragraph = el('w:p', {}, [markerEl]);

  return {
    sha1Hash: `hash-${tagName}-${attrs['w:id']}`,
    correlationStatus: status,
    contentElement: markerEl,
    ancestorElements: [paragraph],
    ancestorUnids: [],
    part: PART,
    paragraphIndex,
    rPr: null,
  };
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('Move-range marker reconstruction (issue #110)', () => {
  test('detected move without explicit markers synthesizes exactly one range pair per side', async ({ given, when, then }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];
    let result: string;

    await given('a MovedSource atom and a MovedDestination atom in marker-free paragraphs', () => {
      const source = makeTextAtom('moved text', CorrelationStatus.MovedSource, 0);
      source.moveName = 'move1';
      const dest = makeTextAtom('moved text', CorrelationStatus.MovedDestination, 1);
      dest.moveName = 'move1';
      atoms = [source, dest];
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument(atoms, MINIMAL_DOCXML, OPTS);
    });

    await then('exactly one synthetic moveFromRange and moveToRange pair is emitted', () => {
      expect(count(result, 'w:moveFromRangeStart')).toBe(1);
      expect(count(result, 'w:moveFromRangeEnd')).toBe(1);
      expect(count(result, 'w:moveToRangeStart')).toBe(1);
      expect(count(result, 'w:moveToRangeEnd')).toBe(1);
      expect(result).toContain('w:name="move1"');
      expect(result).toContain('<w:moveFrom ');
      expect(result).toContain('<w:moveTo ');
    });
  });

  test('explicit moveFromRange markers in the paragraph suppress synthetic range emission', async ({ given, when, then, and }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];
    let result: string;

    await given('explicit moveFromRangeStart/End marker atoms bracketing a MovedSource atom', () => {
      const start = makeMarkerAtom(
        'w:moveFromRangeStart',
        { 'w:id': '300', 'w:name': 'userMove1', 'w:author': 'Mover', 'w:date': '2025-01-01T00:00:00Z' },
        CorrelationStatus.Equal,
        0
      );
      const moved = makeTextAtom('moved text', CorrelationStatus.MovedSource, 0);
      moved.moveName = 'move1';
      const end = makeMarkerAtom(
        'w:moveFromRangeEnd',
        { 'w:id': '300' },
        CorrelationStatus.Equal,
        0
      );
      atoms = [start, moved, end];
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument(atoms, MINIMAL_DOCXML, OPTS);
    });

    await then('only the explicit range pair survives — no synthetic duplicate', () => {
      expect(count(result, 'w:moveFromRangeStart')).toBe(1);
      expect(count(result, 'w:moveFromRangeEnd')).toBe(1);
      expect(result).toContain('w:name="userMove1"');
      expect(result).not.toContain('w:name="move1"');
    });

    await and('the w:moveFrom wrapper is still emitted around the moved content', () => {
      expect(count(result, '<w:moveFrom ')).toBe(1);
      expect(result).toContain('<w:delText');
    });
  });

  test('explicit moveToRange markers in the paragraph suppress synthetic range emission', async ({ given, when, then, and }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];
    let result: string;

    await given('explicit moveToRangeStart/End marker atoms bracketing a MovedDestination atom', () => {
      const start = makeMarkerAtom(
        'w:moveToRangeStart',
        { 'w:id': '302', 'w:name': 'userMove1', 'w:author': 'Mover', 'w:date': '2025-01-01T00:00:00Z' },
        CorrelationStatus.Equal,
        0
      );
      const moved = makeTextAtom('moved text', CorrelationStatus.MovedDestination, 0);
      moved.moveName = 'move1';
      const end = makeMarkerAtom(
        'w:moveToRangeEnd',
        { 'w:id': '302' },
        CorrelationStatus.Equal,
        0
      );
      atoms = [start, moved, end];
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument(atoms, MINIMAL_DOCXML, OPTS);
    });

    await then('only the explicit range pair survives — no synthetic duplicate', () => {
      expect(count(result, 'w:moveToRangeStart')).toBe(1);
      expect(count(result, 'w:moveToRangeEnd')).toBe(1);
      expect(result).toContain('w:name="userMove1"');
      expect(result).not.toContain('w:name="move1"');
    });

    await and('the w:moveTo wrapper is still emitted around the moved content', () => {
      expect(count(result, '<w:moveTo ')).toBe(1);
    });
  });

  test('explicit markers suppress only their own kind — the other side still synthesizes', async ({ given, when, then }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];
    let result: string;

    await given('a paragraph with explicit moveFromRange markers and a separate marker-free MovedDestination paragraph', () => {
      const start = makeMarkerAtom(
        'w:moveFromRangeStart',
        { 'w:id': '300', 'w:name': 'userMove1', 'w:author': 'Mover', 'w:date': '2025-01-01T00:00:00Z' },
        CorrelationStatus.Equal,
        0
      );
      const movedSource = makeTextAtom('moved text', CorrelationStatus.MovedSource, 0);
      movedSource.moveName = 'move1';
      const end = makeMarkerAtom(
        'w:moveFromRangeEnd',
        { 'w:id': '300' },
        CorrelationStatus.Equal,
        0
      );
      const movedDest = makeTextAtom('moved text', CorrelationStatus.MovedDestination, 1);
      movedDest.moveName = 'move1';
      atoms = [start, movedSource, end, movedDest];
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument(atoms, MINIMAL_DOCXML, OPTS);
    });

    await then('the moveFrom side keeps the explicit pair while the moveTo side synthesizes its own', () => {
      expect(count(result, 'w:moveFromRangeStart')).toBe(1);
      expect(count(result, 'w:moveFromRangeEnd')).toBe(1);
      expect(result).toContain('w:name="userMove1"');
      expect(count(result, 'w:moveToRangeStart')).toBe(1);
      expect(count(result, 'w:moveToRangeEnd')).toBe(1);
      expect(result).toContain('w:name="move1"');
    });
  });

  test('explicit markers are emitted outside synthetic <w:r> wrappers', async ({ given, when, then }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];
    let result: string;

    await given('an Equal paragraph whose atom stream contains explicit move-range markers', () => {
      const before = makeTextAtom('before ', CorrelationStatus.Equal, 0);
      const start = makeMarkerAtom(
        'w:moveFromRangeStart',
        { 'w:id': '300', 'w:name': 'userMove1', 'w:author': 'Mover', 'w:date': '2025-01-01T00:00:00Z' },
        CorrelationStatus.Equal,
        0
      );
      const end = makeMarkerAtom(
        'w:moveFromRangeEnd',
        { 'w:id': '300' },
        CorrelationStatus.Equal,
        0
      );
      const after = makeTextAtom('after', CorrelationStatus.Equal, 0);
      atoms = [before, start, end, after];
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument(atoms, MINIMAL_DOCXML, OPTS);
    });

    await then('the markers are siblings of <w:r>, never inside a run', () => {
      // A marker nested in a run would serialize as <w:r>...<w:moveFromRange...
      // with no closing </w:r> before it; assert the run closes first.
      expect(result).toMatch(/<\/w:r><w:moveFromRangeStart /);
      expect(result).toMatch(/<w:moveFromRangeEnd [^>]*\/><w:r>/);
    });
  });
});
