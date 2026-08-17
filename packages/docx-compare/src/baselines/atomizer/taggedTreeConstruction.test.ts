import { describe, expect } from 'vitest';
import { parseXml, validateBookmarkIntegrity, validateFieldStructure } from '@usejunior/docx-core';
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

function documentWithBody(bodyXml: string): Element {
  return parseXml(`<w:document xmlns:w="${W_NS}"><w:body>${bodyXml}</w:body></w:document>`).documentElement;
}

describe('complete tagged-tree construction', () => {
  test('constructs projection-isomorphic trees for insertion, deletion, and replacement', () => {
    const original = body(['A', 'B', 'C']);
    const revised = body(['A', 'new B', 'C', 'D']);
    const result = constructTaggedTree(original, revised);
    expect(verifyTaggedTree(original, revised, result.tree)).toEqual([]);
    expect(verifyGlobalEqualContentInvariant(result.tree, result.moves)).toEqual([]);
  });

  test('aligns similar paragraphs before constructing run-level replacements', () => {
    const original = body(['stable anchor', 'the agreement applies to old assets', 'final anchor']);
    const revised = body(['stable anchor', 'the agreement applies to revised assets and liabilities', 'final anchor']);
    const result = constructTaggedTree(original, revised);
    const paragraph = result.tree.children[1];
    expect(paragraph?.tag).toBe('both');
    expect(paragraph?.children.some((child) => child.tag === 'original')).toBe(true);
    expect(paragraph?.children.some((child) => child.tag === 'revised')).toBe(true);
    expect(verifyTaggedTree(original, revised, result.tree)).toEqual([]);
  });

  test('does not create property deltas for indentation-only XML whitespace', () => {
    const original = documentWithBody('<w:p><w:pPr>\n  <w:pStyle w:val="Heading3"/>\n</w:pPr><w:r><w:t>same</w:t></w:r></w:p>');
    const revised = documentWithBody('<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>same</w:t></w:r></w:p>');
    const result = constructTaggedTree(original, revised);
    const paragraph = result.tree.children[0];
    expect(paragraph?.tag === 'both' ? paragraph.propertyDelta : undefined).toBeUndefined();
    const output = serializeTaggedTree(result.tree, createPreservePlan(original, revised, result.tree, {
      author: 'Comparator', date: '2026-08-14T12:00:00Z',
    }));
    expect(output).not.toMatch(/<w:(?:ins|del)[^>]*>\s*<w:pPr[ >]/);
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

  test('serializes bookmarked moves with unique paired IDs in the combined candidate', () => {
    const paragraph = (value: string, bookmarked = false) => `<w:p>${
      bookmarked ? '<w:bookmarkStart w:id="7" w:name="Clause"/>' : ''
    }<w:r><w:t>${value}</w:t></w:r>${
      bookmarked ? '<w:bookmarkEnd w:id="7"/>' : ''
    }</w:p>`;
    const original = documentWithBody(paragraph('A') + paragraph('B', true));
    const revised = documentWithBody(paragraph('B', true) + paragraph('A'));
    const result = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(
      result.tree,
      createPreservePlan(original, revised, result.tree, {
        author: 'Comparator', date: '2026-08-14T12:00:00Z',
      }),
      { moves: result.moves },
    );
    const integrity = validateBookmarkIntegrity(output);

    expect(integrity).toEqual({
      unmatchedStartIds: [],
      unmatchedEndIds: [],
      duplicateStartIds: [],
      duplicateEndIds: [],
    });
    expect(resolvedText(acceptAllChanges(output))).toBe('BA');
    expect(resolvedText(rejectAllChanges(output))).toBe('AB');
    for (const projection of [acceptAllChanges(output), rejectAllChanges(output)]) {
      const document = parseXml(projection);
      expect(document.getElementsByTagNameNS(W_NS, 'bookmarkStart')).toHaveLength(1);
      expect(document.getElementsByTagNameNS(W_NS, 'bookmarkEnd')).toHaveLength(1);
      expect(document.getElementsByTagNameNS(W_NS, 'bookmarkStart')[0]!.getAttributeNS(W_NS, 'name')).toBe('Clause');
    }
  });

  test('keeps colliding source-side deletion bookmarks unique across both projections', () => {
    const paragraph = (value: string, name: string, column: string) => '<w:p>'
      + `<w:bookmarkStart w:id="7" w:name="${name}" w:colFirst="${column}" w:colLast="${column}"/>`
      + `<w:r><w:t>${value}</w:t></w:r>`
      + '<w:bookmarkEnd w:id="7"/></w:p>';
    const original = documentWithBody(paragraph('Old', 'Clause', '0'));
    const revised = documentWithBody(paragraph('New', 'Clause', '1'));
    const result = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(
      result.tree,
      createPreservePlan(original, revised, result.tree, {
        author: 'Comparator', date: '2026-08-14T12:00:00Z',
      }),
      { moves: result.moves },
    );

    for (const xml of [output, acceptAllChanges(output), rejectAllChanges(output)]) {
      expect(validateBookmarkIntegrity(xml)).toEqual({
        unmatchedStartIds: [],
        unmatchedEndIds: [],
        duplicateStartIds: [],
        duplicateEndIds: [],
      });
    }
    const accepted = parseXml(acceptAllChanges(output));
    const rejected = parseXml(rejectAllChanges(output));
    expect(accepted.getElementsByTagNameNS(W_NS, 'bookmarkStart')[0]!.getAttributeNS(W_NS, 'colFirst')).toBe('1');
    expect(rejected.getElementsByTagNameNS(W_NS, 'bookmarkStart')[0]!.getAttributeNS(W_NS, 'colFirst')).toBe('0');
  });

  test('projects changed semantic attributes instead of silently taking the revised representative', () => {
    const original = documentWithBody(
      '<w:p><w:fldSimple w:instr=" DATE "><w:r><w:t xml:space="preserve">value </w:t></w:r></w:fldSimple></w:p>',
    );
    const revised = documentWithBody(
      '<w:p><w:fldSimple w:instr=" TIME "><w:r><w:t>value </w:t></w:r></w:fldSimple></w:p>',
    );
    const result = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(
      result.tree,
      createPreservePlan(original, revised, result.tree, {
        author: 'Comparator', date: '2026-08-14T12:00:00Z',
      }),
      { moves: result.moves },
    );
    const accepted = parseXml(acceptAllChanges(output));
    const rejected = parseXml(rejectAllChanges(output));

    expect(accepted.getElementsByTagNameNS(W_NS, 'fldSimple')[0]!.getAttributeNS(W_NS, 'instr')).toBe(' TIME ');
    expect(rejected.getElementsByTagNameNS(W_NS, 'fldSimple')[0]!.getAttributeNS(W_NS, 'instr')).toBe(' DATE ');
    expect(accepted.getElementsByTagNameNS(W_NS, 't')[0]!.getAttribute('xml:space')).toBeNull();
    expect(rejected.getElementsByTagNameNS(W_NS, 't')[0]!.getAttribute('xml:space')).toBe('preserve');
  });

  test('projects an isolated xml:space change on otherwise equal text', () => {
    const original = documentWithBody('<w:p><w:r><w:t xml:space="preserve">same </w:t></w:r></w:p>');
    const revised = documentWithBody('<w:p><w:r><w:t>same </w:t></w:r></w:p>');
    const result = constructTaggedTree(original, revised);
    const output = serializeTaggedTree(
      result.tree,
      createPreservePlan(original, revised, result.tree, {
        author: 'Comparator', date: '2026-08-14T12:00:00Z',
      }),
      { moves: result.moves },
    );

    expect(parseXml(acceptAllChanges(output)).getElementsByTagNameNS(W_NS, 't')[0]!
      .getAttribute('xml:space')).toBeNull();
    expect(parseXml(rejectAllChanges(output)).getElementsByTagNameNS(W_NS, 't')[0]!
      .getAttribute('xml:space')).toBe('preserve');
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

  test('preserves field structure and both projections across the Stage A field matrix', () => {
    const run = (content: string) => `<w:r>${content}</w:r>`;
    const field = (instruction: string, result: string) =>
      run('<w:fldChar w:fldCharType="begin"/>') +
      run(`<w:instrText>${instruction}</w:instrText>`) +
      run('<w:fldChar w:fldCharType="separate"/>') +
      run(`<w:t>${result}</w:t>`) +
      run('<w:fldChar w:fldCharType="end"/>');
    const cases = [
      ['field-stable', `<w:p>${field('PAGE', '1')}</w:p>`, `<w:p>${field('PAGE', '1')}</w:p>`],
      ['field-modification', `<w:p>${field('PAGE', '1')}</w:p>`, `<w:p>${field('PAGE', '2')}</w:p>`],
      ['field-delete', `<w:p>${field('PAGE', '1')}<w:r><w:t>tail</w:t></w:r></w:p>`, '<w:p><w:r><w:t>tail</w:t></w:r></w:p>'],
      ['nested-field', `<w:p>${field('IF', 'old')}${field('PAGE', '1')}</w:p>`, `<w:p>${field('IF', 'new')}${field('PAGE', '1')}</w:p>`],
      ['paragraph-spanning-field', `<w:p>${run('<w:fldChar w:fldCharType="begin"/>')}${run('<w:instrText>REF x</w:instrText>')}</w:p><w:p>${run('<w:fldChar w:fldCharType="end"/>')}</w:p>`, `<w:p>${run('<w:fldChar w:fldCharType="begin"/>')}${run('<w:instrText>REF y</w:instrText>')}</w:p><w:p>${run('<w:fldChar w:fldCharType="end"/>')}</w:p>`],
    ] as const;
    for (const [name, originalBody, revisedBody] of cases) {
      const original = documentWithBody(originalBody);
      const revised = documentWithBody(revisedBody);
      const result = constructTaggedTree(original, revised);
      expect(verifyGlobalEqualContentInvariant(result.tree, result.moves), name).toEqual([]);
      const output = serializeTaggedTree(result.tree, createPreservePlan(original, revised, result.tree, {
        author: 'Comparator', date: '2026-08-14T12:00:00Z',
      }), { moves: result.moves });
      expect(validateFieldStructure(acceptAllChanges(output)), `${name} accept`).toBe(true);
      expect(validateFieldStructure(rejectAllChanges(output)), `${name} reject`).toBe(true);
    }
  });
});
