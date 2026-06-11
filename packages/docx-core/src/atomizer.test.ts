import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import {
  sha1,
  hashElement,
  findRevisionTrackingElement,
  getStatusFromRevisionTracking,
  extractAncestorUnids,
  isLeafNode,
  createComparisonUnitAtom,
  atomizeTree,
  getAncestors,
  EMPTY_PARAGRAPH_TAG,
} from './atomizer.js';
import { CorrelationStatus, OpcPart } from './core-types.js';
import { assertDefined } from './testing/test-utils.js';
import { el } from './testing/dom-test-helpers.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Atomizer' });

describe('sha1', () => {
  test('returns consistent hash for same input', async ({ given, when, then }: AllureBddContext) => {
    let hash1: string;
    let hash2: string;

    await given('the same input string', () => {});

    await when('sha1 is called twice', () => {
      hash1 = sha1('hello');
      hash2 = sha1('hello');
    });

    await then('both hashes are equal', () => {
      expect(hash1).toBe(hash2);
    });
  });

  test('returns different hash for different input', async ({ given, when, then }: AllureBddContext) => {
    let hash1: string;
    let hash2: string;

    await given('two different input strings', () => {});

    await when('sha1 is called on each', () => {
      hash1 = sha1('hello');
      hash2 = sha1('world');
    });

    await then('the hashes differ', () => {
      expect(hash1).not.toBe(hash2);
    });
  });

  test('returns 40 character hex string', async ({ given, when, then }: AllureBddContext) => {
    let hash: string;

    await given('an input string', () => {});

    await when('sha1 is called', () => {
      hash = sha1('test');
    });

    await then('the result is a 40-character hex string', () => {
      expect(hash).toHaveLength(40);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });
  });
});

describe('hashElement', () => {
  test('hashes element with tag name', async ({ given, when, then }: AllureBddContext) => {
    let element: Element;
    let hash: string;

    await given('a w:t element', () => {
      element = el('w:t');
    });

    await when('hashElement is called', () => {
      hash = hashElement(element);
    });

    await then('a 40-character hash is returned', () => {
      expect(hash).toHaveLength(40);
    });
  });

  test('includes attributes in hash', async ({ given, when, then }: AllureBddContext) => {
    let element1: Element;
    let element2: Element;

    await given('two elements with and without attributes', () => {
      // Use a meaningful attribute (not xml:space which is intentionally ignored)
      element1 = el('w:b', { 'w:val': 'true' });
      element2 = el('w:b');
    });

    await when('both are hashed', () => {});

    await then('the hashes differ', () => {
      expect(hashElement(element1)).not.toBe(hashElement(element2));
    });
  });

  test('ignores xml:space attribute in hash', async ({ given, when, then }: AllureBddContext) => {
    let element1: Element;
    let element2: Element;

    await given('two elements with same text but different xml:space', () => {
      // xml:space is a presentation hint that should not affect content comparison
      element1 = el('w:t', { 'xml:space': 'preserve' }, undefined, 'Hello');
      element2 = el('w:t', {}, undefined, 'Hello');
    });

    await when('both are hashed', () => {});

    await then('the hashes are equal', () => {
      // Same text content should produce same hash regardless of xml:space
      expect(hashElement(element1)).toBe(hashElement(element2));
    });
  });

  test('includes text content in hash', async ({ given, when, then }: AllureBddContext) => {
    let element1: Element;
    let element2: Element;

    await given('two elements with different text content', () => {
      element1 = el('w:t', {}, undefined, 'Hello');
      element2 = el('w:t', {}, undefined, 'World');
    });

    await when('both are hashed', () => {});

    await then('the hashes differ', () => {
      expect(hashElement(element1)).not.toBe(hashElement(element2));
    });
  });

  test('produces deterministic hash regardless of attribute order', async ({ given, when, then }: AllureBddContext) => {
    let element1: Element;
    let element2: Element;

    await given('two elements with same attributes in different order', () => {
      element1 = el('w:ins', { 'w:id': '1', 'w:author': 'John' });
      element2 = el('w:ins', { 'w:author': 'John', 'w:id': '1' });
    });

    await when('both are hashed', () => {});

    await then('the hashes are equal', () => {
      expect(hashElement(element1)).toBe(hashElement(element2));
    });
  });
});

describe('findRevisionTrackingElement', () => {
  test('returns undefined for empty ancestors', async ({ given, when, then }: AllureBddContext) => {
    await given('an empty ancestors array', () => {});
    await when('findRevisionTrackingElement is called', () => {});
    await then('undefined is returned', () => {
      expect(findRevisionTrackingElement([])).toBeUndefined();
    });
  });

  test('finds w:ins in ancestors', async ({ given, when, then }: AllureBddContext) => {
    let ins: Element;

    await given('an ancestors array containing a w:ins element', () => {
      ins = el('w:ins', { 'w:id': '1', 'w:author': 'John' });
    });

    await when('findRevisionTrackingElement is called', () => {});

    await then('the w:ins element is returned', () => {
      expect(findRevisionTrackingElement([ins])).toBe(ins);
    });
  });

  test('finds w:del in ancestors', async ({ given, when, then }: AllureBddContext) => {
    let del: Element;

    await given('an ancestors array containing a w:del element', () => {
      del = el('w:del', { 'w:id': '2' });
    });

    await when('findRevisionTrackingElement is called', () => {});

    await then('the w:del element is returned', () => {
      expect(findRevisionTrackingElement([del])).toBe(del);
    });
  });

  test('finds w:moveFrom in ancestors', async ({ given, when, then }: AllureBddContext) => {
    let moveFrom: Element;

    await given('an ancestors array containing a w:moveFrom element', () => {
      moveFrom = el('w:moveFrom', { 'w:id': '3' });
    });

    await when('findRevisionTrackingElement is called', () => {});

    await then('the w:moveFrom element is returned', () => {
      expect(findRevisionTrackingElement([moveFrom])).toBe(moveFrom);
    });
  });

  test('finds w:moveTo in ancestors', async ({ given, when, then }: AllureBddContext) => {
    let moveTo: Element;

    await given('an ancestors array containing a w:moveTo element', () => {
      moveTo = el('w:moveTo', { 'w:id': '4' });
    });

    await when('findRevisionTrackingElement is called', () => {});

    await then('the w:moveTo element is returned', () => {
      expect(findRevisionTrackingElement([moveTo])).toBe(moveTo);
    });
  });

  test('returns nearest revision element', async ({ given, when, then }: AllureBddContext) => {
    let outerIns: Element;
    let innerDel: Element;

    await given('an ancestors array with an outer ins and an inner del', () => {
      outerIns = el('w:ins', { 'w:id': '1' });
      innerDel = el('w:del', { 'w:id': '2' });
    });

    await when('findRevisionTrackingElement is called', () => {});

    await then('the innermost revision element is returned', () => {
      // innerDel is more recent (later in array = closer ancestor)
      const ancestors = [outerIns, innerDel];
      expect(findRevisionTrackingElement(ancestors)).toBe(innerDel);
    });
  });

  test('ignores non-revision elements', async ({ given, when, then }: AllureBddContext) => {
    let ins: Element;

    await given('an ancestors array with mixed revision and non-revision elements', () => {
      ins = el('w:ins', { 'w:id': '1' });
    });

    await when('findRevisionTrackingElement is called', () => {});

    await then('only the revision element is returned', () => {
      const paragraph = el('w:p');
      const run = el('w:r');
      const ancestors = [paragraph, ins, run];
      expect(findRevisionTrackingElement(ancestors)).toBe(ins);
    });
  });
});

