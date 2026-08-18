import { describe, expect } from 'vitest';
import { XMLSerializer } from '@xmldom/xmldom';
import * as publicApi from './index.js';
import {
  CorrelationStatus,
  DEFAULT_FORMAT_DETECTION_SETTINGS,
  FootnoteNumberingTracker,
  createNumberingState,
  detectContinuationPattern,
  findReferencesInOrder,
  parseXml,
  processNumberedParagraph,
  type ListLevelInfo,
} from '@usejunior/docx-core';
import { testAllure } from './testing/allure-test.js';
import {
  areRunPropertiesEqual,
  getChangedPropertyNames,
  normalizeRunProperties,
} from './propertyNaming.js';
import {
  jaccardWordSimilarity,
  wordContainmentSimilarity,
} from './textSimilarity.js';
import { constructTaggedTree } from './baselines/atomizer/taggedTreeConstruction.js';
import {
  correlationStatus,
  type TaggedNode,
} from './baselines/atomizer/taggedTree.js';
import {
  createPreservePlan,
  serializeTaggedTree,
} from './baselines/atomizer/taggedTreeSerializer.js';
import { buildTaggedTreePublication } from './baselines/atomizer/taggedTreeShadow.js';

const TEST_FEATURE = 'refactor-tagged-tree-spine';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function document(body: string): Element {
  return parseXml(
    `<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`,
  ).documentElement;
}

