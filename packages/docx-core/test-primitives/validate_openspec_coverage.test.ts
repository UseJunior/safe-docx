import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import {
  applySpecDeltas,
  extractTestBody,
  extractThenTokens,
  findThenKeywordViolations,
  normalizeScenarioName,
  parseScenariosFromSpec,
  parseTaggedTestSlices,
  sliceReferencesToken,
  tokenizeCodeSpan,
} from '../scripts/validate_openspec_coverage.mjs';

const test = testAllure
  .epic('DOCX Primitives')
  .withLabels({ feature: 'OpenSpec Coverage Validator' });

// The validator scripts grep their scan roots (which include this test-primitives/
// directory) for the literal `.openspec(` call. Build that call at runtime so this
// fixture file's own source never contains the substring those scanners match.
const OPENSPEC = `.open${'spec'}`;
const tag = (story: string): string => `${OPENSPEC}('${story}')`;

// Build the Map<scenarioName, {file, slice}[]> the way the validator's main()
// does, from a fixture test source string.
function storyToSlicesFrom(testSource: string, file = 'fixture.test.ts'): Map<string, { file: string; slice: string }[]> {
  const map = new Map<string, { file: string; slice: string }[]>();
  for (const { rawStory, slice } of parseTaggedTestSlices(testSource)) {
    const name = normalizeScenarioName(rawStory);
    const entries = map.get(name) ?? [];
    entries.push({ file, slice });
    map.set(name, entries);
  }
  return map;
}

// A spec with three scenarios: one with a code token in its THEN, one whose THEN
// is pure prose, and one whose observable token is an OOXML element name.
const SPEC = [
  '### Requirement: Correlation Status',
  '',
  '#### Scenario: Status set to Equal',
  '- **WHEN** `markCorrelationStatus()` is called',
  '- **THEN** its `correlationStatus` is set to `Equal`',
  '',
  '#### Scenario: Result is acceptable',
  '- **WHEN** the comparison finishes',
  '- **THEN** the result is acceptable and clearly documented for the reader',
  '',
  '#### Scenario: Table structure preserved',
  '- **WHEN** a tracked edit is applied',
  '- **THEN** tracked output preserves table structure (`w:tbl` remains present)',
  '',
].join('\n');

