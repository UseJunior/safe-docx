import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { classifyFieldInstruction } from './field-semantics.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'add-scoped-field-evaluation',
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
