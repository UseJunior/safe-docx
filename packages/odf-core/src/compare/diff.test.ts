import { describe, it, expect } from 'vitest';

import { diffParagraphs, type EditOp } from './diff.js';

/** Compact an edit script to readable tokens for assertions. */
function tokens(ops: EditOp[]): string[] {
  return ops.map((op) => {
    if (op.kind === 'equal') return `=${op.originalIndex}:${op.revisedIndex}`;
    if (op.kind === 'insert') return `+${op.revisedIndex}`;
    return `-${op.originalIndex}`;
  });
}

describe('diffParagraphs — paragraph-level LCS', () => {
  it('[OCMP-01] marks added/removed/common paragraphs', () => {
    // original: A B C ; revised: A X C  (B removed, X added, A/C common)
    const ops = diffParagraphs(['A', 'B', 'C'], ['A', 'X', 'C']);
    expect(tokens(ops)).toEqual(['=0:0', '-1', '+1', '=2:2']);
  });

  it('identical documents are all equal', () => {
    const ops = diffParagraphs(['A', 'B'], ['A', 'B']);
    expect(ops.every((o) => o.kind === 'equal')).toBe(true);
    expect(tokens(ops)).toEqual(['=0:0', '=1:1']);
  });

  it('insert-only against an empty original', () => {
    expect(tokens(diffParagraphs([], ['A', 'B']))).toEqual(['+0', '+1']);
  });

  it('delete-only against an empty revised', () => {
    expect(tokens(diffParagraphs(['A', 'B'], []))).toEqual(['-0', '-1']);
  });

  it('two empty arrays produce no ops', () => {
    expect(diffParagraphs([], [])).toEqual([]);
  });

  it('a pure insertion in the middle keeps surrounding paragraphs equal', () => {
    expect(tokens(diffParagraphs(['A', 'C'], ['A', 'B', 'C']))).toEqual(['=0:0', '+1', '=1:2']);
  });

  it('consecutive deletions are emitted in order', () => {
    expect(tokens(diffParagraphs(['A', 'B', 'C', 'D'], ['A', 'D']))).toEqual(['=0:0', '-1', '-2', '=3:1']);
  });

  it('a replace surfaces as delete-before-insert at the same slot', () => {
    expect(tokens(diffParagraphs(['B'], ['X']))).toEqual(['-0', '+0']);
  });

  it('reordering is handled by the LCS (no spurious equals)', () => {
    // original A B ; revised B A — LCS length 1; one of A/B is delete+insert.
    const ops = diffParagraphs(['A', 'B'], ['B', 'A']);
    const ins = ops.filter((o) => o.kind === 'insert').length;
    const del = ops.filter((o) => o.kind === 'delete').length;
    const eq = ops.filter((o) => o.kind === 'equal').length;
    expect(eq).toBe(1);
    expect(ins).toBe(1);
    expect(del).toBe(1);
  });
});
