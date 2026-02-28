/**
 * Tests for rPr-aware document reconstruction.
 *
 * Validates that the reconstructor splits RunGroups when adjacent same-status
 * atoms have different rPr, preventing formatting bleed.
 */

import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import { el, testDoc } from '../../testing/dom-test-helpers.js';
import { reconstructDocument } from './documentReconstructor.js';
import {
  acceptAllChanges,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';
import { parseDocumentXml } from './xmlToWmlElement.js';
import { findAllByTagName, findChildByTagName } from '../../primitives/index.js';
import { EMPTY_PARAGRAPH_TAG } from '../../atomizer.js';
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

// =============================================================================
// Step 7: pPrChange for inserted paragraphs (rebuild path)
// =============================================================================

describe('Step 7: Rebuild path emits pPrChange for inserted paragraphs', () => {
  it('whole-paragraph insertion includes pPrChange with cloned pPr snapshot', () => {
    // Create atoms for a whole-paragraph insertion with paragraph properties
    const spacingEl = el('w:spacing', { 'w:after': '200' });
    const pPrEl = el('w:pPr', {}, [spacingEl]);
    const textEl = el('w:t', {}, undefined, 'new paragraph');
    const run = el('w:r', {}, [textEl]);
    const paragraph = el('w:p', {}, [pPrEl, run]);

    const atom: ComparisonUnitAtom = {
      sha1Hash: 'hash-new',
      correlationStatus: CorrelationStatus.Inserted,
      contentElement: textEl,
      ancestorElements: [paragraph, run],
      ancestorUnids: [],
      part: PART,
      paragraphIndex: 0,
      rPr: null,
    };

    const result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);

    // Should contain pPrChange
    expect(result).toContain('w:pPrChange');
    // pPrChange should contain the original spacing properties
    expect(result).toMatch(/w:pPrChange[^>]*>.*<w:pPr>.*w:spacing/s);
    // Accept should still work — pPrChange is removed
    const accepted = acceptAllChanges(result);
    expect(accepted).toContain('new paragraph');
    expect(accepted).not.toContain('w:pPrChange');
    expect(accepted).not.toContain('w:ins');
  });

  it('whole-paragraph insertion without pPr still emits pPrChange (empty snapshot)', () => {
    const textEl = el('w:t', {}, undefined, 'bare paragraph');
    const run = el('w:r', {}, [textEl]);
    const paragraph = el('w:p', {}, [run]);

    const atom: ComparisonUnitAtom = {
      sha1Hash: 'hash-bare',
      correlationStatus: CorrelationStatus.Inserted,
      contentElement: textEl,
      ancestorElements: [paragraph, run],
      ancestorUnids: [],
      part: PART,
      paragraphIndex: 0,
      rPr: null,
    };

    const result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);

    // Should contain pPrChange even with no source pPr
    expect(result).toContain('w:pPrChange');
    // Inner pPr should be empty — parse and check structurally
    const root = parseDocumentXml(result);
    const pPrChanges = findAllByTagName(root, 'w:pPrChange');
    expect(pPrChanges.length).toBeGreaterThanOrEqual(1);
    const innerPPr = findChildByTagName(pPrChanges[0]!, 'w:pPr');
    expect(innerPPr).not.toBeNull();
    // Inner pPr should have no child elements (empty snapshot)
    const innerChildren = Array.from(innerPPr!.childNodes).filter(n => n.nodeType === 1);
    expect(innerChildren.length).toBe(0);
  });
});

// =============================================================================
// Step 8: Empty paragraph track change encoding
// =============================================================================

/**
 * Create an empty paragraph atom (uses the synthetic __emptyParagraph__ marker).
 */
function makeEmptyParagraphAtom(
  status: CorrelationStatus,
  paragraphIndex = 0,
  pPrEl?: Element
): ComparisonUnitAtom {
  // Use testDoc.createElement (not createElementNS) since this is a synthetic marker, not OOXML
  const emptyEl = testDoc.createElement(EMPTY_PARAGRAPH_TAG);
  const paragraph = pPrEl
    ? el('w:p', {}, [pPrEl.cloneNode(true) as Element])
    : el('w:p');
  return {
    sha1Hash: `hash-empty-${paragraphIndex}`,
    correlationStatus: status,
    contentElement: emptyEl,
    ancestorElements: [paragraph],
    ancestorUnids: [],
    part: PART,
    paragraphIndex,
    rPr: null,
  };
}