describe('getStatusFromRevisionTracking', () => {
  test('returns Unknown for undefined', async ({ given, when, then }: AllureBddContext) => {
    await given('undefined as input', () => {});
    await when('getStatusFromRevisionTracking is called', () => {});
    await then('Unknown is returned', () => {
      expect(getStatusFromRevisionTracking(undefined)).toBe(CorrelationStatus.Unknown);
    });
  });

  test('returns Inserted for w:ins', async ({ given, when, then }: AllureBddContext) => {
    let ins: Element;

    await given('a w:ins element', () => {
      ins = el('w:ins');
    });

    await when('getStatusFromRevisionTracking is called', () => {});

    await then('Inserted is returned', () => {
      expect(getStatusFromRevisionTracking(ins)).toBe(CorrelationStatus.Inserted);
    });
  });

  test('returns Deleted for w:del', async ({ given, when, then }: AllureBddContext) => {
    let del: Element;

    await given('a w:del element', () => {
      del = el('w:del');
    });

    await when('getStatusFromRevisionTracking is called', () => {});

    await then('Deleted is returned', () => {
      expect(getStatusFromRevisionTracking(del)).toBe(CorrelationStatus.Deleted);
    });
  });

  test('returns MovedSource for w:moveFrom', async ({ given, when, then }: AllureBddContext) => {
    let moveFrom: Element;

    await given('a w:moveFrom element', () => {
      moveFrom = el('w:moveFrom');
    });

    await when('getStatusFromRevisionTracking is called', () => {});

    await then('MovedSource is returned', () => {
      expect(getStatusFromRevisionTracking(moveFrom)).toBe(CorrelationStatus.MovedSource);
    });
  });

  test('returns MovedDestination for w:moveTo', async ({ given, when, then }: AllureBddContext) => {
    let moveTo: Element;

    await given('a w:moveTo element', () => {
      moveTo = el('w:moveTo');
    });

    await when('getStatusFromRevisionTracking is called', () => {});

    await then('MovedDestination is returned', () => {
      expect(getStatusFromRevisionTracking(moveTo)).toBe(CorrelationStatus.MovedDestination);
    });
  });

  test('returns Unknown for unrecognized element', async ({ given, when, then }: AllureBddContext) => {
    let other: Element;

    await given('an unrecognized element', () => {
      other = el('w:r');
    });

    await when('getStatusFromRevisionTracking is called', () => {});

    await then('Unknown is returned', () => {
      expect(getStatusFromRevisionTracking(other)).toBe(CorrelationStatus.Unknown);
    });
  });
});

describe('extractAncestorUnids', () => {
  test('returns empty array for no ancestors', async ({ given, when, then }: AllureBddContext) => {
    await given('an empty ancestors array', () => {});
    await when('extractAncestorUnids is called', () => {});
    await then('an empty array is returned', () => {
      expect(extractAncestorUnids([])).toEqual([]);
    });
  });

  test('extracts w:Unid attributes', async ({ given, when, then }: AllureBddContext) => {
    let ancestors: Element[];

    await given('ancestors with w:Unid attributes', () => {
      ancestors = [
        el('w:p', { 'w:Unid': 'unid-1' }),
        el('w:r', { 'w:Unid': 'unid-2' }),
      ];
    });

    await when('extractAncestorUnids is called', () => {});

    await then('the unids are extracted', () => {
      expect(extractAncestorUnids(ancestors)).toEqual(['unid-1', 'unid-2']);
    });
  });

  test('skips elements without Unid', async ({ given, when, then }: AllureBddContext) => {
    let ancestors: Element[];

    await given('ancestors where some lack w:Unid', () => {
      ancestors = [
        el('w:p', { 'w:Unid': 'unid-1' }),
        el('w:r'),
        el('w:ins', { 'w:Unid': 'unid-3' }),
      ];
    });

    await when('extractAncestorUnids is called', () => {});

    await then('only elements with Unid are included', () => {
      expect(extractAncestorUnids(ancestors)).toEqual(['unid-1', 'unid-3']);
    });
  });
});

