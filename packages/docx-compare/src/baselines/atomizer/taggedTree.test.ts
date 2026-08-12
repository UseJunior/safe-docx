import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { el } from '../../testing/dom-test-helpers.js';
import {
  assertTaggedTree,
  project,
  ProjectionContractError,
  verifyTaggedTree,
  type BothNode,
  type PropertyDelta,
  type ProjectionViolation,
  type TaggedNode,
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
        };
      });

      await then('each projection takes that side own element', () => {
        expect(project(node, 'original')?.element).toBe(originalRun);
        expect(project(node, 'revised')?.element).toBe(revisedRun);
      });

      await and('the difference is carried as a run-scoped delta', () => {
        expect(node.propertyDelta?.scope).toBe('run');
        expect(node.propertyDelta?.original).toBeNull();
        expect(node.propertyDelta?.revised?.tagName).toBe('w:rPr');
      });
    },
  );

  test.openspec('Property delta scope matches the property level')(
    'a paragraph-property difference is recorded at paragraph scope',
    async ({ given, when, then }: AllureBddContext) => {
      let delta!: PropertyDelta;

      await given('a paragraph whose justification differs between sides', () => {
        expect(true).toBe(true);
      });

      await when('the difference is recorded as a property delta', () => {
        delta = {
          scope: 'paragraph',
          original: el('w:pPr', {}, [el('w:jc', { 'w:val': 'left' })]),
          revised: el('w:pPr', {}, [el('w:jc', { 'w:val': 'center' })]),
          changedProperties: ['justification'],
        };
      });

      await then('the delta carries paragraph scope and pPr snapshots', () => {
        // A run-scoped and a paragraph-scoped change serialize to different
        // revision elements, so the level has to travel with the delta.
        expect(delta.scope).toBe('paragraph');
        expect(delta.original?.tagName).toBe('w:pPr');
        expect(delta.revised?.tagName).toBe('w:pPr');
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
        // Equal content has a single home in the tree, so no code path can emit
        // it as a deletion paired with an insertion of the same text.
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
            { tag: 'original', node: removed, children: [] },
            { tag: 'revised', node: added, children: [] },
          ],
        };
      });

      await then('both projections are isomorphic to their inputs', () => {
        // Checked on the tree itself — nothing is serialized, and no
        // accept/reject round trip is involved.
        expect(verifyTaggedTree(original, revised, tree)).toEqual([]);
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
        // This is the candidate a coverage-only obligation accepts: each input
        // node appears exactly once and carries the right tag.
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
        // Why order cannot be left to a coverage count: OOXML text extraction
        // is order-sensitive, so this tree would certify a redline that reads
        // back as [B, A] against an original of [A, B].
        const projected = project(tree, 'original');
        const text = projected?.children.map((c) => c.element.textContent).join('');
        expect(text).toBe('BA');
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
        tree = {
          tag: 'both',
          original,
          revised,
          children: [bothTree(originalPara, revisedPara)],
        };
        violations = verifyTaggedTree(original, revised, tree);
      });

      await then('the untagged node is reported with its obligation and path', () => {
        const missing = violations.find((v) => v.obligation === 'P1-bijection');
        expect(missing).toBeDefined();
        expect(missing?.side).toBe('original');
        expect(missing?.path).toContain('w:p');
      });

      await and('the assert form throws rather than letting the tree continue', () => {
        // A violation is an engine defect, not something a later pass repairs.
        expect(() => assertTaggedTree(original, revised, tree)).toThrow(ProjectionContractError);
      });
    },
  );
});
