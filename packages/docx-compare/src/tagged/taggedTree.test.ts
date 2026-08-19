import { describe, expect } from 'vitest';
import fc from 'fast-check';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { el } from '../testing/dom-test-helpers.js';
import {
  assertTaggedTree,
  nextRevisionId,
  project,
  revisionProvenance,
  ProjectionContractError,
  verifyTaggedTree,
  type BothNode,
  type PropertyDelta,
  type ProjectionViolation,
  type TaggedNode,
  verifyMoveRelations,
} from './taggedTree.js';

const TEST_FEATURE = 'refactor-tagged-tree-redline-construction';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

/** A `w:p` holding a single run of `text`, optionally with run properties. */
function para(text: string, runProps?: Element[]): Element {
  const runChildren: Element[] = [];
  if (runProps) runChildren.push(el('w:rPr', {}, runProps));
  runChildren.push(el('w:t', {}, undefined, text));
  return el('w:p', {}, [el('w:r', {}, runChildren)]);
}

function body(children: Element[]): Element {
  return el('w:body', {}, children);
}

function elementChildren(element: Element): Element[] {
  return Array.from(element.childNodes).filter((n): n is Element => n.nodeType === 1);
}

/** Tag a pair of structurally parallel elements as `both`, recursively. */
function bothTree(original: Element, revised: Element): BothNode {
  const originalChildren = elementChildren(original);
  const revisedChildren = elementChildren(revised);
  return {
    tag: 'both',
    original,
    revised,
    children: originalChildren.map((child, i) => bothTree(child, revisedChildren[i]!)),
  };
}

function obligations(violations: ProjectionViolation[]): string[] {
  return [...new Set(violations.map((v) => v.obligation))].sort();
}

