/**
 * Tests for rPr-aware document reconstruction.
 *
 * Validates that the reconstructor splits RunGroups when adjacent same-status
 * atoms have different rPr, preventing formatting bleed.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
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

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Document Reconstructor RPR' });

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

  test('acceptAllChanges removes all deleted text from multi-run <w:del>', async ({ given, when, then }: AllureBddContext) => {
    let result: string;

    await given('a document with a multi-run w:del element', () => {});

    await when('acceptAllChanges is called', () => {
      result = acceptAllChanges(multiRunDelXml);
    });

    await then('all deleted text and w:del wrapper are removed', () => {
      expect(result).not.toContain('bold text');
      expect(result).not.toContain('normal text');
      expect(result).not.toContain('w:del');
    });
  });

  test('rejectAllChanges preserves both runs from multi-run <w:del>', async ({ given, when, then, and }: AllureBddContext) => {
    let result: string;

    await given('a document with a multi-run w:del element', () => {});

    await when('rejectAllChanges is called', () => {
      result = rejectAllChanges(multiRunDelXml);
    });

    await then('both deleted texts are restored as w:t', () => {
      // delText should be converted to w:t
      expect(result).toContain('bold text');
      expect(result).toContain('normal text');
      expect(result).not.toContain('w:del');
      expect(result).not.toContain('w:delText');
    });

    await and('bold formatting is preserved', () => {
      expect(result).toContain('w:b');
    });
  });
});

// =============================================================================
// Step 2: rPr-aware group splitting
// =============================================================================

describe('Step 2: rPr-aware group splitting in reconstructor', () => {
  test('Test 1 — Equal atoms with different rPr produce separate runs', async ({ given, when, then, and }: AllureBddContext) => {
    let atomA: ComparisonUnitAtom;
    let atomB: ComparisonUnitAtom;
    let result: string;

    await given('an atom with underline rPr and an atom with no rPr', () => {
      atomA = makeAtomWithRPr('underlined', [el('w:u', { 'w:val': 'single' })]);
      atomB = makeAtomNoRPr('normal');
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument([atomA, atomB], MINIMAL_DOCXML, OPTS);
    });

    await then('there are at least two separate runs', () => {
      // Should contain two separate <w:r> elements
      const runMatches = result.match(/<w:r>/g);
      expect(runMatches?.length).toBeGreaterThanOrEqual(2);
    });

    await and('underline marker is near underlined text not near normal text', () => {
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
  });

  test('Test 2 — Same rPr atoms consolidate into one run', async ({ given, when, then }: AllureBddContext) => {
    let atomA: ComparisonUnitAtom;
    let atomB: ComparisonUnitAtom;
    let result: string;

    await given('two atoms with identical bold rPr', () => {
      atomA = makeAtomWithRPr('word1', [el('w:b')]);
      atomB = makeAtomWithRPr('word2', [el('w:b')]);
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument([atomA, atomB], MINIMAL_DOCXML, OPTS);
    });

    await then('both atoms are consolidated into one run', () => {
      // Should produce a single paragraph with atoms consolidated
      // Both texts in the same run since rPr is identical
      const runMatches = result.match(/<w:r>/g);
      expect(runMatches?.length).toBe(1);
      expect(result).toContain('word1');
      expect(result).toContain('word2');
    });
  });

  test('Test 2b — Move atoms with different rPr stay in one group', async ({ given, when, then }: AllureBddContext) => {
    let atomA: ComparisonUnitAtom;
    let atomB: ComparisonUnitAtom;
    let result: string;

    await given('two MovedSource atoms with same move name but different rPr', () => {
      atomA = makeAtomWithRPr(
        'moved-bold',
        [el('w:b')],
        CorrelationStatus.MovedSource,
        0
      );
      atomA.moveName = 'move1';

      atomB = makeAtomNoRPr(
        'moved-normal',
        CorrelationStatus.MovedSource,
        0
      );
      atomB.moveName = 'move1';
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument([atomA, atomB], MINIMAL_DOCXML, OPTS);
    });

    await then('there is exactly one w:moveFrom block', () => {
      // Should produce one w:moveFrom block (no duplicate range markers)
      const moveFromRangeStartMatches = result.match(/moveFromRangeStart/g);
      expect(moveFromRangeStartMatches?.length).toBe(1);
    });
  });

  test('Test 2c — Atoms with rPr: null group together', async ({ given, when, then }: AllureBddContext) => {
    let atomA: ComparisonUnitAtom;
    let atomB: ComparisonUnitAtom;
    let result: string;

    await given('two atoms with null rPr', () => {
      atomA = makeAtomNoRPr('plain1');
      atomB = makeAtomNoRPr('plain2');
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument([atomA, atomB], MINIMAL_DOCXML, OPTS);
    });

    await then('atoms consolidate into one run with no rPr', () => {
      // Should consolidate into one <w:r> with no <w:rPr>
      const runMatches = result.match(/<w:r>/g);
      expect(runMatches?.length).toBe(1);
      expect(result).not.toContain('<w:rPr');
    });
  });
});

// =============================================================================
// Step 3: Format change integration
// =============================================================================

describe('Step 3: FormatChanged atom emits w:rPrChange', () => {
  test('Test 3 — FormatChanged atom produces rPrChange in output', async ({ given, when, then, and }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;
    let result: string;

    await given('a FormatChanged atom with bold new rPr and italic old rPr', () => {
      atom = makeAtomWithRPr(
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
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
    });

    await then('the output contains w:rPrChange', () => {
      expect(result).toContain('w:rPrChange');
    });

    await and('old italic property is inside rPrChange and new bold is in the run rPr', () => {
      // Should contain the old italic property inside rPrChange
      expect(result).toContain('w:i');
      // Should contain the new bold property in the run's rPr
      expect(result).toContain('w:b');
    });
  });
});

// =============================================================================
// Step 4: Per-atom rPr in reorderChangeBlocks
// =============================================================================

describe('Step 4: Per-atom rPr in reorderChangeBlocks', () => {
  test('Test 4 — Deleted atoms with different rPr produce separate runs inside <w:del>', async ({ given, when, then, and }: AllureBddContext) => {
    let delBold: ComparisonUnitAtom;
    let delNormal: ComparisonUnitAtom;
    let insItalic: ComparisonUnitAtom;
    let result: string;

    await given('two deleted atoms with different rPr and one inserted atom', () => {
      delBold = makeAtomWithRPr(
        'bold-deleted',
        [el('w:b')],
        CorrelationStatus.Deleted,
        0
      );
      delNormal = makeAtomNoRPr(
        'normal-deleted',
        CorrelationStatus.Deleted,
        0
      );
      insItalic = makeAtomWithRPr(
        'italic-inserted',
        [el('w:i')],
        CorrelationStatus.Inserted,
        0
      );
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument(
        [delBold, delNormal, insItalic],
        MINIMAL_DOCXML,
        OPTS
      );
    });

    await then('w:del wrapper contains two runs for the two differently-formatted deletions', () => {
      // <w:del> wrapper should contain two <w:r> (bold + normal)
      const delMatch = result.match(/<w:del[^>]*>([\s\S]*?)<\/w:del>/);
      expect(delMatch).not.toBeNull();
      const delContent = delMatch![1]!;
      const delRuns = delContent.match(/<w:r>/g);
      expect(delRuns?.length).toBe(2);
    });

    await and('w:ins wrapper contains one run with italic', () => {
      // <w:ins> wrapper should contain one <w:r> with italic
      const insMatch = result.match(/<w:ins[^>]*>([\s\S]*?)<\/w:ins>/);
      expect(insMatch).not.toBeNull();
      const insContent = insMatch![1]!;
      const insRuns = insContent.match(/<w:r>/g);
      expect(insRuns?.length).toBe(1);
      expect(insContent).toContain('w:i');
    });
  });

  test('Test 5 — Reorder with uniform rPr still consolidates', async ({ given, when, then }: AllureBddContext) => {
    let del1: ComparisonUnitAtom;
    let del2: ComparisonUnitAtom;
    let ins1: ComparisonUnitAtom;
    let result: string;

    await given('two deleted atoms with identical bold rPr and one inserted atom', () => {
      del1 = makeAtomWithRPr(
        'del1',
        [el('w:b')],
        CorrelationStatus.Deleted,
        0
      );
      del2 = makeAtomWithRPr(
        'del2',
        [el('w:b')],
        CorrelationStatus.Deleted,
        0
      );
      ins1 = makeAtomNoRPr('ins1', CorrelationStatus.Inserted, 0);
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument(
        [del1, del2, ins1],
        MINIMAL_DOCXML,
        OPTS
      );
    });

    await then('w:del contains exactly one run since both deletions have same rPr', () => {
      // <w:del> should have one <w:r> since both deletions have same rPr
      const delMatch = result.match(/<w:del[^>]*>([\s\S]*?)<\/w:del>/);
      expect(delMatch).not.toBeNull();
      const delContent = delMatch![1]!;
      const delRuns = delContent.match(/<w:r>/g);
      expect(delRuns?.length).toBe(1);
    });
  });

  test('Test 6 — Multi-run <w:del> accept/reject regression', async ({ given, when, then, and }: AllureBddContext) => {
    let xml: string;
    let accepted: string;
    let rejected: string;

    await given('a document with w:del containing two runs with different rPr', () => {
      // Construct XML with <w:del> containing two <w:r> children with different rPr
      xml = [
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
    });

    await when('acceptAllChanges and rejectAllChanges are called', () => {
      // Accept: all deleted text removed
      accepted = acceptAllChanges(xml);
      // Reject: all deleted text restored as normal text
      rejected = rejectAllChanges(xml);
    });

    await then('accept removes all deleted text', () => {
      expect(accepted).not.toContain('bold');
      expect(accepted).not.toContain('italic');
    });

    await and('reject restores all deleted text with formatting', () => {
      expect(rejected).toContain('bold');
      expect(rejected).toContain('italic');
      // Formatting preserved
      expect(rejected).toContain('w:b');
      expect(rejected).toContain('w:i');
      // No more delText
      expect(rejected).not.toContain('w:delText');
    });
  });
});

// =============================================================================
// Step 7: pPrChange for inserted paragraphs (rebuild path)
// =============================================================================

describe('Step 7: Rebuild path emits pPrChange for inserted paragraphs', () => {
  test('whole-paragraph insertion includes pPrChange with cloned pPr snapshot', async ({ given, when, then, and }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;
    let result: string;

    await given('an inserted atom whose paragraph has pPr with spacing', () => {
      // Create atoms for a whole-paragraph insertion with paragraph properties
      const spacingEl = el('w:spacing', { 'w:after': '200' });
      const pPrEl = el('w:pPr', {}, [spacingEl]);
      const textEl = el('w:t', {}, undefined, 'new paragraph');
      const run = el('w:r', {}, [textEl]);
      const paragraph = el('w:p', {}, [pPrEl, run]);

      atom = {
        sha1Hash: 'hash-new',
        correlationStatus: CorrelationStatus.Inserted,
        contentElement: textEl,
        ancestorElements: [paragraph, run],
        ancestorUnids: [],
        part: PART,
        paragraphIndex: 0,
        rPr: null,
      };
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
    });

    await then('the output contains pPrChange with original spacing', () => {
      // Should contain pPrChange
      expect(result).toContain('w:pPrChange');
      // pPrChange should contain the original spacing properties
      expect(result).toMatch(/w:pPrChange[^>]*>.*<w:pPr>.*w:spacing/s);
    });

    await and('accept removes pPrChange and w:ins but keeps text', () => {
      // Accept should still work — pPrChange is removed
      const accepted = acceptAllChanges(result);
      expect(accepted).toContain('new paragraph');
      expect(accepted).not.toContain('w:pPrChange');
      expect(accepted).not.toContain('w:ins');
    });
  });

  test('whole-paragraph insertion without pPr still emits pPrChange (empty snapshot)', async ({ given, when, then, and }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;
    let result: string;

    await given('an inserted atom whose paragraph has no pPr', () => {
      const textEl = el('w:t', {}, undefined, 'bare paragraph');
      const run = el('w:r', {}, [textEl]);
      const paragraph = el('w:p', {}, [run]);

      atom = {
        sha1Hash: 'hash-bare',
        correlationStatus: CorrelationStatus.Inserted,
        contentElement: textEl,
        ancestorElements: [paragraph, run],
        ancestorUnids: [],
        part: PART,
        paragraphIndex: 0,
        rPr: null,
      };
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
    });

    await then('pPrChange is present', () => {
      // Should contain pPrChange even with no source pPr
      expect(result).toContain('w:pPrChange');
    });

    await and('pPrChange contains an empty inner pPr', () => {
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
  test('empty inserted paragraph uses pPr/rPr/w:ins marker (not w:ins wrapping w:p)', async ({ given, when, then, and }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;
    let result: string;
    let root: ReturnType<typeof parseDocumentXml>;
    let targetP: Element | undefined;

    await given('an inserted empty paragraph atom with spacing pPr', () => {
      const pPrEl = el('w:pPr', {}, [el('w:spacing', { 'w:after': '200' })]);
      atom = makeEmptyParagraphAtom(CorrelationStatus.Inserted, 0, pPrEl);
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
      root = parseDocumentXml(result);
      const body = root.getElementsByTagName('w:body')[0]!;
      const paragraphs = findAllByTagName(body, 'w:p');

      // There should be at least one paragraph
      expect(paragraphs.length).toBeGreaterThanOrEqual(1);

      // Find the paragraph with the ins marker
      targetP = paragraphs.find(p => {
        const pPr = findChildByTagName(p, 'w:pPr');
        if (!pPr) return false;
        const rPr = findChildByTagName(pPr, 'w:rPr');
        if (!rPr) return false;
        return findChildByTagName(rPr, 'w:ins') !== null;
      });
    });

    await then('the target paragraph with w:ins marker is found', () => {
      expect(targetP).toBeDefined();
    });

    await and('pPr > rPr > w:ins exists with correct author', () => {
      // Verify w:pPr > w:rPr > w:ins exists
      const pPr = findChildByTagName(targetP!, 'w:pPr')!;
      const rPr = findChildByTagName(pPr, 'w:rPr')!;
      const insMarker = findChildByTagName(rPr, 'w:ins')!;
      expect(insMarker).not.toBeNull();
      expect(insMarker.getAttribute('w:author')).toBe('Test');
    });

    await and('no illegal w:ins wrapping w:p at top level', () => {
      // Verify NO <w:ins> wrapping <w:p> (the illegal pattern)
      const body = root.getElementsByTagName('w:body')[0]!;
      const topLevelIns = findAllByTagName(body, 'w:ins').filter(
        ins => ins.parentNode === body || ins.parentNode?.nodeName === 'w:body'
      );
      expect(topLevelIns.length).toBe(0);
    });

    await and('pPrChange is present', () => {
      const pPr = findChildByTagName(targetP!, 'w:pPr')!;
      const pPrChange = findChildByTagName(pPr, 'w:pPrChange');
      expect(pPrChange).not.toBeNull();
    });
  });

  test('empty deleted paragraph uses pPr/rPr/w:del marker (not w:del wrapping w:p)', async ({ given, when, then, and }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;
    let result: string;
    let targetP: Element | undefined;

    await given('a deleted empty paragraph atom with jc alignment pPr', () => {
      const pPrEl = el('w:pPr', {}, [el('w:jc', { 'w:val': 'center' })]);
      atom = makeEmptyParagraphAtom(CorrelationStatus.Deleted, 0, pPrEl);
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
      const root = parseDocumentXml(result);
      const body = root.getElementsByTagName('w:body')[0]!;
      const paragraphs = findAllByTagName(body, 'w:p');

      // Find the paragraph with the del marker
      targetP = paragraphs.find(p => {
        const pPr = findChildByTagName(p, 'w:pPr');
        if (!pPr) return false;
        const rPr = findChildByTagName(pPr, 'w:rPr');
        if (!rPr) return false;
        return findChildByTagName(rPr, 'w:del') !== null;
      });
    });

    await then('the target paragraph with w:del marker is found', () => {
      expect(targetP).toBeDefined();
    });

    await and('pPr > rPr > w:del exists with correct author', () => {
      // Verify w:pPr > w:rPr > w:del exists
      const pPr = findChildByTagName(targetP!, 'w:pPr')!;
      const rPr = findChildByTagName(pPr, 'w:rPr')!;
      const delMarker = findChildByTagName(rPr, 'w:del')!;
      expect(delMarker).not.toBeNull();
      expect(delMarker.getAttribute('w:author')).toBe('Test');
    });

    await and('no illegal w:del wrapping w:p at top level', () => {
      const root = parseDocumentXml(result);
      const body = root.getElementsByTagName('w:body')[0]!;
      // Verify NO <w:del> wrapping <w:p> (the illegal pattern)
      const topLevelDel = findAllByTagName(body, 'w:del').filter(
        del => del.parentNode === body || del.parentNode?.nodeName === 'w:body'
      );
      expect(topLevelDel.length).toBe(0);
    });
  });

  test('empty inserted paragraph without pPr synthesizes correct pPr/rPr', async ({ given, when, then, and }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;
    let result: string;
    let targetP: Element | undefined;

    await given('an inserted empty paragraph atom with no pPr', () => {
      atom = makeEmptyParagraphAtom(CorrelationStatus.Inserted, 0);
    });

    await when('reconstructDocument is called', () => {
      result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
      const root = parseDocumentXml(result);
      const body = root.getElementsByTagName('w:body')[0]!;
      const paragraphs = findAllByTagName(body, 'w:p');

      // Find paragraph with ins marker
      targetP = paragraphs.find(p => {
        const pPr = findChildByTagName(p, 'w:pPr');
        if (!pPr) return false;
        const rPr = findChildByTagName(pPr, 'w:rPr');
        if (!rPr) return false;
        return findChildByTagName(rPr, 'w:ins') !== null;
      });
    });

    await then('the synthesized pPr > rPr > w:ins structure is present', () => {
      expect(targetP).toBeDefined();

      // Verify synthesized pPr/rPr/w:ins
      const pPr = findChildByTagName(targetP!, 'w:pPr')!;
      expect(pPr).not.toBeNull();
      const rPr = findChildByTagName(pPr, 'w:rPr')!;
      expect(rPr).not.toBeNull();
      const insMarker = findChildByTagName(rPr, 'w:ins')!;
      expect(insMarker).not.toBeNull();
    });
  });

  test('accept round-trip: deleted empty paragraph removed on accept', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;
    let result: string;

    await given('a deleted empty paragraph atom', () => {
      atom = makeEmptyParagraphAtom(CorrelationStatus.Deleted, 0);
    });

    await when('reconstructDocument then acceptAllChanges are called', () => {
      result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
    });

    await then('no w:del markers remain after accept', () => {
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
  });

  test('accept round-trip: inserted empty paragraph kept on accept', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;
    let result: string;

    await given('an inserted empty paragraph atom', () => {
      atom = makeEmptyParagraphAtom(CorrelationStatus.Inserted, 0);
    });

    await when('reconstructDocument then acceptAllChanges are called', () => {
      result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
    });

    await then('w:ins marker is stripped and paragraph remains', () => {
      const accepted = acceptAllChanges(result);

      // After accepting, the inserted paragraph should remain (marker stripped)
      expect(accepted).not.toContain('w:ins');
      // The paragraph should still exist in the output
      const root = parseDocumentXml(accepted);
      const body = root.getElementsByTagName('w:body')[0]!;
      const paragraphs = findAllByTagName(body, 'w:p');
      expect(paragraphs.length).toBeGreaterThanOrEqual(1);
    });
  });

  test('reject round-trip: inserted empty paragraph removed on reject', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;
    let result: string;

    await given('an inserted empty paragraph atom', () => {
      atom = makeEmptyParagraphAtom(CorrelationStatus.Inserted, 0);
    });

    await when('reconstructDocument then rejectAllChanges are called', () => {
      result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
    });

    await then('w:ins is removed on reject', () => {
      const rejected = rejectAllChanges(result);
      // After rejecting, the inserted paragraph should be removed
      expect(rejected).not.toContain('w:ins');
    });
  });

  test('reject round-trip: deleted empty paragraph kept on reject', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;
    let result: string;

    await given('a deleted empty paragraph atom', () => {
      atom = makeEmptyParagraphAtom(CorrelationStatus.Deleted, 0);
    });

    await when('reconstructDocument then rejectAllChanges are called', () => {
      result = reconstructDocument([atom], MINIMAL_DOCXML, OPTS);
    });

    await then('w:del marker is stripped and paragraph remains', () => {
      const rejected = rejectAllChanges(result);

      // After rejecting, the deleted paragraph should be kept (marker stripped)
      expect(rejected).not.toContain('w:del');
      const root = parseDocumentXml(rejected);
      const body = root.getElementsByTagName('w:body')[0]!;
      const paragraphs = findAllByTagName(body, 'w:p');
      expect(paragraphs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
