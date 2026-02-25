/**
 * Tests for rPr-aware document reconstruction.
 *
 * Validates that the reconstructor splits RunGroups when adjacent same-status
 * atoms have different rPr, preventing formatting bleed.
 */

import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import { el } from '../../testing/dom-test-helpers.js';
import { reconstructDocument } from './documentReconstructor.js';
import {
  acceptAllChanges,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';
import type { ComparisonUnitAtom, OpcPart } from '../../core-types.js';
import { CorrelationStatus } from '../../core-types.js';

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

/**
 * Create a test atom with explicit rPr, status, and text.
 */
function makeAtom(
  text: string,
  opts: {
    status?: CorrelationStatus;
    rPr?: Element | null;
    paragraphIndex?: number;
    moveName?: string;
    formatChange?: ComparisonUnitAtom['formatChange'];
  } = {}
): ComparisonUnitAtom {
  const {
    status = CorrelationStatus.Equal,
    rPr = null,
    paragraphIndex = 0,
    moveName,
    formatChange,
  } = opts;

  const rPrEl = rPr ? el('w:rPr', {}, [rPr.cloneNode(true) as Element]) : el('w:rPr');
  const textEl = el('w:t', {}, undefined, text);
  const run = el('w:r', {}, rPr ? [rPrEl, textEl] : [textEl]);
  const paragraph = el('w:p', {}, [run]);

  return {
    sha1Hash: `hash-${text}`,
    correlationStatus: status,
    contentElement: textEl,
    ancestorElements: [paragraph, run],
    ancestorUnids: [],
    part: PART,
    paragraphIndex,
    rPr: rPr ? (rPr.cloneNode(true) as Element).parentNode
      ? rPr.cloneNode(true) as Element
      : rPr.cloneNode(true) as Element
      : null,
    moveName,
    formatChange,
  };
}

/**
 * Shorthand: create an atom with a cloned rPr element.
 */
function makeAtomWithRPr(
  text: string,
  rPrChildren: Element[],
  status: CorrelationStatus = CorrelationStatus.Equal,
  paragraphIndex = 0
): ComparisonUnitAtom {
  const rPrEl = el('w:rPr', {}, rPrChildren);
  const textEl = el('w:t', {}, undefined, text);
  const run = el('w:r', {}, [rPrEl.cloneNode(true) as Element, textEl]);
  const paragraph = el('w:p', {}, [run]);

  return {
    sha1Hash: `hash-${text}`,
    correlationStatus: status,
    contentElement: textEl,
    ancestorElements: [paragraph, run],
    ancestorUnids: [],
    part: PART,
    paragraphIndex,
    rPr: rPrEl.cloneNode(true) as Element,
  };
}

function makeAtomNoRPr(
  text: string,
  status: CorrelationStatus = CorrelationStatus.Equal,
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

// =============================================================================
// Step 0: Multi-<w:r> inside <w:del> accept/reject validation
// =============================================================================

describe('Step 0: Multi-run <w:del> accept/reject', () => {
  const multiRunDelXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    '<w:p>',
    '<w:del w:id="1" w:author="Test" w:date="2025-01-01T00:00:00Z">',
    '<w:r><w:rPr><w:b/></w:rPr><w:delText>bold text</w:delText></w:r>',
    '<w:r><w:delText>normal text</w:delText></w:r>',
    '</w:del>',
    '</w:p>',
    '</w:body>',
    '</w:document>',
  ].join('');

  it('acceptAllChanges removes all deleted text from multi-run <w:del>', () => {
    const result = acceptAllChanges(multiRunDelXml);
    expect(result).not.toContain('bold text');
    expect(result).not.toContain('normal text');
    expect(result).not.toContain('w:del');
  });

  it('rejectAllChanges preserves both runs from multi-run <w:del>', () => {
    const result = rejectAllChanges(multiRunDelXml);
    // delText should be converted to w:t
    expect(result).toContain('bold text');
    expect(result).toContain('normal text');
    expect(result).not.toContain('w:del');
    expect(result).not.toContain('w:delText');
    // Bold formatting should be preserved
    expect(result).toContain('w:b');
  });
});

// =============================================================================
// Step 2: rPr-aware group splitting
// =============================================================================

describe('Step 2: rPr-aware group splitting in reconstructor', () => {
  it('Test 1 — Equal atoms with different rPr produce separate runs', () => {
    const atomA = makeAtomWithRPr('underlined', [el('w:u', { 'w:val': 'single' })]);
    const atomB = makeAtomNoRPr('normal');

    const result = reconstructDocument([atomA, atomB], MINIMAL_DOCXML, OPTS);

    // Should contain two separate <w:r> elements
    const runMatches = result.match(/<w:r>/g);
    expect(runMatches?.length).toBeGreaterThanOrEqual(2);

    // First run should have underline, second should not
    expect(result).toContain('w:u');
    // The underlined text and normal text should be in different runs
    const underlinePos = result.indexOf('w:u');
    const underlinedTextPos = result.indexOf('underlined');
    const normalTextPos = result.indexOf('normal');

    // Underline marker should be near "underlined" text, not near "normal" text
    expect(Math.abs(underlinePos - underlinedTextPos)).toBeLessThan(
      Math.abs(underlinePos - normalTextPos)
    );
  });

  it('Test 2 — Same rPr atoms consolidate into one run', () => {
    const atomA = makeAtomWithRPr('word1', [el('w:b')]);
    const atomB = makeAtomWithRPr('word2', [el('w:b')]);

    const result = reconstructDocument([atomA, atomB], MINIMAL_DOCXML, OPTS);

    // Should produce a single paragraph with atoms consolidated
    // Both texts in the same run since rPr is identical
    const runMatches = result.match(/<w:r>/g);
    expect(runMatches?.length).toBe(1);
    expect(result).toContain('word1');
    expect(result).toContain('word2');
  });

  it('Test 2b — Move atoms with different rPr stay in one group', () => {
    const atomA = makeAtomWithRPr(
      'moved-bold',
      [el('w:b')],
      CorrelationStatus.MovedSource,
      0
    );
    atomA.moveName = 'move1';

    const atomB = makeAtomNoRPr(
      'moved-normal',
      CorrelationStatus.MovedSource,
      0
    );
    atomB.moveName = 'move1';

    const result = reconstructDocument([atomA, atomB], MINIMAL_DOCXML, OPTS);

    // Should produce one w:moveFrom block (no duplicate range markers)
    const moveFromRangeStartMatches = result.match(/moveFromRangeStart/g);
    expect(moveFromRangeStartMatches?.length).toBe(1);
  });

  it('Test 2c — Atoms with rPr: null group together', () => {
    const atomA = makeAtomNoRPr('plain1');
    const atomB = makeAtomNoRPr('plain2');

    const result = reconstructDocument([atomA, atomB], MINIMAL_DOCXML, OPTS);

    // Should consolidate into one <w:r> with no <w:rPr>
    const runMatches = result.match(/<w:r>/g);
    expect(runMatches?.length).toBe(1);
    expect(result).not.toContain('<w:rPr');
  });
});

// =============================================================================
// Step 3: Format change integration
// =============================================================================

describe('Step 3: FormatChanged atom emits w:rPrChange', () => {
  it('Test 3 — FormatChanged atom produces rPrChange in output', () => {
    const atom = makeAtomWithRPr(
      'reformatted',
      [el('w:b')],
      CorrelationStatus.FormatChanged,
      0
    );
    atom.formatChange = {
      oldRunProperties: el('w:rPr', {}, [el('w:i')]),
      newRunProperties: el('w:rPr', {}, [el('w:b')]),
      changedProperties: ['bold', 'italic'],
    };

    const result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);

    expect(result).toContain('w:rPrChange');
    // Should contain the old italic property inside rPrChange
    expect(result).toContain('w:i');
    // Should contain the new bold property in the run's rPr
    expect(result).toContain('w:b');
  });
});