describe('side-tagged comparison tree', () => {
  test.openspec('Matched-but-differing nodes retain both representatives')(
    'a both node carries each side own representative and a scoped delta',
    async ({ given, when, then, and }: AllureBddContext) => {
      const originalRun = el('w:r', {}, [el('w:t', {}, undefined, 'Confidential')]);
      const revisedRun = el('w:r', {}, [
        el('w:rPr', {}, [el('w:b', {})]),
        el('w:t', {}, undefined, 'Confidential'),
      ]);
      let node!: BothNode;

      await given('the same text matched across a run-property difference', () => {
        expect(originalRun.textContent).toBe(revisedRun.textContent);
      });

      await when('the pair is tagged as one node with two representatives', () => {
        const delta: PropertyDelta = {
          scope: 'run',
          original: null,
          revised: el('w:rPr', {}, [el('w:b', {})]),
          changedProperties: ['bold'],
        };
        node = {
          tag: 'both',
          original: originalRun,
          revised: revisedRun,
          propertyDelta: delta,
          children: [],
          opaque: true,
        };
      });

      await then('each projection takes that side own element', () => {
        expect(project(node, 'original')?.element).toBe(originalRun);
        expect(project(node, 'revised')?.element).toBe(revisedRun);
      });

      await and('the difference is carried as a run-scoped delta', () => {
        expect(node.propertyDelta?.scope).toBe('run');
        expect(node.propertyDelta?.revised?.tagName).toBe('w:rPr');
      });
    },
  );

  test.openspec('Property delta scope matches the property level')(
    'a delta whose snapshot contradicts its scope is rejected',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = body([para('Clause.')]);
      const revised = body([para('Clause.')]);
      let wrong: ProjectionViolation[] = [];
      let right: ProjectionViolation[] = [];

      await given('a paragraph-scoped delta carrying a w:rPr snapshot', () => {
        expect(true).toBe(true);
      });

      await when('the tree is verified', () => {
        const tree = bothTree(original, revised);
        tree.propertyDelta = {
          scope: 'paragraph',
          original: el('w:rPr', {}, [el('w:b', {})]),
          revised: null,
          changedProperties: ['bold'],
        };
        wrong = verifyTaggedTree(original, revised, tree);

        const corrected = bothTree(original, revised);
        corrected.propertyDelta = {
          scope: 'paragraph',
          original: el('w:pPr', {}, [el('w:jc', { 'w:val': 'left' })]),
          revised: el('w:pPr', {}, [el('w:jc', { 'w:val': 'center' })]),
          changedProperties: ['justification'],
        };
        right = verifyTaggedTree(original, revised, corrected);
      });

      await then('the mismatched scope is reported', () => {
        // A run-scoped and a paragraph-scoped change serialize to different
        // revision elements, so a delta that mislabels its level cannot be
        // serialized correctly.
        expect(wrong.length).toBeGreaterThan(0);
        expect(wrong.some((v) => v.detail.includes('w:pPr'))).toBe(true);
      });

      await and('a correctly-scoped delta passes', () => {
        expect(right).toEqual([]);
      });
    },
  );

  test.openspec('Equal content is tagged both')(
    'identical content projects to both sides from a single node',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = body([para('Unchanged clause.')]);
      const revised = body([para('Unchanged clause.')]);
      let tree!: TaggedNode;

      await given('an identical clause on both sides', () => {
        expect(original.textContent).toBe(revised.textContent);
      });

      await when('the pair is aligned', () => {
        tree = bothTree(original, revised);
      });

      await then('both projections reproduce their input', () => {
        expect(verifyTaggedTree(original, revised, tree)).toEqual([]);
      });

      await and('the content reaches both sides from one node', () => {
        expect(project(tree, 'original')?.children).toHaveLength(1);
        expect(project(tree, 'revised')?.children).toHaveLength(1);
      });
    },
  );

  test.openspec('Projections reproduce their input sides')(
    'a tree with a deletion and an insertion projects back to both inputs',
    async ({ given, when, then }: AllureBddContext) => {
      const keptOriginal = para('Term A.');
      const keptRevised = para('Term A.');
      const removed = para('Term B.');
      const added = para('Term C.');
      const original = body([keptOriginal, removed]);
      const revised = body([keptRevised, added]);
      let tree!: TaggedNode;

      await given('one kept paragraph, one removed and one added', () => {
        expect(elementChildren(original)).toHaveLength(2);
        expect(elementChildren(revised)).toHaveLength(2);
      });

      await when('the pair is aligned into a tagged tree', () => {
        tree = {
          tag: 'both',
          original,
          revised,
          children: [
            bothTree(keptOriginal, keptRevised),
            { tag: 'original', node: removed, children: [], opaque: true },
            { tag: 'revised', node: added, children: [], opaque: true },
          ],
        };
      });

      await then('both projections are isomorphic to their inputs', () => {
        expect(verifyTaggedTree(original, revised, tree)).toEqual([]);
      });
    },
  );

  test.openspec('An unmodeled subtree must declare itself opaque')(
    'forgetting descendants is reported; declaring them opaque verifies clean',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = body([para('Clause.')]);
      const revised = body([para('Clause.')]);
      let forgetful: ProjectionViolation[] = [];
      let deliberate: ProjectionViolation[] = [];

      await given('a node whose input element has children', () => {
        expect(elementChildren(original)).toHaveLength(1);
      });

      await when('one tree omits them silently and another marks itself opaque', () => {
        forgetful = verifyTaggedTree(original, revised, {
          tag: 'both',
          original,
          revised,
          children: [],
        });
        deliberate = verifyTaggedTree(original, revised, {
          tag: 'both',
          original,
          revised,
          children: [],
          opaque: true,
        });
      });

      await then('the silent omission is reported as unaccounted children', () => {
        // An earlier revision read "no children" as "opaque" and compared the
        // projected element against itself, so this tree passed clean.
        expect(obligations(forgetful)).toContain('P1-bijection');
      });

      await and('the explicit declaration verifies clean', () => {
        expect(deliberate).toEqual([]);
      });
    },
  );

  test.openspec('Reordering that satisfies coverage is rejected')(
    'original [A,B] against revised [B,A] tagged [both(B),both(A)] violates P2',
    async ({ given, when, then, and }: AllureBddContext) => {
      const originalA = para('A');
      const originalB = para('B');
      const revisedB = para('B');
      const revisedA = para('A');
      const original = body([originalA, originalB]);
      const revised = body([revisedB, revisedA]);
      let tree!: TaggedNode;
      let violations: ProjectionViolation[] = [];

      await given('an original ordered [A, B] and a revised ordered [B, A]', () => {
        expect(original.textContent).toBe('AB');
        expect(revised.textContent).toBe('BA');
      });

      await when('every node is tagged both, exactly once', () => {
        tree = {
          tag: 'both',
          original,
          revised,
          children: [bothTree(originalB, revisedB), bothTree(originalA, revisedA)],
        };
        violations = verifyTaggedTree(original, revised, tree);
      });

      await then('the contract rejects it for violating P2', () => {
        const ordering = violations.filter((v) => v.obligation === 'P2-order');
        expect(ordering.length).toBeGreaterThan(0);
        expect(ordering[0]?.side).toBe('original');
      });

      await and('the original projection really does read back in the wrong order', () => {
        const projected = project(tree, 'original');
        expect(projected?.children.map((c) => c.element.textContent).join('')).toBe('BA');
      });
    },
  );

  test.openspec('Contract violations name the offending node')(
    'a violation reports its obligation and a document-order path, and asserts loudly',
    async ({ given, when, then, and }: AllureBddContext) => {
      const originalPara = para('Original text.');
      const revisedPara = para('Original text.');
      const dropped = para('Dropped clause.');
      const original = body([originalPara, dropped]);
      const revised = body([revisedPara]);
      let tree!: TaggedNode;
      let violations: ProjectionViolation[] = [];

      await given('an original paragraph that the tree never tags', () => {
        expect(elementChildren(original)).toHaveLength(2);
      });

      await when('the tree is verified against both inputs', () => {
        tree = { tag: 'both', original, revised, children: [bothTree(originalPara, revisedPara)] };
        violations = verifyTaggedTree(original, revised, tree);
      });

      await then('the untagged node is reported with its obligation and path', () => {
        const bijection = violations.filter((v) => v.obligation === 'P1-bijection');
        expect(bijection.length).toBeGreaterThan(0);
        expect(bijection.every((v) => v.side === 'original')).toBe(true);

        // The parent is reported for the count mismatch, but the dropped child
        // has to be named too — "two children, one projected" is not actionable
        // on its own when a paragraph has many siblings.
        const named = bijection.find((v) => v.path.includes('w:p['));
        expect(named).toBeDefined();
        expect(named?.path).toBe('w:body/w:p[2]');
      });

      await and('the assert form throws rather than letting the tree continue', () => {
        expect(() => assertTaggedTree(original, revised, tree)).toThrow(ProjectionContractError);
      });
    },
  );

  test.openspec('Pre-existing tracked changes are represented by construction invariants')(
    'aligned content retains each side revision nesting and reserves non-colliding IDs',
    async ({ given, when, then, and }: AllureBddContext) => {
      const originalText = el('w:t', {}, undefined, 'shared');
      const revisedText = el('w:t', {}, undefined, 'shared');
      const original = el('w:body', {}, [
        el('w:ins', { 'w:id': '17', 'w:author': 'Original Author', 'w:date': '2024-01-01T00:00:00Z' }, [
          el('w:del', { 'w:id': '18', 'w:author': 'Second Original Author', 'w:date': '2024-01-02T00:00:00Z' }, [
            el('w:r', {}, [originalText]),
          ]),
        ]),
      ]);
      const revised = el('w:body', {}, [
        el('w:ins', { 'w:id': '42', 'w:author': 'Revised Author', 'w:date': '2024-02-01T00:00:00Z' }, [
          el('w:r', {}, [revisedText]),
        ]),
      ]);
      let originalProvenance: ReturnType<typeof revisionProvenance> = [];
      let revisedProvenance: ReturnType<typeof revisionProvenance> = [];
      let firstAllocatedId = 0;

      await given('matched content under stacked revisions from multiple authors', () => {
        expect(originalText.textContent).toBe(revisedText.textContent);
      });

      await when('the aligner captures each input side revision lineage', () => {
        originalProvenance = revisionProvenance(originalText);
        revisedProvenance = revisionProvenance(revisedText);
        firstAllocatedId = nextRevisionId(original, revised);
      });

      await then('the original lineage preserves nesting, author, and date on every boundary fragment', () => {
        expect(originalProvenance).toEqual([
          { kind: 'w:ins', id: '17', author: 'Original Author', date: '2024-01-01T00:00:00Z' },
          { kind: 'w:del', id: '18', author: 'Second Original Author', date: '2024-01-02T00:00:00Z' },
        ]);
      });

      await and('the revised lineage remains independently available to the serializer', () => {
        expect(revisedProvenance).toEqual([
          { kind: 'w:ins', id: '42', author: 'Revised Author', date: '2024-02-01T00:00:00Z' },
        ]);
      });

      await and('comparison revisions allocate the first identifier not present in either input', () => {
        expect(firstAllocatedId).toBe(1);
      });
    },
  );
});