describe('isLeafNode', () => {
  test('returns true for w:t', async ({ given, when, then }: AllureBddContext) => {
    let text: Element;

    await given('a w:t element', () => {
      text = el('w:t', {}, undefined, 'Hello');
    });

    await when('isLeafNode is called', () => {});

    await then('true is returned', () => {
      expect(isLeafNode(text)).toBe(true);
    });
  });

  test('returns true for w:br', async ({ given, when, then }: AllureBddContext) => {
    let br: Element;

    await given('a w:br element', () => {
      br = el('w:br');
    });

    await when('isLeafNode is called', () => {});

    await then('true is returned', () => {
      expect(isLeafNode(br)).toBe(true);
    });
  });

  test('returns true for w:tab', async ({ given, when, then }: AllureBddContext) => {
    let tab: Element;

    await given('a w:tab element', () => {
      tab = el('w:tab');
    });

    await when('isLeafNode is called', () => {});

    await then('true is returned', () => {
      expect(isLeafNode(tab)).toBe(true);
    });
  });

  test('returns true for w:footnoteReference', async ({ given, when, then }: AllureBddContext) => {
    let fnRef: Element;

    await given('a w:footnoteReference element', () => {
      fnRef = el('w:footnoteReference', { 'w:id': '1' });
    });

    await when('isLeafNode is called', () => {});

    await then('true is returned', () => {
      expect(isLeafNode(fnRef)).toBe(true);
    });
  });

  test('returns false for w:p', async ({ given, when, then }: AllureBddContext) => {
    let paragraph: Element;

    await given('a w:p element', () => {
      paragraph = el('w:p');
    });

    await when('isLeafNode is called', () => {});

    await then('false is returned', () => {
      expect(isLeafNode(paragraph)).toBe(false);
    });
  });

  test('returns false for w:r', async ({ given, when, then }: AllureBddContext) => {
    let run: Element;

    await given('a w:r element', () => {
      run = el('w:r');
    });

    await when('isLeafNode is called', () => {});

    await then('false is returned', () => {
      expect(isLeafNode(run)).toBe(false);
    });
  });
});

describe('createComparisonUnitAtom', () => {
  const mockPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  test('creates atom with basic properties', async ({ given, when, then }: AllureBddContext) => {
    let textElement: Element;
    let atom: ReturnType<typeof createComparisonUnitAtom>;

    await given('a text element and empty ancestors', () => {
      textElement = el('w:t', {}, undefined, 'Hello');
    });

    await when('createComparisonUnitAtom is called', () => {
      atom = createComparisonUnitAtom({
        contentElement: textElement,
        ancestors: [],
        part: mockPart,
      });
    });

    await then('the atom has basic properties set', () => {
      expect(atom.contentElement).toBe(textElement);
      expect(atom.part).toBe(mockPart);
      expect(atom.sha1Hash).toHaveLength(40);
      expect(atom.correlationStatus).toBe(CorrelationStatus.Unknown);
    });
  });

  test('detects inserted status from w:ins ancestor', async ({ given, when, then }: AllureBddContext) => {
    let textElement: Element;
    let insElement: Element;
    let atom: ReturnType<typeof createComparisonUnitAtom>;

    await given('a text element inside a w:ins ancestor', () => {
      textElement = el('w:t', {}, undefined, 'New');
      insElement = el('w:ins', { 'w:id': '1' });
    });

    await when('createComparisonUnitAtom is called', () => {
      atom = createComparisonUnitAtom({
        contentElement: textElement,
        ancestors: [insElement],
        part: mockPart,
      });
    });

    await then('the atom has Inserted status', () => {
      expect(atom.correlationStatus).toBe(CorrelationStatus.Inserted);
      expect(atom.revTrackElement).toBe(insElement);
    });
  });

  test('detects deleted status from w:del ancestor', async ({ given, when, then }: AllureBddContext) => {
    let textElement: Element;
    let delElement: Element;
    let atom: ReturnType<typeof createComparisonUnitAtom>;

    await given('a delText element inside a w:del ancestor', () => {
      textElement = el('w:delText', {}, undefined, 'Old');
      delElement = el('w:del', { 'w:id': '2' });
    });

    await when('createComparisonUnitAtom is called', () => {
      atom = createComparisonUnitAtom({
        contentElement: textElement,
        ancestors: [delElement],
        part: mockPart,
      });
    });

    await then('the atom has Deleted status', () => {
      expect(atom.correlationStatus).toBe(CorrelationStatus.Deleted);
      expect(atom.revTrackElement).toBe(delElement);
    });
  });

  test('extracts ancestor unids', async ({ given, when, then }: AllureBddContext) => {
    let atom: ReturnType<typeof createComparisonUnitAtom>;

    await given('ancestors with Unid attributes', () => {});

    await when('createComparisonUnitAtom is called', () => {
      const textElement = el('w:t', {}, undefined, 'Test');
      const paragraph = el('w:p', { 'w:Unid': 'para-1' });
      const run = el('w:r', { 'w:Unid': 'run-1' });
      atom = createComparisonUnitAtom({
        contentElement: textElement,
        ancestors: [paragraph, run],
        part: mockPart,
      });
    });

    await then('the ancestor unids are extracted', () => {
      expect(atom.ancestorUnids).toEqual(['para-1', 'run-1']);
    });
  });

  test('copies ancestors to avoid mutation', async ({ given, when, then }: AllureBddContext) => {
    let ancestors: Element[];
    let atom: ReturnType<typeof createComparisonUnitAtom>;

    await given('an ancestors array', () => {
      ancestors = [el('w:p')];
    });

    await when('createComparisonUnitAtom is called and ancestors are mutated', () => {
      const textElement = el('w:t', {}, undefined, 'Test');
      atom = createComparisonUnitAtom({
        contentElement: textElement,
        ancestors,
        part: mockPart,
      });
      // Modify original array
      ancestors.push(el('w:r'));
    });

    await then('the atom ancestors are unchanged', () => {
      // Atom's ancestors should be unchanged
      expect(atom.ancestorElements).toHaveLength(1);
    });
  });
});

