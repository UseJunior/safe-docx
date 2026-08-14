/**
 * Characterization tests pinning the LCS *alignment* chosen by `computeAtomLcs` (#584).
 *
 * LCS *length* is unique, but the *alignment* — which atom pairs get matched when
 * several optimal alignments exist — is not. The selector in `atomLcs.ts` walks
 * a suffix table FORWARD from (0,0), matching equal heads eagerly and preferring
 * the original side on `dp[i+1][j] >= dp[i][j+1]` ties, and that choice is
 * user-visible: matched pairs feed `comparisonUnitAtomBefore`, which drives
 * format-change detection (`w:rPrChange`), move detection, and merged-output
 * ordering. Before this file, inverting a tie-breaker changed which runs
 * received format-change revisions yet the entire suite stayed green.
 *
 * These tests pin the CURRENT alignment as observable behavior — they do not
 * claim it is the only correct one. Any refactor of the LCS internals (the
 * Myers/prefix-trim work gated behind #583 Track B, or an innocuous-looking loop
 * rewrite) that changes any of these pinned alignment choices MUST fail here,
 * forcing a deliberate, reviewed decision instead of a silent redline shift.
 * (They are a characterization set, not exhaustive equivalence evidence: a
 * refactor could preserve these cases while changing other ambiguous alignments
 * — the corpus-wide differential harness proposed in #584 remains follow-up.)
 *
 * One such deliberate decision has already happened: issue #846 replaced the
 * original prefix-table backward backtracker (whose eager tail matching pinned
 * LAST-occurrence duplicates) with the forward earliest-occurrence walk, so the
 * emitted alignment agrees with the independent release verifier's
 * forward-greedy convention and stops revising preservable common tokens. The
 * "duplicate identity" pin below was updated accordingly in the same change.
 *
 * Perturbations each test discriminates:
 * - "swapped adjacent atoms" / "reversed sequence": fail when the forward walk's
 *   tie preference is inverted (`>=` → `<`), which would advance the revised
 *   side first and survive the opposite element.
 * - "duplicate identity": tie branches are unreachable here (the walk eagerly
 *   matches equal heads), so this test is tie-inversion-neutral by
 *   construction; it instead pins the eager first-occurrence match that a
 *   last-occurrence-preferring rewrite (e.g. the pre-#846 backward
 *   backtracker) would flip.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/584
 * @see https://github.com/UseJunior/safe-docx/issues/846
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

    await then('the walk keeps the Beta pair (original index 1 ↔ revised index 0), deleting and re-inserting Alpha', () => {
      // Both {Alpha: 0↔1} and {Beta: 1↔0} are length-1 optima. The forward
      // walk's `>=` tie advances the original side first and lands on Beta; an
      // inverted tie preference (advance the revised side first) flips this to
      // [{ originalIndex: 0, revisedIndex: 1 }].
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

    await then('the walk survives D (original index 3 ↔ revised index 0)', () => {
      // The forward walk crosses three consecutive dp ties; the `>=` tie
      // preference advances the original side first and lands on D. Inverting
      // it advances the revised side first and would survive A
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

  test.allure({ story: 'duplicate identity: the FIRST same-text original run anchors the match, not the last' })('duplicate identity: the FIRST same-text original run anchors the match, not the last', async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
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

    await then('the surviving run pairs with the BOLD original, so no rPrChange is emitted', () => {
      // The forward walk matches equal heads eagerly from the front, so the
      // revised bold "Same" pairs with the *bold* original — formatting
      // identical, no format change — while the italic duplicate is deleted.
      // A last-occurrence-preferring rewrite (e.g. the pre-#846 backward
      // backtracker) would pair bold↔italic and surface a spurious
      // italic→bold rPrChange instead.
      const doc = parseXml(xml);
      const rPrChanges = elementsOf(doc, 'w:rPrChange');
      expect(stats.formatChanges).toBe(0);
      expect(rPrChanges).toHaveLength(0);
    });

    await and('the deleted run is the ITALIC duplicate', () => {
      const doc = parseXml(xml);
      const dels = elementsOf(doc, 'w:del');
      expect(dels).toHaveLength(1);
      const deletedRun = dels[0]!;
      expect(Array.from(deletedRun.getElementsByTagName('w:delText')).map((t) => t.textContent)).toEqual(['Same']);
      expect(Array.from(deletedRun.getElementsByTagName('w:i'))).toHaveLength(1);
      expect(Array.from(deletedRun.getElementsByTagName('w:b'))).toHaveLength(0);
    });
  });
});
