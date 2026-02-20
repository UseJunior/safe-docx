import { describe, expect } from 'vitest';
import { itAllure as it } from './testing/allure-test.js';
import {
  getRunPropertiesFromAtom,
  normalizeRunProperties,
  areRunPropertiesEqual,
  getChangedPropertyNames,
  categorizePropertyChanges,
  detectFormatChangesInAtomList,
  generateFormatChangeMarkup,
  mergeFormatChangeIntoRun,
} from './format-detection.js';
import {
  ComparisonUnitAtom,
  CorrelationStatus,
  FormatChangeInfo,
  OpcPart,
  WmlElement,
} from './core-types.js';
import { assertDefined } from './testing/test-utils.js';

// Helper to create test atoms with ancestor elements
function createAtomWithAncestors(
  text: string,
  rPrChildren: WmlElement[] = [],
  status: CorrelationStatus = CorrelationStatus.Equal
): ComparisonUnitAtom {
  const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };

  const rPr: WmlElement = {
    tagName: 'w:rPr',
    attributes: {},
    children: rPrChildren,
  };

  const run: WmlElement = {
    tagName: 'w:r',
    attributes: {},
    children: [rPr, { tagName: 'w:t', attributes: {}, textContent: text }],
  };

  const paragraph: WmlElement = {
    tagName: 'w:p',
    attributes: {},
    children: [run],
  };

  return {
    sha1Hash: 'test-hash',
    correlationStatus: status,
    contentElement: { tagName: 'w:t', attributes: {}, textContent: text },
    ancestorElements: [paragraph, run],
    ancestorUnids: [],
    part,
  };
}

describe('getRunPropertiesFromAtom', () => {
  it('returns null when no w:r ancestor', () => {
    const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
    const atom: ComparisonUnitAtom = {
      sha1Hash: 'test',
      correlationStatus: CorrelationStatus.Equal,
      contentElement: { tagName: 'w:t', attributes: {}, textContent: 'Test' },
      ancestorElements: [], // No ancestors
      ancestorUnids: [],
      part,
    };

    expect(getRunPropertiesFromAtom(atom)).toBeNull();
  });

  it('returns null when w:r has no rPr', () => {
    const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
    const run: WmlElement = {
      tagName: 'w:r',
      attributes: {},
      children: [{ tagName: 'w:t', attributes: {}, textContent: 'Test' }],
    };

    const atom: ComparisonUnitAtom = {
      sha1Hash: 'test',
      correlationStatus: CorrelationStatus.Equal,
      contentElement: { tagName: 'w:t', attributes: {}, textContent: 'Test' },
      ancestorElements: [run],
      ancestorUnids: [],
      part,
    };

    expect(getRunPropertiesFromAtom(atom)).toBeNull();
  });

  it('returns rPr when present', () => {
    const atom = createAtomWithAncestors('Test', [{ tagName: 'w:b', attributes: {} }]);
    const rPr = getRunPropertiesFromAtom(atom);

    expect(rPr).not.toBeNull();
    expect(rPr!.tagName).toBe('w:rPr');
    // rPr contains the bold element we specified
    expect(rPr!.children!.some((c) => c.tagName === 'w:b')).toBe(true);
  });
});

