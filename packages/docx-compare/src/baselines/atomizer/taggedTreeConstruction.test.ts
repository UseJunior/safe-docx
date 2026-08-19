import { describe, expect } from 'vitest';
import { parseXml, validateBookmarkIntegrity, validateFieldStructure } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { verifyMoveRelations, verifyTaggedTree } from './taggedTree.js';
import {
  constructTaggedTree,
  globallyPairCandidates,
  verifyGlobalEqualContentInvariant,
} from './taggedTreeConstruction.js';
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

function serializedReorderedMove(): string {
  const original = body(['A', 'B']);
  const revised = body(['B', 'A']);
  const result = constructTaggedTree(original, revised);
  return serializeTaggedTree(
    result.tree,
    createPreservePlan(original, revised, result.tree, {
      author: 'Comparator', date: '2026-08-14T12:00:00Z',
    }),
    { moves: result.moves },
  );
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
        expect(result.tree.children.some((child) => child.tag === 'both')).toBe(true);
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

  test.openspec('Exact move matching precedes fuzzy matching')(
    'binds an exact relocation before assigning a similar residual relocation',
    () => {
      const original = body([
        'Stable opening anchor remains unchanged.',
        'Exact moved clause remains stable and intact.',
        'Supplier shall deliver quarterly reports to buyer promptly.',
        'Stable closing anchor remains unchanged.',
      ]);
      const revised = body([
        'Stable opening anchor remains unchanged.',
        'Stable closing anchor remains unchanged.',
        'Exact moved clause remains stable and intact.',
        'Supplier shall deliver all quarterly reports to buyer promptly.',
      ]);
      const result = constructTaggedTree(original, revised, {
        moveSimilarityThreshold: 0.8,
        moveMinimumWordCount: 5,
      });
      expect(result.moves).toHaveLength(2);
      expect(result.moves[0]?.source.node.textContent).toBe(
        'Exact moved clause remains stable and intact.',
      );
      expect(result.moves[0]?.destination.node.textContent).toBe(
        'Exact moved clause remains stable and intact.',
      );
      expect(result.moves[1]?.source.node.textContent).toContain('quarterly reports');
      expect(result.moves[1]?.destination.node.textContent).toContain('all quarterly reports');
      const output = serializeTaggedTree(
        result.tree,
        createPreservePlan(original, revised, result.tree, {
          author: 'Comparator', date: '2026-08-17T12:00:00Z',
        }),
        { moves: result.moves },
      );
      expect(verifySerializedMoveRanges(output, result.moves)).toEqual([]);
      expect(resolvedText(rejectAllChanges(output))).toBe(original.textContent);
      expect(resolvedText(acceptAllChanges(output))).toBe(revised.textContent);
    },
  );

  test.openspec('Residual matching is globally deterministic')(
    'chooses the maximum-weight assignment instead of consuming the first local best match',
    () => {
      expect(globallyPairCandidates([
        [0.9, 0.8],
        [0.85, undefined],
      ])).toEqual([
        [0, 1],
        [1, 0],
      ]);
      expect(globallyPairCandidates([
        [0.8, 0.8],
        [0.8, 0.8],
      ])).toEqual(globallyPairCandidates([
        [0.8, 0.8],
        [0.8, 0.8],
      ]));
    },
  );

  test.openspec('Paired paragraph representatives are not moves')(
    'keeps a similar in-place paragraph rewrite as ordinary insertion and deletion ranges',
    () => {
      const original = body(['The supplier delivers detailed monthly reports to the purchaser.']);
      const revised = body(['The supplier delivers detailed quarterly reports to the purchaser.']);
      const result = constructTaggedTree(original, revised, {
        moveSimilarityThreshold: 0.1,
        moveMinimumWordCount: 1,
      });
      expect(result.tree.children[0]?.tag).toBe('both');
      expect(result.moves).toEqual([]);
    },
  );

  test('honors fuzzy move threshold, minimum word count, and case behavior', () => {
    const original = body([
      'Opening anchor remains unchanged.',
      'ALPHA BETA GAMMA DELTA EPSILON',
      'Closing anchor remains unchanged.',
    ]);
    const revised = body([
      'Opening anchor remains unchanged.',
      'Closing anchor remains unchanged.',
      'alpha beta gamma delta epsilon zeta',
    ]);
    expect(constructTaggedTree(original, revised, {
      moveSimilarityThreshold: 0.8,
      moveMinimumWordCount: 5,
      caseInsensitiveMove: true,
    }).moves).toHaveLength(1);
    expect(constructTaggedTree(original, revised, {
      moveSimilarityThreshold: 0.8,
      moveMinimumWordCount: 5,
      caseInsensitiveMove: false,
    }).moves).toHaveLength(0);
    expect(constructTaggedTree(original, revised, {
      moveSimilarityThreshold: 0.8,
      moveMinimumWordCount: 7,
      caseInsensitiveMove: true,
    }).moves).toHaveLength(0);
  });

  test('pairs only outermost overlapping candidates and remains stable for repeated similar blocks', () => {
    const nested = (text: string) => '<w:sdt><w:sdtContent>'
      + `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
      + '</w:sdtContent></w:sdt>';
    const originalNested = parseXml(`<w:body xmlns:w="${W_NS}">`
      + nested('Nested moved clause has enough stable words here')
      + '<w:p><w:r><w:t>Stable closing anchor</w:t></w:r></w:p></w:body>').documentElement;
    const revisedNested = parseXml(`<w:body xmlns:w="${W_NS}">`
      + '<w:p><w:r><w:t>Stable closing anchor</w:t></w:r></w:p>'
      + nested('Nested moved clause has enough stable words now')
      + '</w:body>');
    const nestedResult = constructTaggedTree(originalNested, revisedNested.documentElement, {
      moveMinimumWordCount: 5,
      moveSimilarityThreshold: 0.7,
    });
    expect(nestedResult.moves).toHaveLength(1);
    expect(nestedResult.moves[0]?.source.node.localName).toBe('sdt');
    expect(nestedResult.moves[0]?.destination.node.localName).toBe('sdt');

    const repeatedOriginalXml = [
      'Opening anchor remains unchanged.',
      'Alpha beta gamma delta first repeated clause.',
      'Alpha beta gamma delta second repeated clause.',
      'Closing anchor remains unchanged.',
    ];
    const repeatedRevisedXml = [
      'Opening anchor remains unchanged.',
      'Closing anchor remains unchanged.',
      'Alpha beta gamma delta first revised clause.',
      'Alpha beta gamma delta second revised clause.',
    ];
    const summarize = () => constructTaggedTree(
      body(repeatedOriginalXml),
      body(repeatedRevisedXml),
      { moveMinimumWordCount: 5, moveSimilarityThreshold: 0.7 },
    ).moves.map((move) => ({
      source: move.source.node.textContent,
      destination: move.destination.node.textContent,
      name: move.name,
      sourceRangeId: move.sourceRangeId,
      destinationRangeId: move.destinationRangeId,
    }));
    expect(summarize()).toEqual(summarize());
    expect(summarize()).toHaveLength(2);
  });

  test('excludes fields, ranges, tables, text boxes, notes, and preserved moves from fuzzy pairing', () => {
    const movedStory = (unsafe: string): [Element, Element] => [
      parseXml(`<w:body xmlns:w="${W_NS}">${unsafe}`
        + '<w:p><w:r><w:t>Stable closing anchor</w:t></w:r></w:p></w:body>').documentElement,
      parseXml(`<w:body xmlns:w="${W_NS}">`
        + '<w:p><w:r><w:t>Stable closing anchor</w:t></w:r></w:p>'
        + `${unsafe.replace('original', 'revised')}</w:body>`).documentElement,
    ];
    const cases: Array<[string, string]> = [
      ['field', '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>original field words here</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'],
      ['range', '<w:p><w:moveFromRangeStart w:id="8" w:name="prior"/><w:r><w:t>original range words remain here</w:t></w:r><w:moveFromRangeEnd w:id="8"/></w:p>'],
      ['table', '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>original table words remain here</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'],
      ['text box', '<w:p><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>original text box words remain here</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p>'],
      ['preserved move', '<w:p><w:moveFrom w:id="9" w:author="Prior"><w:r><w:t>original preserved move words here</w:t></w:r></w:moveFrom></w:p>'],
    ];
    for (const [name, unsafe] of cases) {
      const [original, revised] = movedStory(unsafe);
      expect(constructTaggedTree(original, revised, {
        moveMinimumWordCount: 1,
        moveSimilarityThreshold: 0.1,
      }).moves, name).toEqual([]);
    }
    const equalTable = cases.find(([name]) => name === 'table')![1];
    const equalOriginal = parseXml(`<w:body xmlns:w="${W_NS}">${equalTable}`
      + '<w:p><w:r><w:t>Stable closing anchor</w:t></w:r></w:p></w:body>').documentElement;
    const equalRevised = parseXml(`<w:body xmlns:w="${W_NS}">`
      + '<w:p><w:r><w:t>Stable closing anchor</w:t></w:r></w:p>'
      + `${equalTable}</w:body>`).documentElement;
    const equalResult = constructTaggedTree(equalOriginal, equalRevised);
    expect(equalResult.moves).toEqual([]);
    expect(verifyGlobalEqualContentInvariant(equalResult.tree, equalResult.moves)).toEqual([]);
    const originalNote = parseXml(`<w:footnote xmlns:w="${W_NS}" w:id="3">`
      + '<w:p><w:r><w:t>original note words remain here</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>Stable closing anchor</w:t></w:r></w:p></w:footnote>').documentElement;
    const revisedNote = parseXml(`<w:footnote xmlns:w="${W_NS}" w:id="3">`
      + '<w:p><w:r><w:t>Stable closing anchor</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>revised note words remain here</w:t></w:r></w:p></w:footnote>').documentElement;
    expect(constructTaggedTree(originalNote, revisedNote, {
      moveMinimumWordCount: 1,
      moveSimilarityThreshold: 0.1,
    }).moves).toEqual([]);
  });

  test('uses rendered numbering identities without serializing virtual labels', () => {
    const numberedParagraph = (text: string) => '<w:p><w:pPr><w:numPr>'
      + '<w:ilvl w:val="0"/><w:numId w:val="1"/>'
      + `</w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const numberingXml = `<w:numbering xmlns:w="${W_NS}">`
      + '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">'
      + '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>'
      + '</w:lvl></w:abstractNum>'
      + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
      + '</w:numbering>';
    const originalDocument = documentWithBody(numberedParagraph('Same clause'));
    const revisedDocument = documentWithBody(
      numberedParagraph('New clause') + numberedParagraph('Same clause'),
    );
    const original = originalDocument.getElementsByTagNameNS(W_NS, 'body')[0]!;
    const revised = revisedDocument.getElementsByTagNameNS(W_NS, 'body')[0]!;
    const withoutVirtualization = constructTaggedTree(original, revised, {
      detectMoves: false,
      numberingEnabled: false,
      originalNumberingXml: numberingXml,
      revisedNumberingXml: numberingXml,
    });
    expect(withoutVirtualization.tree.children.map((child) => child.tag)).toEqual([
      'revised',
      'both',
    ]);

    const result = constructTaggedTree(original, revised, {
      detectMoves: false,
      numberingEnabled: true,
      originalNumberingXml: numberingXml,
      revisedNumberingXml: numberingXml,
    });
    expect(result.tree.children.map((child) => child.tag)).toEqual(['both', 'revised']);
    expect(result.tree.children[0]?.tag === 'both'
      ? result.tree.children[0].original.textContent
      : undefined).toBe('Same clause');
    expect(result.tree.children[0]?.tag === 'both'
      ? result.tree.children[0].revised.textContent
      : undefined).toBe('New clause');
    const output = serializeTaggedTree(
      result.tree,
      createPreservePlan(original, revised, result.tree, {
        author: 'Comparator', date: '2026-08-17T12:00:00Z',
      }),
      { moves: result.moves },
    );
    expect(resolvedText(rejectAllChanges(output))).toBe(original.textContent);
    expect(resolvedText(acceptAllChanges(output))).toBe(revised.textContent);
    expect(output).not.toContain('1:0:1.');
  });

  test.openspec('Move source markup structure')(
    'serializes the tagged source range around moved-from content',
    () => {
      const output = serializedReorderedMove();
      const document = parseXml(output);
      const start = document.getElementsByTagNameNS(W_NS, 'moveFromRangeStart')[0]!;
      const wrapper = document.getElementsByTagNameNS(W_NS, 'moveFrom')[0]!;
      const end = document.getElementsByTagNameNS(W_NS, 'moveFromRangeEnd')[0]!;
      expect(output.indexOf('<w:moveFromRangeStart')).toBeLessThan(output.indexOf('<w:moveFrom '));
      expect(output.indexOf('<w:moveFrom ')).toBeLessThan(output.indexOf('<w:moveFromRangeEnd'));
      expect(start.getAttributeNS(W_NS, 'name')).not.toBe('');
      expect(wrapper.textContent).toBe('A');
      expect(end.getAttributeNS(W_NS, 'id')).toBe(start.getAttributeNS(W_NS, 'id'));
    },
  );

  test.openspec('Move destination markup structure')(
    'serializes the tagged destination range around moved-to content',
    () => {
      const output = serializedReorderedMove();
      const document = parseXml(output);
      const start = document.getElementsByTagNameNS(W_NS, 'moveToRangeStart')[0]!;
      const wrapper = document.getElementsByTagNameNS(W_NS, 'moveTo')[0]!;
      const end = document.getElementsByTagNameNS(W_NS, 'moveToRangeEnd')[0]!;
      const sourceName = document.getElementsByTagNameNS(W_NS, 'moveFromRangeStart')[0]!
        .getAttributeNS(W_NS, 'name');
      expect(output.indexOf('<w:moveToRangeStart')).toBeLessThan(output.indexOf('<w:moveTo '));
      expect(output.indexOf('<w:moveTo ')).toBeLessThan(output.indexOf('<w:moveToRangeEnd'));
      expect(start.getAttributeNS(W_NS, 'name')).toBe(sourceName);
      expect(wrapper.textContent).toBe('A');
      expect(end.getAttributeNS(W_NS, 'id')).toBe(start.getAttributeNS(W_NS, 'id'));
    },
  );

  test.openspec('Range IDs properly paired')(
    'serializes one balanced, named range per move direction',
    () => {
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
    },
  );

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
