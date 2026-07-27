/**
 * Characterization tests pinning the LCS *alignment* chosen by `computeAtomLcs` (#584).
 *
 * LCS *length* is unique, but the *alignment* — which atom pairs get matched when
 * several optimal alignments exist — is not. The backtracker in `atomLcs.ts`
 * resolves ties with `dp[i-1][j] > dp[i][j-1]`, and that choice is user-visible:
 * matched pairs feed `comparisonUnitAtomBefore`, which drives format-change
 * detection (`w:rPrChange`), move detection, and merged-output ordering. Before
 * this file, inverting the tie-breaker (`>` → `>=`) changed which runs received
 * format-change revisions yet the entire suite stayed green.
 *
 * These tests pin the CURRENT alignment as observable behavior — they do not
 * claim it is the only correct one. Any refactor of the LCS internals (the
 * Myers/prefix-trim work gated behind #583 Track B, or an innocuous-looking loop
 * rewrite) that changes the chosen alignment MUST fail here, forcing a deliberate,
 * reviewed decision instead of a silent redline shift.
 *
 * Perturbations each test discriminates:
 * - "swapped adjacent atoms" / "reversed sequence": fail when the DP tie-breaker
 *   is inverted (`>` → `>=`), verified by executing the suite under the inversion.
 * - "duplicate identity": the inversion cannot reach the tie branch here (the
 *   backtracker eagerly matches equal heads), so this test is inversion-neutral
 *   by construction; it instead pins the eager last-occurrence match that a
 *   first-occurrence-preferring rewrite (e.g. Myers) would flip.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/584
 */

import { describe, expect } from 'vitest';
import { DocxArchive, parseXml } from '@usejunior/docx-core';
import type { ComparisonUnitAtom, OpcPart, WmlElement } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { el } from '../../testing/dom-test-helpers.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import {
  createComparisonUnitAtom,
  assignIdentityIds,
  IdentityInterner,
} from '../../atomizer.js';
import { compareDocuments } from '../../index.js';
import { computeAtomLcs } from './atomLcs.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Atom LCS' });

const PART: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
const FIXED_DATE = new Date('2026-07-27T12:00:00Z');

/** Build a real finalized atom whose identity is its `w:t` text. */
function textAtom(text: string): ComparisonUnitAtom {
  return createComparisonUnitAtom({
    contentElement: el('w:t', {}, undefined, text) as WmlElement,
    ancestors: [],
    part: PART,
  });
}