// =============================================================================
// Step 4: Per-atom rPr in reorderChangeBlocks
// =============================================================================

describe('Step 4: Per-atom rPr in reorderChangeBlocks', () => {
  it('Test 4 — Deleted atoms with different rPr produce separate runs inside <w:del>', () => {
    const delBold = makeAtomWithRPr(
      'bold-deleted',
      [el('w:b')],
      CorrelationStatus.Deleted,
      0
    );
    const delNormal = makeAtomNoRPr(
      'normal-deleted',
      CorrelationStatus.Deleted,
      0
    );
    const insItalic = makeAtomWithRPr(
      'italic-inserted',
      [el('w:i')],
      CorrelationStatus.Inserted,
      0
    );

    const result = reconstructDocument(
      [delBold, delNormal, insItalic],
      MINIMAL_DOCXML,
      OPTS
    );

    // <w:del> wrapper should contain two <w:r> (bold + normal)
    const delMatch = result.match(/<w:del[^>]*>([\s\S]*?)<\/w:del>/);
    expect(delMatch).not.toBeNull();
    const delContent = delMatch![1]!;
    const delRuns = delContent.match(/<w:r>/g);
    expect(delRuns?.length).toBe(2);

    // <w:ins> wrapper should contain one <w:r> with italic
    const insMatch = result.match(/<w:ins[^>]*>([\s\S]*?)<\/w:ins>/);
    expect(insMatch).not.toBeNull();
    const insContent = insMatch![1]!;
    const insRuns = insContent.match(/<w:r>/g);
    expect(insRuns?.length).toBe(1);
    expect(insContent).toContain('w:i');
  });

  it('Test 5 — Reorder with uniform rPr still consolidates', () => {
    const del1 = makeAtomWithRPr(
      'del1',
      [el('w:b')],
      CorrelationStatus.Deleted,
      0
    );
    const del2 = makeAtomWithRPr(
      'del2',
      [el('w:b')],
      CorrelationStatus.Deleted,
      0
    );
    const ins1 = makeAtomNoRPr('ins1', CorrelationStatus.Inserted, 0);

    const result = reconstructDocument(
      [del1, del2, ins1],
      MINIMAL_DOCXML,
      OPTS
    );

    // <w:del> should have one <w:r> since both deletions have same rPr
    const delMatch = result.match(/<w:del[^>]*>([\s\S]*?)<\/w:del>/);
    expect(delMatch).not.toBeNull();
    const delContent = delMatch![1]!;
    const delRuns = delContent.match(/<w:r>/g);
    expect(delRuns?.length).toBe(1);
  });

  it('Test 6 — Multi-run <w:del> accept/reject regression', () => {
    // Construct XML with <w:del> containing two <w:r> children with different rPr
    const xml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p>',
      '<w:del w:id="1" w:author="Test" w:date="2025-01-01T00:00:00Z">',
      '<w:r><w:rPr><w:b/></w:rPr><w:delText>bold</w:delText></w:r>',
      '<w:r><w:rPr><w:i/></w:rPr><w:delText>italic</w:delText></w:r>',
      '</w:del>',
      '</w:p>',
      '</w:body>',
      '</w:document>',
    ].join('');

    // Accept: all deleted text removed
    const accepted = acceptAllChanges(xml);
    expect(accepted).not.toContain('bold');
    expect(accepted).not.toContain('italic');

    // Reject: all deleted text restored as normal text
    const rejected = rejectAllChanges(xml);
    expect(rejected).toContain('bold');
    expect(rejected).toContain('italic');
    // Formatting preserved
    expect(rejected).toContain('w:b');
    expect(rejected).toContain('w:i');
    // No more delText
    expect(rejected).not.toContain('w:delText');
  });
});
