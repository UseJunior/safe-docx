import { describe, expect } from 'vitest';
import type { ComparisonUnitAtom, OpaquePassthroughNode } from '@usejunior/docx-core';
import { testAllure } from '../../testing/allure-test.js';
import {
  computeGroupLcs,
  type ComparisonUnitGroup,
  type GroupLcsInstrumentation,
} from './hierarchicalLcs.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Hierarchical LCS' });

function descriptor(documentOrdinal: number, fingerprint: string): OpaquePassthroughNode {
  return {
    namespaceUri: 'urn:test:w',
    localName: 'sdt',
    documentOrdinal,
    paragraphOrdinal: 4,
    containerIdentity: 'body:0',
    semanticFingerprint: fingerprint,
  } as OpaquePassthroughNode;
}

function atom(owner?: OpaquePassthroughNode): ComparisonUnitAtom {
  return {
    contentElement: { tagName: 'w:t' },
    ancestorElements: [],
    opaquePassthrough: owner,
  } as unknown as ComparisonUnitAtom;
}

function group(index: number, atoms: ComparisonUnitAtom[], textHash = index + 1): ComparisonUnitGroup {
  return {
    paragraphIndex: index,
    atoms,
    textHash,
    normalizedTextHash: textHash,
    textContent: `paragraph-${index}`,
  };
}

describe('opaque paragraph identity caching', () => {
  test('computes each ordinary group identity once across DP and backtracking', () => {
    const original = Array.from({ length: 70 }, (_, index) => group(index, [atom()], index + 1));
    const revised = Array.from({ length: 70 }, (_, index) => group(index, [atom()], index + 1));
    const instrumentation: GroupLcsInstrumentation = { opaqueIdentityComputations: 0 };

    const result = computeGroupLcs(original, revised, 2, undefined, instrumentation);

    expect(result.matchedGroups).toHaveLength(70);
    expect(instrumentation.opaqueIdentityComputations).toBe(original.length + revised.length);
  });

  test('matches and distinguishes groups containing multiple opaque identities', () => {
    const originalFirst = descriptor(0, 'first');
    const originalSecond = descriptor(1, 'second');
    const revisedFirst = descriptor(0, 'first');
    const revisedSecond = descriptor(1, 'second');
    const original = group(0, [
      atom(originalFirst),
      atom(originalFirst),
      atom(originalSecond),
    ], 10);
    const same = group(0, [
      atom(revisedFirst),
      atom(revisedSecond),
      atom(revisedSecond),
    ], 20);
    const changed = group(0, [atom(descriptor(0, 'first')), atom(descriptor(1, 'changed'))], 30);

    expect(computeGroupLcs([original], [same], 2).matchedGroups).toEqual([
      { originalIndex: 0, revisedIndex: 0 },
    ]);
    expect(computeGroupLcs([original], [changed], 2).matchedGroups).toEqual([]);
  });

  test('does not reuse a stale identity after atoms mutate between LCS runs', () => {
    const mutable = group(0, [atom()], 10);
    const ordinary = group(0, [atom()], 10);
    expect(computeGroupLcs([mutable], [ordinary], 2).matchedGroups).toHaveLength(1);

    mutable.atoms[0]!.opaquePassthrough = descriptor(0, 'added-between-runs');

    expect(computeGroupLcs([mutable], [ordinary], 2).matchedGroups).toEqual([]);
  });
});
