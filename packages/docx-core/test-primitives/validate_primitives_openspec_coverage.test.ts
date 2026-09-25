import { describe, expect } from 'vitest';
import {
  isArchivedScenarioSuperseded,
  isCanonicalScenarioSuperseded,
  parseChangedRequirementNames,
} from '../scripts/validate_primitives_openspec_coverage.mjs';
import { testAllure } from './helpers/allure-test.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'OpenSpec coverage validator' });

describe('OpenSpec coverage supersession parsing', () => {
  test('recognizes modified and removed requirements but not added requirements', () => {
    const requirements = parseChangedRequirementNames(`
## ADDED Requirements
### Requirement: New behavior
## MODIFIED Requirements
### Requirement: Replaced behavior
## REMOVED Requirements
### Requirement: Retired behavior
`);
    expect([...requirements]).toEqual(['Replaced behavior', 'Retired behavior']);
  });

  test('does not classify added requirements as superseding canonical coverage', () => {
    const requirements = parseChangedRequirementNames(`
## ADDED Requirements
### Requirement: Existing-looking name
#### Scenario: Existing scenario
`);
    expect(requirements.size).toBe(0);
  });

  test('keeps unlisted canonical scenarios when a requirement is only modified', () => {
    const removed = new Set<string>();
    const modifiedScenarios = new Set(['replacement scenario']);
    expect(isCanonicalScenarioSuperseded('Requirement A', 'replacement scenario', removed, modifiedScenarios)).toBe(true);
    expect(isCanonicalScenarioSuperseded('Requirement A', 'still canonical', removed, modifiedScenarios)).toBe(false);
    removed.add('Requirement A');
    expect(isCanonicalScenarioSuperseded('Requirement A', 'still canonical', removed, modifiedScenarios)).toBe(true);
  });

  test('retired archived scenarios remain superseded after their removing change is archived', () => {
    const activeChanges = new Set<string>();
    const archivedRemovals = new Set(['Unresolvable Row-Level Revision Preservation']);
    const canonicalRequirements = new Set(['Row-Level Revision Resolution']);
    expect(isArchivedScenarioSuperseded(
      'Unresolvable Row-Level Revision Preservation', activeChanges, archivedRemovals, canonicalRequirements,
    )).toBe(true);
    expect(isArchivedScenarioSuperseded('Row-Level Revision Resolution', activeChanges, archivedRemovals, canonicalRequirements)).toBe(false);
    canonicalRequirements.add('Unresolvable Row-Level Revision Preservation');
    expect(isArchivedScenarioSuperseded(
      'Unresolvable Row-Level Revision Preservation', activeChanges, archivedRemovals, canonicalRequirements,
    )).toBe(false);
  });
});