describe('atomizeTree', () => {
  const mockPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  test('atomizes a simple paragraph', async ({ given, when, then }: AllureBddContext) => {
    let document: Element;
    let atoms: ReturnType<typeof atomizeTree>['atoms'];

    await given('a simple paragraph element', () => {
      document = el('w:p', {}, [
        el('w:r', {}, [el('w:t', {}, undefined, 'Hello World')]),
      ]);
    });

    await when('the tree is atomized', () => {
      ({ atoms } = atomizeTree(document, [], mockPart));
    });

    await then('the text is word-split into three atoms', () => {
      // Word-level splitting produces ["Hello", " ", "World"]
      expect(atoms).toHaveLength(3);
      const atom0 = atoms[0];
      const atom1 = atoms[1];
      const atom2 = atoms[2];
      assertDefined(atom0, 'atoms[0]');
      assertDefined(atom1, 'atoms[1]');
      assertDefined(atom2, 'atoms[2]');
      expect(atom0.contentElement.textContent).toBe('Hello');
      expect(atom1.contentElement.textContent).toBe(' ');
      expect(atom2.contentElement.textContent).toBe('World');
    });
  });

  test('atomizes and normalizes multiple runs with same formatting', async ({ given, when, then }: AllureBddContext) => {
    let document: Element;
    let atoms: ReturnType<typeof atomizeTree>['atoms'];

    await given('a paragraph with multiple runs having the same formatting', () => {
      // Multiple runs with the same formatting (none) are merged during normalization
      document = el('w:p', {}, [
        el('w:r', {}, [el('w:t', {}, undefined, 'Hello ')]),
        el('w:r', {}, [el('w:t', {}, undefined, 'World')]),
      ]);
    });

    await when('the tree is atomized', () => {
      ({ atoms } = atomizeTree(document, [], mockPart));
    });

    await then('runs are merged then word-split into three atoms', () => {
      // Merged into 1 atom due to same formatting, then word-split to 3
      expect(atoms).toHaveLength(3);
      const atom0 = atoms[0];
      const atom1 = atoms[1];
      const atom2 = atoms[2];
      assertDefined(atom0, 'atoms[0]');
      assertDefined(atom1, 'atoms[1]');
      assertDefined(atom2, 'atoms[2]');
      expect(atom0.contentElement.textContent).toBe('Hello');
      expect(atom1.contentElement.textContent).toBe(' ');
      expect(atom2.contentElement.textContent).toBe('World');
    });
  });

  test('includes ancestor chain for each atom', async ({ given, when, then }: AllureBddContext) => {
    let document: Element;
    let atoms: ReturnType<typeof atomizeTree>['atoms'];

    await given('a paragraph with Unid attributes on p and r', () => {
      document = el('w:p', { 'w:Unid': 'para-1' }, [
        el('w:r', { 'w:Unid': 'run-1' }, [el('w:t', {}, undefined, 'Test')]),
      ]);
    });

    await when('the tree is atomized', () => {
      ({ atoms } = atomizeTree(document, [], mockPart));
    });

    await then('the atom has both p and r as ancestors', () => {
      const atom0 = atoms[0];
      assertDefined(atom0, 'atoms[0]');
      expect(atom0.ancestorElements).toHaveLength(2); // p and r
      const ancestor0 = atom0.ancestorElements[0];
      const ancestor1 = atom0.ancestorElements[1];
      assertDefined(ancestor0, 'ancestorElements[0]');
      assertDefined(ancestor1, 'ancestorElements[1]');
      expect(ancestor0.tagName).toBe('w:p');
      expect(ancestor1.tagName).toBe('w:r');
    });
  });

  test('handles revision tracking elements', async ({ given, when, then }: AllureBddContext) => {
    let document: Element;
    let atoms: ReturnType<typeof atomizeTree>['atoms'];

    await given('a paragraph with a w:ins element', () => {
      document = el('w:p', {}, [
        el('w:ins', { 'w:id': '1', 'w:author': 'John' }, [
          el('w:r', {}, [el('w:t', {}, undefined, 'New text')]),
        ]),
      ]);
    });

    await when('the tree is atomized', () => {
      ({ atoms } = atomizeTree(document, [], mockPart));
    });

    await then('atoms are marked as inserted', () => {
      // "New text" splits to ["New", " ", "text"]
      expect(atoms).toHaveLength(3);
      const atom0 = atoms[0];
      assertDefined(atom0, 'atoms[0]');
      expect(atom0.correlationStatus).toBe(CorrelationStatus.Inserted);
      expect(atom0.revTrackElement?.tagName).toBe('w:ins');
      expect(atom0.contentElement.textContent).toBe('New');
    });
  });

  test('atomizes leaf nodes like breaks and tabs', async ({ given, when, then }: AllureBddContext) => {
    let document: Element;
    let atoms: ReturnType<typeof atomizeTree>['atoms'];

    await given('a run with text, a break, and more text', () => {
      document = el('w:r', {}, [
        el('w:t', {}, undefined, 'Before'),
        el('w:br'),
        el('w:t', {}, undefined, 'After'),
      ]);
    });

    await when('the tree is atomized', () => {
      ({ atoms } = atomizeTree(document, [], mockPart));
    });

    await then('each leaf node is a separate atom', () => {
      expect(atoms).toHaveLength(3);
      const atom0 = atoms[0];
      const atom1 = atoms[1];
      const atom2 = atoms[2];
      assertDefined(atom0, 'atoms[0]');
      assertDefined(atom1, 'atoms[1]');
      assertDefined(atom2, 'atoms[2]');
      expect(atom0.contentElement.tagName).toBe('w:t');
      expect(atom1.contentElement.tagName).toBe('w:br');
      expect(atom2.contentElement.tagName).toBe('w:t');
    });
  });
});

