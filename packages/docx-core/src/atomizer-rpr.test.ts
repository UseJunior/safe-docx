/**
 * Tests for rPr field on ComparisonUnitAtom.
 *
 * Validates that createComparisonUnitAtom populates rPr from the run ancestor,
 * sets null when no rPr exists, and that word-split atoms inherit rPr.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import { el } from './testing/dom-test-helpers.js';
import {
  createComparisonUnitAtom,
  splitAtomsIntoWords,
} from './atomizer.js';
import type { OpcPart } from './core-types.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Atomizer RPR' });

const PART: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };

describe('ComparisonUnitAtom.rPr', () => {
  test('populates rPr when the run has w:rPr', async ({ given, when, then }: AllureBddContext) => {
    let rPr: Element;
    let textEl: Element;
    let run: Element;
    let paragraph: Element;
    let atom: ReturnType<typeof createComparisonUnitAtom>;

    await given('a run with a w:rPr containing bold and underline', () => {
      rPr = el('w:rPr', {}, [el('w:b'), el('w:u', { 'w:val': 'single' })]);
      textEl = el('w:t', {}, undefined, 'hello');
      run = el('w:r', {}, [rPr, textEl]);
      paragraph = el('w:p', {}, [run]);
    });

    await when('createComparisonUnitAtom is called', () => {
      atom = createComparisonUnitAtom({
        contentElement: textEl,
        ancestors: [paragraph, run],
        part: PART,
      });
    });

    await then('rPr is populated as a clone with the correct children', () => {
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
  });

  test('sets rPr to null when run has no w:rPr', async ({ given, when, then }: AllureBddContext) => {
    let textEl: Element;
    let run: Element;
    let paragraph: Element;
    let atom: ReturnType<typeof createComparisonUnitAtom>;

    await given('a run without a w:rPr', () => {
      textEl = el('w:t', {}, undefined, 'world');
      run = el('w:r', {}, [textEl]);
      paragraph = el('w:p', {}, [run]);
    });

    await when('createComparisonUnitAtom is called', () => {
      atom = createComparisonUnitAtom({
        contentElement: textEl,
        ancestors: [paragraph, run],
        part: PART,
      });
    });

    await then('rPr is null', () => {
      expect(atom.rPr).toBeNull();
    });
  });

  test('word-split atoms inherit rPr from parent', async ({ given, when, then }: AllureBddContext) => {
    let textEl: Element;
    let run: Element;
    let paragraph: Element;
    let atom: ReturnType<typeof createComparisonUnitAtom>;
    let wordAtoms: ReturnType<typeof splitAtomsIntoWords>;

    await given('a run with italic rPr and multi-word text', () => {
      const rPr = el('w:rPr', {}, [el('w:i')]);
      textEl = el('w:t', {}, undefined, 'hello world');
      run = el('w:r', {}, [rPr, textEl]);
      paragraph = el('w:p', {}, [run]);
    });

    await when('the atom is word-split', () => {
      atom = createComparisonUnitAtom({
        contentElement: textEl,
        ancestors: [paragraph, run],
        part: PART,
      });
      // Split the atom into words
      wordAtoms = splitAtomsIntoWords([atom]);
    });

    await then('all word atoms share the same rPr reference', () => {
      // Should have 3 atoms: "hello", " ", "world"
      expect(wordAtoms.length).toBe(3);

      // All word atoms should share the same rPr reference
      for (const wordAtom of wordAtoms) {
        expect(wordAtom.rPr).toBe(atom.rPr);
      }
    });
  });
});