describe('validate_openspec_coverage THEN-keyword check', () => {
  describe('applySpecDeltas', () => {
    test('adds, replaces, and removes whole requirements before coverage is measured', (_: AllureBddContext) => {
      const base = `
### Requirement: Retained
#### Scenario: Old retained scenario
- **WHEN** old behavior runs
- **THEN** old output appears

### Requirement: Removed
#### Scenario: Obsolete scenario
- **WHEN** old behavior runs
- **THEN** old output appears
`;
      const delta = `
## ADDED Requirements
### Requirement: Added
#### Scenario: Added scenario
- **WHEN** new behavior runs
- **THEN** new output appears

## MODIFIED Requirements
### Requirement: Retained
#### Scenario: New retained scenario
- **WHEN** tagged behavior runs
- **THEN** tagged output appears

## REMOVED Requirements
### Requirement: Removed
#### Scenario: Removal migration evidence
- **WHEN** the API is inspected
- **THEN** the old export is absent
`;

      const scenarios = parseScenariosFromSpec(applySpecDeltas(base, [delta]))
        .map((entry) => entry.name);
      expect(scenarios).toEqual(['New retained scenario', 'Added scenario']);
    });
  });

  describe('tokenizeCodeSpan', () => {
    test('keeps namespaced names and splits dotted/value expressions', (_: AllureBddContext) => {
      expect(tokenizeCodeSpan('w:tbl')).toEqual(['w:tbl']);
      expect(tokenizeCodeSpan('OpcPart.uri')).toEqual(['OpcPart', 'uri']);
      expect(tokenizeCodeSpan('reconstructionModeUsed: rebuild')).toEqual([
        'reconstructionModeUsed',
        'rebuild',
      ]);
    });

    test('drops generic stoplisted words and single characters', (_: AllureBddContext) => {
      expect(tokenizeCodeSpan('true')).toEqual([]);
      expect(tokenizeCodeSpan('x')).toEqual([]);
    });
  });

  describe('sliceReferencesToken', () => {
    test('matches a standalone identifier but not a substring of a longer one', (_: AllureBddContext) => {
      expect(sliceReferencesToken('CorrelationStatus.Equal', 'Equal')).toBe(true);
      expect(sliceReferencesToken('expect(x).toEqual(y)', 'Equal')).toBe(false);
      expect(sliceReferencesToken('parse(<w:tbl/>)', 'w:tbl')).toBe(true);
    });
  });

  describe('extractThenTokens', () => {
    test('gates on THEN tokens and includes the WHEN in the match set', (_: AllureBddContext) => {
      const lines = [
        '- **WHEN** `markCorrelationStatus()` is called',
        '- **THEN** its `correlationStatus` is set to `Equal`',
      ];
      const { gateTokens, matchTokens } = extractThenTokens(lines);
      expect([...gateTokens].sort()).toEqual(['Equal', 'correlationStatus']);
      expect([...matchTokens].sort()).toEqual(['Equal', 'correlationStatus', 'markCorrelationStatus']);
    });

    test('a pure-prose observable yields no gate tokens', (_: AllureBddContext) => {
      const lines = [
        '- **WHEN** the comparison finishes',
        '- **THEN** the result is acceptable and clearly documented for the reader',
      ];
      const { gateTokens } = extractThenTokens(lines);
      expect(gateTokens.size).toBe(0);
    });

    test('a GIVEN-only token is excluded from both sets', (_: AllureBddContext) => {
      const lines = [
        '- **GIVEN** an atom with `ancestorElements`',
        '- **WHEN** the comparison finishes',
        '- **THEN** the result is acceptable',
      ];
      const { gateTokens, matchTokens } = extractThenTokens(lines);
      expect(gateTokens.size).toBe(0);
      expect(matchTokens.has('ancestorElements')).toBe(false);
    });
  });

  describe('extractTestBody', () => {
    test('drops the tag/title preamble before the callback arrow', (_: AllureBddContext) => {
      const slice = `${tag('Status set to Equal')}('Scenario: Status set to Equal', () => { doThing(); })`;
      const body = extractTestBody(slice);
      expect(body.startsWith('=>')).toBe(true);
      expect(body.includes('Scenario: Status set to Equal')).toBe(false);
    });
  });

  describe('findThenKeywordViolations', () => {
    const entries = parseScenariosFromSpec(SPEC);

    test('a genuine mapping passes', (_: AllureBddContext) => {
      const source = `humanReadableTest${tag('Status set to Equal')}(
        'Scenario: Status set to Equal',
        () => {
          markCorrelationStatus(original, revised, matches);
          expect(revised.correlationStatus).toBe(CorrelationStatus.Equal);
        },
      );`;
      const violations = findThenKeywordViolations(entries, storyToSlicesFrom(source), new Set());
      expect(violations).toEqual([]);
    });

    test('a stuffed mapping fails (token in THEN, absent in body)', (_: AllureBddContext) => {
      const source = `test${tag('Status set to Equal')}(
        'Scenario: Status set to Equal',
        () => {
          const result = authorAndCompare(doc);
          expect(result.ok).toBe(true);
        },
      );`;
      const violations = findThenKeywordViolations(entries, storyToSlicesFrom(source), new Set());
      expect(violations.map((v) => v.scenario)).toEqual(['Status set to Equal']);
    });

    test('a prose-only scenario is exempt even when the body shares nothing', (_: AllureBddContext) => {
      const source = `test${tag('Result is acceptable')}(
        'Scenario: Result is acceptable',
        () => {
          expect(somethingUnrelated()).toBe(42);
        },
      );`;
      const violations = findThenKeywordViolations(entries, storyToSlicesFrom(source), new Set());
      expect(violations).toEqual([]);
    });

    test('a title echoing the scenario name does not satisfy the check', (_: AllureBddContext) => {
      // The OOXML token `w:tbl` appears in the title but not the body.
      const source = `test${tag('Table structure preserved')}(
        'Scenario: Table structure preserved keeps w:tbl present',
        () => {
          expect(unrelated()).toBe(true);
        },
      );`;
      const violations = findThenKeywordViolations(entries, storyToSlicesFrom(source), new Set());
      expect(violations.map((v) => v.scenario)).toEqual(['Table structure preserved']);
    });

    test('the allowlist exempts a named scenario', (_: AllureBddContext) => {
      const source = `test${tag('Status set to Equal')}(
        'Scenario: Status set to Equal',
        () => {
          expect(authorAndCompare(doc).ok).toBe(true);
        },
      );`;
      const allowlist = new Set(['Status set to Equal']);
      const violations = findThenKeywordViolations(entries, storyToSlicesFrom(source), allowlist);
      expect(violations).toEqual([]);
    });

    test('chained tags share one body, so each chained scenario is checked against it', (_: AllureBddContext) => {
      // One test carries two tags before its body. The body satisfies the first
      // scenario (correlationStatus) but not the second (w:tbl) — the second must
      // be flagged, proving the whole body is attributed to every chained tag.
      const source = `test
        ${tag('Status set to Equal')}
        ${tag('Table structure preserved')}(
        'a chained test',
        () => {
          expect(revised.correlationStatus).toBe(CorrelationStatus.Equal);
        },
      );`;
      const violations = findThenKeywordViolations(entries, storyToSlicesFrom(source), new Set());
      expect(violations.map((v) => v.scenario)).toEqual(['Table structure preserved']);
    });
  });
});
