import { expect } from 'vitest';

export interface RevisionEvidenceMatrix {
  elements: readonly string[];
  operations: readonly string[];
  story?: string;
  stories?: Readonly<Record<string, string>>;
  passed: (element: string, operation: string, story: string) => boolean;
}

/**
 * Execute machine-readable advanced-revision evidence assertions.
 *
 * The advanced-revision drift gate parses literal claims from calls to this
 * helper, so each claim stays bound to the exact element, operation/mode, and
 * story exercised by the test instead of relying on titles or nearby tags.
 */
export function revisionEvidence(id: string, matrix: RevisionEvidenceMatrix): void {
  for (const element of matrix.elements) {
    const story = matrix.stories?.[element] ?? matrix.story;
    if (!story) throw new Error(`${id}: no story declared for ${element}`);
    for (const operation of matrix.operations) {
      expect(
        matrix.passed(element, operation, story),
        `${id}: ${element} ${operation} in ${story}`,
      ).toBe(true);
    }
  }
}
