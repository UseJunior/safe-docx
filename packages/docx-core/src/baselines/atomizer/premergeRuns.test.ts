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
});