/** A single run with optional rPr children, as body XML. */
function run(text: string, rPrXml = ''): string {
  const rPr = rPrXml === '' ? '' : `<w:rPr>${rPrXml}</w:rPr>`;
  return `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

// Shared multi-word context on both sides of the interesting runs. Without it the
// paragraph pair fails the hierarchical paragraph-similarity gate (a one-token
// paragraph like "AlphaBeta" has Jaccard 0 against "BetaAlpha") and the whole
// paragraph degrades to delete+insert before `computeAtomLcs` ever runs.
const PREFIX = run('Clause text before ');
const SUFFIX = run(' after end');

async function documentXml(docx: Buffer): Promise<string> {
  return (await DocxArchive.load(docx)).getDocumentXml();
}

/** All elements with the given qualified tag name, as an array. */
function elementsOf(doc: ReturnType<typeof parseXml>, tagName: string): Element[] {
  return Array.from(doc.getElementsByTagName(tagName)) as Element[];
}

/** Text of the w:t / w:delText leaf inside the run that owns `descendant`. */
function owningRunText(descendant: Element): string {
  let node: Element | null = descendant;
  while (node && node.tagName !== 'w:r') {
    node = node.parentNode as Element | null;
  }
  if (!node) return '';
  const texts = Array.from(node.getElementsByTagName('w:t')).concat(
    Array.from(node.getElementsByTagName('w:delText')),
  );
  return texts.map((t) => t.textContent ?? '').join('');
}

describe('LCS alignment pinning (#584)', () => {
  test.allure({ story: 'swapped adjacent atoms: tie resolves toward the later original / earlier revised match' })('swapped adjacent atoms: tie resolves toward the later original / earlier revised match', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    let result: ReturnType<typeof computeAtomLcs>;

    await given('original [Alpha, Beta] and revised [Beta, Alpha] — either single-atom match is LCS-optimal', () => {});

    await when('the LCS is computed (legacy atomsEqual path: no interned identity ids)', async () => {
      result = computeAtomLcs(
        [textAtom('Alpha'), textAtom('Beta')],
        [textAtom('Beta'), textAtom('Alpha')],
      );
      await attachPrettyJson('LCS result', result);
    });

    await then('the backtracker keeps the Beta pair (original index 1 ↔ revised index 0), deleting and re-inserting Alpha', () => {
      // Both {Alpha: 0↔1} and {Beta: 1↔0} are length-1 optima. The dp tie at the
      // top-right corner is what selects between them, so an inverted tie-breaker
      // (`>` → `>=`) flips this to [{ originalIndex: 0, revisedIndex: 1 }].
      expect(result.matches).toEqual([{ originalIndex: 1, revisedIndex: 0 }]);
      expect(result.deletedIndices).toEqual([0]);
      expect(result.insertedIndices).toEqual([1]);
    });
  });

  test.allure({ story: 'reversed sequence: the single surviving atom is the LAST original element' })('reversed sequence: the single surviving atom is the LAST original element', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    let result: ReturnType<typeof computeAtomLcs>;

    await given('original [A, B, C, D] and revised [D, C, B, A] — every element is a length-1 LCS candidate', () => {});

    await when('the LCS is computed on the production path (interned identity ids)', async () => {
      const original = ['A', 'B', 'C', 'D'].map(textAtom);
      const revised = ['D', 'C', 'B', 'A'].map(textAtom);
      const interner = new IdentityInterner();
      assignIdentityIds(original, interner);
      assignIdentityIds(revised, interner);
      result = computeAtomLcs(original, revised);
      await attachPrettyJson('LCS result', result);
    });

    await then('the backtracker survives D (original index 3 ↔ revised index 0)', () => {
      // The backtrack from the corner crosses three consecutive dp ties; the
      // current `>` tie-breaker walks the revised side first and lands on D.
      // Inverting it walks the original side first and would survive A
      // ([{ originalIndex: 0, revisedIndex: 3 }]) instead.
      expect(result.matches).toEqual([{ originalIndex: 3, revisedIndex: 0 }]);
      expect(result.deletedIndices).toEqual([0, 1, 2]);
      expect(result.insertedIndices).toEqual([1, 2, 3]);
    });
  });

  test.allure({ story: 'swapped formatted runs: alignment decides which run gets the rPrChange revision' })('swapped formatted runs: alignment decides which run gets the rPrChange revision', async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
    let xml: string;
    let stats: Awaited<ReturnType<typeof compareDocuments>>['stats'];

    const original = await given('an original paragraph "… Alpha Beta …" with Alpha italic and Beta bold', () =>
      buildDocxFromBodyXml(`<w:p>${PREFIX}${run('Alpha', '<w:i/>')}${run('Beta', '<w:b/>')}${SUFFIX}</w:p>`),
    );
    const revised = await given('a revised paragraph "… Beta Alpha …" with Beta now plain and Alpha still italic', () =>
      buildDocxFromBodyXml(`<w:p>${PREFIX}${run('Beta')}${run('Alpha', '<w:i/>')}${SUFFIX}</w:p>`),
    );

    await when('the documents are compared with format detection on and move detection off', async () => {
      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        date: FIXED_DATE,
        ignoreFormatting: false,
        detectMoves: false,
      });
      stats = result.stats;
      xml = await documentXml(result.document);
      await attachPrettyJson('Comparison stats', stats);
    });

    await then('the Beta pair is the matched anchor, so its bold→plain change surfaces as the only rPrChange', () => {
      // Under the inverted tie-breaker the Alpha pair (italic ↔ italic, no format
      // difference) anchors instead: formatChanges drops to 0, no rPrChange is
      // emitted, and Beta becomes the deleted/re-inserted text.
      const doc = parseXml(xml);
      const rPrChanges = elementsOf(doc, 'w:rPrChange');
      expect(stats.formatChanges).toBe(1);
      expect(rPrChanges).toHaveLength(1);
      expect(owningRunText(rPrChanges[0]!)).toBe('Beta');
      // The recorded old formatting is Beta's original bold, confirming the
      // matched pair is Beta(bold) ↔ Beta(plain).
      expect(Array.from(rPrChanges[0]!.getElementsByTagName('w:b'))).toHaveLength(1);
    });

    await and('Alpha — not Beta — is the deleted and re-inserted text', () => {
      const doc = parseXml(xml);
      const deletedTexts = elementsOf(doc, 'w:delText').map((t) => t.textContent ?? '');
      expect(deletedTexts).toEqual(['Alpha']);
      const insertedTexts = elementsOf(doc, 'w:ins').flatMap((ins) =>
        Array.from(ins.getElementsByTagName('w:t')).map((t) => t.textContent ?? ''),
      );
      expect(insertedTexts).toEqual(['Alpha']);
    });
  });

  test.allure({ story: 'duplicate identity: the LAST same-text original run anchors the match, not the first' })('duplicate identity: the LAST same-text original run anchors the match, not the first', async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
    let xml: string;
    let stats: Awaited<ReturnType<typeof compareDocuments>>['stats'];

    const original = await given('an original paragraph with two same-text runs: "Same" bold then "Same" italic', () =>
      buildDocxFromBodyXml(`<w:p>${PREFIX}${run('Same', '<w:b/>')}${run('Same', '<w:i/>')}${SUFFIX}</w:p>`),
    );
    const revised = await given('a revised paragraph with a single bold "Same" run', () =>
      buildDocxFromBodyXml(`<w:p>${PREFIX}${run('Same', '<w:b/>')}${SUFFIX}</w:p>`),
    );

    await when('the documents are compared with format detection on and move detection off', async () => {
      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        date: FIXED_DATE,
        ignoreFormatting: false,
        detectMoves: false,
      });
      stats = result.stats;
      xml = await documentXml(result.document);
      await attachPrettyJson('Comparison stats', stats);
    });

    await then('the surviving run pairs with the ITALIC original, surfacing an italic→bold rPrChange', () => {
      // The backtracker matches equal heads eagerly from the tail, so the revised
      // bold "Same" pairs with the *italic* original — a format change — while the
      // formatting-identical bold original is deleted. A first-occurrence-preferring
      // rewrite (e.g. Myers) would pair bold↔bold and emit no rPrChange at all.
      const doc = parseXml(xml);
      const rPrChanges = elementsOf(doc, 'w:rPrChange');
      expect(stats.formatChanges).toBe(1);
      expect(rPrChanges).toHaveLength(1);
      const oldRPr = Array.from(rPrChanges[0]!.getElementsByTagName('w:i'));
      expect(oldRPr).toHaveLength(1);
    });

    await and('the deleted run is the BOLD duplicate', () => {
      const doc = parseXml(xml);
      const dels = elementsOf(doc, 'w:del');
      expect(dels).toHaveLength(1);
      const deletedRun = dels[0]!;
      expect(Array.from(deletedRun.getElementsByTagName('w:delText')).map((t) => t.textContent)).toEqual(['Same']);
      expect(Array.from(deletedRun.getElementsByTagName('w:b'))).toHaveLength(1);
      expect(Array.from(deletedRun.getElementsByTagName('w:i'))).toHaveLength(0);
    });
  });
});