/**
 * Falsification cases.
 *
 * Every one of these passed an earlier revision of the verifier. They are kept
 * as named regressions because the failure mode they share is the dangerous
 * one: the checker stayed silent on a wrong tree, so nothing downstream had any
 * reason to look.
 */
describe('side-tagged tree: falsification', () => {
  test('rejects a tree that forgot every descendant instead of declaring it opaque', () => {
    const original = body([para('Clause.')]);
    const revised = body([para('Clause.')]);

    // The aligner simply never descended. Before `opaque` was explicit, this
    // was indistinguishable from a deliberate whole-subtree carry, because the
    // verifier compared the projected element against itself.
    const forgetful: TaggedNode = { tag: 'both', original, revised, children: [] };

    const violations = verifyTaggedTree(original, revised, forgetful);
    expect(violations.length).toBeGreaterThan(0);
    expect(obligations(violations)).toContain('P1-bijection');
  });

  test('accepts the same shape when the subtree is explicitly opaque', () => {
    const original = body([para('Clause.')]);
    const revised = body([para('Clause.')]);
    const deliberate: TaggedNode = {
      tag: 'both',
      original,
      revised,
      children: [],
      opaque: true,
    };
    expect(verifyTaggedTree(original, revised, deliberate)).toEqual([]);
  });

  test('rejects an opaque node whose subtree is not the input subtree', () => {
    const original = body([para('Original clause.')]);
    const revised = body([para('Revised clause.')]);
    const wrongPayload = body([para('Something else entirely.')]);

    const tree: TaggedNode = {
      tag: 'both',
      original: wrongPayload,
      revised,
      children: [],
      opaque: true,
    };

    const violations = verifyTaggedTree(original, revised, tree);
    expect(obligations(violations)).toContain('P5-opaque-payload');
  });

  test('distinguishes elements that share a tagName across namespaces', () => {
    const foreign = 'urn:not-wordprocessingml';
    const originalDoc = el('w:body', {}, [para('Clause.')]);
    const impostorBody = testElementInNamespace(foreign, 'w:body');
    const impostorPara = testElementInNamespace(foreign, 'w:p');
    impostorBody.appendChild(impostorPara);

    const tree: TaggedNode = {
      tag: 'both',
      original: impostorBody,
      revised: impostorBody,
      children: [{ tag: 'both', original: impostorPara, revised: impostorPara, children: [], opaque: true }],
    };

    // Comparing lexical tagName alone would call these equal.
    const violations = verifyTaggedTree(originalDoc, originalDoc, tree);
    expect(violations.length).toBeGreaterThan(0);
  });

  test('does not let a delimiter-bearing attribute value forge another attribute set', () => {
    const combined = el('w:p', { a: 'x b=y' });
    const split = el('w:p', { a: 'x', b: 'y' });
    const originalBody = body([combined]);
    const impostorBody = body([split]);

    const tree: TaggedNode = {
      tag: 'both',
      original: impostorBody,
      revised: impostorBody,
      children: [
        { tag: 'both', original: split, revised: split, children: [], opaque: true },
      ],
    };

    // `a="x b=y"` and `a="x" b="y"` concatenate identically around delimiters.
    const violations = verifyTaggedTree(originalBody, originalBody, tree);
    expect(violations.length).toBeGreaterThan(0);
  });

  test('reports a reorder combined with an edit rather than going silent', () => {
    const originalA = para('A');
    const originalB = para('B');
    const revisedB = para('B');
    const revisedAEdited = para('A edited');
    const original = body([originalA, originalB]);
    const revised = body([revisedB, revisedAEdited]);

    const tree: TaggedNode = {
      tag: 'both',
      original,
      revised,
      children: [bothTree(originalB, revisedB), bothTree(originalA, revisedAEdited)],
    };

    // Not a clean permutation, so it is reported as content rather than order.
    // What matters is that it is reported at all.
    const violations = verifyTaggedTree(original, revised, tree);
    expect(violations.length).toBeGreaterThan(0);
  });

  test('rejects a duplicated occurrence of the same input node', () => {
    const only = para('Only clause.');
    const original = body([only]);
    const revised = body([para('Only clause.')]);

    const tree: TaggedNode = {
      tag: 'both',
      original,
      revised,
      children: [
        { tag: 'both', original: only, revised: only, children: [], opaque: true },
        { tag: 'both', original: only, revised: only, children: [], opaque: true },
      ],
    };

    const violations = verifyTaggedTree(original, revised, tree);
    expect(obligations(violations)).toContain('P3-containment');
  });

  test('rejects wrong containment — a grandchild promoted to child', () => {
    const run = el('w:r', {}, [el('w:t', {}, undefined, 'text')]);
    const paragraph = el('w:p', {}, [run]);
    const original = body([paragraph]);
    const revised = body([para('text')]);

    // The run is tagged as a sibling of its own paragraph.
    const tree: TaggedNode = {
      tag: 'both',
      original,
      revised,
      children: [
        { tag: 'both', original: paragraph, revised: paragraph, children: [], opaque: true },
        { tag: 'both', original: run, revised: run, children: [], opaque: true },
      ],
    };

    const violations = verifyTaggedTree(original, revised, tree);
    expect(violations.length).toBeGreaterThan(0);
  });

  test('would fail if verification were stubbed out', () => {
    // Guards against the mutation "make verifyTaggedTree return []": at least
    // one case above must be non-vacuous for every obligation the module
    // claims to check.
    const original = body([para('A'), para('B')]);
    const revised = body([para('A')]);
    const tree: TaggedNode = { tag: 'both', original, revised, children: [] };
    expect(verifyTaggedTree(original, revised, tree)).not.toEqual([]);
  });
});