describe('move-range marker atomization (issue #110)', () => {
  const mockPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  function paragraphWithTrackedMove(): Element {
    return el('w:p', {}, [
      el('w:moveFromRangeStart', {
        'w:id': '300',
        'w:name': 'userMove1',
        'w:author': 'Mover',
        'w:date': '2025-01-01T00:00:00Z',
      }),
      el('w:moveFrom', { 'w:id': '301', 'w:author': 'Mover', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:delText', {}, undefined, 'moved')]),
      ]),
      el('w:moveFromRangeEnd', { 'w:id': '300' }),
      el('w:moveToRangeStart', {
        'w:id': '302',
        'w:name': 'userMove1',
        'w:author': 'Mover',
        'w:date': '2025-01-01T00:00:00Z',
      }),
      el('w:moveTo', { 'w:id': '303', 'w:author': 'Mover', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:t', {}, undefined, 'moved')]),
      ]),
      el('w:moveToRangeEnd', { 'w:id': '302' }),
    ]);
  }

  test('move-range markers inside w:p become atoms when atomizeParagraphLevelMarkers is true', async ({ given, when, then }: AllureBddContext) => {
    let body: Element;
    let atoms: ReturnType<typeof atomizeTree>['atoms'];

    await given('a body whose paragraph carries an explicit tracked move with range markers', () => {
      body = el('w:body', {}, [paragraphWithTrackedMove()]);
    });

    await when('the tree is atomized with paragraph-level markers enabled', () => {
      ({ atoms } = atomizeTree(body, [], mockPart, { atomizeParagraphLevelMarkers: true }));
    });

    await then('all four move-range marker kinds appear as atoms', () => {
      const tags = atoms.map((a) => a.contentElement.tagName);
      expect(tags).toContain('w:moveFromRangeStart');
      expect(tags).toContain('w:moveFromRangeEnd');
      expect(tags).toContain('w:moveToRangeStart');
      expect(tags).toContain('w:moveToRangeEnd');
    });
  });

  test('move-range markers are NOT atomized when atomizeParagraphLevelMarkers is false', async ({ given, when, then }: AllureBddContext) => {
    let body: Element;
    let atoms: ReturnType<typeof atomizeTree>['atoms'];

    await given('a body whose paragraph carries an explicit tracked move with range markers', () => {
      body = el('w:body', {}, [paragraphWithTrackedMove()]);
    });

    await when('the tree is atomized with default options', () => {
      ({ atoms } = atomizeTree(body, [], mockPart));
    });

    await then('no move-range marker atoms enter the stream', () => {
      const tags = atoms.map((a) => a.contentElement.tagName);
      expect(tags).not.toContain('w:moveFromRangeStart');
      expect(tags).not.toContain('w:moveFromRangeEnd');
      expect(tags).not.toContain('w:moveToRangeStart');
      expect(tags).not.toContain('w:moveToRangeEnd');
    });
  });

  test('body-level move-range markers stay out of the atom stream', async ({ given, when, then }: AllureBddContext) => {
    let body: Element;
    let atoms: ReturnType<typeof atomizeTree>['atoms'];

    await given('move-range markers that are siblings of w:p at body level', () => {
      body = el('w:body', {}, [
        el('w:moveFromRangeStart', {
          'w:id': '300',
          'w:name': 'userMove1',
          'w:author': 'Mover',
          'w:date': '2025-01-01T00:00:00Z',
        }),
        el('w:p', {}, [el('w:r', {}, [el('w:t', {}, undefined, 'text')])]),
        el('w:moveFromRangeEnd', { 'w:id': '300' }),
      ]);
    });

    await when('the tree is atomized with paragraph-level markers enabled', () => {
      ({ atoms } = atomizeTree(body, [], mockPart, { atomizeParagraphLevelMarkers: true }));
    });

    await then('only the paragraph content is atomized — markers are scaffold-handled', () => {
      const tags = atoms.map((a) => a.contentElement.tagName);
      expect(tags).not.toContain('w:moveFromRangeStart');
      expect(tags).not.toContain('w:moveFromRangeEnd');
    });
  });
});

