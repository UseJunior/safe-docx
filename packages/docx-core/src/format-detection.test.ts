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
} from './core-types.js';
import { el } from './testing/dom-test-helpers.js';
import { childElements } from './primitives/index.js';
import { assertDefined } from './testing/test-utils.js';

// Helper to create test atoms with ancestor elements
function createAtomWithAncestors(
  text: string,
  rPrChildren: Element[] = [],
  status: CorrelationStatus = CorrelationStatus.Equal
): ComparisonUnitAtom {
  const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };

  const rPr = el('w:rPr', {}, rPrChildren);

  const run = el('w:r', {}, [rPr, el('w:t', {}, undefined, text)]);

  const paragraph = el('w:p', {}, [run]);

  return {
    sha1Hash: 'test-hash',
    correlationStatus: status,
    contentElement: el('w:t', {}, undefined, text),
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
      contentElement: el('w:t', {}, undefined, 'Test'),
      ancestorElements: [], // No ancestors
      ancestorUnids: [],
      part,
    };

    expect(getRunPropertiesFromAtom(atom)).toBeNull();
  });

  it('returns null when w:r has no rPr', () => {
    const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
    const run = el('w:r', {}, [el('w:t', {}, undefined, 'Test')]);

    const atom: ComparisonUnitAtom = {
      sha1Hash: 'test',
      correlationStatus: CorrelationStatus.Equal,
      contentElement: el('w:t', {}, undefined, 'Test'),
      ancestorElements: [run],
      ancestorUnids: [],
      part,
    };

    expect(getRunPropertiesFromAtom(atom)).toBeNull();
  });

  it('returns rPr when present', () => {
    const atom = createAtomWithAncestors('Test', [el('w:b')]);
    const rPr = getRunPropertiesFromAtom(atom);

    expect(rPr).not.toBeNull();
    expect(rPr!.tagName).toBe('w:rPr');
    // rPr contains the bold element we specified
    expect(childElements(rPr!).some((c) => c.tagName === 'w:b')).toBe(true);
  });
});

describe('normalizeRunProperties', () => {
  it('returns empty rPr for null input', () => {
    const result = normalizeRunProperties(null);

    expect(result.children).toEqual([]);
  });

  it('removes w:rPrChange elements', () => {
    const rPr = el('w:rPr', {}, [
      el('w:b'),
      el('w:rPrChange', { 'w:id': '1' }),
      el('w:i'),
    ]);

    const result = normalizeRunProperties(rPr);

    expect(result.children).toHaveLength(2);
    expect(result.children.find((c) => c.tagName === 'w:rPrChange')).toBeUndefined();
  });

  it('sorts children by tag name', () => {
    const rPr = el('w:rPr', {}, [el('w:u'), el('w:b'), el('w:i')]);

    const result = normalizeRunProperties(rPr);

    const child0 = result.children[0];
    const child1 = result.children[1];
    const child2 = result.children[2];
    assertDefined(child0, 'children[0]');
    assertDefined(child1, 'children[1]');
    assertDefined(child2, 'children[2]');
    expect(child0.tagName).toBe('w:b');
    expect(child1.tagName).toBe('w:i');
    expect(child2.tagName).toBe('w:u');
  });

  it('sorts attributes within children', () => {
    const rPr = el('w:rPr', {}, [
      el('w:u', { 'w:val': 'single', 'w:color': 'FF0000' }),
    ]);

    const result = normalizeRunProperties(rPr);
    const firstChild = result.children[0];
    assertDefined(firstChild, 'children[0]');
    // NormalizedProperty.attrs is [string, string][] sorted by key
    const attrKeys = firstChild.attrs.map(([k]) => k);

    expect(attrKeys[0]).toBe('w:color');
    expect(attrKeys[1]).toBe('w:val');
  });
});

describe('areRunPropertiesEqual', () => {
  it('returns true for identical properties', () => {
    const rPr1 = el('w:rPr', {}, [el('w:b')]);
    const rPr2 = el('w:rPr', {}, [el('w:b')]);

    expect(areRunPropertiesEqual(rPr1, rPr2)).toBe(true);
  });

  it('returns true for same properties in different order', () => {
    const rPr1 = el('w:rPr', {}, [el('w:b'), el('w:i')]);
    const rPr2 = el('w:rPr', {}, [el('w:i'), el('w:b')]);

    // After normalization, order should match
    expect(areRunPropertiesEqual(rPr1, rPr2)).toBe(true);
  });

  it('returns false for different properties', () => {
    const rPr1 = el('w:rPr', {}, [el('w:b')]);
    const rPr2 = el('w:rPr', {}, [el('w:i')]);

    expect(areRunPropertiesEqual(rPr1, rPr2)).toBe(false);
  });

  it('returns false for different attribute values', () => {
    const rPr1 = el('w:rPr', {}, [el('w:sz', { 'w:val': '24' })]);
    const rPr2 = el('w:rPr', {}, [el('w:sz', { 'w:val': '28' })]);

    expect(areRunPropertiesEqual(rPr1, rPr2)).toBe(false);
  });
});