describe('side-tagged tree: move relations', () => {
  test('certifies one non-crossing source/destination subtree pair per move name', () => {
    const source = { tag: 'original' as const, node: el('w:p', {}, [el('w:r')]), children: [], opaque: true as const };
    const destination = { tag: 'revised' as const, node: el('w:p', {}, [el('w:r')]), children: [], opaque: true as const };
    expect(verifyMoveRelations([{
      source,
      destination,
      name: 'move1',
      sourceRangeId: 7,
      destinationRangeId: 8,
    }])).toEqual([]);
  });

  test('rejects duplicate names, duplicate directional IDs, and non-decimal-number IDs', () => {
    const source = { tag: 'original' as const, node: el('w:p'), children: [] };
    const destination = { tag: 'revised' as const, node: el('w:p'), children: [] };
    const violations = verifyMoveRelations([
      { source, destination, name: 'move1', sourceRangeId: 1, destinationRangeId: 2 },
      { source, destination, name: 'move1', sourceRangeId: 1, destinationRangeId: -1 },
    ]);
    expect(violations.map((violation) => violation.detail)).toEqual(expect.arrayContaining([
      'move name must be non-empty and one-to-one',
      'source range id must be a unique non-negative integer',
      'destination range id must be a unique non-negative integer',
    ]));
  });

  test('requires range IDs to be unique across both move directions', () => {
    const source = { tag: 'original' as const, node: el('w:p'), children: [] };
    const destination = { tag: 'revised' as const, node: el('w:p'), children: [] };
    expect(verifyMoveRelations([
      { source, destination, name: 'move1', sourceRangeId: 4, destinationRangeId: 4 },
    ])).toContainEqual({
      relation: 0,
      detail: 'destination range id must be a unique non-negative integer',
    });
  });
});

