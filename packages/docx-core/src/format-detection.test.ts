import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
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

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Format Detection' });

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
  test('returns null when no w:r ancestor', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;

    await given('an atom with no ancestors', () => {
      const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
      atom = {
        sha1Hash: 'test',
        correlationStatus: CorrelationStatus.Equal,
        contentElement: el('w:t', {}, undefined, 'Test'),
        ancestorElements: [], // No ancestors
        ancestorUnids: [],
        part,
      };
    });

    await when('run properties are retrieved', () => {});

    await then('null is returned', () => {
      expect(getRunPropertiesFromAtom(atom)).toBeNull();
    });
  });

  test('returns null when w:r has no rPr', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;

    await given('an atom whose run has no rPr', () => {
      const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
      const run = el('w:r', {}, [el('w:t', {}, undefined, 'Test')]);
      atom = {
        sha1Hash: 'test',
        correlationStatus: CorrelationStatus.Equal,
        contentElement: el('w:t', {}, undefined, 'Test'),
        ancestorElements: [run],
        ancestorUnids: [],
        part,
      };
    });

    await when('run properties are retrieved', () => {});

    await then('null is returned', () => {
      expect(getRunPropertiesFromAtom(atom)).toBeNull();
    });
  });

  test('returns rPr when present', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;
    let rPr: Element | null;

    await given('an atom whose run has a bold rPr', () => {
      atom = createAtomWithAncestors('Test', [el('w:b')]);
    });

    await when('run properties are retrieved', () => {
      rPr = getRunPropertiesFromAtom(atom);
    });

    await then('the rPr element is returned with the bold child', () => {
      expect(rPr).not.toBeNull();
      expect(rPr!.tagName).toBe('w:rPr');
      // rPr contains the bold element we specified
      expect(childElements(rPr!).some((c) => c.tagName === 'w:b')).toBe(true);
    });
  });
});

