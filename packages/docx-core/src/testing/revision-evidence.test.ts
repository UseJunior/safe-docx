import { describe, expect } from 'vitest';
import { testAllure } from './allure-test.js';
import { revisionEvidence, revisionEvidenceCases } from './revision-evidence.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Revision Evidence Contract' });

describe('revision evidence contract', () => {
  test('[ADV-EVIDENCE-CONTRACT-NEGATIVE] rejects a factory-path constant-true observable', () => {
    const cases = revisionEvidenceCases({
      elements: ['ins'],
      operations: ['accept'],
      story: 'main',
      fixture: () => ({ elements: ['ins'] }),
      observable: () => true,
      removeTarget: () => ({ elements: [] }),
    });
    expect(() => revisionEvidence('CONSTANT-TRUE', cases)).toThrow(/removing ins must invalidate the observable itself/);
  });

  test('[ADV-EVIDENCE-CONTRACT-NEGATIVE] rejects an aggregate no-errors observable that ignores operation and story', () => {
    const aggregate = revisionEvidenceCases({
      elements: ['customXmlInsRangeStart'],
      operations: ['validate'],
      story: 'main',
      fixture: () => ({ elements: ['customXmlInsRangeStart'], errors: [] as string[] }),
      observable: (fixture) => fixture.errors.length === 0,
      removeTarget: (fixture, element) => ({ ...fixture, elements: fixture.elements.filter((candidate) => candidate !== element) }),
    });
    expect(() => revisionEvidence('AGGREGATE-NO-ERRORS', aggregate)).toThrow(/removing customXmlInsRangeStart must invalidate the observable itself/);
  });
});
