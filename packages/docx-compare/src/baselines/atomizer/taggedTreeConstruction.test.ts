import { describe, expect } from 'vitest';
import { parseXml } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { verifyMoveRelations, verifyTaggedTree } from './taggedTree.js';
import { constructTaggedTree, verifyGlobalEqualContentInvariant } from './taggedTreeConstruction.js';
import { createPreservePlan, serializeTaggedTree, verifySerializedMoveRanges } from './taggedTreeSerializer.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const TEST_FEATURE = 'refactor-tagged-tree-redline-construction';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function body(paragraphs: readonly string[]): Element {
  return parseXml(
    `<w:document xmlns:w="${W_NS}"><w:body>${paragraphs.map((text) =>
      `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`,
  ).getElementsByTagNameNS(W_NS, 'body')[0]!;
}

function resolvedText(xml: string): string {
  return parseXml(xml).documentElement.textContent ?? '';
}

describe('complete tagged-tree construction', () => {
  test('constructs projection-isomorphic trees for insertion, deletion, and replacement', () => {
    const original = body(['A', 'B', 'C']);
    const revised = body(['A', 'new B', 'C', 'D']);
    const result = constructTaggedTree(original, revised);
    expect(verifyTaggedTree(original, revised, result.tree)).toEqual([]);
    expect(verifyGlobalEqualContentInvariant(result.tree, result.moves)).toEqual([]);
  });

  test.openspec('Equal content is tagged both')(
    'classifies reordered equal subtrees as explicit moves rather than unrelated del/ins',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = body(['A', 'B']);
      const revised = body(['B', 'A']);
      let result!: ReturnType<typeof constructTaggedTree>;
      await given('equal paragraph content relocated across sibling order', () => undefined);
      await when('the complete tree is constructed', () => { result = constructTaggedTree(original, revised); });
      await then('the projections remain isomorphic', () => {
        expect(verifyTaggedTree(original, revised, result.tree)).toEqual([]);
      });
      await and('every surviving equal-content side pair belongs to a move relation', () => {
        expect(result.moves).toHaveLength(1);
        expect(verifyGlobalEqualContentInvariant(result.tree, result.moves)).toEqual([]);
      });
    },
  );

  test('certifies move endpoint membership and unique direction IDs', () => {
    const original = body(['A', 'B']);
    const revised = body(['B', 'A']);
    const result = constructTaggedTree(original, revised);
    expect(verifyMoveRelations(result.moves, result.tree)).toEqual([]);
    expect(result.moves[0]?.sourceRangeId).not.toBe(result.moves[0]?.destinationRangeId);
  });

  test('serializes one balanced, named range per move direction', () => {
    const original = body(['A', 'B']);
    const revised = body(['B', 'A']);
    const result = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(
      result.tree,
      createPreservePlan(original, revised, result.tree, {
        author: 'Comparator', date: '2026-08-14T12:00:00Z',
      }),
      { moves: result.moves },
    );
    expect(verifySerializedMoveRanges(output, result.moves)).toEqual([]);
    expect(resolvedText(rejectAllChanges(output))).toBe('AB');
    expect(resolvedText(acceptAllChanges(output))).toBe('BA');
  });

  test('represents direct run properties as a both node with a scoped delta', () => {
    const original = body(['same']);
    const revised = body(['same']);
    const originalRun = original.getElementsByTagNameNS(W_NS, 'r')[0]!;
    const revisedRun = revised.getElementsByTagNameNS(W_NS, 'r')[0]!;
    originalRun.insertBefore(original.ownerDocument!.createElementNS(W_NS, 'w:rPr'), originalRun.firstChild);
    const revisedPr = revised.ownerDocument!.createElementNS(W_NS, 'w:rPr');
    revisedPr.appendChild(revised.ownerDocument!.createElementNS(W_NS, 'w:b'));
    revisedRun.insertBefore(revisedPr, revisedRun.firstChild);
    const result = constructTaggedTree(original, revised);
    const runNode = result.tree.children[0]?.children[0];
    expect(runNode?.tag).toBe('both');
    expect(runNode?.tag === 'both' ? runNode.propertyDelta?.scope : undefined).toBe('run');
    expect(verifyTaggedTree(original, revised, result.tree)).toEqual([]);
  });
});
