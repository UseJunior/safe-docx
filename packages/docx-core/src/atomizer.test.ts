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
