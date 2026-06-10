import { describe, it, expect } from 'vitest';

import { diffInline, type SpanOp } from './inline_diff.js';

/** Reapply the span script: equal+delete spans must reconstruct the original, equal+insert the revised. */
function reconstruct(ops: SpanOp[], original: string, revised: string): { orig: string; rev: string } {
  let orig = '';
  let rev = '';
  for (const op of ops) {
    if (op.kind === 'equal' || op.kind === 'delete') orig += original.slice(op.origStart, op.origEnd);
    if (op.kind === 'equal' || op.kind === 'insert') rev += revised.slice(op.revStart, op.revEnd);
  }
  return { orig, rev };
}

/** Structural invariants every script must satisfy, regardless of content. */
function assertInvariants(ops: SpanOp[], original: string, revised: string): void {
  const { orig, rev } = reconstruct(ops, original, revised);
  expect(orig).toBe(original);
  expect(rev).toBe(revised);
  let origPos = 0;
  let revPos = 0;
  for (const op of ops) {
    expect(op.origStart).toBe(origPos);
    expect(op.revStart).toBe(revPos);
    expect(op.origEnd).toBeGreaterThanOrEqual(op.origStart);
    expect(op.revEnd).toBeGreaterThanOrEqual(op.revStart);
    if (op.kind === 'insert') expect(op.origEnd).toBe(op.origStart);
    if (op.kind === 'delete') expect(op.revEnd).toBe(op.revStart);
    if (op.kind === 'equal') {
      expect(op.origEnd - op.origStart).toBe(op.revEnd - op.revStart);
      expect(original.slice(op.origStart, op.origEnd)).toBe(revised.slice(op.revStart, op.revEnd));
    }
    // No zero-length spans, no two adjacent same-kind spans (coalesced).
    expect(op.origEnd - op.origStart + (op.revEnd - op.revStart)).toBeGreaterThan(0);
    origPos = op.origEnd;
    revPos = op.revEnd;
  }
  expect(origPos).toBe(original.length);
  expect(revPos).toBe(revised.length);
  for (let k = 1; k < ops.length; k++) expect(ops[k]!.kind).not.toBe(ops[k - 1]!.kind);
}