describe('empty paragraph context hashing', () => {
  const mockPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  function textParagraph(text: string): Element {
    return el('w:p', {}, [el('w:r', {}, [el('w:t', {}, undefined, text)])]);
  }

  function emptyParagraph(children: Element[] = []): Element {
    return el('w:p', {}, children);
  }

  function emptyAtoms(document: Element): ReturnType<typeof atomizeTree>['atoms'] {
    return atomizeTree(document, [], mockPart, {
      atomizeParagraphLevelMarkers: true,
    }).atoms.filter((atom) => atom.contentElement.tagName === EMPTY_PARAGRAPH_TAG);
  }

  function defaultEmptyAtoms(document: Element): ReturnType<typeof atomizeTree>['atoms'] {
    return atomizeTree(document, [], mockPart).atoms.filter(
      (atom) => atom.contentElement.tagName === EMPTY_PARAGRAPH_TAG
    );
  }

  test('keeps empty paragraph hashes stable when preceding run text is merged', async ({ given, when, then }: AllureBddContext) => {
    let splitBody: Element;
    let mergedBody: Element;
    let splitEmptyHash: string;
    let mergedEmptyHash: string;

    await given('two bodies whose preceding paragraph has identical text with different w:t boundaries', () => {
      splitBody = el('w:body', {}, [
        el('w:p', {}, [
          el('w:r', {}, [el('w:t', {}, undefined, 'of ')]),
          el('w:r', {}, [el('w:t', {}, undefined, 'Disclosure.')]),
        ]),
        emptyParagraph(),
      ]);
      mergedBody = el('w:body', {}, [
        el('w:p', {}, [el('w:r', {}, [el('w:t', {}, undefined, 'of Disclosure.')])]),
        emptyParagraph(),
      ]);
    });

    await when('both bodies are atomized', () => {
      const splitEmpty = emptyAtoms(splitBody)[0];
      const mergedEmpty = emptyAtoms(mergedBody)[0];
      assertDefined(splitEmpty, 'split empty paragraph atom');
      assertDefined(mergedEmpty, 'merged empty paragraph atom');
      splitEmptyHash = splitEmpty.sha1Hash;
      mergedEmptyHash = mergedEmpty.sha1Hash;
    });

    await then('the empty paragraph hashes match', () => {
      expect(splitEmptyHash).toBe(mergedEmptyHash);
    });
  });

  test('disambiguates consecutive empty paragraphs after the same content', async ({ given, when, then }: AllureBddContext) => {
    let body: Element;
    let empties: ReturnType<typeof atomizeTree>['atoms'];

    await given('two consecutive empty paragraphs after a content paragraph', () => {
      body = el('w:body', {}, [textParagraph('alpha'), emptyParagraph(), emptyParagraph()]);
    });

    await when('the body is atomized', () => {
      empties = emptyAtoms(body);
    });

    await then('the empty paragraph hashes differ', () => {
      expect(empties).toHaveLength(2);
      expect(empties[0]?.sha1Hash).not.toBe(empties[1]?.sha1Hash);
    });
  });

  test('pins shallow paragraph property hashing for empty paragraphs', async ({ given, when, then }: AllureBddContext) => {
    let noPPrHash: string;
    let barePPrHash: string;
    let attributedPPrHash: string;
    let childPPrHash: string;

    await given('empty paragraphs with absent, bare, attributed, and child-bearing pPr', () => {});

    await when('each empty paragraph is atomized after identical content', () => {
      const hashFor = (paragraph: Element) => {
        const atom = emptyAtoms(el('w:body', {}, [textParagraph('alpha'), paragraph]))[0];
        assertDefined(atom, 'empty paragraph atom');
        return atom.sha1Hash;
      };

      noPPrHash = hashFor(emptyParagraph());
      barePPrHash = hashFor(emptyParagraph([el('w:pPr')]));
      attributedPPrHash = hashFor(emptyParagraph([el('w:pPr', { 'w:rsidR': '00112233' })]));
      childPPrHash = hashFor(emptyParagraph([el('w:pPr', {}, [el('w:rPr', {}, [el('w:b')])])]));
    });

    await then('pPr presence and attributes matter, while pPr children are ignored', () => {
      expect(noPPrHash).not.toBe(barePPrHash);
      expect(barePPrHash).not.toBe(attributedPPrHash);
      expect(barePPrHash).toBe(childPPrHash);
    });
  });

  test('keeps later empty paragraph hashes stable after an inserted empty paragraph elsewhere', async ({ given, when, then }: AllureBddContext) => {
    let originalBody: Element;
    let revisedBody: Element;
    let originalLaterEmptyHash: string;
    let revisedLaterEmptyHash: string;

    await given('one body has a new empty paragraph before unchanged later content', () => {
      originalBody = el('w:body', {}, [textParagraph('one'), textParagraph('two'), emptyParagraph()]);
      revisedBody = el('w:body', {}, [
        textParagraph('one'),
        emptyParagraph(),
        textParagraph('two'),
        emptyParagraph(),
      ]);
    });

    await when('both bodies are atomized', () => {
      const originalEmpty = emptyAtoms(originalBody)[0];
      const revisedEmpties = emptyAtoms(revisedBody);
      assertDefined(originalEmpty, 'original later empty paragraph atom');
      assertDefined(revisedEmpties[1], 'revised later empty paragraph atom');
      originalLaterEmptyHash = originalEmpty.sha1Hash;
      revisedLaterEmptyHash = revisedEmpties[1].sha1Hash;
    });

    await then('the later unchanged empty paragraph hashes match', () => {
      expect(originalLaterEmptyHash).toBe(revisedLaterEmptyHash);
    });
  });

  test('keeps non-text leaf context distinctions', async ({ given, when, then }: AllureBddContext) => {
    let tabBody: Element;
    let breakBody: Element;
    let tabEmptyHash: string;
    let breakEmptyHash: string;

    await given('empty paragraphs following tab-only and break-only paragraphs', () => {
      tabBody = el('w:body', {}, [el('w:p', {}, [el('w:r', {}, [el('w:tab')])]), emptyParagraph()]);
      breakBody = el('w:body', {}, [el('w:p', {}, [el('w:r', {}, [el('w:br')])]), emptyParagraph()]);
    });

    await when('both bodies are atomized', () => {
      const tabEmpty = emptyAtoms(tabBody)[0];
      const breakEmpty = emptyAtoms(breakBody)[0];
      assertDefined(tabEmpty, 'tab-context empty paragraph atom');
      assertDefined(breakEmpty, 'break-context empty paragraph atom');
      tabEmptyHash = tabEmpty.sha1Hash;
      breakEmptyHash = breakEmpty.sha1Hash;
    });

    await then('the empty paragraph hashes differ', () => {
      expect(tabEmptyHash).not.toBe(breakEmptyHash);
    });
  });

  test('treats marker-only and proofErr-only paragraphs as content-transparent', async ({ given, when, then }: AllureBddContext) => {
    let baselineBody: Element;
    let bookmarkBody: Element;
    let proofErrBody: Element;
    let baselineHash: string;
    let bookmarkHash: string;
    let proofErrHash: string;
    let proofErrEmptyCount: number;

    await given('empty paragraphs after content-transparent marker-only paragraphs', () => {
      baselineBody = el('w:body', {}, [textParagraph('alpha'), emptyParagraph()]);
      bookmarkBody = el('w:body', {}, [
        textParagraph('alpha'),
        el('w:p', {}, [el('w:bookmarkStart', { 'w:id': '7', 'w:name': 'marker' })]),
        emptyParagraph(),
      ]);
      proofErrBody = el('w:body', {}, [
        textParagraph('alpha'),
        el('w:p', {}, [el('w:proofErr', { 'w:type': 'spellStart' })]),
        emptyParagraph(),
      ]);
    });

    await when('the bodies are atomized with paragraph-level markers enabled', () => {
      const baselineEmpty = emptyAtoms(baselineBody)[0];
      const bookmarkEmpty = emptyAtoms(bookmarkBody)[0];
      const proofErrEmpties = emptyAtoms(proofErrBody);
      const proofErrEmpty = proofErrEmpties[0];
      assertDefined(baselineEmpty, 'baseline empty paragraph atom');
      assertDefined(bookmarkEmpty, 'bookmark-context empty paragraph atom');
      assertDefined(proofErrEmpty, 'proofErr-context empty paragraph atom');
      baselineHash = baselineEmpty.sha1Hash;
      bookmarkHash = bookmarkEmpty.sha1Hash;
      proofErrHash = proofErrEmpty.sha1Hash;
      proofErrEmptyCount = proofErrEmpties.length;
    });

    await then('the following empty paragraph hashes match the baseline', () => {
      expect(proofErrEmptyCount).toBe(2);
      expect(bookmarkHash).toBe(baselineHash);
      expect(proofErrHash).toBe(baselineHash);
    });
  });

  test('proofErr-only paragraphs hash like stripped empty paragraphs', async ({ given, when, then }: AllureBddContext) => {
    let bareProofErrBody: Element;
    let bareStrippedBody: Element;
    let pPrProofErrBody: Element;
    let pPrStrippedBody: Element;
    let bareProofErrHash: string;
    let bareStrippedHash: string;
    let pPrProofErrHash: string;
    let pPrStrippedHash: string;

    await given('proofErr-only paragraphs and matching stripped empty paragraphs', () => {
      const pPr = () => el('w:pPr', {}, [el('w:spacing', { 'w:after': '0' })]);
      const proofErr = () => el('w:proofErr', { 'w:type': 'spellStart' });
      bareProofErrBody = el('w:body', {}, [textParagraph('alpha'), emptyParagraph([proofErr()])]);
      bareStrippedBody = el('w:body', {}, [textParagraph('alpha'), emptyParagraph()]);
      pPrProofErrBody = el('w:body', {}, [textParagraph('alpha'), emptyParagraph([pPr(), proofErr()])]);
      pPrStrippedBody = el('w:body', {}, [textParagraph('alpha'), emptyParagraph([pPr()])]);
    });

    await when('the bodies are atomized with paragraph-level markers enabled', () => {
      const bareProofErr = emptyAtoms(bareProofErrBody)[0];
      const bareStripped = emptyAtoms(bareStrippedBody)[0];
      const pPrProofErr = emptyAtoms(pPrProofErrBody)[0];
      const pPrStripped = emptyAtoms(pPrStrippedBody)[0];
      assertDefined(bareProofErr, 'bare proofErr empty atom');
      assertDefined(bareStripped, 'bare stripped empty atom');
      assertDefined(pPrProofErr, 'pPr proofErr empty atom');
      assertDefined(pPrStripped, 'pPr stripped empty atom');
      bareProofErrHash = bareProofErr.sha1Hash;
      bareStrippedHash = bareStripped.sha1Hash;
      pPrProofErrHash = pPrProofErr.sha1Hash;
      pPrStrippedHash = pPrStripped.sha1Hash;
    });

    await then('proofErr anchors do not affect empty-paragraph hashes', () => {
      expect(bareProofErrHash).toBe(bareStrippedHash);
      expect(pPrProofErrHash).toBe(pPrStrippedHash);
    });
  });

  test('proofErr-only paragraphs atomize as empty paragraphs with default options', async ({ given, when, then }: AllureBddContext) => {
    let proofErrBody: Element;
    let strippedBody: Element;
    let proofErrHash: string;
    let strippedHash: string;

    await given('a proofErr-only paragraph and its stripped counterpart', () => {
      proofErrBody = el('w:body', {}, [
        textParagraph('alpha'),
        emptyParagraph([el('w:proofErr', { 'w:type': 'gramStart' })]),
      ]);
      strippedBody = el('w:body', {}, [textParagraph('alpha'), emptyParagraph()]);
    });

    await when('the bodies are atomized with default options', () => {
      const proofErrEmpty = defaultEmptyAtoms(proofErrBody)[0];
      const strippedEmpty = defaultEmptyAtoms(strippedBody)[0];
      assertDefined(proofErrEmpty, 'default proofErr empty atom');
      assertDefined(strippedEmpty, 'default stripped empty atom');
      proofErrHash = proofErrEmpty.sha1Hash;
      strippedHash = strippedEmpty.sha1Hash;
    });

    await then('their empty-paragraph hashes match', () => {
      expect(proofErrHash).toBe(strippedHash);
    });
  });
});