describe('getChangedPropertyNames', () => {
  it('returns empty array for identical properties', () => {
    const rPr1 = el('w:rPr', {}, [el('w:b')]);
    const rPr2 = el('w:rPr', {}, [el('w:b')]);

    expect(getChangedPropertyNames(rPr1, rPr2)).toEqual([]);
  });

  it('returns friendly name for added property', () => {
    const rPr1 = el('w:rPr');
    const rPr2 = el('w:rPr', {}, [el('w:b')]);

    expect(getChangedPropertyNames(rPr1, rPr2)).toContain('bold');
  });

  it('returns friendly name for removed property', () => {
    const rPr1 = el('w:rPr', {}, [el('w:i')]);
    const rPr2 = el('w:rPr');

    expect(getChangedPropertyNames(rPr1, rPr2)).toContain('italic');
  });

  it('returns multiple changed properties', () => {
    const rPr1 = el('w:rPr', {}, [el('w:b'), el('w:sz', { 'w:val': '24' })]);
    const rPr2 = el('w:rPr', {}, [el('w:i'), el('w:sz', { 'w:val': '28' })]);

    const changed = getChangedPropertyNames(rPr1, rPr2);

    expect(changed).toContain('bold');
    expect(changed).toContain('italic');
    expect(changed).toContain('fontSize');
  });

  it('returns tag name for unknown properties', () => {
    const rPr1 = el('w:rPr');
    const rPr2 = el('w:rPr', {}, [el('w:unknownProp')]);

    expect(getChangedPropertyNames(rPr1, rPr2)).toContain('w:unknownProp');
  });
});