describe('normalizeRunProperties', () => {
  it('returns empty rPr for null input', () => {
    const result = normalizeRunProperties(null);

    expect(result.tagName).toBe('w:rPr');
    expect(result.children).toEqual([]);
  });

  it('removes w:rPrChange elements', () => {
    const rPr: WmlElement = {
      tagName: 'w:rPr',
      attributes: {},
      children: [
        { tagName: 'w:b', attributes: {} },
        { tagName: 'w:rPrChange', attributes: { 'w:id': '1' } },
        { tagName: 'w:i', attributes: {} },
      ],
    };

    const result = normalizeRunProperties(rPr);

    expect(result.children).toHaveLength(2);
    expect(result.children!.find((c) => c.tagName === 'w:rPrChange')).toBeUndefined();
  });

  it('sorts children by tag name', () => {
    const rPr: WmlElement = {
      tagName: 'w:rPr',
      attributes: {},
      children: [
        { tagName: 'w:u', attributes: {} },
        { tagName: 'w:b', attributes: {} },
        { tagName: 'w:i', attributes: {} },
      ],
    };

    const result = normalizeRunProperties(rPr);

    const child0 = result.children![0];
    const child1 = result.children![1];
    const child2 = result.children![2];
    assertDefined(child0, 'children[0]');
    assertDefined(child1, 'children[1]');
    assertDefined(child2, 'children[2]');
    expect(child0.tagName).toBe('w:b');
    expect(child1.tagName).toBe('w:i');
    expect(child2.tagName).toBe('w:u');
  });

  it('sorts attributes within children', () => {
    const rPr: WmlElement = {
      tagName: 'w:rPr',
      attributes: {},
      children: [
        { tagName: 'w:u', attributes: { 'w:val': 'single', 'w:color': 'FF0000' } },
      ],
    };

    const result = normalizeRunProperties(rPr);
    const firstChild = result.children![0];
    assertDefined(firstChild, 'children[0]');
    const attrs = Object.keys(firstChild.attributes);

    expect(attrs[0]).toBe('w:color');
    expect(attrs[1]).toBe('w:val');
  });
});

describe('areRunPropertiesEqual', () => {
  it('returns true for identical properties', () => {
    const rPr1 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:b', attributes: {} }],
    });

    const rPr2 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:b', attributes: {} }],
    });

    expect(areRunPropertiesEqual(rPr1, rPr2)).toBe(true);
  });

  it('returns true for same properties in different order', () => {
    const rPr1 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [
        { tagName: 'w:b', attributes: {} },
        { tagName: 'w:i', attributes: {} },
      ],
    });

    const rPr2 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [
        { tagName: 'w:i', attributes: {} },
        { tagName: 'w:b', attributes: {} },
      ],
    });

    // After normalization, order should match
    expect(areRunPropertiesEqual(rPr1, rPr2)).toBe(true);
  });

  it('returns false for different properties', () => {
    const rPr1 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:b', attributes: {} }],
    });

    const rPr2 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:i', attributes: {} }],
    });

    expect(areRunPropertiesEqual(rPr1, rPr2)).toBe(false);
  });

  it('returns false for different attribute values', () => {
    const rPr1 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:sz', attributes: { 'w:val': '24' } }],
    });

    const rPr2 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:sz', attributes: { 'w:val': '28' } }],
    });

    expect(areRunPropertiesEqual(rPr1, rPr2)).toBe(false);
  });
});

describe('getChangedPropertyNames', () => {
  it('returns empty array for identical properties', () => {
    const rPr1 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:b', attributes: {} }],
    });

    const rPr2 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:b', attributes: {} }],
    });

    expect(getChangedPropertyNames(rPr1, rPr2)).toEqual([]);
  });

  it('returns friendly name for added property', () => {
    const rPr1 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [],
    });

    const rPr2 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:b', attributes: {} }],
    });

    expect(getChangedPropertyNames(rPr1, rPr2)).toContain('bold');
  });

  it('returns friendly name for removed property', () => {
    const rPr1 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:i', attributes: {} }],
    });

    const rPr2 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [],
    });

    expect(getChangedPropertyNames(rPr1, rPr2)).toContain('italic');
  });

  it('returns multiple changed properties', () => {
    const rPr1 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [
        { tagName: 'w:b', attributes: {} },
        { tagName: 'w:sz', attributes: { 'w:val': '24' } },
      ],
    });

    const rPr2 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [
        { tagName: 'w:i', attributes: {} },
        { tagName: 'w:sz', attributes: { 'w:val': '28' } },
      ],
    });

    const changed = getChangedPropertyNames(rPr1, rPr2);

    expect(changed).toContain('bold');
    expect(changed).toContain('italic');
    expect(changed).toContain('fontSize');
  });

  it('returns tag name for unknown properties', () => {
    const rPr1 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [],
    });

    const rPr2 = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:unknownProp', attributes: {} }],
    });

    expect(getChangedPropertyNames(rPr1, rPr2)).toContain('w:unknownProp');
  });
});

