import { appendFileSync } from 'node:fs';
import { expect } from 'vitest';

export interface RevisionEvidenceContext {
  operation: string;
  story: string;
}

export interface RevisionEvidenceMutation<Fixture> {
  name: string;
  apply: (fixture: Fixture, context: RevisionEvidenceContext) => {
    fixture: Fixture;
    context: RevisionEvidenceContext;
  };
}

export interface RevisionEvidenceCase<Fixture = unknown, Run = unknown> {
  element: string;
  context: RevisionEvidenceContext;
  buildFixture: () => Fixture | Promise<Fixture>;
  run: (fixture: Fixture, context: RevisionEvidenceContext) => Run | Promise<Run>;
  observe: (run: Run) => boolean;
  mutations: readonly RevisionEvidenceMutation<Fixture>[];
}

export interface RevisionEvidenceResult {
  id: string;
  element: string;
  operation: string;
  story: string;
  assertions: {
    observable: true;
    mutationsDetected: string[];
  };
}

export interface RevisionEvidenceCaseFactory<Fixture, Run> {
  elements: readonly string[];
  operations: readonly string[];
  story: string | ((element: string) => string);
  buildFixture: (element: string, context: RevisionEvidenceContext) => Fixture | Promise<Fixture>;
  run: (fixture: Fixture, element: string, context: RevisionEvidenceContext) => Run | Promise<Run>;
  observe: (run: Run, element: string, expected: RevisionEvidenceContext) => boolean;
  mutations: (
    element: string,
    expected: RevisionEvidenceContext,
  ) => readonly RevisionEvidenceMutation<Fixture>[];
}

export function revisionEvidenceCases<Fixture, Run>(
  factory: RevisionEvidenceCaseFactory<Fixture, Run>,
): RevisionEvidenceCase<Fixture, Run>[] {
  return factory.elements.flatMap((element) => factory.operations.map((operation) => {
    const story = typeof factory.story === 'function' ? factory.story(element) : factory.story;
    const context = { operation, story };
    return {
      element,
      context,
      buildFixture: () => factory.buildFixture(element, context),
      run: (fixture, actualContext) => factory.run(fixture, element, actualContext),
      observe: (result) => factory.observe(result, element, context),
      mutations: factory.mutations(element, context),
    };
  }));
}

/**
 * Execute machine-readable advanced-revision evidence assertions.
 *
 * Every assertion starts from a fresh input fixture and invokes the supplied
 * production operation. Mutations change that input or the operation context
 * before invoking the same runner again. The observable sees only the new run
 * result, so metadata guards and precomputed outputs cannot establish evidence.
 */
export async function revisionEvidence<Fixture, Run>(
  id: string,
  cases: readonly RevisionEvidenceCase<Fixture, Run>[],
): Promise<void> {
  if (cases.length === 0) throw new Error(`${id}: at least one evidence case is required`);
  const seen = new Set<string>();
  for (const evidence of cases) {
    const key = `${evidence.element}\u0000${evidence.context.operation}\u0000${evidence.context.story}`;
    if (seen.has(key)) {
      throw new Error(
        `${id}: duplicate evidence case ${evidence.element} ${evidence.context.operation} ${evidence.context.story}`,
      );
    }
    seen.add(key);
    if (evidence.mutations.length === 0) {
      throw new Error(`${id}: ${evidence.element} requires at least one causal mutation`);
    }
    const requiredMutations = ['remove-target', 'corrupt-target'];
    for (const required of requiredMutations) {
      if (!evidence.mutations.some((mutation) => mutation.name === required)) {
        throw new Error(`${id}: ${evidence.element} requires ${required} rerun evidence`);
      }
    }

    const fixture = await evidence.buildFixture();
    const baseline = await evidence.run(fixture, evidence.context);
    expect(
      evidence.observe(baseline),
      `${id}: ${evidence.element} ${evidence.context.operation} in ${evidence.context.story}`,
    ).toBe(true);

    const mutationNames = new Set<string>();
    for (const mutation of evidence.mutations) {
      if (!mutation.name || mutationNames.has(mutation.name)) {
        throw new Error(`${id}: ${evidence.element} has a missing or duplicate mutation name`);
      }
      mutationNames.add(mutation.name);
      const fresh = await evidence.buildFixture();
      const mutated = mutation.apply(fresh, evidence.context);
      const rerun = await evidence.run(mutated.fixture, mutated.context);
      expect(
        evidence.observe(rerun),
        `${id}: mutation ${mutation.name} must invalidate ${evidence.element} evidence`,
      ).toBe(false);
    }

    const outputPath = process.env.SDX_REVISION_EVIDENCE_RESULTS;
    if (outputPath) {
      const result: RevisionEvidenceResult = {
        id,
        element: evidence.element,
        operation: evidence.context.operation,
        story: evidence.context.story,
        assertions: {
          observable: true,
          mutationsDetected: [...mutationNames],
        },
      };
      appendFileSync(outputPath, `${JSON.stringify(result)}\n`, 'utf8');
    }
  }
}
