import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import type { WmlElement } from '../../core-types.js';
import { backfillParentReferences } from './wmlElementUtils.js';
import { premergeAdjacentRuns } from './premergeRuns.js';
import { assertDefined } from '../../testing/test-utils.js';

function el(
  tagName: string,
  attrs: Record<string, string> = {},
  children?: WmlElement[],
  textContent?: string
): WmlElement {
  const node: WmlElement = { tagName, attributes: { ...attrs } };
  if (children) node.children = children;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

describe('premergeAdjacentRuns', () => {
  it('merges adjacent runs with identical formatting', () => {
    const rPr = el('w:rPr', {}, [el('w:b')]);
    const r1 = el('w:r', {}, [rPr, el('w:t', {}, undefined, 'Hello')]);
    const r2 = el('w:r', {}, [el('w:rPr', {}, [el('w:b')]), el('w:t', {}, undefined, ' world')]);
    const p = el('w:p', {}, [r1, r2]);
    backfillParentReferences(p);

    const merges = premergeAdjacentRuns(p);

    expect(merges).toBe(1);
    expect(p.children).toHaveLength(1);
    const firstChild = p.children![0];
    assertDefined(firstChild, 'p.children[0]');
    expect(firstChild.tagName).toBe('w:r');
    const runChildren = firstChild.children ?? [];
    expect(runChildren.filter((c) => c.tagName === 'w:t')).toHaveLength(2);
    expect(runChildren.filter((c) => c.tagName === 'w:t').map((c) => c.textContent).join('')).toBe(
      'Hello world'
    );
  });

  it('does not merge runs when formatting differs', () => {
    const r1 = el('w:r', {}, [el('w:rPr', {}, [el('w:b')]), el('w:t', {}, undefined, 'A')]);
    const r2 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'B')]);
    const p = el('w:p', {}, [r1, r2]);
    backfillParentReferences(p);

    const merges = premergeAdjacentRuns(p);

    expect(merges).toBe(0);
    expect(p.children).toHaveLength(2);
  });

  it('does not merge runs that contain unsafe children', () => {
    const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'A')]);
    const r2 = el('w:r', {}, [el('w:drawing'), el('w:t', {}, undefined, 'B')]);
    const p = el('w:p', {}, [r1, r2]);
    backfillParentReferences(p);

    const merges = premergeAdjacentRuns(p);

    expect(merges).toBe(0);
    expect(p.children).toHaveLength(2);
  });

  it('does not merge runs when run attributes differ', () => {
    const r1 = el('w:r', { 'w:rsidRPr': 'AAAA' }, [el('w:t', {}, undefined, 'A')]);
    const r2 = el('w:r', { 'w:rsidRPr': 'BBBB' }, [el('w:t', {}, undefined, 'B')]);
    const p = el('w:p', {}, [r1, r2]);
    backfillParentReferences(p);

    const merges = premergeAdjacentRuns(p);

    expect(merges).toBe(0);
    expect(p.children).toHaveLength(2);
  });
});
