import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { classifyFieldInstruction } from './field-semantics.js';

const TEST_FEATURE = 'add-scoped-field-evaluation';
const test = testAllure.epic('Document Comparison').withLabels({
  feature: TEST_FEATURE,
});
const conformanceTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.45' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' },
);

describe('field instruction semantics', () => {
  conformanceTest.openspec('[SDX-FIELD-EVAL-06] Shared classifier recognizes PAGEREF')(
    'normalizes fragmented whitespace without confusing REF and PAGEREF',
    () => {
      expect(classifyFieldInstruction('  pageref   "_Toc 42"  \\h ')).toMatchObject({
        kind: 'PAGEREF',
        evaluationClass: 'layout-dependent',
        normalizedInstruction: 'PAGEREF "_Toc 42" \\h',
        target: '_Toc 42',
      });
      expect(classifyFieldInstruction(' REF Clause_1 \\h ')).toMatchObject({
        kind: 'REF',
        evaluationClass: 'deterministic-ref',
        target: 'Clause_1',
      });
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-03] Unsupported REF projection is preserved')(
    'admits presentation-only switches and rejects projection switches',
    () => {
      expect(classifyFieldInstruction(' REF Clause_1 \\h \\* MERGEFORMAT ')).toMatchObject({
        evaluationClass: 'deterministic-ref',
        unsupportedSwitches: [],
      });
      expect(classifyFieldInstruction(' REF Clause_1 \\p ')).toMatchObject({
        evaluationClass: 'recognized-unsupported',
        unsupportedSwitches: ['\\p'],
        preservationSupported: true,
        reason: 'unsupported-ref-switch',
      });
      expect(classifyFieldInstruction(' REF Clause_1 \\d "-" ')).toMatchObject({
        evaluationClass: 'recognized-unsupported',
        preservationSupported: true,
      });
      expect(classifyFieldInstruction(' REF "Clause_1')).toMatchObject({
        evaluationClass: 'unknown',
        preservationSupported: false,
        reason: 'malformed-field-instruction',
      });
    },
  );
});

describe('field instruction classification boundaries', () => {
  conformanceTest.openspec('[SDX-FIELD-EVAL-03] Unsupported REF projection is preserved')(
    'rejects malformed quoting and unsupported switch shapes',
    () => {
      const malformed = ['REF a"b \\h', 'REF "a"b \\h', 'REF "unterminated \\h'];
      for (const instruction of malformed) {
        expect(classifyFieldInstruction(instruction), instruction).toMatchObject({
          kind: 'UNKNOWN',
          evaluationClass: 'unknown',
          reason: 'malformed-field-instruction',
        });
      }

      expect(classifyFieldInstruction('REF bk \\qq')).toMatchObject({
        kind: 'REF',
        evaluationClass: 'recognized-unsupported',
        reason: 'unsupported-ref-switch',
      });
      // A well-formed but unrecognized switch is recorded; a malformed
      // multi-character one is rejected on shape before it can be.
      expect(classifyFieldInstruction('REF bk \\z')).toMatchObject({
        unsupportedSwitches: ['\\z'],
      });
      expect(classifyFieldInstruction('REF bk \\zz')).toMatchObject({
        unsupportedSwitches: [],
        reason: 'unsupported-ref-switch',
      });
      expect(classifyFieldInstruction('REF bk \\d')).toMatchObject({
        evaluationClass: 'recognized-unsupported',
      });
      expect(classifyFieldInstruction('REF \\h')).toMatchObject({
        reason: 'missing-ref-target',
      });
      expect(classifyFieldInstruction('REF bk \\n \\h')).toMatchObject({
        evaluationClass: 'recognized-unsupported',
        preservationSupported: true,
      });
    },
  );

  conformanceTest.openspec('[SDX-FIELD-EVAL-02] Layout-dependent field is marked dirty')(
    'classifies layout-dependent, counter, and unknown field kinds',
    () => {
      expect(classifyFieldInstruction('TOC \\o "1-3" \\h \\z \\u')).toMatchObject({
        kind: 'TOC',
        evaluationClass: 'layout-dependent',
        preservationSupported: true,
      });
      expect(classifyFieldInstruction('SEQ Figure \\* ARABIC')).toMatchObject({
        kind: 'SEQ',
        evaluationClass: 'recognized-unsupported',
        reason: 'field-kind-not-evaluated',
      });
      expect(classifyFieldInstruction('HYPERLINK "http://example.com"')).toMatchObject({
        kind: 'UNKNOWN',
        evaluationClass: 'unknown',
        reason: 'unknown-field-kind',
      });
      expect(classifyFieldInstruction('PAGE \\zz')).toMatchObject({
        kind: 'PAGE',
        evaluationClass: 'recognized-unsupported',
        preservationSupported: false,
      });
      expect(classifyFieldInstruction('PAGEREF \\h')).toMatchObject({
        kind: 'PAGEREF',
        evaluationClass: 'recognized-unsupported',
      });
    },
  );

  test('escapes the escape character when re-quoting a normalized token', () => {
    expect(classifyFieldInstruction('REF "a\\b c" \\h').normalizedInstruction).toBe(
      'REF "a\\\\b c" \\h',
    );
  });
});
