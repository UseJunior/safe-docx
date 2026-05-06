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

  describe('Cf-category invisibles are stripped', () => {
    test('soft hyphen U+00AD: cooperate == co­operate', ({}) => {
      expect(computeContentFingerprint('cooperate')).toBe(
        computeContentFingerprint('co­operate'),
      );
    });

    test('zero-width space U+200B is stripped', ({}) => {
      expect(computeContentFingerprint('AB')).toBe(computeContentFingerprint('A​B'));
    });

    test('zero-width non-joiner U+200C is stripped', ({}) => {
      expect(computeContentFingerprint('AB')).toBe(computeContentFingerprint('A‌B'));
    });

    test('zero-width joiner U+200D is stripped', ({}) => {
      expect(computeContentFingerprint('AB')).toBe(computeContentFingerprint('A‍B'));
    });

    test('LRM U+200E is stripped', ({}) => {
      expect(computeContentFingerprint('AB')).toBe(computeContentFingerprint('A‎B'));
    });

    test('RLM U+200F is stripped', ({}) => {
      expect(computeContentFingerprint('AB')).toBe(computeContentFingerprint('A‏B'));
    });

    test('bidi embedding U+202A (LRE) is stripped', ({}) => {
      expect(computeContentFingerprint('AB')).toBe(computeContentFingerprint('A‪B'));
    });

    test('bidi PDF U+202C is stripped', ({}) => {
      expect(computeContentFingerprint('AB')).toBe(computeContentFingerprint('A‬B'));
    });

    test('variation selector U+FE0F is stripped', ({}) => {
      expect(computeContentFingerprint('AB')).toBe(computeContentFingerprint('A️B'));
    });

    test('BOM U+FEFF is stripped', ({}) => {
      expect(computeContentFingerprint('AB')).toBe(computeContentFingerprint('A﻿B'));
      expect(computeContentFingerprint('Hello')).toBe(
        computeContentFingerprint('﻿Hello'),
      );
    });

    test('multiple invisibles in one paragraph all collapse', ({}) => {
      const baseline = computeContentFingerprint('Hello world');
      expect(
        computeContentFingerprint('He​llo­ wor‍ld﻿'),
      ).toBe(baseline);
    });
  });

  describe('legitimate text variants are NOT folded (regression guard)', () => {
    // These tests exist so a future maintainer doesn't expand the strip regex
    // to "be helpful" — citation pipelines downstream legitimately distinguish
    // these glyphs and rely on the fingerprint to surface the difference.
    test('curly quotes differ from ASCII quotes', ({}) => {
      // U+201C/U+201D = curly double quotes; ASCII " = U+0022.
      expect(computeContentFingerprint('"Section 5"')).not.toBe(
        computeContentFingerprint('“Section 5”'),
      );
    });

    test('curly apostrophes differ from ASCII apostrophe', ({}) => {
      // U+2019 = right single quotation mark; ASCII ' = U+0027.
      expect(computeContentFingerprint("Company's")).not.toBe(
        computeContentFingerprint('Company’s'),
      );
    });

    test('en-dash differs from hyphen-minus', ({}) => {
      // U+2013 EN DASH vs ASCII hyphen-minus U+002D.
      expect(computeContentFingerprint('A-B')).not.toBe(
        computeContentFingerprint('A–B'),
      );
    });

    test('em-dash differs from hyphen-minus', ({}) => {
      // U+2014 EM DASH vs ASCII hyphen-minus U+002D.
      expect(computeContentFingerprint('A-B')).not.toBe(
        computeContentFingerprint('A—B'),
      );
    });
  });
});