describe('atom boundary normalization', () => {
  const mockPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  test('merges contiguous w:t elements in same run', async ({ given, when, then }: AllureBddContext) => {
    let document: Element;
    let atoms: ReturnType<typeof atomizeTree>['atoms'];

    await given('a run with multiple contiguous w:t elements', () => {
      document = el('w:p', {}, [
        el('w:r', {}, [
          el('w:t', {}, undefined, 'Hello'),
          el('w:t', {}, undefined, ' '),
          el('w:t', {}, undefined, 'World'),
        ]),
      ]);
    });

    await when('the tree is atomized', () => {
      ({ atoms } = atomizeTree(document, [], mockPart));
    });

    await then('the texts are merged then word-split into three atoms', () => {
      // Merged then word-split: ["Hello", " ", "World"]
      expect(atoms).toHaveLength(3);
      const atom0 = atoms[0];
      const atom1 = atoms[1];
      const atom2 = atoms[2];
      assertDefined(atom0, 'atoms[0]');
      assertDefined(atom1, 'atoms[1]');
      assertDefined(atom2, 'atoms[2]');
      expect(atom0.contentElement.textContent).toBe('Hello');
      expect(atom1.contentElement.textContent).toBe(' ');
      expect(atom2.contentElement.textContent).toBe('World');
    });
  });

  test('merges w:t elements across runs with same formatting', async ({ given, when, then }: AllureBddContext) => {
    let document: Element;
    let atoms: ReturnType<typeof atomizeTree>['atoms'];

    await given('two runs with the same bold formatting', () => {
      document = el('w:p', {}, [
        el('w:r', {}, [
          el('w:rPr', {}, [el('w:b')]),
          el('w:t', {}, undefined, 'Def'),
        ]),
        el('w:r', {}, [
          el('w:rPr', {}, [el('w:b')]),
          el('w:t', {}, undefined, 'initions'),
        ]),
      ]);
    });

    await when('the tree is atomized', () => {
      ({ atoms } = atomizeTree(document, [], mockPart));
    });

    await then('the texts are merged into a single atom', () => {
      expect(atoms).toHaveLength(1);
      const atom0 = atoms[0];
      assertDefined(atom0, 'atoms[0]');
      expect(atom0.contentElement.textContent).toBe('Definitions');
    });
  });

  test('does not merge across runs with different formatting', async ({ given, when, then }: AllureBddContext) => {
    let document: Element;
    let atoms: ReturnType<typeof atomizeTree>['atoms'];

    await given('two runs with different formatting', () => {
      document = el('w:p', {}, [
        el('w:r', {}, [
          el('w:rPr', {}, [el('w:b')]),
          el('w:t', {}, undefined, 'Bold'),
        ]),
        el('w:r', {}, [
          el('w:rPr', {}, [el('w:i')]),
          el('w:t', {}, undefined, 'Italic'),
        ]),
      ]);
    });

    await when('the tree is atomized', () => {
      ({ atoms } = atomizeTree(document, [], mockPart));
    });

    await then('the runs remain as separate atoms', () => {
      expect(atoms).toHaveLength(2);
      const atom0 = atoms[0];
      const atom1 = atoms[1];
      assertDefined(atom0, 'atoms[0]');
      assertDefined(atom1, 'atoms[1]');
      expect(atom0.contentElement.textContent).toBe('Bold');
      expect(atom1.contentElement.textContent).toBe('Italic');
    });
  });

  test('does not merge across w:br elements', async ({ given, when, then }: AllureBddContext) => {
    let document: Element;
    let atoms: ReturnType<typeof atomizeTree>['atoms'];

    await given('a run with text separated by a break', () => {
      document = el('w:p', {}, [
        el('w:r', {}, [
          el('w:t', {}, undefined, 'Line1'),
          el('w:br'),
          el('w:t', {}, undefined, 'Line2'),
        ]),
      ]);
    });

    await when('the tree is atomized', () => {
      ({ atoms } = atomizeTree(document, [], mockPart));
    });

    await then('the break separates the atoms', () => {
      expect(atoms).toHaveLength(3);
      const atom0 = atoms[0];
      const atom1 = atoms[1];
      const atom2 = atoms[2];
      assertDefined(atom0, 'atoms[0]');
      assertDefined(atom1, 'atoms[1]');
      assertDefined(atom2, 'atoms[2]');
      expect(atom0.contentElement.textContent).toBe('Line1');
      expect(atom1.contentElement.tagName).toBe('w:br');
      expect(atom2.contentElement.textContent).toBe('Line2');
    });
  });

  test('does not merge across track change boundaries', async ({ given, when, then }: AllureBddContext) => {
    let document: Element;
    let atoms: ReturnType<typeof atomizeTree>['atoms'];

    await given('a paragraph with a normal run followed by an inserted run', () => {
      document = el('w:p', {}, [
        el('w:r', {}, [el('w:t', {}, undefined, 'Normal')]),
        el('w:ins', { 'w:id': '1', 'w:author': 'Test' }, [
          el('w:r', {}, [el('w:t', {}, undefined, 'Inserted')]),
        ]),
      ]);
    });

    await when('the tree is atomized', () => {
      ({ atoms } = atomizeTree(document, [], mockPart));
    });

    await then('the track change boundary separates the atoms', () => {
      expect(atoms).toHaveLength(2);
      const atom0 = atoms[0];
      const atom1 = atoms[1];
      assertDefined(atom0, 'atoms[0]');
      assertDefined(atom1, 'atoms[1]');
      expect(atom0.contentElement.textContent).toBe('Normal');
      expect(atom1.contentElement.textContent).toBe('Inserted');
      expect(atom1.revTrackElement?.tagName).toBe('w:ins');
    });
  });

  test('does not merge across paragraph boundaries', async ({ given, when, then }: AllureBddContext) => {
    let document: Element;
    let atoms: ReturnType<typeof atomizeTree>['atoms'];

    await given('a body with two paragraphs', () => {
      document = el('w:body', {}, [
        el('w:p', {}, [el('w:r', {}, [el('w:t', {}, undefined, 'Para1')])]),
        el('w:p', {}, [el('w:r', {}, [el('w:t', {}, undefined, 'Para2')])]),
      ]);
    });

    await when('the tree is atomized', () => {
      ({ atoms } = atomizeTree(document, [], mockPart));
    });

    await then('each paragraph produces a separate atom', () => {
      expect(atoms).toHaveLength(2);
      const atom0 = atoms[0];
      const atom1 = atoms[1];
      assertDefined(atom0, 'atoms[0]');
      assertDefined(atom1, 'atoms[1]');
      expect(atom0.contentElement.textContent).toBe('Para1');
      expect(atom1.contentElement.textContent).toBe('Para2');
    });
  });
});

