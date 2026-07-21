import { describe, expect } from 'vitest';
import { testAllure } from './allure-test.js';
import { revisionEvidence, revisionEvidenceCases } from './revision-evidence.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Revision Evidence Contract' });

describe('revision evidence contract', () => {
  test('[ADV-EVIDENCE-CONTRACT-NEGATIVE] rejects a constant-true observable when the target is removed', () => {
    expect(() => revisionEvidence('CONSTANT-TRUE', [{
      element: 'ins',
      operation: 'accept',
      story: 'main',
      fixture: { elements: ['ins'] },
      targetPresent: () => true,
      observable: () => true,
      removeTarget: () => ({ elements: [] }),
    }])).toThrow(/removing ins must remove the target/);
  });

  test('[ADV-EVIDENCE-CONTRACT-NEGATIVE] rejects an aggregate no-errors observable that ignores operation and story', () => {
    const aggregate = revisionEvidenceCases({
      elements: ['customXmlInsRangeStart'],
      operations: ['validate'],
      story: 'main',
      fixture: () => ({ elements: ['customXmlInsRangeStart'], errors: [] as string[] }),
      targetPresent: (fixture, element) => fixture.elements.includes(element),
      observable: (fixture) => fixture.errors.length === 0,
      removeTarget: (fixture, element) => ({ ...fixture, elements: fixture.elements.filter((candidate) => candidate !== element) }),
    });
    aggregate[0]!.observable = (fixture) => fixture.errors.length === 0;

    expect(() => revisionEvidence('AGGREGATE-NO-ERRORS', aggregate)).toThrow(/changing the operation must invalidate/);
  });
});
