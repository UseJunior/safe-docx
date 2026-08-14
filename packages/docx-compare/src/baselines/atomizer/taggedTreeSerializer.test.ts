import { describe, expect } from 'vitest';
import fc from 'fast-check';
import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { project, type BothNode, type TaggedNode } from './taggedTree.js';
import {
  composeTaggedStories,
  createPreservePlan,
  preservedStack,
  serializeTaggedTree,
  splitWithPreservedProvenance,
} from './taggedTreeSerializer.js';
import { constructTaggedTree } from './taggedTreeConstruction.js';
import { compareSourceProjectedFormattingFidelity } from './formattingFidelity.js';

const TEST_FEATURE = 'refactor-tagged-tree-redline-construction';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function documentBody(xml: string): Element {
  return parseXml(`<w:document xmlns:w="${W_NS}"><w:body>${xml}</w:body></w:document>`)
    .getElementsByTagNameNS(W_NS, 'body')[0]!;
}

function elementChildren(element: Element): Element[] {
  return Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1);
}

function text(xml: string): string {
  return parseXml(xml).documentElement.textContent ?? '';
}

describe('tagged-tree shadow serializer', () => {
  test.openspec('Allocated revision identifiers avoid input collisions')(
    'builds a PreservePlan from both ordered provenance stacks',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = documentBody(
        '<w:ins w:id="1" w:author="Alice" w:date="2026-08-01T00:00:00Z"><w:r><w:t>old</w:t></w:r></w:ins>',
      );
      const revised = documentBody(
        '<w:ins w:id="2" w:author="Bob" w:date="2026-08-02T00:00:00Z"><w:r><w:t>new</w:t></w:r></w:ins>',
      );
      const originalRun = original.getElementsByTagNameNS(W_NS, 'r')[0]!;
      const revisedRun = revised.getElementsByTagNameNS(W_NS, 'r')[0]!;
      const tree: TaggedNode = {
        tag: 'both', original, revised, children: [
          { tag: 'original', node: originalRun, children: [], opaque: true },
          { tag: 'revised', node: revisedRun, children: [], opaque: true },
        ],
      };
      let plan!: ReturnType<typeof createPreservePlan>;

      await given('each input owns a prior revision with a distinct author and identifier', () => undefined);
      await when('the pre-serializer preserve plan is created', () => {
        plan = createPreservePlan(original, revised, tree, {
          author: 'Comparator', date: '2026-08-14T12:00:00Z',
        });
      });
      await then('the comparison identifier avoids both inputs', () => expect(plan.comparison.id).toBe(3));
      await and('ordered prior attribution is retained before cloning', () => {
        expect(preservedStack(plan, tree.children[0]!, 'original')).toEqual([
          { kind: 'w:ins', id: '1', author: 'Alice', date: '2026-08-01T00:00:00Z' },
        ]);
        expect(preservedStack(plan, tree.children[1]!, 'revised')).toEqual([
          { kind: 'w:ins', id: '2', author: 'Bob', date: '2026-08-02T00:00:00Z' },
        ]);
      });
    },
  );

  test.openspec('Provenance survives a boundary split')(
    'copies the complete ordered multi-author stack onto every fragment',
    async ({ given, when, then }: AllureBddContext) => {
      const root = documentBody(
        '<w:ins w:id="1" w:author="Alice" w:date="2026-08-01T00:00:00Z">' +
        '<w:del w:id="2" w:author="Bob" w:date="2026-08-02T00:00:00Z">' +
        '<w:r><w:t>contract</w:t></w:r></w:del></w:ins>',
      );
      const source = root.getElementsByTagNameNS(W_NS, 'r')[0]!;
      const fragment = (value: string): Element => documentBody(`<w:r><w:t>${value}</w:t></w:r>`)
        .getElementsByTagNameNS(W_NS, 'r')[0]!;
      let fragments: Element[] = [];

      await given('an alignment boundary inside nested prior revisions', () => undefined);
      await when('the run is split at that boundary', () => {
        fragments = splitWithPreservedProvenance(source, [fragment('con'), fragment('tract')]);
      });
      await then('each fragment retains both wrappers in the original order', () => {
        expect(fragments).toHaveLength(2);
        for (const wrapped of fragments) {
          expect(wrapped.getAttributeNS(W_NS, 'author')).toBe('Alice');
          expect(wrapped.getElementsByTagNameNS(W_NS, 'del')[0]?.getAttributeNS(W_NS, 'author')).toBe('Bob');
        }
      });
    },
  );

  test.openspec('Serialized multi-author stacks preserve both projections')(
    'emits ordered prior wrappers outside the comparison revision',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = documentBody(
        '<w:ins w:id="4" w:author="Alice" w:date="2026-08-01T00:00:00Z"><w:r><w:t>old</w:t></w:r></w:ins>',
      );
      const revised = documentBody(
        '<w:ins w:id="9" w:author="Bob" w:date="2026-08-02T00:00:00Z"><w:r><w:t>new</w:t></w:r></w:ins>',
      );
      const tree: TaggedNode = {
        tag: 'both', original, revised, children: [
          { tag: 'original', node: original.getElementsByTagNameNS(W_NS, 'r')[0]!, children: [], opaque: true },
          { tag: 'revised', node: revised.getElementsByTagNameNS(W_NS, 'r')[0]!, children: [], opaque: true },
        ],
      };
      const plan = createPreservePlan(original, revised, tree, {
        author: 'Comparator', date: '2026-08-14T12:00:00Z',
      });
      let serialized = '';

      await given('ordered prior-author insertions containing a comparison replacement', () => undefined);
      await when('the shadow-only serializer emits tracked markup', () => {
        serialized = serializeTaggedTree(tree, plan);
      });
      await then('prior wrappers contain rather than trail the comparison wrappers', () => {
        const output = parseXml(serialized);
        const alice = Array.from(output.getElementsByTagNameNS(W_NS, 'ins'))
          .find((element) => element.getAttributeNS(W_NS, 'author') === 'Alice')!;
        expect(alice.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(1);
      });
      await and('accept and reject resolve to the revised and original projections', () => {
        expect(text(acceptAllChanges(serialized))).toBe(text(acceptAllChanges(new XMLSerializer().serializeToString(revised))));
        expect(text(rejectAllChanges(serialized))).toBe(text(rejectAllChanges(new XMLSerializer().serializeToString(original))));
      });
    },
  );

  test('serializes side-only siblings without changing its input tree', () => {
    const original = documentBody('<w:p><w:r><w:t>A</w:t></w:r></w:p>');
    const revised = documentBody('<w:p><w:r><w:t>B</w:t></w:r></w:p>');
    const tree: BothNode = {
      tag: 'both', original, revised, children: [
        { tag: 'original', node: elementChildren(original)[0]!, children: [], opaque: true },
        { tag: 'revised', node: elementChildren(revised)[0]!, children: [], opaque: true },
      ],
    };
    const before = original.textContent;
    const output = serializeTaggedTree(tree, createPreservePlan(original, revised, tree, {
      author: 'Comparator', date: '2026-08-14T12:00:00Z',
    }));
    expect(text(acceptAllChanges(output))).toBe('B');
    expect(text(rejectAllChanges(output))).toBe('A');
    expect(original.textContent).toBe(before);
  });

  test('serializes a both-node direct-property delta as tracked property markup', () => {
    const original = documentBody('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t></w:r></w:p>');
    const revised = documentBody('<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>A</w:t></w:r></w:p>');
    const originalRun = original.getElementsByTagNameNS(W_NS, 'r')[0]!;
    const revisedRun = revised.getElementsByTagNameNS(W_NS, 'r')[0]!;
    const tree: BothNode = {
      tag: 'both', original, revised, children: [{
        tag: 'both',
        original: originalRun,
        revised: revisedRun,
        children: [],
        opaque: true,
        propertyDelta: {
          scope: 'run',
          original: originalRun.getElementsByTagNameNS(W_NS, 'rPr')[0]!,
          revised: revisedRun.getElementsByTagNameNS(W_NS, 'rPr')[0]!,
          changedProperties: ['bold', 'italic'],
        },
      }],
    };
    const output = parseXml(serializeTaggedTree(tree, createPreservePlan(original, revised, tree, {
      author: 'Comparator', date: '2026-08-14T12:00:00Z',
    })));
    const change = output.getElementsByTagNameNS(W_NS, 'rPrChange')[0]!;
    expect(change.getAttributeNS(W_NS, 'author')).toBe('Comparator');
    expect(change.getElementsByTagNameNS(W_NS, 'b')).toHaveLength(1);
    expect(output.documentElement.getElementsByTagNameNS(W_NS, 'i')).toHaveLength(1);
  });

  test('preserves both text projections for arbitrary replacement siblings', () => {
    const words = fc.string({
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
      minLength: 1,
      maxLength: 20,
    });
    fc.assert(fc.property(words, words, (oldText, newText) => {
      const original = documentBody(`<w:p><w:r><w:t>${oldText}</w:t></w:r></w:p>`);
      const revised = documentBody(`<w:p><w:r><w:t>${newText}</w:t></w:r></w:p>`);
      const tree: BothNode = {
        tag: 'both', original, revised, children: [
          { tag: 'original', node: elementChildren(original)[0]!, children: [], opaque: true },
          { tag: 'revised', node: elementChildren(revised)[0]!, children: [], opaque: true },
        ],
      };
      const output = serializeTaggedTree(tree, createPreservePlan(original, revised, tree, {
        author: 'Comparator', date: '2026-08-14T12:00:00Z',
      }));
      return text(rejectAllChanges(output)) === oldText && text(acceptAllChanges(output)) === newText;
    }), { numRuns: 100 });
  });

  test('composes nested story subtrees without mutating the outer tree', () => {
    const original = documentBody('<w:p><w:r><w:t>outer</w:t></w:r></w:p>');
    const revised = documentBody('<w:p><w:r><w:t>outer</w:t></w:r></w:p>');
    const storyOriginal = documentBody('<w:p><w:r><w:t>old story</w:t></w:r></w:p>');
    const storyRevised = documentBody('<w:p><w:r><w:t>new story</w:t></w:r></w:p>');
    const outer: BothNode = { tag: 'both', original, revised, children: [], opaque: true };
    const story: BothNode = {
      tag: 'both', original: storyOriginal, revised: storyRevised, children: [
        { tag: 'original', node: elementChildren(storyOriginal)[0]!, children: [], opaque: true },
        { tag: 'revised', node: elementChildren(storyRevised)[0]!, children: [], opaque: true },
      ],
    };
    const composed = composeTaggedStories(outer, [story]);
    expect(outer.children).toEqual([]);
    expect(project(composed, 'original')?.children[0]?.element).toBe(storyOriginal);
    expect(project(composed, 'revised')?.children[0]?.element).toBe(storyRevised);
  });

  test('parameterizes the package skeleton side without changing tracked projections', () => {
    const original = documentBody('<w:p><w:r><w:t>A</w:t></w:r></w:p>');
    const revised = documentBody('<w:p><w:r><w:t>B</w:t></w:r></w:p>');
    original.setAttribute('data-skeleton', 'original');
    revised.setAttribute('data-skeleton', 'revised');
    const tree: BothNode = {
      tag: 'both', original, revised, children: [
        { tag: 'original', node: elementChildren(original)[0]!, children: [], opaque: true },
        { tag: 'revised', node: elementChildren(revised)[0]!, children: [], opaque: true },
      ],
    };
    const plan = createPreservePlan(original, revised, tree, {
      author: 'Comparator', date: '2026-08-14T12:00:00Z',
    });
    const rebuilt = serializeTaggedTree(tree, plan, { baseSide: 'original' });
    const inplace = serializeTaggedTree(tree, plan, { baseSide: 'revised' });
    expect(parseXml(rebuilt).documentElement.getAttribute('data-skeleton')).toBe('original');
    expect(parseXml(inplace).documentElement.getAttribute('data-skeleton')).toBe('revised');
    expect(text(acceptAllChanges(rebuilt))).toBe('B');
    expect(text(rejectAllChanges(inplace))).toBe('A');
  });

  test('serializes whole paragraphs through paragraph marks with exact source properties', () => {
    const original = documentBody(
      '<w:p><w:r><w:t>anchor</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:jc w:val="center"/><w:rPr><w:szCs w:val="22"/></w:rPr></w:pPr><w:r><w:t>old</w:t></w:r></w:p>',
    );
    const revised = documentBody(
      '<w:p><w:r><w:t>anchor</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading3"/><w:jc w:val="right"/><w:rPr><w:szCs w:val="22"/></w:rPr></w:pPr><w:r><w:t>new one</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading4"/><w:jc w:val="left"/></w:pPr><w:r><w:t>new two</w:t></w:r></w:p>',
    );
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(original, revised, constructed.tree, {
      author: 'Comparator', date: '2026-08-14T12:00:00Z',
    }), { moves: constructed.moves });

    expect(output).not.toMatch(/<w:(?:ins|del)[^>]*>\s*<w:p[ >]/);
    expect(output).toMatch(/<w:pPr>[\s\S]*<w:rPr>[\s\S]*<w:(?:ins|del)/);
    const originalXml = `<w:document xmlns:w="${W_NS}">${new XMLSerializer().serializeToString(original)}</w:document>`;
    const revisedXml = `<w:document xmlns:w="${W_NS}">${new XMLSerializer().serializeToString(revised)}</w:document>`;
    const candidateXml = `<w:document xmlns:w="${W_NS}">${output}</w:document>`;
    expect(compareSourceProjectedFormattingFidelity(originalXml, revisedXml, candidateXml).score).toBe(1);
  });
});