describe('normalizeRunProperties', () => {
  test('returns empty rPr for null input', async ({ given, when, then }: AllureBddContext) => {
    let result: ReturnType<typeof normalizeRunProperties>;

    await given('null as input', () => {});

    await when('normalizeRunProperties is called', () => {
      result = normalizeRunProperties(null);
    });

    await then('an empty children array is returned', () => {
      expect(result.children).toEqual([]);
    });
  });

  test('removes w:rPrChange elements', async ({ given, when, then }: AllureBddContext) => {
    let rPr: Element;
    let result: ReturnType<typeof normalizeRunProperties>;

    await given('an rPr with bold, italic, and an rPrChange', () => {
      rPr = el('w:rPr', {}, [
        el('w:b'),
        el('w:rPrChange', { 'w:id': '1' }),
        el('w:i'),
      ]);
    });

    await when('normalizeRunProperties is called', () => {
      result = normalizeRunProperties(rPr);
    });

    await then('the rPrChange is removed', () => {
      expect(result.children).toHaveLength(2);
      expect(result.children.find((c) => c.tagName === 'w:rPrChange')).toBeUndefined();
    });
  });

  test('sorts children by tag name', async ({ given, when, then }: AllureBddContext) => {
    let rPr: Element;
    let result: ReturnType<typeof normalizeRunProperties>;

    await given('an rPr with u, b, i in that order', () => {
      rPr = el('w:rPr', {}, [el('w:u'), el('w:b'), el('w:i')]);
    });

    await when('normalizeRunProperties is called', () => {
      result = normalizeRunProperties(rPr);
    });

    await then('children are sorted alphabetically by tag name', () => {
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
  });

  test('sorts attributes within children', async ({ given, when, then }: AllureBddContext) => {
    let rPr: Element;
    let result: ReturnType<typeof normalizeRunProperties>;

    await given('an rPr with a child having multiple attributes', () => {
      rPr = el('w:rPr', {}, [
        el('w:u', { 'w:val': 'single', 'w:color': 'FF0000' }),
      ]);
    });

    await when('normalizeRunProperties is called', () => {
      result = normalizeRunProperties(rPr);
    });

    await then('attributes are sorted by key', () => {
      const firstChild = result.children[0];
      assertDefined(firstChild, 'children[0]');
      // NormalizedProperty.attrs is [string, string][] sorted by key
      const attrKeys = firstChild.attrs.map(([k]) => k);

      expect(attrKeys[0]).toBe('w:color');
      expect(attrKeys[1]).toBe('w:val');
    });
  });
});

describe('areRunPropertiesEqual', () => {
  test('returns true for identical properties', async ({ given, when, then }: AllureBddContext) => {
    let rPr1: Element;
    let rPr2: Element;

    await given('two rPr elements with the same bold property', () => {
      rPr1 = el('w:rPr', {}, [el('w:b')]);
      rPr2 = el('w:rPr', {}, [el('w:b')]);
    });

    await when('properties are compared', () => {});

    await then('they are equal', () => {
      expect(areRunPropertiesEqual(rPr1, rPr2)).toBe(true);
    });
  });

  test('returns true for same properties in different order', async ({ given, when, then }: AllureBddContext) => {
    let rPr1: Element;
    let rPr2: Element;

    await given('two rPr elements with the same properties in different order', () => {
      rPr1 = el('w:rPr', {}, [el('w:b'), el('w:i')]);
      rPr2 = el('w:rPr', {}, [el('w:i'), el('w:b')]);
    });

    await when('properties are compared', () => {});

    await then('they are equal after normalization', () => {
      // After normalization, order should match
      expect(areRunPropertiesEqual(rPr1, rPr2)).toBe(true);
    });
  });

  test('returns false for different properties', async ({ given, when, then }: AllureBddContext) => {
    let rPr1: Element;
    let rPr2: Element;

    await given('an rPr with bold and one with italic', () => {
      rPr1 = el('w:rPr', {}, [el('w:b')]);
      rPr2 = el('w:rPr', {}, [el('w:i')]);
    });

    await when('properties are compared', () => {});

    await then('they are not equal', () => {
      expect(areRunPropertiesEqual(rPr1, rPr2)).toBe(false);
    });
  });

  test('returns false for different attribute values', async ({ given, when, then }: AllureBddContext) => {
    let rPr1: Element;
    let rPr2: Element;

    await given('two rPr elements with different font size values', () => {
      rPr1 = el('w:rPr', {}, [el('w:sz', { 'w:val': '24' })]);
      rPr2 = el('w:rPr', {}, [el('w:sz', { 'w:val': '28' })]);
    });

    await when('properties are compared', () => {});

    await then('they are not equal', () => {
      expect(areRunPropertiesEqual(rPr1, rPr2)).toBe(false);
    });
  });
});

describe('getChangedPropertyNames', () => {
  test('returns empty array for identical properties', async ({ given, when, then }: AllureBddContext) => {
    await given('two identical rPr elements', () => {});
    await when('changed property names are retrieved', () => {});
    await then('an empty array is returned', () => {
      const rPr1 = el('w:rPr', {}, [el('w:b')]);
      const rPr2 = el('w:rPr', {}, [el('w:b')]);
      expect(getChangedPropertyNames(rPr1, rPr2)).toEqual([]);
    });
  });

  test('returns friendly name for added property', async ({ given, when, then }: AllureBddContext) => {
    await given('an old rPr without bold and a new rPr with bold', () => {});
    await when('changed property names are retrieved', () => {});
    await then('bold is returned as a changed property', () => {
      const rPr1 = el('w:rPr');
      const rPr2 = el('w:rPr', {}, [el('w:b')]);
      expect(getChangedPropertyNames(rPr1, rPr2)).toContain('bold');
    });
  });

  test('returns friendly name for removed property', async ({ given, when, then }: AllureBddContext) => {
    await given('an old rPr with italic and a new rPr without it', () => {});
    await when('changed property names are retrieved', () => {});
    await then('italic is returned as a changed property', () => {
      const rPr1 = el('w:rPr', {}, [el('w:i')]);
      const rPr2 = el('w:rPr');
      expect(getChangedPropertyNames(rPr1, rPr2)).toContain('italic');
    });
  });

  test('returns multiple changed properties', async ({ given, when, then }: AllureBddContext) => {
    let changed: string[];

    await given('rPr elements with multiple differences', () => {});

    await when('changed property names are retrieved', () => {
      const rPr1 = el('w:rPr', {}, [el('w:b'), el('w:sz', { 'w:val': '24' })]);
      const rPr2 = el('w:rPr', {}, [el('w:i'), el('w:sz', { 'w:val': '28' })]);
      changed = getChangedPropertyNames(rPr1, rPr2);
    });

    await then('all changed properties are listed', () => {
      expect(changed).toContain('bold');
      expect(changed).toContain('italic');
      expect(changed).toContain('fontSize');
    });
  });

  test('returns tag name for unknown properties', async ({ given, when, then }: AllureBddContext) => {
    await given('an rPr with an unknown property', () => {});
    await when('changed property names are retrieved', () => {});
    await then('the tag name is returned', () => {
      const rPr1 = el('w:rPr');
      const rPr2 = el('w:rPr', {}, [el('w:unknownProp')]);
      expect(getChangedPropertyNames(rPr1, rPr2)).toContain('w:unknownProp');
    });
  });
});

describe('categorizePropertyChanges', () => {
  test('identifies added properties', async ({ given, when, then }: AllureBddContext) => {
    let result: ReturnType<typeof categorizePropertyChanges>;

    await given('an empty old rPr and a new rPr with bold', () => {});

    await when('property changes are categorized', () => {
      const oldRPr = el('w:rPr');
      const newRPr = el('w:rPr', {}, [el('w:b')]);
      result = categorizePropertyChanges(oldRPr, newRPr);
    });

    await then('bold is in the added list', () => {
      expect(result.added).toContain('bold');
      expect(result.removed).toEqual([]);
      expect(result.changed).toEqual([]);
    });
  });

  test('identifies removed properties', async ({ given, when, then }: AllureBddContext) => {
    let result: ReturnType<typeof categorizePropertyChanges>;

    await given('an old rPr with italic and an empty new rPr', () => {});

    await when('property changes are categorized', () => {
      const oldRPr = el('w:rPr', {}, [el('w:i')]);
      const newRPr = el('w:rPr');
      result = categorizePropertyChanges(oldRPr, newRPr);
    });

    await then('italic is in the removed list', () => {
      expect(result.added).toEqual([]);
      expect(result.removed).toContain('italic');
      expect(result.changed).toEqual([]);
    });
  });

  test('identifies changed properties', async ({ given, when, then }: AllureBddContext) => {
    let result: ReturnType<typeof categorizePropertyChanges>;

    await given('rPr elements with different font size values', () => {});

    await when('property changes are categorized', () => {
      const oldRPr = el('w:rPr', {}, [el('w:sz', { 'w:val': '24' })]);
      const newRPr = el('w:rPr', {}, [el('w:sz', { 'w:val': '28' })]);
      result = categorizePropertyChanges(oldRPr, newRPr);
    });

    await then('fontSize is in the changed list', () => {
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.changed).toContain('fontSize');
    });
  });
});

describe('detectFormatChangesInAtomList', () => {
  test('does nothing when detectFormatChanges is false', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;

    await given('an atom with format change and detectFormatChanges disabled', () => {
      atom = createAtomWithAncestors('Test', [el('w:b')]);
      atom.comparisonUnitAtomBefore = createAtomWithAncestors('Test', []);
    });

    await when('format changes are detected', () => {
      detectFormatChangesInAtomList([atom], { detectFormatChanges: false });
    });

    await then('the atom status is unchanged', () => {
      expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
      expect(atom.formatChange).toBeUndefined();
    });
  });

  test('skips non-Equal atoms', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;

    await given('an Inserted atom with format change', () => {
      atom = createAtomWithAncestors('Test', [el('w:b')], CorrelationStatus.Inserted);
      atom.comparisonUnitAtomBefore = createAtomWithAncestors('Test', []);
    });

    await when('format changes are detected', () => {
      detectFormatChangesInAtomList([atom], { detectFormatChanges: true });
    });

    await then('the atom status is still Inserted', () => {
      expect(atom.correlationStatus).toBe(CorrelationStatus.Inserted);
      expect(atom.formatChange).toBeUndefined();
    });
  });

  test('skips atoms without comparisonUnitAtomBefore', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;

    await given('an atom without comparisonUnitAtomBefore', () => {
      atom = createAtomWithAncestors('Test', [el('w:b')]);
      // No comparisonUnitAtomBefore set
    });

    await when('format changes are detected', () => {
      detectFormatChangesInAtomList([atom], { detectFormatChanges: true });
    });

    await then('the atom status is unchanged', () => {
      expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
      expect(atom.formatChange).toBeUndefined();
    });
  });

  test('detects format change when bold is added', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;

    await given('an atom with bold and a before-atom without bold', () => {
      atom = createAtomWithAncestors('Test', [el('w:b')]);
      atom.comparisonUnitAtomBefore = createAtomWithAncestors('Test', []);
    });

    await when('format changes are detected', () => {
      detectFormatChangesInAtomList([atom], { detectFormatChanges: true });
    });

    await then('the atom is marked as FormatChanged with bold in changedProperties', () => {
      expect(atom.correlationStatus).toBe(CorrelationStatus.FormatChanged);
      expect(atom.formatChange).toBeDefined();
      expect(atom.formatChange!.changedProperties).toContain('bold');
    });
  });

  test('does not mark as changed when formatting is identical', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;

    await given('an atom and a before-atom both with the same bold formatting', () => {
      atom = createAtomWithAncestors('Test', [el('w:b')]);
      atom.comparisonUnitAtomBefore = createAtomWithAncestors('Test', [el('w:b')]);
    });

    await when('format changes are detected', () => {
      detectFormatChangesInAtomList([atom], { detectFormatChanges: true });
    });

    await then('the atom status is unchanged', () => {
      expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
      expect(atom.formatChange).toBeUndefined();
    });
  });
});

