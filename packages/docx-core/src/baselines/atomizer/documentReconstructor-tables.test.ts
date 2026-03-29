/**
 * Tests for structure-preserving document reconstruction (rebuild mode).
 *
 * Validates that the reconstructor preserves table wrappers, SDTs,
 * and other structural elements when rebuilding from atoms.
 */

import { describe, expect } from 'vitest';
import { testAllure } from '../../testing/allure-test.js';
import { DOMParser } from '@xmldom/xmldom';
import { reconstructDocument } from './documentReconstructor.js';
import {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
} from './trackChangesAcceptorAst.js';
import type { ComparisonUnitAtom, OpcPart } from '../../core-types.js';
import { CorrelationStatus } from '../../core-types.js';

const PART: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
const OPTS = { author: 'Test', date: new Date('2025-01-01T00:00:00Z') };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAtom(
  text: string,
  status: CorrelationStatus,
  paragraphIndex: number
): ComparisonUnitAtom {
  const doc = new DOMParser().parseFromString(
    `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>${text}</w:t></w:r></w:p>`,
    'application/xml'
  );
  const paragraph = doc.documentElement;
  const run = paragraph.getElementsByTagName('w:r')[0]!;
  const textEl = paragraph.getElementsByTagName('w:t')[0]!;

  return {
    sha1Hash: `hash-${text}-${paragraphIndex}`,
    correlationStatus: status,
    contentElement: textEl,
    ancestorElements: [paragraph, run],
    ancestorUnids: [],
    part: PART,
    paragraphIndex,
    rPr: null,
  };
}

function countTag(xml: string, tag: string): number {
  const regex = new RegExp(`<${tag}[\\s/>]`, 'g');
  return (xml.match(regex) || []).length;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Document with 2 body paragraphs + 1 table (2 rows x 1 col, 1 para each) */
const DOC_WITH_TABLE = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
  '<w:body>',
  '<w:p><w:r><w:t>Body para 1</w:t></w:r></w:p>',
  '<w:tbl>',
  '  <w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="0000FF"/></w:tblBorders></w:tblPr>',
  '  <w:tr>',
  '    <w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>',
  '      <w:p><w:r><w:t>Cell R1</w:t></w:r></w:p>',
  '    </w:tc>',
  '  </w:tr>',
  '  <w:tr>',
  '    <w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>',
  '      <w:p><w:r><w:t>Cell R2</w:t></w:r></w:p>',
  '    </w:tc>',
  '  </w:tr>',
  '</w:tbl>',
  '<w:p><w:r><w:t>Body para 2</w:t></w:r></w:p>',
  '</w:body>',
  '</w:document>',
].join('\n');

/** Document with final sectPr */
const DOC_WITH_SECTPR = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
  '<w:body>',
  '<w:p><w:r><w:t>Paragraph 1</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>Paragraph 2</w:t></w:r></w:p>',
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
  '</w:body>',
  '</w:document>',
].join('\n');

/** Document with SDT wrapper */
const DOC_WITH_SDT = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
  '<w:body>',
  '<w:p><w:r><w:t>Before SDT</w:t></w:r></w:p>',
  '<w:sdt><w:sdtContent>',
  '  <w:p><w:r><w:t>Inside SDT</w:t></w:r></w:p>',
  '</w:sdtContent></w:sdt>',
  '<w:p><w:r><w:t>After SDT</w:t></w:r></w:p>',
  '</w:body>',
  '</w:document>',
].join('\n');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Document Reconstruction' });

