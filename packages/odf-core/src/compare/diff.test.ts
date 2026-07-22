import { describe, it, expect } from 'vitest';

import { diffParagraphs, pairModifications, type EditOp } from './diff.js';

/** Compact an edit script to readable tokens for assertions. */
function tokens(ops: EditOp[]): string[] {
  return ops.map((op) => {
    if (op.kind === 'equal') return `=${op.originalIndex}:${op.revisedIndex}`;
    if (op.kind === 'insert') return `+${op.revisedIndex}`;
    if (op.kind === 'modify') return `~${op.originalIndex}:${op.revisedIndex}`;
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

describe('pairModifications — modify-pair detection', () => {
  const pair = (original: string[], revised: string[], threshold?: number): string[] =>
    tokens(pairModifications(diffParagraphs(original, revised), original, revised, threshold));

  it('[OCMPI-02] a similar replaced paragraph becomes a modify op', () => {
    const original = ['Common intro.', 'The quick brown fox jumps over the lazy dog.', 'Common outro.'];
    const revised = ['Common intro.', 'The quick red fox jumps over the lazy dog.', 'Common outro.'];
    expect(pair(original, revised)).toEqual(['=0:0', '~1:1', '=2:2']);
  });

  it('[OCMPI-02] a dissimilar replacement stays delete+insert', () => {
    const original = ['Common.', 'Entirely different sentence about apples.', 'Common two.'];
    const revised = ['Common.', 'Nothing shared here whatsoever, zebras graze.', 'Common two.'];
    expect(pair(original, revised)).toEqual(['=0:0', '-1', '+1', '=2:2']);
  });

  it('[OCMPI-02] threshold is honored (low threshold pairs, high threshold does not)', () => {
    const original = ['alpha bravo charlie delta'];
    const revised = ['alpha xx yy zz'];
    // Jaccard = |{alpha}| / |{alpha bravo charlie delta xx yy zz}| = 1/7 ≈ 0.14
    expect(pair(original, revised, 0.1)).toEqual(['~0:0']);
    expect(pair(original, revised, 0.25)).toEqual(['-0', '+0']);
  });

  it('[OCMPI-02] gap of 2 deletes + 1 insert pairs the best match deterministically', () => {
    const original = [
      'Anchor before.',
      'First clause about indemnification of officers.',
      'Second clause about termination for convenience.',
      'Anchor after.',
    ];
    const revised = [
      'Anchor before.',
      'Second clause about termination for cause.',
      'Anchor after.',
    ];
    // Both deletes share words with the insert; the second shares far more — DP must pick it
    // (maximize total similarity at equal pair count) and leave the first a pure delete.
    expect(pair(original, revised)).toEqual(['=0:0', '-1', '~2:1', '=3:2']);
  });

  it('[OCMPI-02] both-above-threshold candidates resolve by total similarity, not first-wins', () => {
    const original = ['Anchor.', 'shared words one extra', 'shared words two almost all same', 'End.'];
    const revised = ['Anchor.', 'shared words two almost all same exactly', 'End.'];
    const result = pair(original, revised);
    expect(result).toEqual(['=0:0', '-1', '~2:1', '=3:2']);
  });

  it('[OCMPI-02] a gap with more inserts than deletes pairs in order and keeps the rest inserts', () => {
    const original = ['Anchor.', 'The payment terms shall be net thirty days.', 'End.'];
    const revised = [
      'Anchor.',
      'A brand new unrelated recital appears first, fully distinct wording.',
      'The payment terms shall be net sixty days.',
      'End.',
    ];
    expect(pair(original, revised)).toEqual(['=0:0', '+1', '~1:2', '=2:3']);
  });

  it('[OCMPI-02] empty paragraphs never pair as modify', () => {
    expect(pair([''], ['Some new text'])).toEqual(['-0', '+0']);
    expect(pair(['Some old text'], [''])).toEqual(['-0', '+0']);
    // Two empty paragraphs are equal, not a gap at all.
    expect(pair([''], [''])).toEqual(['=0:0']);
  });

  it('[OCMPI-02] punctuation and case differences do not block pairing', () => {
    const original = ['The Quick BROWN fox, jumps; over the lazy dog.'];
    const revised = ['the quick brown fox jumps over the lazy dog'];
    expect(pair(original, revised)).toEqual(['~0:0']);
  });

  it('scripts without gaps pass through unchanged', () => {
    const original = ['A', 'B'];
    const revised = ['A', 'B'];
    expect(pair(original, revised)).toEqual(['=0:0', '=1:1']);
  });
});
