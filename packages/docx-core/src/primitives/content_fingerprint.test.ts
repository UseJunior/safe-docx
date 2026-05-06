import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { computeContentFingerprint } from './content_fingerprint.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Content Fingerprint' });

describe('computeContentFingerprint', () => {
  test('emits sha256:nfkc: prefix and exactly 32 hex chars', ({}) => {
    const fp = computeContentFingerprint('Hello world');
    expect(fp).toMatch(/^sha256:nfkc:[0-9a-f]{32}$/);
  });

  test('NFKC normalization: ligature ﬁ matches ASCII fi', ({}) => {
    // U+FB01 LATIN SMALL LIGATURE FI should NFKC-decompose to "fi".
    const a = computeContentFingerprint('ﬁve dollars');
    const b = computeContentFingerprint('five dollars');
    expect(a).toBe(b);
  });

  test('NFKC normalization: full-width Latin matches ASCII', ({}) => {
    // U+FF28 = "Ｈ" (full-width H). NFKC decomposes to "H".
    const a = computeContentFingerprint('Ｈello');
    const b = computeContentFingerprint('Hello');
    expect(a).toBe(b);
  });

  test('compatibility whitespace: NBSP collapses to single space', ({}) => {
    // U+00A0 NO-BREAK SPACE is whitespace under \s+ regex.
    const a = computeContentFingerprint('hello world');
    const b = computeContentFingerprint('hello world');
    expect(a).toBe(b);
  });

  test('whitespace collapse: multiple spaces, tabs, newlines fold to single space', ({}) => {
    const baseline = computeContentFingerprint('one two three');
    expect(computeContentFingerprint('one  two   three')).toBe(baseline);
    expect(computeContentFingerprint('one\ttwo\tthree')).toBe(baseline);
    expect(computeContentFingerprint('one\ntwo\rthree')).toBe(baseline);
    expect(computeContentFingerprint('one \t two \n three')).toBe(baseline);
  });

  test('trim: leading and trailing whitespace stripped before hashing', ({}) => {
    const baseline = computeContentFingerprint('Section 5');
    expect(computeContentFingerprint('   Section 5   ')).toBe(baseline);
    expect(computeContentFingerprint('\nSection 5\n')).toBe(baseline);
  });

  test('case is preserved: Section 5 differs from section 5', ({}) => {
    const upper = computeContentFingerprint('Section 5');
    const lower = computeContentFingerprint('section 5');
    expect(upper).not.toBe(lower);
  });

  test('empty input produces a deterministic fingerprint', ({}) => {
    const a = computeContentFingerprint('');
    const b = computeContentFingerprint('   ');
    const c = computeContentFingerprint('\n\t\r');
    expect(a).toMatch(/^sha256:nfkc:[0-9a-f]{32}$/);
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  test('determinism: golden values for fixed inputs', ({}) => {
    // These golden values must NEVER change; downstream consumers depend on
    // cross-machine, cross-version stability. If a test fails here because the
    // algorithm legitimately changed, bump the prefix (e.g. sha256:nfkc:v2).
    expect(computeContentFingerprint('Hello world')).toBe(
      'sha256:nfkc:64ec88ca00b268e5ba1a35678a1b5316',
    );
    expect(computeContentFingerprint('The Company shall indemnify the Customer.')).toBe(
      computeContentFingerprint(
        '   The   Company\tshall  indemnify   the\nCustomer.   ',
      ),
    );
  });

  test('different text produces different fingerprints', ({}) => {
    const a = computeContentFingerprint('Section 5: Termination');
    const b = computeContentFingerprint('Section 6: Termination');
    expect(a).not.toBe(b);
  });
});
