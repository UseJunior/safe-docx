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
  targetPresent: (fixture: Fixture) => boolean;
  observable: (fixture: Fixture, context: RevisionEvidenceContext) => boolean;
  removeTarget: (fixture: Fixture) => Fixture;
}

export interface RevisionEvidenceResult {
  id: string;
  element: string;
  operation: string;
  story: string;
  assertions: {
    targetPresent: true;
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
  targetPresent: (fixture: Fixture, element: string) => boolean;
  observable: (fixture: Fixture, element: string, operation: string, story: string) => boolean;
  removeTarget: (fixture: Fixture, element: string) => Fixture;
}

const MUTATED_OPERATION = '__revision_evidence_wrong_operation__';
const MUTATED_STORY = '__revision_evidence_wrong_story__';

function evaluate<Fixture>(evidence: RevisionEvidenceCase<Fixture>, fixture: Fixture, context: RevisionEvidenceContext): boolean {
  const targetPresent = evidence.targetPresent(fixture);
  const observable = evidence.observable(fixture, context);
  return targetPresent && observable;
}

export function revisionEvidenceCases<Fixture>(factory: RevisionEvidenceCaseFactory<Fixture>): RevisionEvidenceCase<Fixture>[] {
  return factory.elements.flatMap((element) => factory.operations.map((operation) => {
    const story = typeof factory.story === 'function' ? factory.story(element) : factory.story;
    return {
      element,
      operation,
      story,
      fixture: factory.fixture(element, operation, story),
      targetPresent: (fixture) => factory.targetPresent(fixture, element),
      observable: (fixture, context) =>
        context.operation === operation &&
        context.story === story &&
        factory.observable(fixture, element, operation, story),
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
    expect(evidence.targetPresent(evidence.fixture), `${id}: ${evidence.element} target is absent from its fixture`).toBe(true);
    expect(evidence.observable(evidence.fixture, context), `${id}: ${evidence.element} ${evidence.operation} in ${evidence.story}`).toBe(true);

    const withoutTarget = evidence.removeTarget(evidence.fixture);
    expect(evidence.targetPresent(withoutTarget), `${id}: removing ${evidence.element} must remove the target`).toBe(false);
    expect(evaluate(evidence, withoutTarget, context), `${id}: removing ${evidence.element} must invalidate the observable`).toBe(false);
    expect(evaluate(evidence, evidence.fixture, { ...context, operation: MUTATED_OPERATION }), `${id}: changing the operation must invalidate the observable`).toBe(false);
    expect(evaluate(evidence, evidence.fixture, { ...context, story: MUTATED_STORY }), `${id}: changing the story must invalidate the observable`).toBe(false);

    const outputPath = process.env.SDX_REVISION_EVIDENCE_RESULTS;
    if (outputPath) {
      const result: RevisionEvidenceResult = {
        id,
        element: evidence.element,
        operation: evidence.operation,
        story: evidence.story,
        assertions: {
          targetPresent: true,
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