describe('categorizePropertyChanges', () => {
  it('identifies added properties', () => {
    const oldRPr = normalizeRunProperties({ tagName: 'w:rPr', attributes: {}, children: [] });
    const newRPr = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:b', attributes: {} }],
    });

    const result = categorizePropertyChanges(oldRPr, newRPr);

    expect(result.added).toContain('bold');
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it('identifies removed properties', () => {
    const oldRPr = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:i', attributes: {} }],
    });
    const newRPr = normalizeRunProperties({ tagName: 'w:rPr', attributes: {}, children: [] });

    const result = categorizePropertyChanges(oldRPr, newRPr);

    expect(result.added).toEqual([]);
    expect(result.removed).toContain('italic');
    expect(result.changed).toEqual([]);
  });

  it('identifies changed properties', () => {
    const oldRPr = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:sz', attributes: { 'w:val': '24' } }],
    });
    const newRPr = normalizeRunProperties({
      tagName: 'w:rPr',
      attributes: {},
      children: [{ tagName: 'w:sz', attributes: { 'w:val': '28' } }],
    });

    const result = categorizePropertyChanges(oldRPr, newRPr);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toContain('fontSize');
  });
});

describe('detectFormatChangesInAtomList', () => {
  it('does nothing when detectFormatChanges is false', () => {
    const atom = createAtomWithAncestors('Test', [{ tagName: 'w:b', attributes: {} }]);
    atom.comparisonUnitAtomBefore = createAtomWithAncestors('Test', []);

    detectFormatChangesInAtomList([atom], { detectFormatChanges: false });

    expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
    expect(atom.formatChange).toBeUndefined();
  });

  it('skips non-Equal atoms', () => {
    const atom = createAtomWithAncestors(
      'Test',
      [{ tagName: 'w:b', attributes: {} }],
      CorrelationStatus.Inserted
    );
    atom.comparisonUnitAtomBefore = createAtomWithAncestors('Test', []);

    detectFormatChangesInAtomList([atom], { detectFormatChanges: true });

    expect(atom.correlationStatus).toBe(CorrelationStatus.Inserted);
    expect(atom.formatChange).toBeUndefined();
  });

  it('skips atoms without comparisonUnitAtomBefore', () => {
    const atom = createAtomWithAncestors('Test', [{ tagName: 'w:b', attributes: {} }]);
    // No comparisonUnitAtomBefore set

    detectFormatChangesInAtomList([atom], { detectFormatChanges: true });

    expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
    expect(atom.formatChange).toBeUndefined();
  });

  it('detects format change when bold is added', () => {
    const atom = createAtomWithAncestors('Test', [{ tagName: 'w:b', attributes: {} }]);
    atom.comparisonUnitAtomBefore = createAtomWithAncestors('Test', []);

    detectFormatChangesInAtomList([atom], { detectFormatChanges: true });

    expect(atom.correlationStatus).toBe(CorrelationStatus.FormatChanged);
    expect(atom.formatChange).toBeDefined();
    expect(atom.formatChange!.changedProperties).toContain('bold');
  });

  it('does not mark as changed when formatting is identical', () => {
    const atom = createAtomWithAncestors('Test', [{ tagName: 'w:b', attributes: {} }]);
    atom.comparisonUnitAtomBefore = createAtomWithAncestors('Test', [
      { tagName: 'w:b', attributes: {} },
    ]);

    detectFormatChangesInAtomList([atom], { detectFormatChanges: true });

    expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
    expect(atom.formatChange).toBeUndefined();
  });
});