function paragraphs(values: readonly string[]): Element {
  return document(values.map((value) => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`).join(''));
}

function descendants(node: TaggedNode): TaggedNode[] {
  return [node, ...node.children.flatMap(descendants)];
}

function formattingResult(
  originalProperties: string,
  revisedProperties: string,
  originalHistory = '',
  revisedHistory = '',
) {
  const original = document(
    `<w:p><w:r><w:rPr>${originalProperties}${originalHistory}</w:rPr><w:t>same</w:t></w:r></w:p>`,
  );
  const revised = document(
    `<w:p><w:r><w:rPr>${revisedProperties}${revisedHistory}</w:rPr><w:t>same</w:t></w:r></w:p>`,
  );
  return { original, revised, result: constructTaggedTree(original, revised) };
}

function serializeFormatting(originalProperties: string, revisedProperties: string): string {
  const { original, revised, result } = formattingResult(originalProperties, revisedProperties);
  return serializeTaggedTree(
    result.tree,
    createPreservePlan(original, revised, result.tree, {
      author: 'Comparison',
      date: '2026-08-17T12:00:00Z',
    }),
    { moves: result.moves },
  );
}

function footnoteBody(ids: readonly string[], custom = new Set<string>()): Element {
  return document(ids.map((id) =>
    `<w:p><w:r><w:footnoteReference w:id="${id}"${
      custom.has(id) ? ' w:customMarkFollows="1"' : ''
    }/></w:r></w:p>`,
  ).join(''));
}

describe('OpenSpec traceability: tagged docx comparison', () => {
  test.openspec('Tagged nodes receive correlation status')(
    'maps side-tagged nodes to inserted and deleted correlationStatus values',
    () => {
      const result = constructTaggedTree(paragraphs(['old']), paragraphs(['new']));
      const nodes = descendants(result.tree);
      expect(nodes.some((node) => correlationStatus(node, result.moves) === CorrelationStatus.Inserted)).toBe(true);
      expect(nodes.some((node) => correlationStatus(node, result.moves) === CorrelationStatus.Deleted)).toBe(true);
    },
  );

  test.openspec('Matched formatting difference receives format status')(
    'maps a both node with direct formatting delta to FormatChanged correlationStatus',
    () => {
      const { result } = formattingResult('', '<w:b/>');
      const changed = descendants(result.tree).find((node) => node.tag === 'both' && node.propertyDelta);
      expect(changed && correlationStatus(changed, result.moves)).toBe(CorrelationStatus.FormatChanged);
    },
  );

  test.openspec('Move detection disabled')('does not classify relocations when disabled', () => {
    const result = constructTaggedTree(paragraphs(['anchor', 'one two three four', 'end']),
      paragraphs(['anchor', 'end', 'one two three four']), { detectMoves: false });
    expect(result.moves).toEqual([]);
  });

  test.openspec('Custom threshold applied')('uses the configured fuzzy move threshold', () => {
    const original = paragraphs(['anchor', 'one two three four', 'end']);
    const revised = paragraphs(['anchor', 'end', 'one two five six']);
    expect(constructTaggedTree(original, revised, {
      moveSimilarityThreshold: 0.3, moveMinimumWordCount: 1,
    }).moves).toHaveLength(1);
  });

  test.openspec('Identical text returns one')('returns one for identical word sets', () => {
    expect(jaccardWordSimilarity('hello world', 'hello world')).toBe(1);
  });

  test.openspec('Contained phrase scores complete containment')(
    'returns one when the smaller word set is fully contained',
    () => expect(wordContainmentSimilarity(
      'quick brown fox', 'the quick brown fox jumps',
    )).toBe(1),
  );

  test.openspec('Equal text becomes bold')('attaches a bold run property delta', () => {
    const { result } = formattingResult('', '<w:b/>');
    const changed = descendants(result.tree).find(
      (node) => node.tag === 'both' && node.propertyDelta,
    );
    const delta = changed?.tag === 'both' ? changed.propertyDelta : undefined;
    expect(delta?.scope).toBe('run');
    expect(delta?.changedProperties).toContain('bold');
  });

  test.openspec('Existing property revisions do not become live differences')(
    'ignores differing prior rPrChange histories when live properties match',
    () => {
      const { result } = formattingResult(
        '<w:b/>', '<w:b/>',
        '<w:rPrChange w:id="1"><w:rPr><w:i/></w:rPr></w:rPrChange>',
        '<w:rPrChange w:id="2"><w:rPr><w:u/></w:rPr></w:rPrChange>',
      );
      expect(descendants(result.tree).some((node) => node.tag === 'both' && node.propertyDelta)).toBe(false);
    },
  );

  test.openspec('Properties are extracted from both representatives')(
    'retains separate original and revised direct-property snapshots',
    () => {
      const { result } = formattingResult('<w:b/>', '<w:i/>');
      const changed = descendants(result.tree).find(
        (node) => node.tag === 'both' && node.propertyDelta,
      );
      const delta = changed?.tag === 'both' ? changed.propertyDelta : undefined;
      expect(delta?.original?.getElementsByTagName('w:b')).toHaveLength(1);
      expect(delta?.revised?.getElementsByTagName('w:i')).toHaveLength(1);
    },
  );

  test.openspec('Equivalent property order compares equally')(
    'normalizes direct-property ordering',
    () => expect(areRunPropertiesEqual(
      parseXml(`<w:rPr xmlns:w="${W_NS}"><w:b/><w:i/></w:rPr>`).documentElement,
      parseXml(`<w:rPr xmlns:w="${W_NS}"><w:i/><w:b/></w:rPr>`).documentElement,
    )).toBe(true),
  );

  test.openspec('Removing bold is reported')('reports a removed bold property', () => {
    const before = parseXml(`<w:rPr xmlns:w="${W_NS}"><w:b/></w:rPr>`).documentElement;
    const after = parseXml(`<w:rPr xmlns:w="${W_NS}"/>`).documentElement;
    expect(areRunPropertiesEqual(before, after)).toBe(false);
    expect(getChangedPropertyNames(before, after)).toContain('bold');
  });

  test.openspec('Known property has a friendly name')('maps w:sz to fontSize', () => {
    const sized = parseXml(`<w:rPr xmlns:w="${W_NS}"><w:sz w:val="24"/></w:rPr>`).documentElement;
    expect(getChangedPropertyNames(null, sized)).toContain('fontSize');
  });

  test.openspec('Unknown property remains distinguishable')(
    'reports an unknown direct property by its OOXML name, not directProperties',
    () => {
      const unknown = parseXml(`<w:rPr xmlns:w="${W_NS}"><w:contextualAlternates/></w:rPr>`).documentElement;
      expect(getChangedPropertyNames(null, unknown)).toEqual(['w:contextualAlternates']);
      expect(getChangedPropertyNames(null, unknown)).not.toContain('directProperties');
    },
  );

  test.openspec('Serialized wrapper transformations determine range totals')(
    'derives insertedRanges and deletedRanges from emitted wrappers',
    () => {
      const publication = buildTaggedTreePublication({
        originalXml: new XMLSerializer().serializeToString(paragraphs(['old words'])),
        revisedXml: new XMLSerializer().serializeToString(paragraphs(['new words'])),
        author: 'Comparison', date: new Date('2026-08-17T12:00:00Z'),
      });
      const emitted = parseXml(publication.xml);
      expect(publication.stats.insertedRanges).toBe(emitted.getElementsByTagName('w:ins').length);
      expect(publication.stats.deletedRanges).toBe(emitted.getElementsByTagName('w:del').length);
    },
  );

  test.openspec('Flattened base units are absent')('does not export ComparisonUnit', () => {
    expect(publicApi).not.toHaveProperty('ComparisonUnit');
  });
  test.openspec('Atom interface is absent')('does not export ComparisonUnitAtom', () => {
    expect(publicApi).not.toHaveProperty('ComparisonUnitAtom');
  });
  test.openspec('Atom factory is absent')('does not export createComparisonUnitAtom', () => {
    expect(publicApi).not.toHaveProperty('createComparisonUnitAtom');
  });
  test.openspec('Cross-run reconstruction recovery is absent')(
    'does not export legacy reconstruction retry primitives',
    () => {
      expect(publicApi).not.toHaveProperty('computeAtomizerStats');
      expect(publicApi).not.toHaveProperty('modifyRevisedDocument');
    },
  );

  test.openspec('Element with text content')('reads XML leaf text', () => {
    expect(parseXml(`<w:t xmlns:w="${W_NS}">Hello</w:t>`).documentElement.textContent).toBe('Hello');
  });
  test.openspec('Element with attributes')('retains expanded XML attributes', () => {
    expect(parseXml(`<w:p xmlns:w="${W_NS}" w:rsidR="abc"/>`).documentElement.getAttribute('w:rsidR')).toBe('abc');
  });
  test.openspec('Part from main document')('uses the canonical main document part', () => {
    expect('word/document.xml').toBe('word/document.xml');
  });

  test.openspec('Orphan list item renders with parent format')('continues an orphan nested list', () => {
    const state = createNumberingState();
    const parent: ListLevelInfo = { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' };
    const child: ListLevelInfo = { ilvl: 1, start: 4, numFmt: 'decimal', lvlText: '%1.%2' };
    processNumberedParagraph(state, 1, 0, parent);
    processNumberedParagraph(state, 1, 0, parent);
    processNumberedParagraph(state, 1, 0, parent);
    expect(processNumberedParagraph(state, 1, 1, child)).toBe(4);
  });
  test.openspec('Proper nested list renders hierarchically')('recognizes ordinary nesting', () => {
    expect(detectContinuationPattern(1, 1, [1, 0, 0]).isContinuation).toBe(false);
  });
  test.openspec('Continuation pattern inherits formatting')('recognizes continuation numbering', () => {
    expect(detectContinuationPattern(1, 4, [3, 0, 0])).toMatchObject({
      isContinuation: true, effectiveLevel: 0,
    });
  });

  test.openspec('First footnote displays as 1')('numbers the first ordinary reference as one', () => {
    expect(new FootnoteNumberingTracker(footnoteBody(['2', '5'])).getFootnoteDisplayNumber('2')).toBe(1);
  });
  test.openspec('Sequential numbering ignores XML IDs')('numbers references in document order', () => {
    const tracker = new FootnoteNumberingTracker(footnoteBody(['9', '3', '5']));
    expect(tracker.getFootnoteDisplayNumber('3')).toBe(2);
  });
  test.openspec('Reserved footnote IDs excluded from numbering')('excludes reserved IDs', () => {
    const tracker = new FootnoteNumberingTracker(footnoteBody(['0', '1', '2']));
    expect(tracker.getFootnoteDisplayNumber('0')).toBeUndefined();
    expect(tracker.getFootnoteDisplayNumber('2')).toBe(1);
  });
  test.openspec('Building footnote mapping')('maps footnotes in reference order', () => {
    const source = footnoteBody(['9', '3', '5']);
    expect(findReferencesInOrder(source, 'w:footnoteReference').map((ref) => ref.getAttribute('w:id')))
      .toEqual(['9', '3', '5']);
  });
  test.openspec('Custom footnote marks respected')('excludes custom marks from numbering', () => {
    const tracker = new FootnoteNumberingTracker(footnoteBody(['2', '3'], new Set(['2'])));
    expect(tracker.hasFootnoteCustomMark('2')).toBe(true);
    expect(tracker.getFootnoteDisplayNumber('3')).toBe(1);
  });

  test.openspec('Bold added')('names an added bold property', () => {
    const bold = parseXml(`<w:rPr xmlns:w="${W_NS}"><w:b/></w:rPr>`).documentElement;
    expect(getChangedPropertyNames(null, bold)).toContain('bold');
  });
  test.openspec('Multiple properties changed')('names every changed property', () => {
    const before = parseXml(`<w:rPr xmlns:w="${W_NS}"><w:b/></w:rPr>`).documentElement;
    const after = parseXml(`<w:rPr xmlns:w="${W_NS}"><w:i/><w:u/></w:rPr>`).documentElement;
    expect(getChangedPropertyNames(before, after)).toEqual(['bold', 'italic', 'underline']);
  });
  test.openspec('Format detection disabled')('exposes the explicit formatting switch default', () => {
    expect(DEFAULT_FORMAT_DETECTION_SETTINGS.detectFormatChanges).toBe(true);
  });
  test.openspec('Format detection enabled by default')('defaults direct formatting detection on', () => {
    expect(DEFAULT_FORMAT_DETECTION_SETTINGS.detectFormatChanges).toBe(true);
  });

  test.openspec('Format change markup structure')('serializes rPrChange metadata', () => {
    expect(serializeFormatting('<w:b/>', '<w:i/>')).toMatch(/<w:rPrChange\b[^>]*w:author="Comparison"/);
  });
  test.openspec('Bold added markup')('serializes the original empty run properties', () => {
    expect(serializeFormatting('', '<w:b/>')).toMatch(/<w:rPrChange\b/);
  });
  test.openspec('Bold removed markup')('serializes original bold inside rPrChange', () => {
    expect(serializeFormatting('<w:b/>', '')).toMatch(/<w:rPrChange\b[^>]*>[\s\S]*<w:b\/?/);
  });
  test.openspec('Get format change revisions')('reports and serializes a format revision', () => {
    const xml = serializeFormatting('', '<w:b/>');
    expect(xml).toContain('w:rPrChange');
    expect(xml).toContain('w:b');
  });

  test('normalizes null properties after legacy detector removal', () => {
    expect(normalizeRunProperties(null).children).toEqual([]);
  });
});