function testElementInNamespace(namespaceURI: string, qualifiedName: string): Element {
  const doc = el('w:body', {}).ownerDocument!;
  return doc.createElementNS(namespaceURI, qualifiedName);
}

/**
 * Property test: any tree built by tagging two structurally parallel documents
 * as `both` must verify clean, and dropping any single tagged child must make
 * it fail. The second half is what stops the suite from passing vacuously.
 */
describe('side-tagged tree: properties', () => {
  const paragraphTexts = fc.array(fc.string({ minLength: 1, maxLength: 8 }), {
    minLength: 1,
    maxLength: 6,
  });

  test('a fully-tagged parallel pair always verifies clean', () => {
    fc.assert(
      fc.property(paragraphTexts, (texts) => {
        const original = body(texts.map((t) => para(t)));
        const revised = body(texts.map((t) => para(t)));
        return verifyTaggedTree(original, revised, bothTree(original, revised)).length === 0;
      }),
      { numRuns: 100 },
    );
  });

  test('dropping any single top-level child always produces a violation', () => {
    fc.assert(
      fc.property(paragraphTexts, fc.nat(), (texts, seed) => {
        const original = body(texts.map((t) => para(t)));
        const revised = body(texts.map((t) => para(t)));
        const tree = bothTree(original, revised);
        const dropAt = seed % tree.children.length;
        tree.children.splice(dropAt, 1);
        return verifyTaggedTree(original, revised, tree).length > 0;
      }),
      { numRuns: 100 },
    );
  });

  test('reversing the tagged children of a multi-child pair always produces a violation', () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 2, maxLength: 6 })
          .filter((t) => t.length >= 2),
        (texts) => {
          const original = body(texts.map((t) => para(t)));
          const revised = body(texts.map((t) => para(t)));
          const tree = bothTree(original, revised);
          tree.children.reverse();
          return verifyTaggedTree(original, revised, tree).length > 0;
        },
      ),
      { numRuns: 100 },
    );
  });
});