describe('generateFormatChangeMarkup', () => {
  test('generates correct w:rPrChange structure', async ({ given, when, then }: AllureBddContext) => {
    let formatChange: FormatChangeInfo;
    let markup: Element;

    await given('a format change with old bold rPr', () => {
      formatChange = {
        oldRunProperties: el('w:rPr', {}, [el('w:b')]),
        newRunProperties: el('w:rPr'),
        changedProperties: ['bold'],
      };
    });

    await when('format change markup is generated', () => {
      markup = generateFormatChangeMarkup(formatChange, {
        author: 'Test Author',
        dateTime: new Date('2025-01-15T10:00:00Z'),
        id: 1,
      });
    });

    await then('the markup has correct structure and attributes', () => {
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
  });

  test('handles empty old properties', async ({ given, when, then }: AllureBddContext) => {
    let markup: Element;

    await given('a format change with null old rPr', () => {});

    await when('format change markup is generated', () => {
      const formatChange: FormatChangeInfo = {
        oldRunProperties: null,
        newRunProperties: el('w:rPr', {}, [el('w:b')]),
        changedProperties: ['bold'],
      };
      markup = generateFormatChangeMarkup(formatChange, {
        author: 'Test',
        dateTime: new Date(),
        id: 1,
      });
    });

    await then('an empty rPr child is generated', () => {
      const markupChildren = childElements(markup);
      const emptyRPrChild = markupChildren[0];
      assertDefined(emptyRPrChild, 'markup children[0]');
      expect(childElements(emptyRPrChild)).toEqual([]);
    });
  });

  test('excludes existing rPrChange from old properties', async ({ given, when, then }: AllureBddContext) => {
    let markup: Element;

    await given('a format change with an rPrChange nested in the old rPr', () => {});

    await when('format change markup is generated', () => {
      const formatChange: FormatChangeInfo = {
        oldRunProperties: el('w:rPr', {}, [
          el('w:b'),
          el('w:rPrChange', { 'w:id': '99' }),
        ]),
        newRunProperties: null,
        changedProperties: ['bold'],
      };
      markup = generateFormatChangeMarkup(formatChange, {
        author: 'Test',
        dateTime: new Date(),
        id: 1,
      });
    });

    await then('the nested rPrChange is excluded from the output', () => {
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
});

describe('mergeFormatChangeIntoRun', () => {
  test('adds rPrChange to existing rPr', async ({ given, when, then }: AllureBddContext) => {
    let runElement: Element;
    let rPrChange: Element;

    await given('a run with an existing rPr and a rPrChange to add', () => {
      runElement = el('w:r', {}, [
        el('w:rPr', {}, [el('w:b')]),
        el('w:t', {}, undefined, 'Test'),
      ]);
      rPrChange = el('w:rPrChange', { 'w:id': '1' });
    });

    await when('the rPrChange is merged into the run', () => {
      mergeFormatChangeIntoRun(runElement, rPrChange);
    });

    await then('the rPrChange is appended to the existing rPr', () => {
      const rPr = childElements(runElement)[0];
      assertDefined(rPr, 'runElement children[0]');
      const rPrChildren = childElements(rPr);
      expect(rPrChildren).toHaveLength(2);
      const rPrSecondChild = rPrChildren[1];
      assertDefined(rPrSecondChild, 'rPr children[1]');
      expect(rPrSecondChild.tagName).toBe('w:rPrChange');
    });
  });

  test('creates rPr if not present', async ({ given, when, then }: AllureBddContext) => {
    let runElement: Element;
    let rPrChange: Element;

    await given('a run without an rPr and a rPrChange to add', () => {
      runElement = el('w:r', {}, [el('w:t', {}, undefined, 'Test')]);
      rPrChange = el('w:rPrChange', { 'w:id': '1' });
    });

    await when('the rPrChange is merged into the run', () => {
      mergeFormatChangeIntoRun(runElement, rPrChange);
    });

    await then('a new rPr is created containing the rPrChange', () => {
      const createdRPr = childElements(runElement)[0];
      assertDefined(createdRPr, 'runElement children[0]');
      expect(createdRPr.tagName).toBe('w:rPr');
      const createdRPrChildren = childElements(createdRPr);
      const createdRPrChild = createdRPrChildren[0];
      assertDefined(createdRPrChild, 'rPr children[0]');
      expect(createdRPrChild.tagName).toBe('w:rPrChange');
    });
  });

  test('does nothing for non-run elements', async ({ given, when, then }: AllureBddContext) => {
    let paragraph: Element;
    let rPrChange: Element;

    await given('a paragraph element and a rPrChange', () => {
      paragraph = el('w:p');
      rPrChange = el('w:rPrChange', { 'w:id': '1' });
    });

    await when('the rPrChange is merged into the paragraph', () => {
      mergeFormatChangeIntoRun(paragraph, rPrChange);
    });

    await then('the paragraph has no children', () => {
      expect(childElements(paragraph)).toEqual([]);
    });
  });
});
