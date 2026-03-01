import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import { premergeAdjacentRuns } from './premergeRuns.js';
import { el } from '../../testing/dom-test-helpers.js';
import { childElements, getLeafText } from '../../primitives/index.js';
import { assertDefined } from '../../testing/test-utils.js';

describe('premergeAdjacentRuns', () => {
  it('merges adjacent runs with identical formatting', () => {
    const rPr = el('w:rPr', {}, [el('w:b')]);
    const r1 = el('w:r', {}, [rPr, el('w:t', {}, undefined, 'Hello')]);
    const r2 = el('w:r', {}, [el('w:rPr', {}, [el('w:b')]), el('w:t', {}, undefined, ' world')]);
    const p = el('w:p', {}, [r1, r2]);

    const merges = premergeAdjacentRuns(p);

    expect(merges).toBe(1);
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

  it('does not merge runs when formatting differs', () => {
    const r1 = el('w:r', {}, [el('w:rPr', {}, [el('w:b')]), el('w:t', {}, undefined, 'A')]);
    const r2 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'B')]);
    const p = el('w:p', {}, [r1, r2]);

    const merges = premergeAdjacentRuns(p);

    expect(merges).toBe(0);
    expect(childElements(p)).toHaveLength(2);
  });

  it('does not merge runs that contain unsafe children', () => {
    const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'A')]);
    const r2 = el('w:r', {}, [el('w:drawing'), el('w:t', {}, undefined, 'B')]);
    const p = el('w:p', {}, [r1, r2]);

    const merges = premergeAdjacentRuns(p);

    expect(merges).toBe(0);
    expect(childElements(p)).toHaveLength(2);
  });

  it('does not merge runs when run attributes differ', () => {
    const r1 = el('w:r', { 'w:rsidRPr': 'AAAA' }, [el('w:t', {}, undefined, 'A')]);
    const r2 = el('w:r', { 'w:rsidRPr': 'BBBB' }, [el('w:t', {}, undefined, 'B')]);
    const p = el('w:p', {}, [r1, r2]);

    const merges = premergeAdjacentRuns(p);

    expect(merges).toBe(0);
    expect(childElements(p)).toHaveLength(2);
  });

  it('skips empty runs (no w:t children)', () => {
    const r1 = el('w:r', {}, [el('w:rPr', {}, [el('w:b')])]);
    const r2 = el('w:r', {}, [el('w:rPr', {}, [el('w:b')]), el('w:t', {}, undefined, 'Hello')]);
    const p = el('w:p', {}, [r1, r2]);

    const merges = premergeAdjacentRuns(p);

    // r1 is empty but still safe to merge — content from r2 moves into r1
    expect(merges).toBe(1);
    expect(childElements(p)).toHaveLength(1);
  });

  it('does not merge runs with mixed content (w:t + w:tab + w:br)', () => {
    const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'A'), el('w:tab')]);
    const r2 = el('w:r', {}, [el('w:t', {}, undefined, 'B'), el('w:br')]);
    const p = el('w:p', {}, [r1, r2]);

    // Both runs are safe (w:t, w:tab, w:br are in SAFE_RUN_CHILD_TAGS), but they have no rPr
    // so formatting is identical — they CAN be merged
    const merges = premergeAdjacentRuns(p);
    expect(merges).toBe(1);
    expect(childElements(p)).toHaveLength(1);
    // Merged run should contain all content elements
    const merged = childElements(p)[0]!;
    const mergedChildren = childElements(merged);
    expect(mergedChildren.map((c) => c.tagName)).toEqual(['w:t', 'w:tab', 'w:t', 'w:br']);
  });

  it('collapses three+ adjacent mergeable runs into one', () => {
    const r1 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'A')]);
    const r2 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'B')]);
    const r3 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'C')]);
    const r4 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'D')]);
    const p = el('w:p', {}, [r1, r2, r3, r4]);

    const merges = premergeAdjacentRuns(p);

    expect(merges).toBe(3);
    expect(childElements(p)).toHaveLength(1);
    const merged = childElements(p)[0]!;
    const textChildren = childElements(merged).filter((c) => c.tagName === 'w:t');
    expect(textChildren.map((c) => getLeafText(c) ?? '').join('')).toBe('ABCD');
  });

  it('does not merge across field character boundaries (fldChar)', () => {
    const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'Before')]);
    const rField = el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'begin' })]);
    const r2 = el('w:r', {}, [el('w:t', {}, undefined, 'After')]);
    const p = el('w:p', {}, [r1, rField, r2]);

    const merges = premergeAdjacentRuns(p);

    // fldChar is not in SAFE_RUN_CHILD_TAGS, so rField is unsafe — blocks merging
    expect(merges).toBe(0);
    expect(childElements(p)).toHaveLength(3);
  });

  it('is a no-op for paragraph with only pPr + one run', () => {
    const pPr = el('w:pPr', {}, [el('w:jc', { 'w:val': 'center' })]);
    const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'Only run')]);
    const p = el('w:p', {}, [pPr, r1]);

    const merges = premergeAdjacentRuns(p);

    expect(merges).toBe(0);
    // pPr is not a w:r so only 1 run — nothing to merge
    const runs = childElements(p).filter((c) => c.tagName === 'w:r');
    expect(runs).toHaveLength(1);
  });

  it('concatenates text content correctly after merge', () => {
    const r1 = el('w:r', {}, [el('w:t', { 'xml:space': 'preserve' }, undefined, 'Hello ')]);
    const r2 = el('w:r', {}, [el('w:t', {}, undefined, 'world')]);
    const r3 = el('w:r', {}, [el('w:t', {}, undefined, '!')]);
    const p = el('w:p', {}, [r1, r2, r3]);

    premergeAdjacentRuns(p);

    expect(childElements(p)).toHaveLength(1);
    const merged = childElements(p)[0]!;
    const textChildren = childElements(merged).filter((c) => c.tagName === 'w:t');
    expect(textChildren.map((c) => getLeafText(c) ?? '').join('')).toBe('Hello world!');
  });

  it('merges runs with identical rPr but different xml:space handling', () => {
    const r1 = el('w:r', {}, [
      el('w:rPr', {}, [el('w:b')]),
      el('w:t', { 'xml:space': 'preserve' }, undefined, 'Hello '),
    ]);
    const r2 = el('w:r', {}, [
      el('w:rPr', {}, [el('w:b')]),
      el('w:t', {}, undefined, 'world'),
    ]);
    const p = el('w:p', {}, [r1, r2]);

    const merges = premergeAdjacentRuns(p);

    // xml:space is on w:t, not on w:r or w:rPr — rPr is still identical
    expect(merges).toBe(1);
    expect(childElements(p)).toHaveLength(1);
  });

  it('does not merge runs with nested elements under non-rPr children', () => {
    // A w:t with a nested child element is unusual but should be rejected
    const t1 = el('w:t', {}, undefined, 'A');
    const t2 = el('w:t', {}, [el('w:sym', { 'w:char': 'F0E0' })]);
    const r1 = el('w:r', {}, [t1]);
    const r2 = el('w:r', {}, [t2]);
    const p = el('w:p', {}, [r1, r2]);

    const merges = premergeAdjacentRuns(p);

    // t2 has a child element under w:t — runIsSafeToMerge returns false
    expect(merges).toBe(0);
    expect(childElements(p)).toHaveLength(2);
  });

  it('handles runs with w:delText (deleted text)', () => {
    const r1 = el('w:r', {}, [el('w:delText', {}, undefined, 'removed ')]);
    const r2 = el('w:r', {}, [el('w:delText', {}, undefined, 'text')]);
    const p = el('w:p', {}, [r1, r2]);

    const merges = premergeAdjacentRuns(p);

    // w:delText is in SAFE_RUN_CHILD_TAGS, runs have no rPr — should merge
    expect(merges).toBe(1);
    expect(childElements(p)).toHaveLength(1);
  });
});
