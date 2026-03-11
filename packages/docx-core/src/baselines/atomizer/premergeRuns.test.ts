import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { premergeAdjacentRuns } from './premergeRuns.js';
import { el } from '../../testing/dom-test-helpers.js';
import { childElements, getLeafText } from '../../primitives/index.js';
import { assertDefined } from '../../testing/test-utils.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Premerge Runs' });

describe('premergeAdjacentRuns', () => {
  test('merges adjacent runs with identical formatting', async ({ given, when, then, and }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two adjacent runs with identical bold formatting', () => {
      const rPr = el('w:rPr', {}, [el('w:b')]);
      const r1 = el('w:r', {}, [rPr, el('w:t', {}, undefined, 'Hello')]);
      const r2 = el('w:r', {}, [el('w:rPr', {}, [el('w:b')]), el('w:t', {}, undefined, ' world')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('one merge is reported', () => {
      expect(merges).toBe(1);
    });

    await and('paragraph has one run child with two w:t elements', () => {
      const pChildren = childElements(p);
      expect(pChildren).toHaveLength(1);
      const firstChild = pChildren[0];
      assertDefined(firstChild, 'p children[0]');
      expect(firstChild.tagName).toBe('w:r');
      const runChildren = childElements(firstChild);
      const textChildren = runChildren.filter((c) => c.tagName === 'w:t');
      expect(textChildren).toHaveLength(2);
      expect(textChildren.map((c) => getLeafText(c) ?? '').join('')).toBe(
        'Hello world'
      );
    });
  });

  test('does not merge runs when formatting differs', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two runs with different formatting (bold vs italic)', () => {
      const r1 = el('w:r', {}, [el('w:rPr', {}, [el('w:b')]), el('w:t', {}, undefined, 'A')]);
      const r2 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'B')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('no merges are reported and both runs remain', () => {
      expect(merges).toBe(0);
      expect(childElements(p)).toHaveLength(2);
    });
  });

  test('does not merge runs that contain unsafe children', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two runs where one contains a w:drawing child', () => {
      const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'A')]);
      const r2 = el('w:r', {}, [el('w:drawing'), el('w:t', {}, undefined, 'B')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('no merges are reported and both runs remain', () => {
      expect(merges).toBe(0);
      expect(childElements(p)).toHaveLength(2);
    });
  });

  test('does not merge runs when run attributes differ', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two runs with different w:rsidRPr attributes', () => {
      const r1 = el('w:r', { 'w:rsidRPr': 'AAAA' }, [el('w:t', {}, undefined, 'A')]);
      const r2 = el('w:r', { 'w:rsidRPr': 'BBBB' }, [el('w:t', {}, undefined, 'B')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('no merges are reported and both runs remain', () => {
      expect(merges).toBe(0);
      expect(childElements(p)).toHaveLength(2);
    });
  });

  test('skips empty runs (no w:t children)', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('an empty run followed by a run with text, both bold', () => {
      const r1 = el('w:r', {}, [el('w:rPr', {}, [el('w:b')])]);
      const r2 = el('w:r', {}, [el('w:rPr', {}, [el('w:b')]), el('w:t', {}, undefined, 'Hello')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('one merge is reported and runs collapse into one', () => {
      // r1 is empty but still safe to merge — content from r2 moves into r1
      expect(merges).toBe(1);
      expect(childElements(p)).toHaveLength(1);
    });
  });

  test('does not merge runs with mixed content (w:t + w:tab + w:br)', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;
    let merged: Element;

    await given('two runs with mixed safe content (w:t, w:tab, w:br) and no rPr', () => {
      const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'A'), el('w:tab')]);
      const r2 = el('w:r', {}, [el('w:t', {}, undefined, 'B'), el('w:br')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      // Both runs are safe (w:t, w:tab, w:br are in SAFE_RUN_CHILD_TAGS), but they have no rPr
      // so formatting is identical — they CAN be merged
      merges = premergeAdjacentRuns(p);
    });

    await then('one merge is reported and merged run contains all content elements', () => {
      expect(merges).toBe(1);
      expect(childElements(p)).toHaveLength(1);
      // Merged run should contain all content elements
      merged = childElements(p)[0]!;
      const mergedChildren = childElements(merged);
      expect(mergedChildren.map((c) => c.tagName)).toEqual(['w:t', 'w:tab', 'w:t', 'w:br']);
    });
  });

  test('collapses three+ adjacent mergeable runs into one', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('four adjacent italic runs each with a single character', () => {
      const r1 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'A')]);
      const r2 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'B')]);
      const r3 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'C')]);
      const r4 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'D')]);
      p = el('w:p', {}, [r1, r2, r3, r4]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('three merges are reported and all runs collapse into one with text "ABCD"', () => {
      expect(merges).toBe(3);
      expect(childElements(p)).toHaveLength(1);
      const merged = childElements(p)[0]!;
      const textChildren = childElements(merged).filter((c) => c.tagName === 'w:t');
      expect(textChildren.map((c) => getLeafText(c) ?? '').join('')).toBe('ABCD');
    });
  });

  test('does not merge across field character boundaries (fldChar)', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('three runs where the middle run contains a field character begin', () => {
      const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'Before')]);
      const rField = el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'begin' })]);
      const r2 = el('w:r', {}, [el('w:t', {}, undefined, 'After')]);
      p = el('w:p', {}, [r1, rField, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('no merges are reported and all three runs remain', () => {
      // fldChar is not in SAFE_RUN_CHILD_TAGS, so rField is unsafe — blocks merging
      expect(merges).toBe(0);
      expect(childElements(p)).toHaveLength(3);
    });
  });

  test('is a no-op for paragraph with only pPr + one run', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('a paragraph with pPr and a single run', () => {
      const pPr = el('w:pPr', {}, [el('w:jc', { 'w:val': 'center' })]);
      const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'Only run')]);
      p = el('w:p', {}, [pPr, r1]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('no merges are reported and the single run remains', () => {
      expect(merges).toBe(0);
      // pPr is not a w:r so only 1 run — nothing to merge
      const runs = childElements(p).filter((c) => c.tagName === 'w:r');
      expect(runs).toHaveLength(1);
    });
  });

  test('concatenates text content correctly after merge', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('three runs with text "Hello ", "world", and "!" and no rPr', () => {
      const r1 = el('w:r', {}, [el('w:t', { 'xml:space': 'preserve' }, undefined, 'Hello ')]);
      const r2 = el('w:r', {}, [el('w:t', {}, undefined, 'world')]);
      const r3 = el('w:r', {}, [el('w:t', {}, undefined, '!')]);
      p = el('w:p', {}, [r1, r2, r3]);
    });

    await when('premergeAdjacentRuns is called', () => {
      premergeAdjacentRuns(p);
    });

    await then('all runs collapse into one with concatenated text "Hello world!"', () => {
      expect(childElements(p)).toHaveLength(1);
      const merged = childElements(p)[0]!;
      const textChildren = childElements(merged).filter((c) => c.tagName === 'w:t');
      expect(textChildren.map((c) => getLeafText(c) ?? '').join('')).toBe('Hello world!');
    });
  });

  test('merges runs with identical rPr but different xml:space handling', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two bold runs where the first w:t has xml:space="preserve"', () => {
      const r1 = el('w:r', {}, [
        el('w:rPr', {}, [el('w:b')]),
        el('w:t', { 'xml:space': 'preserve' }, undefined, 'Hello '),
      ]);
      const r2 = el('w:r', {}, [
        el('w:rPr', {}, [el('w:b')]),
        el('w:t', {}, undefined, 'world'),
      ]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('one merge is reported and runs collapse into one', () => {
      // xml:space is on w:t, not on w:r or w:rPr — rPr is still identical
      expect(merges).toBe(1);
      expect(childElements(p)).toHaveLength(1);
    });
  });

  test('does not merge runs with nested elements under non-rPr children', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two runs where the second w:t has a nested w:sym child element', () => {
      // A w:t with a nested child element is unusual but should be rejected
      const t1 = el('w:t', {}, undefined, 'A');
      const t2 = el('w:t', {}, [el('w:sym', { 'w:char': 'F0E0' })]);
      const r1 = el('w:r', {}, [t1]);
      const r2 = el('w:r', {}, [t2]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('no merges are reported and both runs remain', () => {
      // t2 has a child element under w:t — runIsSafeToMerge returns false
      expect(merges).toBe(0);
      expect(childElements(p)).toHaveLength(2);
    });
  });

  test('handles runs with w:delText (deleted text)', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two runs with w:delText children and no rPr', () => {
      const r1 = el('w:r', {}, [el('w:delText', {}, undefined, 'removed ')]);
      const r2 = el('w:r', {}, [el('w:delText', {}, undefined, 'text')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('one merge is reported and runs collapse into one', () => {
      // w:delText is in SAFE_RUN_CHILD_TAGS, runs have no rPr — should merge
      expect(merges).toBe(1);
      expect(childElements(p)).toHaveLength(1);
    });
  });
});
