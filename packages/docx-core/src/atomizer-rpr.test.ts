/**
 * Tests for rPr field on ComparisonUnitAtom.
 *
 * Validates that createComparisonUnitAtom populates rPr from the run ancestor,
 * sets null when no rPr exists, and that word-split atoms inherit rPr.
 */

import { describe, expect } from 'vitest';
import { itAllure as it } from './testing/allure-test.js';
import { el } from './testing/dom-test-helpers.js';
import {
  createComparisonUnitAtom,
  splitAtomsIntoWords,
} from './atomizer.js';
import type { OpcPart } from './core-types.js';

const PART: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };

describe('ComparisonUnitAtom.rPr', () => {
  it('populates rPr when the run has w:rPr', () => {
    const rPr = el('w:rPr', {}, [el('w:b'), el('w:u', { 'w:val': 'single' })]);
    const textEl = el('w:t', {}, undefined, 'hello');
    const run = el('w:r', {}, [rPr, textEl]);
    const paragraph = el('w:p', {}, [run]);

    const atom = createComparisonUnitAtom({
      contentElement: textEl,
      ancestors: [paragraph, run],
      part: PART,
    });

    expect(atom.rPr).not.toBeNull();
    expect(atom.rPr).toBeDefined();
    // Should be a clone, not the same reference
    expect(atom.rPr).not.toBe(rPr);
    expect(atom.rPr!.tagName).toBe('w:rPr');
    // Check children are preserved
    const children = Array.from(atom.rPr!.childNodes).filter(
      (n) => n.nodeType === 1
    ) as Element[];
    expect(children.length).toBe(2);
    expect(children[0]!.tagName).toBe('w:b');
    expect(children[1]!.tagName).toBe('w:u');
  });

  it('sets rPr to null when run has no w:rPr', () => {
    const textEl = el('w:t', {}, undefined, 'world');
    const run = el('w:r', {}, [textEl]);
    const paragraph = el('w:p', {}, [run]);

    const atom = createComparisonUnitAtom({
      contentElement: textEl,
      ancestors: [paragraph, run],
      part: PART,
    });

    expect(atom.rPr).toBeNull();
  });

  it('word-split atoms inherit rPr from parent', () => {
    const rPr = el('w:rPr', {}, [el('w:i')]);
    const textEl = el('w:t', {}, undefined, 'hello world');
    const run = el('w:r', {}, [rPr, textEl]);
    const paragraph = el('w:p', {}, [run]);

    const atom = createComparisonUnitAtom({
      contentElement: textEl,
      ancestors: [paragraph, run],
      part: PART,
    });

    // Split the atom into words
    const wordAtoms = splitAtomsIntoWords([atom]);

    // Should have 3 atoms: "hello", " ", "world"
    expect(wordAtoms.length).toBe(3);

    // All word atoms should share the same rPr reference
    for (const wordAtom of wordAtoms) {
      expect(wordAtom.rPr).toBe(atom.rPr);
    }
  });
});