describe('generateFormatChangeMarkup', () => {
  it('generates correct w:rPrChange structure', () => {
    const formatChange = {
      oldRunProperties: {
        tagName: 'w:rPr',
        attributes: {},
        children: [{ tagName: 'w:b', attributes: {} }],
      },
      newRunProperties: {
        tagName: 'w:rPr',
        attributes: {},
        children: [],
      },
      changedProperties: ['bold'],
    };

    const markup = generateFormatChangeMarkup(formatChange, {
      author: 'Test Author',
      dateTime: new Date('2025-01-15T10:00:00Z'),
      id: 1,
    });

    expect(markup.tagName).toBe('w:rPrChange');
    expect(markup.attributes['w:id']).toBe('1');
    expect(markup.attributes['w:author']).toBe('Test Author');
    expect(markup.attributes['w:date']).toBe('2025-01-15T10:00:00.000Z');

    // Should have w:rPr child with old properties
    expect(markup.children).toHaveLength(1);
    const rPrChild = markup.children![0];
    assertDefined(rPrChild, 'markup.children[0]');
    expect(rPrChild.tagName).toBe('w:rPr');
    const rPrGrandchild = rPrChild.children![0];
    assertDefined(rPrGrandchild, 'markup.children[0].children[0]');
    expect(rPrGrandchild.tagName).toBe('w:b');
  });

  it('handles empty old properties', () => {
    const formatChange = {
      oldRunProperties: null,
      newRunProperties: {
        tagName: 'w:rPr',
        attributes: {},
        children: [{ tagName: 'w:b', attributes: {} }],
      },
      changedProperties: ['bold'],
    };

    const markup = generateFormatChangeMarkup(formatChange, {
      author: 'Test',
      dateTime: new Date(),
      id: 1,
    });

    const emptyRPrChild = markup.children![0];
    assertDefined(emptyRPrChild, 'markup.children[0]');
    expect(emptyRPrChild.children).toEqual([]);
  });

  it('excludes existing rPrChange from old properties', () => {
    const formatChange: FormatChangeInfo = {
      oldRunProperties: {
        tagName: 'w:rPr',
        attributes: {},
        children: [
          { tagName: 'w:b', attributes: {} },
          { tagName: 'w:rPrChange', attributes: { 'w:id': '99' } },
        ],
      },
      newRunProperties: null,
      changedProperties: ['bold'],
    };

    const markup = generateFormatChangeMarkup(formatChange, {
      author: 'Test',
      dateTime: new Date(),
      id: 1,
    });

    // Should only have w:b, not w:rPrChange
    const filteredRPrChild = markup.children![0];
    assertDefined(filteredRPrChild, 'markup.children[0]');
    expect(filteredRPrChild.children).toHaveLength(1);
    const filteredGrandchild = filteredRPrChild.children![0];
    assertDefined(filteredGrandchild, 'markup.children[0].children[0]');
    expect(filteredGrandchild.tagName).toBe('w:b');
  });
});

describe('mergeFormatChangeIntoRun', () => {
  it('adds rPrChange to existing rPr', () => {
    const runElement: WmlElement = {
      tagName: 'w:r',
      attributes: {},
      children: [
        {
          tagName: 'w:rPr',
          attributes: {},
          children: [{ tagName: 'w:b', attributes: {} }],
        },
        { tagName: 'w:t', attributes: {}, textContent: 'Test' },
      ],
    };

    const rPrChange: WmlElement = {
      tagName: 'w:rPrChange',
      attributes: { 'w:id': '1' },
      children: [],
    };

    mergeFormatChangeIntoRun(runElement, rPrChange);

    const rPr = runElement.children![0];
    assertDefined(rPr, 'runElement.children[0]');
    expect(rPr.children).toHaveLength(2);
    const rPrSecondChild = rPr.children![1];
    assertDefined(rPrSecondChild, 'rPr.children[1]');
    expect(rPrSecondChild.tagName).toBe('w:rPrChange');
  });

  it('creates rPr if not present', () => {
    const runElement: WmlElement = {
      tagName: 'w:r',
      attributes: {},
      children: [{ tagName: 'w:t', attributes: {}, textContent: 'Test' }],
    };

    const rPrChange: WmlElement = {
      tagName: 'w:rPrChange',
      attributes: { 'w:id': '1' },
      children: [],
    };

    mergeFormatChangeIntoRun(runElement, rPrChange);

    const createdRPr = runElement.children![0];
    assertDefined(createdRPr, 'runElement.children[0]');
    expect(createdRPr.tagName).toBe('w:rPr');
    const createdRPrChild = createdRPr.children![0];
    assertDefined(createdRPrChild, 'createdRPr.children[0]');
    expect(createdRPrChild.tagName).toBe('w:rPrChange');
  });

  it('does nothing for non-run elements', () => {
    const paragraph: WmlElement = {
      tagName: 'w:p',
      attributes: {},
      children: [],
    };

    const rPrChange: WmlElement = {
      tagName: 'w:rPrChange',
      attributes: { 'w:id': '1' },
      children: [],
    };

    mergeFormatChangeIntoRun(paragraph, rPrChange);

    expect(paragraph.children).toEqual([]);
  });
});