describe('Structure-preserving rebuild: table preservation', () => {
  test('preserves table wrappers when all paragraphs are equal', () => {
    const atoms: ComparisonUnitAtom[] = [
      makeAtom('Body para 1', CorrelationStatus.Equal, 0),
      makeAtom('Cell R1', CorrelationStatus.Equal, 1),
      makeAtom('Cell R2', CorrelationStatus.Equal, 2),
      makeAtom('Body para 2', CorrelationStatus.Equal, 3),
    ];

    const result = reconstructDocument(atoms, DOC_WITH_TABLE, OPTS);

    expect(countTag(result, 'w:tbl')).toBe(1);
    expect(countTag(result, 'w:tr')).toBe(2);
    expect(countTag(result, 'w:tc')).toBe(2);
    // Table properties preserved
    expect(result).toContain('w:tblBorders');
    expect(result).toContain('0000FF');
    // Cell widths preserved
    expect(result).toContain('w:tcW');
  });

  test('preserves table structure with tracked changes inside cells', () => {
    const atoms: ComparisonUnitAtom[] = [
      makeAtom('Body para 1', CorrelationStatus.Equal, 0),
      makeAtom('Old Cell R1', CorrelationStatus.Deleted, 1),
      makeAtom('New Cell R1', CorrelationStatus.Inserted, 1),
      makeAtom('Cell R2', CorrelationStatus.Equal, 2),
      makeAtom('Body para 2', CorrelationStatus.Equal, 3),
    ];

    const result = reconstructDocument(atoms, DOC_WITH_TABLE, OPTS);

    expect(countTag(result, 'w:tbl')).toBe(1);
    expect(countTag(result, 'w:tr')).toBe(2);
    expect(countTag(result, 'w:tc')).toBe(2);
    // Should have tracked changes
    expect(result).toContain('w:del');
    expect(result).toContain('w:ins');
  });

  test('reconstructed text matches after accept-all', () => {
    const atoms: ComparisonUnitAtom[] = [
      makeAtom('Body para 1', CorrelationStatus.Equal, 0),
      makeAtom('Old Cell', CorrelationStatus.Deleted, 1),
      makeAtom('New Cell', CorrelationStatus.Inserted, 1),
      makeAtom('Cell R2', CorrelationStatus.Equal, 2),
      makeAtom('Body para 2', CorrelationStatus.Equal, 3),
    ];

    const result = reconstructDocument(atoms, DOC_WITH_TABLE, OPTS);
    const acceptedText = extractTextWithParagraphs(acceptAllChanges(result));

    expect(acceptedText).toContain('Body para 1');
    expect(acceptedText).toContain('New Cell');
    expect(acceptedText).toContain('Cell R2');
    expect(acceptedText).toContain('Body para 2');
    expect(acceptedText).not.toContain('Old Cell');
  });

  test('reconstructed text matches after reject-all', () => {
    const atoms: ComparisonUnitAtom[] = [
      makeAtom('Body para 1', CorrelationStatus.Equal, 0),
      makeAtom('Old Cell', CorrelationStatus.Deleted, 1),
      makeAtom('New Cell', CorrelationStatus.Inserted, 1),
      makeAtom('Cell R2', CorrelationStatus.Equal, 2),
      makeAtom('Body para 2', CorrelationStatus.Equal, 3),
    ];

    const result = reconstructDocument(atoms, DOC_WITH_TABLE, OPTS);
    const rejectedText = extractTextWithParagraphs(rejectAllChanges(result));

    expect(rejectedText).toContain('Body para 1');
    expect(rejectedText).toContain('Old Cell');
    expect(rejectedText).toContain('Cell R2');
    expect(rejectedText).toContain('Body para 2');
    expect(rejectedText).not.toContain('New Cell');
  });
});

describe('Structure-preserving rebuild: inserted paragraphs', () => {
  test('inserts paragraph in correct table cell context', () => {
    // Original has 4 paragraphs, we add an extra inserted paragraph in cell 1
    const atoms: ComparisonUnitAtom[] = [
      makeAtom('Body para 1', CorrelationStatus.Equal, 0),
      makeAtom('Cell R1', CorrelationStatus.Equal, 1),
      makeAtom('Extra in cell', CorrelationStatus.Inserted, 2),
      makeAtom('Cell R2', CorrelationStatus.Equal, 3),
      makeAtom('Body para 2', CorrelationStatus.Equal, 4),
    ];

    const result = reconstructDocument(atoms, DOC_WITH_TABLE, OPTS);

    // Table structure preserved
    expect(countTag(result, 'w:tbl')).toBe(1);
    // The inserted paragraph should be inside the table
    const tblMatch = result.match(/<w:tbl>[\s\S]*?<\/w:tbl>/);
    expect(tblMatch).toBeTruthy();
    expect(tblMatch![0]).toContain('Extra in cell');
  });

  test('inserts paragraph before first body paragraph', () => {
    // Insert a paragraph before the first body paragraph
    const atoms: ComparisonUnitAtom[] = [
      makeAtom('Prepended', CorrelationStatus.Inserted, 0),
      makeAtom('Body para 1', CorrelationStatus.Equal, 1),
      makeAtom('Cell R1', CorrelationStatus.Equal, 2),
      makeAtom('Cell R2', CorrelationStatus.Equal, 3),
      makeAtom('Body para 2', CorrelationStatus.Equal, 4),
    ];

    const result = reconstructDocument(atoms, DOC_WITH_TABLE, OPTS);

    // Table preserved
    expect(countTag(result, 'w:tbl')).toBe(1);
    // Prepended paragraph should be in the body, before the table
    expect(result).toContain('Prepended');
  });
});