describe('diffInline', () => {
  it('[OCMPI-01] a one-word replacement yields delete+insert sharing revStart, surroundings equal', () => {
    const original = 'The quick brown fox jumps over the lazy dog.';
    const revised = 'The quick red fox jumps over the lazy dog.';
    const ops = diffInline(original, revised);
    assertInvariants(ops, original, revised);
    const del = ops.find((o) => o.kind === 'delete');
    const ins = ops.find((o) => o.kind === 'insert');
    expect(del).toBeDefined();
    expect(ins).toBeDefined();
    expect(original.slice(del!.origStart, del!.origEnd)).toBe('brown');
    expect(revised.slice(ins!.revStart, ins!.revEnd)).toBe('red');
    // Delete-before-insert at the shared anchor.
    expect(ops.indexOf(del!)).toBeLessThan(ops.indexOf(ins!));
    expect(del!.revStart).toBe(ins!.revStart);
    // Only the changed word moved: exactly equal, delete, insert, equal.
    expect(ops.map((o) => o.kind)).toEqual(['equal', 'delete', 'insert', 'equal']);
  });

  it('[OCMPI-01] insert-only and delete-only edits produce a single changed span', () => {
    const base = 'Alpha bravo charlie.';
    const inserted = 'Alpha bravo extra charlie.';
    const insOps = diffInline(base, inserted);
    assertInvariants(insOps, base, inserted);
    expect(insOps.filter((o) => o.kind === 'insert')).toHaveLength(1);
    expect(insOps.filter((o) => o.kind === 'delete')).toHaveLength(0);
    expect(inserted.slice(insOps.find((o) => o.kind === 'insert')!.revStart, insOps.find((o) => o.kind === 'insert')!.revEnd)).toBe('extra ');

    const delOps = diffInline(inserted, base);
    assertInvariants(delOps, inserted, base);
    expect(delOps.filter((o) => o.kind === 'delete')).toHaveLength(1);
    expect(delOps.filter((o) => o.kind === 'insert')).toHaveLength(0);
  });

  it('[OCMPI-01] edits at string start and string end keep offsets exact', () => {
    const original = 'Alpha bravo charlie';
    const atStart = diffInline(original, 'bravo charlie');
    assertInvariants(atStart, original, 'bravo charlie');
    expect(atStart[0]!.kind).toBe('delete');
    expect(atStart[0]!.origStart).toBe(0);

    const atEnd = diffInline(original, 'Alpha bravo');
    assertInvariants(atEnd, original, 'Alpha bravo');
    expect(atEnd[atEnd.length - 1]!.kind).toBe('delete');
    expect(atEnd[atEnd.length - 1]!.origEnd).toBe(original.length);
  });

  it('[OCMPI-01] whitespace-run changes are their own spans (tokens partition the string)', () => {
    const original = 'word  tail'; // two spaces
    const revised = 'word tail'; // one space
    const ops = diffInline(original, revised);
    assertInvariants(ops, original, revised);
    // The whitespace run differs, so it is replaced as a unit; the words stay equal.
    const del = ops.find((o) => o.kind === 'delete');
    const ins = ops.find((o) => o.kind === 'insert');
    expect(original.slice(del!.origStart, del!.origEnd)).toBe('  ');
    expect(revised.slice(ins!.revStart, ins!.revEnd)).toBe(' ');
  });

  it('[OCMPI-01] identical strings yield one equal span; empty strings yield an empty script', () => {
    const same = diffInline('Same text.', 'Same text.');
    expect(same).toEqual([{ kind: 'equal', origStart: 0, origEnd: 10, revStart: 0, revEnd: 10 }]);
    expect(diffInline('', '')).toEqual([]);
    const fromEmpty = diffInline('', 'New text');
    assertInvariants(fromEmpty, '', 'New text');
    expect(fromEmpty).toEqual([{ kind: 'insert', origStart: 0, origEnd: 0, revStart: 0, revEnd: 8 }]);
    const toEmpty = diffInline('Old text', '');
    assertInvariants(toEmpty, 'Old text', '');
  });

  it('[OCMPI-01] no mid-word matching: distinct words sharing prefix/suffix chars replace whole', () => {
    const original = 'the government acted';
    const revised = 'the garment acted';
    const ops = diffInline(original, revised);
    assertInvariants(ops, original, revised);
    const del = ops.find((o) => o.kind === 'delete')!;
    const ins = ops.find((o) => o.kind === 'insert')!;
    expect(original.slice(del.origStart, del.origEnd)).toBe('government');
    expect(revised.slice(ins.revStart, ins.revEnd)).toBe('garment');
  });

  it('[OCMPI-01] property sweep: random word edits always satisfy the reconstruction invariants', () => {
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'fox', 'golf'];
    // Deterministic pseudo-random walk (no Date/Math.random in tests for reproducibility).
    let seed = 42;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let trial = 0; trial < 200; trial++) {
      const len = next() % 8;
      const orig: string[] = [];
      for (let k = 0; k < len; k++) orig.push(words[next() % words.length]!);
      const rev = [...orig];
      const edits = next() % 3;
      for (let e = 0; e < edits && rev.length > 0; e++) {
        const pos = next() % rev.length;
        const action = next() % 3;
        if (action === 0) rev.splice(pos, 1);
        else if (action === 1) rev.splice(pos, 0, words[next() % words.length]!);
        else rev[pos] = words[next() % words.length]!;
      }
      const a = orig.join(' ');
      const b = rev.join(' ');
      assertInvariants(diffInline(a, b), a, b);
    }
  });
});
