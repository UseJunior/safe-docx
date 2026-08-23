import { describe, expect } from 'vitest';
import {
  compareDocuments,
  type AncillaryFieldEvidence,
  type CompareResult,
  type CompareStats,
  type UnrepresentedChange,
} from './index.js';
import { buildDocxFromBodyXml, paragraphWithText } from './testing/ooxml-fixtures.js';
import { testAllure } from './testing/allure-test.js';

const TEST_FEATURE = 'Refactor Tagged Tree Spine';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE });

type ExpectedCompareResult = {
  document: Buffer;
  stats: CompareStats;
  engine: 'tagged-tree';
  unrepresentedChanges?: UnrepresentedChange[];
  ancillaryFieldEvidence?: AncillaryFieldEvidence;
};

type TypesEqual<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

const compareResultTypeIsExact: TypesEqual<CompareResult, ExpectedCompareResult> = true;

const RETIRED_RESULT_FIELDS = [
  'comparisonStrategyRequested',
  'comparisonStrategyUsed',
  'comparisonStrategyFallbackReason',
  'taggedTreeFallbackDiagnostics',
  'reconstructionModeRequested',
  'reconstructionModeUsed',
  'fallbackReason',
  'fallbackDiagnostics',
  'ancillaryFallbackDiagnostics',
  'rebuildSafetyDiagnostics',
  'inplaceSuccessDiagnostics',
] as const;

describe('public comparison result metadata', () => {
  test.openspec('Public comparison reports only tagged result metadata')(
    'returns truthful tagged metadata and no retired engine, mode, or fallback fields',
    async () => {
      const [original, revised] = await Promise.all([
        buildDocxFromBodyXml(paragraphWithText('Original public result.')),
        buildDocxFromBodyXml(paragraphWithText('Revised public result.')),
      ]);

      const result = await compareDocuments(original, revised, {
        date: new Date('2026-08-22T12:00:00Z'),
      });

      expect(compareResultTypeIsExact).toBe(true);
      expect(result.engine).toBe('tagged-tree');
      for (const field of RETIRED_RESULT_FIELDS) {
        expect(Object.hasOwn(result, field), field).toBe(false);
      }
    },
  );
});
