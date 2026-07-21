import { appendFileSync } from 'node:fs';
import { expect } from 'vitest';

export interface RevisionEvidenceContext {
  operation: string;
  story: string;
}

export interface RevisionEvidenceCase<Fixture = unknown> {
  element: string;
  operation: string;
  story: string;
  fixture: Fixture;
  observable: (fixture: Fixture, context: RevisionEvidenceContext) => boolean;
  removeTarget: (fixture: Fixture) => Fixture;
}

export interface RevisionEvidenceResult {
  id: string;
  element: string;
  operation: string;
  story: string;
  assertions: {
    observable: true;
    targetRemovalDetected: true;
    operationMutationDetected: true;
    storyMutationDetected: true;
  };
}

export interface RevisionEvidenceCaseFactory<Fixture> {
  elements: readonly string[];
  operations: readonly string[];
  story: string | ((element: string) => string);
  fixture: (element: string, operation: string, story: string) => Fixture;
  observable: (fixture: Fixture, element: string, context: RevisionEvidenceContext) => boolean;
  removeTarget: (fixture: Fixture, element: string) => Fixture;
}

const MUTATED_OPERATION = '__revision_evidence_wrong_operation__';
const MUTATED_STORY = '__revision_evidence_wrong_story__';

export function revisionEvidenceCases<Fixture>(factory: RevisionEvidenceCaseFactory<Fixture>): RevisionEvidenceCase<Fixture>[] {
  return factory.elements.flatMap((element) => factory.operations.map((operation) => {
    const story = typeof factory.story === 'function' ? factory.story(element) : factory.story;
    return {
      element,
      operation,
      story,
      fixture: factory.fixture(element, operation, story),
      observable: (fixture, context) => factory.observable(fixture, element, context),
      removeTarget: (fixture) => factory.removeTarget(fixture, element),
    };
  }));
}

/**
 * Execute machine-readable advanced-revision evidence assertions.
 *
 * Each case supplies a fixture containing the target element and an observable
 * tied to one exact operation and story. The helper reruns the observable after
 * removing the target and after mutating the operation and story. This makes a
 * constant-true or aggregate no-errors callback fail instead of certifying a
 * collection of unrelated claims.
 */
export function revisionEvidence<Fixture>(id: string, cases: readonly RevisionEvidenceCase<Fixture>[]): void {
  if (cases.length === 0) throw new Error(`${id}: at least one evidence case is required`);
  const seen = new Set<string>();
  for (const evidence of cases) {
    const key = `${evidence.element}\u0000${evidence.operation}\u0000${evidence.story}`;
    if (seen.has(key)) throw new Error(`${id}: duplicate evidence case ${evidence.element} ${evidence.operation} ${evidence.story}`);
    seen.add(key);

    const context = { operation: evidence.operation, story: evidence.story };
    expect(evidence.observable(evidence.fixture, context), `${id}: ${evidence.element} ${evidence.operation} in ${evidence.story}`).toBe(true);

    const withoutTarget = evidence.removeTarget(evidence.fixture);
    expect(evidence.observable(withoutTarget, context), `${id}: removing ${evidence.element} must invalidate the observable itself`).toBe(false);
    expect(evidence.observable(evidence.fixture, { ...context, operation: MUTATED_OPERATION }), `${id}: changing the operation must invalidate the observable itself`).toBe(false);
    expect(evidence.observable(evidence.fixture, { ...context, story: MUTATED_STORY }), `${id}: changing the story must invalidate the observable itself`).toBe(false);

    const outputPath = process.env.SDX_REVISION_EVIDENCE_RESULTS;
    if (outputPath) {
      const result: RevisionEvidenceResult = {
        id,
        element: evidence.element,
        operation: evidence.operation,
        story: evidence.story,
        assertions: {
          observable: true,
          targetRemovalDetected: true,
          operationMutationDetected: true,
          storyMutationDetected: true,
        },
      };
      appendFileSync(outputPath, `${JSON.stringify(result)}\n`, 'utf8');
    }
  }
}