describe('Step 8: Empty paragraph track change encoding', () => {
  it('empty inserted paragraph uses pPr/rPr/w:ins marker (not w:ins wrapping w:p)', () => {
    const pPrEl = el('w:pPr', {}, [el('w:spacing', { 'w:after': '200' })]);
    const atom = makeEmptyParagraphAtom(CorrelationStatus.Inserted, 0, pPrEl);

    const result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
    const root = parseDocumentXml(result);
    const body = root.getElementsByTagName('w:body')[0]!;
    const paragraphs = findAllByTagName(body, 'w:p');

    // There should be at least one paragraph
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);

    // Find the paragraph with the ins marker
    const targetP = paragraphs.find(p => {
      const pPr = findChildByTagName(p, 'w:pPr');
      if (!pPr) return false;
      const rPr = findChildByTagName(pPr, 'w:rPr');
      if (!rPr) return false;
      return findChildByTagName(rPr, 'w:ins') !== null;
    });
    expect(targetP).toBeDefined();

    // Verify w:pPr > w:rPr > w:ins exists
    const pPr = findChildByTagName(targetP!, 'w:pPr')!;
    const rPr = findChildByTagName(pPr, 'w:rPr')!;
    const insMarker = findChildByTagName(rPr, 'w:ins')!;
    expect(insMarker).not.toBeNull();
    expect(insMarker.getAttribute('w:author')).toBe('Test');

    // Verify NO <w:ins> wrapping <w:p> (the illegal pattern)
    const topLevelIns = findAllByTagName(body, 'w:ins').filter(
      ins => ins.parentNode === body || ins.parentNode?.nodeName === 'w:body'
    );
    expect(topLevelIns.length).toBe(0);

    // Verify pPrChange is present
    const pPrChange = findChildByTagName(pPr, 'w:pPrChange');
    expect(pPrChange).not.toBeNull();
  });

  it('empty deleted paragraph uses pPr/rPr/w:del marker (not w:del wrapping w:p)', () => {
    const pPrEl = el('w:pPr', {}, [el('w:jc', { 'w:val': 'center' })]);
    const atom = makeEmptyParagraphAtom(CorrelationStatus.Deleted, 0, pPrEl);

    const result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
    const root = parseDocumentXml(result);
    const body = root.getElementsByTagName('w:body')[0]!;
    const paragraphs = findAllByTagName(body, 'w:p');

    // Find the paragraph with the del marker
    const targetP = paragraphs.find(p => {
      const pPr = findChildByTagName(p, 'w:pPr');
      if (!pPr) return false;
      const rPr = findChildByTagName(pPr, 'w:rPr');
      if (!rPr) return false;
      return findChildByTagName(rPr, 'w:del') !== null;
    });
    expect(targetP).toBeDefined();

    // Verify w:pPr > w:rPr > w:del exists
    const pPr = findChildByTagName(targetP!, 'w:pPr')!;
    const rPr = findChildByTagName(pPr, 'w:rPr')!;
    const delMarker = findChildByTagName(rPr, 'w:del')!;
    expect(delMarker).not.toBeNull();
    expect(delMarker.getAttribute('w:author')).toBe('Test');

    // Verify NO <w:del> wrapping <w:p> (the illegal pattern)
    const topLevelDel = findAllByTagName(body, 'w:del').filter(
      del => del.parentNode === body || del.parentNode?.nodeName === 'w:body'
    );
    expect(topLevelDel.length).toBe(0);
  });

  it('empty inserted paragraph without pPr synthesizes correct pPr/rPr', () => {
    const atom = makeEmptyParagraphAtom(CorrelationStatus.Inserted, 0);

    const result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
    const root = parseDocumentXml(result);
    const body = root.getElementsByTagName('w:body')[0]!;
    const paragraphs = findAllByTagName(body, 'w:p');

    // Find paragraph with ins marker
    const targetP = paragraphs.find(p => {
      const pPr = findChildByTagName(p, 'w:pPr');
      if (!pPr) return false;
      const rPr = findChildByTagName(pPr, 'w:rPr');
      if (!rPr) return false;
      return findChildByTagName(rPr, 'w:ins') !== null;
    });
    expect(targetP).toBeDefined();

    // Verify synthesized pPr/rPr/w:ins
    const pPr = findChildByTagName(targetP!, 'w:pPr')!;
    expect(pPr).not.toBeNull();
    const rPr = findChildByTagName(pPr, 'w:rPr')!;
    expect(rPr).not.toBeNull();
    const insMarker = findChildByTagName(rPr, 'w:ins')!;
    expect(insMarker).not.toBeNull();
  });

  it('accept round-trip: deleted empty paragraph removed on accept', () => {
    const atom = makeEmptyParagraphAtom(CorrelationStatus.Deleted, 0);

    const result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
    const accepted = acceptAllChanges(result);
    const root = parseDocumentXml(accepted);
    const body = root.getElementsByTagName('w:body')[0]!;
    const paragraphs = findAllByTagName(body, 'w:p');

    // The deleted empty paragraph should be removed on accept
    // (accept = "apply the change" = paragraph stays deleted = removed)
    for (const p of paragraphs) {
      const pPr = findChildByTagName(p, 'w:pPr');
      if (!pPr) continue;
      const rPr = findChildByTagName(pPr, 'w:rPr');
      if (!rPr) continue;
      // No w:del markers should remain after accept
      expect(findChildByTagName(rPr, 'w:del')).toBeNull();
    }
  });

  it('accept round-trip: inserted empty paragraph kept on accept', () => {
    const atom = makeEmptyParagraphAtom(CorrelationStatus.Inserted, 0);

    const result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
    const accepted = acceptAllChanges(result);

    // After accepting, the inserted paragraph should remain (marker stripped)
    expect(accepted).not.toContain('w:ins');
    // The paragraph should still exist in the output
    const root = parseDocumentXml(accepted);
    const body = root.getElementsByTagName('w:body')[0]!;
    const paragraphs = findAllByTagName(body, 'w:p');
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
  });

  it('reject round-trip: inserted empty paragraph removed on reject', () => {
    const atom = makeEmptyParagraphAtom(CorrelationStatus.Inserted, 0);

    const result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
    const rejected = rejectAllChanges(result);

    // After rejecting, the inserted paragraph should be removed
    expect(rejected).not.toContain('w:ins');
  });

  it('reject round-trip: deleted empty paragraph kept on reject', () => {
    const atom = makeEmptyParagraphAtom(CorrelationStatus.Deleted, 0);

    const result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
    const rejected = rejectAllChanges(result);

    // After rejecting, the deleted paragraph should be kept (marker stripped)
    expect(rejected).not.toContain('w:del');
    const root = parseDocumentXml(rejected);
    const body = root.getElementsByTagName('w:body')[0]!;
    const paragraphs = findAllByTagName(body, 'w:p');
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
  });
});
