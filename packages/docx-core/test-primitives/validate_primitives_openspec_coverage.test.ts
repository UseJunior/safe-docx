import { describe, expect } from 'vitest';
import { parseChangedRequirementNames } from '../scripts/validate_primitives_openspec_coverage.mjs';
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
});
