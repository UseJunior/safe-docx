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
import { extractRoundTripComparisonText } from '../../fieldComparisonSemantics.js';

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

  test('splits a shared bookmark endpoint when its cross-paragraph partner moves', () => {
    const original = documentBody(
      '<w:p><w:bookmarkStart w:id="7" w:name="Clause"/><w:r><w:t>A</w:t></w:r></w:p>' +
      '<w:bookmarkEnd w:id="7"/>',
    );
    const revised = documentBody(
      '<w:p><w:bookmarkStart w:id="7" w:name="Clause"/><w:r><w:t>A</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>B</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p>',
    );
    const originalParagraph = elementChildren(original)[0]!;
    const revisedParagraph = elementChildren(revised)[0]!;
    const originalStart = originalParagraph.getElementsByTagNameNS(W_NS, 'bookmarkStart')[0]!;
    const revisedStart = revisedParagraph.getElementsByTagNameNS(W_NS, 'bookmarkStart')[0]!;
    const tree: BothNode = {
      tag: 'both', original, revised, children: [
        {
          tag: 'both', original: originalParagraph, revised: revisedParagraph, children: [
            { tag: 'both', original: originalStart, revised: revisedStart, children: [], opaque: true },
            {
              tag: 'both',
              original: originalParagraph.getElementsByTagNameNS(W_NS, 'r')[0]!,
              revised: revisedParagraph.getElementsByTagNameNS(W_NS, 'r')[0]!,
              children: [], opaque: true,
            },
          ],
        },
        { tag: 'original', node: elementChildren(original)[1]!, children: [], opaque: true },
        { tag: 'revised', node: elementChildren(revised)[1]!, children: [], opaque: true },
      ],
    };
    const serialized = serializeTaggedTree(tree, createPreservePlan(original, revised, tree, {
      author: 'Comparator', date: '2026-08-14T12:00:00Z',
    }));
    const inventory = (xml: string): { starts: string[]; ends: string[] } => {
      const document = parseXml(xml);
      return {
        starts: Array.from(document.getElementsByTagNameNS(W_NS, 'bookmarkStart'))
          .map((marker) => marker.getAttributeNS(W_NS, 'id')!),
        ends: Array.from(document.getElementsByTagNameNS(W_NS, 'bookmarkEnd'))
          .map((marker) => marker.getAttributeNS(W_NS, 'id')!),
      };
    };
    for (const projection of [serialized, acceptAllChanges(serialized), rejectAllChanges(serialized)]) {
      const { starts, ends } = inventory(projection);
      expect(new Set(starts).size).toBe(starts.length);
      expect(new Set(ends).size).toBe(ends.length);
      expect([...starts].sort()).toEqual([...ends].sort());
    }
    expect(text(acceptAllChanges(serialized))).toBe('AB');
    expect(text(rejectAllChanges(serialized))).toBe('A');
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

  test('places a terminal paragraph deletion on the preceding break with exact projections', () => {
    const original = documentBody(
      '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>Alpha</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Bravo</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Charlie</w:t></w:r></w:p>',
    );
    const revised = documentBody(
      '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>Alpha</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Bravo</w:t></w:r></w:p>',
    );
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(original, revised, constructed.tree, {
      author: 'Comparator', date: '2026-08-17T00:00:00Z',
    }));
    const parsed = parseXml(output);
    const paragraphs = Array.from(parsed.getElementsByTagNameNS(W_NS, 'p'));

    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[1]!.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(1);
    expect(paragraphs[2]!.getElementsByTagNameNS(W_NS, 'pPrChange')).toHaveLength(1);
    const generatedIds = Array.from(
      output.matchAll(/<w:(?:del|pPrChange)\b[^>]*w:id="(\d+)"/gu),
      (match) => Number(match[1]),
    );
    expect(generatedIds).toEqual([...generatedIds].sort((left, right) => left - right));
    const originalXml = `<w:document xmlns:w="${W_NS}">${new XMLSerializer().serializeToString(original)}</w:document>`;
    const revisedXml = `<w:document xmlns:w="${W_NS}">${new XMLSerializer().serializeToString(revised)}</w:document>`;
    const candidateXml = `<w:document xmlns:w="${W_NS}">${output}</w:document>`;
    expect(compareSourceProjectedFormattingFidelity(originalXml, revisedXml, candidateXml).score).toBe(1);
    expect(text(acceptAllChanges(candidateXml))).toBe('AlphaBravo');
    expect(text(rejectAllChanges(candidateXml))).toBe('AlphaBravoCharlie');
  });

  test('orders a relocated paragraph deletion before paragraph-mark formatting', () => {
    const markProperties = '<w:rPr><w:b/></w:rPr>';
    const original = documentBody(
      `<w:p><w:pPr>${markProperties}</w:pPr><w:r><w:t>Keep</w:t></w:r></w:p>` +
      '<w:p><w:r><w:t>Delete</w:t></w:r></w:p>',
    );
    const revised = documentBody(`<w:p><w:pPr>${markProperties}</w:pPr><w:r><w:t>Keep</w:t></w:r></w:p>`);
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(original, revised, constructed.tree, {
      author: 'Comparator', date: '2026-08-17T00:00:00Z',
    }));
    const predecessorRPr = parseXml(output).getElementsByTagNameNS(W_NS, 'p')[0]!
      .getElementsByTagNameNS(W_NS, 'rPr')[0]!;

    expect(elementChildren(predecessorRPr).map((child) => child.localName)).toEqual(['del', 'b']);
  });

  test('does not rewrite a predecessor carrying prior paragraph-mark revisions', () => {
    const markProperties = '<w:rPr><w:b/><w:rPrChange w:id="2" w:author="Prior" w:date="2026-08-01T00:00:00Z"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr>';
    const original = documentBody(
      `<w:p><w:pPr>${markProperties}</w:pPr><w:r><w:t>Keep</w:t></w:r></w:p>` +
      '<w:p><w:r><w:t>Delete</w:t></w:r></w:p>',
    );
    const revised = documentBody(`<w:p><w:pPr>${markProperties}</w:pPr><w:r><w:t>Keep</w:t></w:r></w:p>`);
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(original, revised, constructed.tree, {
      author: 'Comparator', date: '2026-08-17T00:00:00Z',
    }));
    const paragraphs = Array.from(parseXml(output).getElementsByTagNameNS(W_NS, 'p'));

    expect(paragraphs[0]!.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(0);
    expect(paragraphs[1]!.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(2);
  });

  test('allocates generated IDs above every authored revision vocabulary element', () => {
    const table = '<w:tbl><w:tblPr><w:tblPrChange w:id="0" w:author="Prior"><w:tblPr/></w:tblPrChange></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>T</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const original = documentBody(`${table}<w:p><w:r><w:t>old</w:t></w:r></w:p>`);
    const revised = documentBody(`${table}<w:p><w:r><w:t>new</w:t></w:r></w:p>`);
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(original, revised, constructed.tree, {
      author: 'Comparator', date: '2026-08-17T00:00:00Z',
    }));
    const ids = Array.from(output.matchAll(/w:id="(\d+)"/gu), (match) => Number(match[1]));

    expect(ids[0]).toBe(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(1).every((id) => id > 0)).toBe(true);
  });

  test('keeps exact projections for middle, consecutive, ranged, and section-bearing deletions', () => {
    const cases = [
      {
        original: '<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r></w:p><w:p><w:r><w:t>C</w:t></w:r></w:p>',
        revised: '<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>C</w:t></w:r></w:p>',
      },
      {
        original: '<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r></w:p><w:p><w:r><w:t>C</w:t></w:r></w:p><w:p><w:r><w:t>D</w:t></w:r></w:p>',
        revised: '<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r></w:p>',
      },
      {
        original: '<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:bookmarkStart w:id="7" w:name="Deleted"/><w:r><w:t>B</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p><w:p><w:r><w:t>C</w:t></w:r></w:p>',
        revised: '<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>C</w:t></w:r></w:p>',
      },
      {
        original: '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="right"/><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr><w:r><w:t>B</w:t></w:r></w:p>',
        revised: '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p>',
      },
    ];

    for (const fixture of cases) {
      const original = documentBody(fixture.original);
      const revised = documentBody(fixture.revised);
      const constructed = constructTaggedTree(original, revised);
      const output = serializeTaggedTree(constructed.tree, createPreservePlan(original, revised, constructed.tree, {
        author: 'Comparator', date: '2026-08-17T00:00:00Z',
      }));
      const originalXml = `<w:document xmlns:w="${W_NS}">${new XMLSerializer().serializeToString(original)}</w:document>`;
      const revisedXml = `<w:document xmlns:w="${W_NS}">${new XMLSerializer().serializeToString(revised)}</w:document>`;
      const candidateXml = `<w:document xmlns:w="${W_NS}">${output}</w:document>`;
      expect(compareSourceProjectedFormattingFidelity(originalXml, revisedXml, candidateXml).score).toBe(1);
    }
  });

  test('serializes paragraph property families only through conforming property changes', () => {
    const original = documentBody(
      '<w:p><w:pPr><w:pStyle w:val="Old"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="4"/></w:numPr>' +
      '<w:spacing w:before="120"/><w:ind w:left="240"/><w:jc w:val="left"/>' +
      '<w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs><w:rPr><w:b/></w:rPr></w:pPr>' +
      '<w:r><w:t>same</w:t></w:r></w:p>',
    );
    const revised = documentBody(
      '<w:p><w:pPr><w:pStyle w:val="New"/><w:spacing w:after="240"/><w:ind w:right="360"/>' +
      '<w:jc w:val="right"/><w:tabs><w:tab w:val="right" w:pos="1440"/></w:tabs>' +
      '<w:rPr><w:i/></w:rPr></w:pPr><w:r><w:t>same</w:t></w:r></w:p>',
    );
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(original, revised, constructed.tree, {
      author: 'Comparator', date: '2026-08-14T12:00:00Z',
    }));
    const parsed = parseXml(output);
    const pPrChange = parsed.getElementsByTagNameNS(W_NS, 'pPrChange')[0]!;
    const snapshot = Array.from(pPrChange.childNodes).find((node): node is Element =>
      node.nodeType === 1 && (node as Element).localName === 'pPr')!;

    expect(output).not.toMatch(/<w:(?:ins|del)[^>]*>\s*<w:pPr[ >]/);
    expect(snapshot.getElementsByTagNameNS(W_NS, 'rPr')).toHaveLength(0);
    expect(parsed.getElementsByTagNameNS(W_NS, 'rPrChange')).toHaveLength(1);
    const originalXml = `<w:document xmlns:w="${W_NS}">${new XMLSerializer().serializeToString(original)}</w:document>`;
    const revisedXml = `<w:document xmlns:w="${W_NS}">${new XMLSerializer().serializeToString(revised)}</w:document>`;
    const candidateXml = `<w:document xmlns:w="${W_NS}">${output}</w:document>`;
    const fidelity = compareSourceProjectedFormattingFidelity(originalXml, revisedXml, candidateXml);
    expect(fidelity.accept.score).toBe(1);
    expect(fidelity.reject.score).toBe(1);
  });

  for (const scenario of [
    {
      name: 'addition',
      originalRow: '',
      revisedRow: '<w:trPr><w:tblHeader/></w:trPr>',
      originalCell: '',
      revisedCell: '<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>',
    },
    {
      name: 'removal',
      originalRow: '<w:trPr><w:cantSplit/></w:trPr>',
      revisedRow: '',
      originalCell: '<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>',
      revisedCell: '',
    },
    {
      name: 'replacement',
      originalRow: '<w:trPr><w:cantSplit/></w:trPr>',
      revisedRow: '<w:trPr><w:tblHeader/></w:trPr>',
      originalCell: '<w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>',
      revisedCell: '<w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>',
    },
  ]) {
    test(`serializes table row/cell property ${scenario.name} with exact source projections`, () => {
      const table = (row: string, cell: string) =>
        `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>` +
        `<w:tr>${row}<w:tc>${cell}<w:p><w:r><w:t>same</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
      const original = documentBody(table(scenario.originalRow, scenario.originalCell));
      const revised = documentBody(table(scenario.revisedRow, scenario.revisedCell));
      const constructed = constructTaggedTree(original, revised);
      const output = serializeTaggedTree(
        constructed.tree,
        createPreservePlan(original, revised, constructed.tree, {
          author: 'Comparator', date: '2026-08-14T12:00:00Z',
        }),
      );
      const parsed = parseXml(output);

      expect(parsed.getElementsByTagNameNS(W_NS, 'trPrChange')).toHaveLength(1);
      expect(parsed.getElementsByTagNameNS(W_NS, 'tcPrChange')).toHaveLength(1);
      for (const [changeName, snapshotName] of [
        ['trPrChange', 'trPr'],
        ['tcPrChange', 'tcPr'],
      ] as const) {
        const change = parsed.getElementsByTagNameNS(W_NS, changeName)[0]!;
        expect(elementChildren(change).map((child) => child.localName)).toContain(snapshotName);
      }

      const originalXml = `<w:document xmlns:w="${W_NS}">${new XMLSerializer().serializeToString(original)}</w:document>`;
      const revisedXml = `<w:document xmlns:w="${W_NS}">${new XMLSerializer().serializeToString(revised)}</w:document>`;
      const candidateXml = `<w:document xmlns:w="${W_NS}">${output}</w:document>`;
      const fidelity = compareSourceProjectedFormattingFidelity(originalXml, revisedXml, candidateXml);
      expect(fidelity.accept.score).toBe(1);
      expect(fidelity.reject.score).toBe(1);
    });
  }

  test('aligns common words across changed run boundaries and coalesces each change hunk', () => {
    const original = documentBody('<w:p><w:r><w:t>Agreement of Limited Partnership</w:t></w:r></w:p>');
    const revised = documentBody(
      '<w:p><w:r><w:t>Agreement </w:t></w:r><w:r><w:t>of Limited Liability Partnership</w:t></w:r></w:p>',
    );
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(original, revised, constructed.tree, {
      author: 'Comparator', date: '2026-08-14T12:00:00Z',
    }));

    expect(output).toContain('Agreement ');
    expect(output).not.toMatch(/<w:del[^>]*>[\s\S]*Agreement[\s\S]*<\/w:del>/);
    expect(output).toMatch(/<w:ins[^>]*>[\s\S]*Liability[\s\S]*<\/w:ins>/);
    expect(parseXml(output).getElementsByTagNameNS(W_NS, 'del')).toHaveLength(0);
    expect(text(acceptAllChanges(output))).toBe('Agreement of Limited Liability Partnership');
    expect(text(rejectAllChanges(output))).toBe('Agreement of Limited Partnership');
  });

  test('represents identical text with changed run boundaries as formatting-only markup', () => {
    const original = documentBody('<w:p><w:r><w:t>such </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>party to the Fund;</w:t></w:r></w:p>');
    const revised = documentBody('<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>such party</w:t></w:r><w:r><w:t> to the Fund;</w:t></w:r></w:p>');
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(original, revised, constructed.tree, {
      author: 'Comparator', date: '2026-08-14T12:00:00Z',
    }));

    expect(output).not.toMatch(/<w:(?:ins|del)\b/);
    expect(parseXml(output).getElementsByTagNameNS(W_NS, 'rPrChange').length).toBeGreaterThan(0);
    expect(text(acceptAllChanges(output))).toBe('such party to the Fund;');
    expect(text(rejectAllChanges(output))).toBe('such party to the Fund;');
  });

  test('aligns a common token split inside different run boundaries', () => {
    const original = documentBody('<w:p><w:r><w:t>Agre</w:t></w:r><w:r><w:t>ement of Limited</w:t></w:r></w:p>');
    const revised = documentBody('<w:p><w:r><w:t>Agreement </w:t></w:r><w:r><w:t>of Expanded Limited</w:t></w:r></w:p>');
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(original, revised, constructed.tree, {
      author: 'Comparator', date: '2026-08-14T12:00:00Z',
    }));

    expect(output).not.toMatch(/<w:del[^>]*>[\s\S]*Agreement[\s\S]*<\/w:del>/);
    expect(text(acceptAllChanges(output))).toBe('Agreement of Expanded Limited');
    expect(text(rejectAllChanges(output))).toBe('Agreement of Limited');
  });

  test('never multiplies a field character while refining nearby text', () => {
    const original = documentBody('<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:t>alpha beta</w:t></w:r><w:r><w:t> tail</w:t></w:r></w:p>');
    const revised = documentBody('<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:t>alpha theta</w:t></w:r><w:r><w:t> tail</w:t></w:r></w:p>');
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(original, revised, constructed.tree, {
      author: 'Comparator', date: '2026-08-14T12:00:00Z',
    }));

    expect(parseXml(output).getElementsByTagNameNS(W_NS, 'fldChar')).toHaveLength(1);
  });

  test('keeps a literal replacement outside a deleted REF instruction zone', () => {
    const original = documentBody(
      '<w:p><w:r><w:t>Section </w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> REF _Ref1 \\r \\h </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>5.1</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:r><w:t xml:space="preserve"> (Heading)</w:t></w:r></w:p>',
    );
    const revised = documentBody(
      '<w:p><w:r><w:t xml:space="preserve">Section 5.1 </w:t></w:r>' +
      '<w:r><w:t>(</w:t></w:r><w:r><w:t>Heading)</w:t></w:r></w:p>',
    );
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(
      constructed.tree,
      createPreservePlan(original, revised, constructed.tree, {
        author: 'Comparator', date: '2026-08-14T12:00:00Z',
      }),
    );
    const document = parseXml(output);
    const paragraph = document.getElementsByTagNameNS(W_NS, 'p')[0]!;
    const siblings = elementChildren(paragraph);
    const beginIndex = siblings.findIndex((node) =>
      Array.from(node.getElementsByTagNameNS(W_NS, 'fldChar')).some((field) =>
        field.getAttributeNS(W_NS, 'fldCharType') === 'begin'),
    );
    const separateIndex = siblings.findIndex((node) =>
      Array.from(node.getElementsByTagNameNS(W_NS, 'fldChar')).some((field) =>
        field.getAttributeNS(W_NS, 'fldCharType') === 'separate'),
    );
    const instructionZone = siblings.slice(beginIndex + 1, separateIndex);
    expect(instructionZone.some((node) =>
      node.localName === 'ins' && node.textContent === '('),
    ).toBe(false);
    expect(extractRoundTripComparisonText(acceptAllChanges(output))).toBe('Section 5.1 (Heading)');
    expect(extractRoundTripComparisonText(rejectAllChanges(output))).toBe('Section 5.1 (Heading)');
  });

  test('serializes a retargeted REF as complete deleted and inserted fields', () => {
    const field = (target: string, result: string) =>
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      `<w:r><w:instrText xml:space="preserve"> REF ${target} \\r \\h </w:instrText></w:r>` +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      `<w:r><w:t>${result}</w:t></w:r>` +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    const original = documentBody(field('_RefOld', '14.7.3'));
    const revised = documentBody(field('_RefNew', '14.7.2'));
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(
      original, revised, constructed.tree,
      { author: 'Comparator', date: '2026-08-14T12:00:00Z' },
    ));
    const document = parseXml(output);
    const deletedFields = Array.from(document.getElementsByTagNameNS(W_NS, 'del')).filter((wrapper) =>
      wrapper.getElementsByTagNameNS(W_NS, 'fldChar').length > 0);
    const insertedFields = Array.from(document.getElementsByTagNameNS(W_NS, 'ins')).filter((wrapper) =>
      wrapper.getElementsByTagNameNS(W_NS, 'fldChar').length > 0);
    expect(deletedFields).toHaveLength(1);
    expect(insertedFields).toHaveLength(1);
    expect(elementChildren(deletedFields[0]!)).toHaveLength(5);
    expect(elementChildren(insertedFields[0]!)).toHaveLength(5);
    for (const type of ['begin', 'separate', 'end']) {
      const fields = Array.from(document.getElementsByTagNameNS(W_NS, 'fldChar')).filter((field) =>
        field.getAttributeNS(W_NS, 'fldCharType') === type);
      expect(fields, `${type} count`).toHaveLength(2);
      expect(fields.map((field) => (field.parentNode?.parentNode as Element).localName).sort()).toEqual(['del', 'ins']);
    }
    const accepted = acceptAllChanges(output);
    const rejected = rejectAllChanges(output);
    expect(extractRoundTripComparisonText(accepted)).toBe('14.7.2');
    expect(extractRoundTripComparisonText(rejected)).toBe('14.7.3');
    const instructionTexts = (xml: string): string[] => Array.from(
      parseXml(xml).getElementsByTagNameNS(W_NS, 'instrText'),
      (instruction) => instruction.textContent ?? '',
    );
    expect(instructionTexts(accepted)).toEqual([' REF _RefNew \\r \\h ']);
    expect(instructionTexts(rejected)).toEqual([' REF _RefOld \\r \\h ']);
  });

  test('serializes split-instruction retargets as complete fields', () => {
    const field = (target: string, result: string) =>
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      `<w:r><w:instrText xml:space="preserve"> REF ${target}</w:instrText></w:r>` +
      '<w:r><w:instrText xml:space="preserve"> \\r \\h </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      `<w:r><w:t>${result}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
    const original = documentBody(field('_RefOld', '14.7.3'));
    const revised = documentBody(field('_RefNew', '14.7.2'));
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(
      original, revised, constructed.tree,
      { author: 'Comparator', date: '2026-08-14T12:00:00Z' },
    ));
    const document = parseXml(output);
    const deleted = Array.from(document.getElementsByTagNameNS(W_NS, 'del')).filter((wrapper) =>
      wrapper.getElementsByTagNameNS(W_NS, 'fldChar').length > 0);
    const inserted = Array.from(document.getElementsByTagNameNS(W_NS, 'ins')).filter((wrapper) =>
      wrapper.getElementsByTagNameNS(W_NS, 'fldChar').length > 0);
    expect(deleted).toHaveLength(1);
    expect(inserted).toHaveLength(1);
    const accepted = acceptAllChanges(output);
    const rejected = rejectAllChanges(output);
    expect(extractRoundTripComparisonText(accepted)).toBe('14.7.2');
    expect(extractRoundTripComparisonText(rejected)).toBe('14.7.3');
    const instructions = (xml: string): string => Array.from(
      parseXml(xml).getElementsByTagNameNS(W_NS, 'instrText'),
      (instruction) => instruction.textContent ?? '',
    ).join('');
    expect(instructions(accepted)).toBe(' REF _RefNew \\r \\h ');
    expect(instructions(rejected)).toBe(' REF _RefOld \\r \\h ');
  });

  test('wraps an added complete field in one insertion', () => {
    const original = documentBody('<w:p/>');
    const revised = documentBody(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> REF _RefNew \\r \\h </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>14.3.2</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    );
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(
      original, revised, constructed.tree,
      { author: 'Comparator', date: '2026-08-14T12:00:00Z' },
    ));
    const insertions = Array.from(parseXml(output).getElementsByTagNameNS(W_NS, 'ins')).filter((wrapper) =>
      wrapper.getElementsByTagNameNS(W_NS, 'fldChar').length > 0);
    expect(insertions).toHaveLength(1);
    expect(elementChildren(insertions[0]!)).toHaveLength(5);
    expect(extractRoundTripComparisonText(acceptAllChanges(output))).toBe('14.3.2');
    expect(extractRoundTripComparisonText(rejectAllChanges(output))).toBe('');
  });

  test('does not interleave one original field with multiple revised fields', () => {
    const field = (target: string, result: string) =>
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      `<w:r><w:instrText> REF ${target} \\r \\h </w:instrText></w:r>` +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      `<w:r><w:t>${result}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const original = documentBody(`<w:p>${field('_RefOld', '14.3')}<w:r><w:t> over</w:t></w:r></w:p>`);
    const revised = documentBody(`<w:p>${field('_RefA', '14.3.2')}<w:r><w:t> and </w:t></w:r>${field('_RefB', '14.3.3')}</w:p>`);
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(
      original, revised, constructed.tree,
      { author: 'Comparator', date: '2026-08-14T12:00:00Z' },
    ));
    const document = parseXml(output);
    const fieldWrappers = (kind: 'del' | 'ins') => Array.from(
      document.getElementsByTagNameNS(W_NS, kind),
    ).filter((wrapper) => wrapper.getElementsByTagNameNS(W_NS, 'fldChar').length > 0);
    expect(fieldWrappers('del')).toHaveLength(1);
    expect(fieldWrappers('ins')).toHaveLength(2);
    expect(Array.from(document.getElementsByTagNameNS(W_NS, 'fldChar')).every((field) =>
      ['del', 'ins'].includes((field.parentNode?.parentNode as Element).localName))).toBe(true);
    expect(extractRoundTripComparisonText(acceptAllChanges(output))).toBe('14.3.2 and 14.3.3');
    expect(extractRoundTripComparisonText(rejectAllChanges(output))).toBe('14.3 over');
  });

  test('does not wrap a volatile rendered-page-break marker inside a run revision', () => {
    const textValue = 'repay indebtedness and satisfy liabilities of the Fund.';
    const original = documentBody(`<w:p><w:r><w:t>${textValue}</w:t></w:r></w:p>`);
    const revised = documentBody(`<w:p><w:r><w:lastRenderedPageBreak/><w:t>${textValue}</w:t></w:r></w:p>`);
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(
      original, revised, constructed.tree,
      { author: 'Comparator', date: '2026-08-14T12:00:00Z' },
    ));
    const document = parseXml(output);
    const marker = document.getElementsByTagNameNS(W_NS, 'lastRenderedPageBreak')[0]!;
    expect((marker.parentNode as Element).localName).toBe('r');
    expect(document.getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(0);
    expect(extractRoundTripComparisonText(acceptAllChanges(output))).toBe(textValue);
    expect(extractRoundTripComparisonText(rejectAllChanges(output))).toBe(textValue);
  });

  test('keeps deleted-paragraph bookmark boundaries around the tracked text', () => {
    const original = documentBody(
      '<w:p><w:bookmarkStart w:id="7" w:name="Clause"/>' +
      '<w:r><w:t>Deleted clause</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p>',
    );
    const revised = documentBody('');
    const constructed = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(constructed.tree, createPreservePlan(
      original, revised, constructed.tree,
      { author: 'Comparator', date: '2026-08-14T12:00:00Z' },
    ));
    const document = parseXml(output);
    const start = document.getElementsByTagNameNS(W_NS, 'bookmarkStart')[0]!;
    const end = document.getElementsByTagNameNS(W_NS, 'bookmarkEnd')[0]!;
    expect((start.parentNode as Element).localName).toBe('p');
    expect(end.parentNode).toBe(start.parentNode);
    expect(document.getElementsByTagNameNS(W_NS, 'delText')).toHaveLength(1);
    const accepted = acceptAllChanges(output);
    const rejected = rejectAllChanges(output);
    expect(extractRoundTripComparisonText(accepted)).toBe('');
    expect(parseXml(accepted).getElementsByTagNameNS(W_NS, 'bookmarkStart')).toHaveLength(0);
    expect(parseXml(accepted).getElementsByTagNameNS(W_NS, 'bookmarkEnd')).toHaveLength(0);
    expect(extractRoundTripComparisonText(rejected)).toBe('Deleted clause');
    expect(parseXml(rejected).getElementsByTagNameNS(W_NS, 'bookmarkStart')).toHaveLength(1);
    expect(parseXml(rejected).getElementsByTagNameNS(W_NS, 'bookmarkEnd')).toHaveLength(1);
  });

  test('serializes whole-row changes as row-property markers', () => {
    const row = '<w:tr><w:tc><w:p><w:r><w:t>Row</w:t></w:r></w:p></w:tc></w:tr>';
    for (const [originalXml, revisedXml, kind] of [
      [`<w:tbl>${row}</w:tbl>`, '<w:tbl/>', 'del'],
      ['<w:tbl/>', `<w:tbl>${row}</w:tbl>`, 'ins'],
    ] as const) {
      const original = documentBody(originalXml);
      const revised = documentBody(revisedXml);
      const constructed = constructTaggedTree(original, revised);
      const output = serializeTaggedTree(constructed.tree, createPreservePlan(
        original, revised, constructed.tree,
        { author: 'Comparator', date: '2026-08-14T12:00:00Z' },
      ));
      const document = parseXml(output);
      const marker = document.getElementsByTagNameNS(W_NS, kind)[0]!;
      expect((marker.parentNode as Element).localName).toBe('trPr');
      expect((marker.parentNode?.parentNode as Element).localName).toBe('tr');
      expect(Array.from(document.getElementsByTagNameNS(W_NS, kind)).some((wrapper) =>
        wrapper.getElementsByTagNameNS(W_NS, 'tr').length > 0)).toBe(false);
      expect(extractRoundTripComparisonText(acceptAllChanges(output))).toBe(kind === 'ins' ? 'Row' : '');
      expect(extractRoundTripComparisonText(rejectAllChanges(output))).toBe(kind === 'del' ? 'Row' : '');
    }
  });
});