describe('Structure-preserving rebuild: sectPr preservation', () => {
  test('keeps sectPr as last child of body', () => {
    const atoms: ComparisonUnitAtom[] = [
      makeAtom('Paragraph 1', CorrelationStatus.Equal, 0),
      makeAtom('Paragraph 2', CorrelationStatus.Equal, 1),
    ];

    const result = reconstructDocument(atoms, DOC_WITH_SECTPR, OPTS);

    // sectPr should be present
    expect(result).toContain('w:sectPr');
    expect(result).toContain('w:pgSz');
    // sectPr should be the last element before </w:body>
    const bodyContent = result.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/)?.[1] ?? '';
    const lastTagMatch = bodyContent.match(/<(w:\w+)[^>]*(?:\/>|>[\s\S]*?<\/\1>)\s*$/);
    expect(lastTagMatch?.[1]).toBe('w:sectPr');
  });

  test('does not insert after sectPr when appending', () => {
    // Extra inserted paragraph should go before sectPr
    const atoms: ComparisonUnitAtom[] = [
      makeAtom('Paragraph 1', CorrelationStatus.Equal, 0),
      makeAtom('Paragraph 2', CorrelationStatus.Equal, 1),
      makeAtom('Appended', CorrelationStatus.Inserted, 2),
    ];

    const result = reconstructDocument(atoms, DOC_WITH_SECTPR, OPTS);

    expect(result).toContain('Appended');
    // sectPr should still be last
    const bodyContent = result.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/)?.[1] ?? '';
    const lastTagMatch = bodyContent.match(/<(w:\w+)[^>]*(?:\/>|>[\s\S]*?<\/\1>)\s*$/);
    expect(lastTagMatch?.[1]).toBe('w:sectPr');
  });
});

describe('Structure-preserving rebuild: SDT wrapper preservation', () => {
  test('preserves SDT wrapper around paragraphs', () => {
    const atoms: ComparisonUnitAtom[] = [
      makeAtom('Before SDT', CorrelationStatus.Equal, 0),
      makeAtom('Inside SDT', CorrelationStatus.Equal, 1),
      makeAtom('After SDT', CorrelationStatus.Equal, 2),
    ];

    const result = reconstructDocument(atoms, DOC_WITH_SDT, OPTS);

    expect(result).toContain('w:sdt');
    expect(result).toContain('w:sdtContent');
    // The SDT-wrapped paragraph should be inside the SDT
    const sdtMatch = result.match(/<w:sdt>[\s\S]*?<\/w:sdt>/);
    expect(sdtMatch).toBeTruthy();
    expect(sdtMatch![0]).toContain('Inside SDT');
  });
});

describe('Structure-preserving rebuild: moved/format-changed classification', () => {
  test('MovedSource paragraph consumes an original slot', () => {
    const atoms: ComparisonUnitAtom[] = [
      makeAtom('Body para 1', CorrelationStatus.Equal, 0),
      makeAtom('Cell R1', CorrelationStatus.MovedSource, 1),
      makeAtom('Cell R2', CorrelationStatus.Equal, 2),
      makeAtom('Body para 2', CorrelationStatus.Equal, 3),
    ];

    const result = reconstructDocument(atoms, DOC_WITH_TABLE, OPTS);

    // Table should still be preserved
    expect(countTag(result, 'w:tbl')).toBe(1);
    expect(countTag(result, 'w:tr')).toBe(2);
  });

  test('FormatChanged paragraph consumes an original slot', () => {
    const atoms: ComparisonUnitAtom[] = [
      makeAtom('Body para 1', CorrelationStatus.Equal, 0),
      makeAtom('Cell R1', CorrelationStatus.FormatChanged, 1),
      makeAtom('Cell R2', CorrelationStatus.Equal, 2),
      makeAtom('Body para 2', CorrelationStatus.Equal, 3),
    ];

    const result = reconstructDocument(atoms, DOC_WITH_TABLE, OPTS);

    // Table should still be preserved
    expect(countTag(result, 'w:tbl')).toBe(1);
    expect(countTag(result, 'w:tr')).toBe(2);
  });
});