describe('getAncestors', () => {
  test('returns empty array for node without parent', async ({ given, when, then }: AllureBddContext) => {
    let node: Element;

    await given('a node with no parent', () => {
      node = el('w:t');
    });

    await when('getAncestors is called', () => {});

    await then('an empty array is returned', () => {
      expect(getAncestors(node)).toEqual([]);
    });
  });

  test('returns ancestors from root to immediate parent', async ({ given, when, then }: AllureBddContext) => {
    let text: Element;
    let run: Element;
    let para: Element;
    let body: Element;
    let root: Element;
    let ancestors: Element[];

    await given('a deep DOM tree', () => {
      // Build a real DOM tree so parentElement references are set automatically
      text = el('w:t');
      run = el('w:r', {}, [text]);
      para = el('w:p', {}, [run]);
      body = el('w:body', {}, [para]);
      root = el('w:document', {}, [body]);
    });

    await when('getAncestors is called on the text node', () => {
      ancestors = getAncestors(text);
    });

    await then('all ancestors from root to immediate parent are returned', () => {
      expect(ancestors).toHaveLength(4);
      expect(ancestors[0]).toBe(root);
      expect(ancestors[1]).toBe(body);
      expect(ancestors[2]).toBe(para);
      expect(ancestors[3]).toBe(run);
    });
  });
});