describe('categorizePropertyChanges', () => {
  it('identifies added properties', () => {
    const oldRPr = el('w:rPr');
    const newRPr = el('w:rPr', {}, [el('w:b')]);

    const result = categorizePropertyChanges(oldRPr, newRPr);

    expect(result.added).toContain('bold');
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it('identifies removed properties', () => {
    const oldRPr = el('w:rPr', {}, [el('w:i')]);
    const newRPr = el('w:rPr');

    const result = categorizePropertyChanges(oldRPr, newRPr);

    expect(result.added).toEqual([]);
    expect(result.removed).toContain('italic');
    expect(result.changed).toEqual([]);
  });

  it('identifies changed properties', () => {
    const oldRPr = el('w:rPr', {}, [el('w:sz', { 'w:val': '24' })]);
    const newRPr = el('w:rPr', {}, [el('w:sz', { 'w:val': '28' })]);

    const result = categorizePropertyChanges(oldRPr, newRPr);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toContain('fontSize');
  });
});

describe('detectFormatChangesInAtomList', () => {
  it('does nothing when detectFormatChanges is false', () => {
    const atom = createAtomWithAncestors('Test', [el('w:b')]);
    atom.comparisonUnitAtomBefore = createAtomWithAncestors('Test', []);

    detectFormatChangesInAtomList([atom], { detectFormatChanges: false });

    expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
    expect(atom.formatChange).toBeUndefined();
  });

  it('skips non-Equal atoms', () => {
    const atom = createAtomWithAncestors(
      'Test',
      [el('w:b')],
      CorrelationStatus.Inserted
    );
    atom.comparisonUnitAtomBefore = createAtomWithAncestors('Test', []);

    detectFormatChangesInAtomList([atom], { detectFormatChanges: true });

    expect(atom.correlationStatus).toBe(CorrelationStatus.Inserted);
    expect(atom.formatChange).toBeUndefined();
  });

  it('skips atoms without comparisonUnitAtomBefore', () => {
    const atom = createAtomWithAncestors('Test', [el('w:b')]);
    // No comparisonUnitAtomBefore set

    detectFormatChangesInAtomList([atom], { detectFormatChanges: true });

    expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
    expect(atom.formatChange).toBeUndefined();
  });

  it('detects format change when bold is added', () => {
    const atom = createAtomWithAncestors('Test', [el('w:b')]);
    atom.comparisonUnitAtomBefore = createAtomWithAncestors('Test', []);

    detectFormatChangesInAtomList([atom], { detectFormatChanges: true });

    expect(atom.correlationStatus).toBe(CorrelationStatus.FormatChanged);
    expect(atom.formatChange).toBeDefined();
    expect(atom.formatChange!.changedProperties).toContain('bold');
  });

  it('does not mark as changed when formatting is identical', () => {
    const atom = createAtomWithAncestors('Test', [el('w:b')]);
    atom.comparisonUnitAtomBefore = createAtomWithAncestors('Test', [el('w:b')]);

    detectFormatChangesInAtomList([atom], { detectFormatChanges: true });

    expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
    expect(atom.formatChange).toBeUndefined();
  });
});

describe('generateFormatChangeMarkup', () => {
  it('generates correct w:rPrChange structure', () => {
    const formatChange: FormatChangeInfo = {
      oldRunProperties: el('w:rPr', {}, [el('w:b')]),
      newRunProperties: el('w:rPr'),
      changedProperties: ['bold'],
    };

    const markup = generateFormatChangeMarkup(formatChange, {
      author: 'Test Author',
      dateTime: new Date('2025-01-15T10:00:00Z'),
      id: 1,
    });

    expect(markup.tagName).toBe('w:rPrChange');
    expect(markup.getAttribute('w:id')).toBe('1');
    expect(markup.getAttribute('w:author')).toBe('Test Author');
    expect(markup.getAttribute('w:date')).toBe('2025-01-15T10:00:00.000Z');

    // Should have w:rPr child with old properties
    const markupChildren = childElements(markup);
    expect(markupChildren).toHaveLength(1);
    const rPrChild = markupChildren[0];
    assertDefined(rPrChild, 'markup children[0]');
    expect(rPrChild.tagName).toBe('w:rPr');
    const rPrGrandchildren = childElements(rPrChild);
    const rPrGrandchild = rPrGrandchildren[0];
    assertDefined(rPrGrandchild, 'rPr children[0]');
    expect(rPrGrandchild.tagName).toBe('w:b');
  });

  it('handles empty old properties', () => {
    const formatChange: FormatChangeInfo = {
      oldRunProperties: null,
      newRunProperties: el('w:rPr', {}, [el('w:b')]),
      changedProperties: ['bold'],
    };

    const markup = generateFormatChangeMarkup(formatChange, {
      author: 'Test',
      dateTime: new Date(),
      id: 1,
    });

    const markupChildren = childElements(markup);
    const emptyRPrChild = markupChildren[0];
    assertDefined(emptyRPrChild, 'markup children[0]');
    expect(childElements(emptyRPrChild)).toEqual([]);
  });

  it('excludes existing rPrChange from old properties', () => {
    const formatChange: FormatChangeInfo = {
      oldRunProperties: el('w:rPr', {}, [
        el('w:b'),
        el('w:rPrChange', { 'w:id': '99' }),
      ]),
      newRunProperties: null,
      changedProperties: ['bold'],
    };

    const markup = generateFormatChangeMarkup(formatChange, {
      author: 'Test',
      dateTime: new Date(),
      id: 1,
    });

    // Should only have w:b, not w:rPrChange
    const markupChildren = childElements(markup);
    const filteredRPrChild = markupChildren[0];
    assertDefined(filteredRPrChild, 'markup children[0]');
    const filteredGrandchildren = childElements(filteredRPrChild);
    expect(filteredGrandchildren).toHaveLength(1);
    const filteredGrandchild = filteredGrandchildren[0];
    assertDefined(filteredGrandchild, 'rPr children[0]');
    expect(filteredGrandchild.tagName).toBe('w:b');
  });
});

describe('mergeFormatChangeIntoRun', () => {
  it('adds rPrChange to existing rPr', () => {
    const runElement = el('w:r', {}, [
      el('w:rPr', {}, [el('w:b')]),
      el('w:t', {}, undefined, 'Test'),
    ]);

    const rPrChange = el('w:rPrChange', { 'w:id': '1' });

    mergeFormatChangeIntoRun(runElement, rPrChange);

    const rPr = childElements(runElement)[0];
    assertDefined(rPr, 'runElement children[0]');
    const rPrChildren = childElements(rPr);
    expect(rPrChildren).toHaveLength(2);
    const rPrSecondChild = rPrChildren[1];
    assertDefined(rPrSecondChild, 'rPr children[1]');
    expect(rPrSecondChild.tagName).toBe('w:rPrChange');
  });

  it('creates rPr if not present', () => {
    const runElement = el('w:r', {}, [el('w:t', {}, undefined, 'Test')]);

    const rPrChange = el('w:rPrChange', { 'w:id': '1' });

    mergeFormatChangeIntoRun(runElement, rPrChange);

    const createdRPr = childElements(runElement)[0];
    assertDefined(createdRPr, 'runElement children[0]');
    expect(createdRPr.tagName).toBe('w:rPr');
    const createdRPrChildren = childElements(createdRPr);
    const createdRPrChild = createdRPrChildren[0];
    assertDefined(createdRPrChild, 'rPr children[0]');
    expect(createdRPrChild.tagName).toBe('w:rPrChange');
  });

  it('does nothing for non-run elements', () => {
    const paragraph = el('w:p');

    const rPrChange = el('w:rPrChange', { 'w:id': '1' });

    mergeFormatChangeIntoRun(paragraph, rPrChange);

    expect(childElements(paragraph)).toEqual([]);
  });
});
