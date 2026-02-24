import { describe, expect } from 'vitest';
import { itAllure as it } from './testing/allure-test.js';
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

describe('sha1', () => {
  it('returns consistent hash for same input', () => {
    const hash1 = sha1('hello');
    const hash2 = sha1('hello');
    expect(hash1).toBe(hash2);
  });

  it('returns different hash for different input', () => {
    const hash1 = sha1('hello');
    const hash2 = sha1('world');
    expect(hash1).not.toBe(hash2);
  });

  it('returns 40 character hex string', () => {
    const hash = sha1('test');
    expect(hash).toHaveLength(40);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

describe('hashElement', () => {
  it('hashes element with tag name', () => {
    const element = el('w:t');

    const hash = hashElement(element);
    expect(hash).toHaveLength(40);
  });

  it('includes attributes in hash', () => {
    // Use a meaningful attribute (not xml:space which is intentionally ignored)
    const element1 = el('w:b', { 'w:val': 'true' });
    const element2 = el('w:b');

    expect(hashElement(element1)).not.toBe(hashElement(element2));
  });

  it('ignores xml:space attribute in hash', () => {
    // xml:space is a presentation hint that should not affect content comparison
    const element1 = el('w:t', { 'xml:space': 'preserve' }, undefined, 'Hello');
    const element2 = el('w:t', {}, undefined, 'Hello');

    // Same text content should produce same hash regardless of xml:space
    expect(hashElement(element1)).toBe(hashElement(element2));
  });

  it('includes text content in hash', () => {
    const element1 = el('w:t', {}, undefined, 'Hello');
    const element2 = el('w:t', {}, undefined, 'World');

    expect(hashElement(element1)).not.toBe(hashElement(element2));
  });

  it('produces deterministic hash regardless of attribute order', () => {
    const element1 = el('w:ins', { 'w:id': '1', 'w:author': 'John' });
    const element2 = el('w:ins', { 'w:author': 'John', 'w:id': '1' });

    expect(hashElement(element1)).toBe(hashElement(element2));
  });
});

describe('findRevisionTrackingElement', () => {
  it('returns undefined for empty ancestors', () => {
    expect(findRevisionTrackingElement([])).toBeUndefined();
  });

  it('finds w:ins in ancestors', () => {
    const ins = el('w:ins', { 'w:id': '1', 'w:author': 'John' });

    const ancestors = [ins];
    expect(findRevisionTrackingElement(ancestors)).toBe(ins);
  });

  it('finds w:del in ancestors', () => {
    const del = el('w:del', { 'w:id': '2' });

    const ancestors = [del];
    expect(findRevisionTrackingElement(ancestors)).toBe(del);
  });

  it('finds w:moveFrom in ancestors', () => {
    const moveFrom = el('w:moveFrom', { 'w:id': '3' });

    expect(findRevisionTrackingElement([moveFrom])).toBe(moveFrom);
  });

  it('finds w:moveTo in ancestors', () => {
    const moveTo = el('w:moveTo', { 'w:id': '4' });

    expect(findRevisionTrackingElement([moveTo])).toBe(moveTo);
  });

  it('returns nearest revision element', () => {
    const outerIns = el('w:ins', { 'w:id': '1' });
    const innerDel = el('w:del', { 'w:id': '2' });

    // innerDel is more recent (later in array = closer ancestor)
    const ancestors = [outerIns, innerDel];
    expect(findRevisionTrackingElement(ancestors)).toBe(innerDel);
  });

  it('ignores non-revision elements', () => {
    const paragraph = el('w:p');
    const run = el('w:r');
    const ins = el('w:ins', { 'w:id': '1' });

    const ancestors = [paragraph, ins, run];
    expect(findRevisionTrackingElement(ancestors)).toBe(ins);
  });
});

describe('getStatusFromRevisionTracking', () => {
  it('returns Unknown for undefined', () => {
    expect(getStatusFromRevisionTracking(undefined)).toBe(CorrelationStatus.Unknown);
  });

  it('returns Inserted for w:ins', () => {
    const ins = el('w:ins');
    expect(getStatusFromRevisionTracking(ins)).toBe(CorrelationStatus.Inserted);
  });

  it('returns Deleted for w:del', () => {
    const del = el('w:del');
    expect(getStatusFromRevisionTracking(del)).toBe(CorrelationStatus.Deleted);
  });

  it('returns MovedSource for w:moveFrom', () => {
    const moveFrom = el('w:moveFrom');
    expect(getStatusFromRevisionTracking(moveFrom)).toBe(CorrelationStatus.MovedSource);
  });

  it('returns MovedDestination for w:moveTo', () => {
    const moveTo = el('w:moveTo');
    expect(getStatusFromRevisionTracking(moveTo)).toBe(CorrelationStatus.MovedDestination);
  });

  it('returns Unknown for unrecognized element', () => {
    const other = el('w:r');
    expect(getStatusFromRevisionTracking(other)).toBe(CorrelationStatus.Unknown);
  });
});

describe('extractAncestorUnids', () => {
  it('returns empty array for no ancestors', () => {
    expect(extractAncestorUnids([])).toEqual([]);
  });

  it('extracts w:Unid attributes', () => {
    const ancestors = [
      el('w:p', { 'w:Unid': 'unid-1' }),
      el('w:r', { 'w:Unid': 'unid-2' }),
    ];

    expect(extractAncestorUnids(ancestors)).toEqual(['unid-1', 'unid-2']);
  });

  it('skips elements without Unid', () => {
    const ancestors = [
      el('w:p', { 'w:Unid': 'unid-1' }),
      el('w:r'),
      el('w:ins', { 'w:Unid': 'unid-3' }),
    ];

    expect(extractAncestorUnids(ancestors)).toEqual(['unid-1', 'unid-3']);
  });
});

describe('isLeafNode', () => {
  it('returns true for w:t', () => {
    const text = el('w:t', {}, undefined, 'Hello');
    expect(isLeafNode(text)).toBe(true);
  });

  it('returns true for w:br', () => {
    const br = el('w:br');
    expect(isLeafNode(br)).toBe(true);
  });

  it('returns true for w:tab', () => {
    const tab = el('w:tab');
    expect(isLeafNode(tab)).toBe(true);
  });

  it('returns true for w:footnoteReference', () => {
    const fnRef = el('w:footnoteReference', { 'w:id': '1' });
    expect(isLeafNode(fnRef)).toBe(true);
  });

  it('returns false for w:p', () => {
    const paragraph = el('w:p');
    expect(isLeafNode(paragraph)).toBe(false);
  });

  it('returns false for w:r', () => {
    const run = el('w:r');
    expect(isLeafNode(run)).toBe(false);
  });
});

describe('createComparisonUnitAtom', () => {
  const mockPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  it('creates atom with basic properties', () => {
    const textElement = el('w:t', {}, undefined, 'Hello');

    const atom = createComparisonUnitAtom({
      contentElement: textElement,
      ancestors: [],
      part: mockPart,
    });

    expect(atom.contentElement).toBe(textElement);
    expect(atom.part).toBe(mockPart);
    expect(atom.sha1Hash).toHaveLength(40);
    expect(atom.correlationStatus).toBe(CorrelationStatus.Unknown);
  });

  it('detects inserted status from w:ins ancestor', () => {
    const textElement = el('w:t', {}, undefined, 'New');
    const insElement = el('w:ins', { 'w:id': '1' });

    const atom = createComparisonUnitAtom({
      contentElement: textElement,
      ancestors: [insElement],
      part: mockPart,
    });

    expect(atom.correlationStatus).toBe(CorrelationStatus.Inserted);
    expect(atom.revTrackElement).toBe(insElement);
  });

  it('detects deleted status from w:del ancestor', () => {
    const textElement = el('w:delText', {}, undefined, 'Old');
    const delElement = el('w:del', { 'w:id': '2' });

    const atom = createComparisonUnitAtom({
      contentElement: textElement,
      ancestors: [delElement],
      part: mockPart,
    });

    expect(atom.correlationStatus).toBe(CorrelationStatus.Deleted);
    expect(atom.revTrackElement).toBe(delElement);
  });

  it('extracts ancestor unids', () => {
    const textElement = el('w:t', {}, undefined, 'Test');
    const paragraph = el('w:p', { 'w:Unid': 'para-1' });
    const run = el('w:r', { 'w:Unid': 'run-1' });

    const atom = createComparisonUnitAtom({
      contentElement: textElement,
      ancestors: [paragraph, run],
      part: mockPart,
    });

    expect(atom.ancestorUnids).toEqual(['para-1', 'run-1']);
  });

  it('copies ancestors to avoid mutation', () => {
    const textElement = el('w:t', {}, undefined, 'Test');
    const ancestors = [el('w:p')];

    const atom = createComparisonUnitAtom({
      contentElement: textElement,
      ancestors,
      part: mockPart,
    });

    // Modify original array
    ancestors.push(el('w:r'));

    // Atom's ancestors should be unchanged
    expect(atom.ancestorElements).toHaveLength(1);
  });
});

describe('atomizeTree', () => {
  const mockPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  it('atomizes a simple paragraph', () => {
    const document = el('w:p', {}, [
      el('w:r', {}, [
        el('w:t', {}, undefined, 'Hello World'),
      ]),
    ]);

    const { atoms } = atomizeTree(document, [], mockPart);

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

  it('atomizes and normalizes multiple runs with same formatting', () => {
    // Multiple runs with the same formatting (none) are merged during normalization
    const document = el('w:p', {}, [
      el('w:r', {}, [
        el('w:t', {}, undefined, 'Hello '),
      ]),
      el('w:r', {}, [
        el('w:t', {}, undefined, 'World'),
      ]),
    ]);

    const { atoms } = atomizeTree(document, [], mockPart);

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

  it('includes ancestor chain for each atom', () => {
    const document = el('w:p', { 'w:Unid': 'para-1' }, [
      el('w:r', { 'w:Unid': 'run-1' }, [
        el('w:t', {}, undefined, 'Test'),
      ]),
    ]);

    const { atoms } = atomizeTree(document, [], mockPart);

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

  it('handles revision tracking elements', () => {
    const document = el('w:p', {}, [
      el('w:ins', { 'w:id': '1', 'w:author': 'John' }, [
        el('w:r', {}, [
          el('w:t', {}, undefined, 'New text'),
        ]),
      ]),
    ]);

    const { atoms } = atomizeTree(document, [], mockPart);

    // "New text" splits to ["New", " ", "text"]
    expect(atoms).toHaveLength(3);
    const atom0 = atoms[0];
    assertDefined(atom0, 'atoms[0]');
    expect(atom0.correlationStatus).toBe(CorrelationStatus.Inserted);
    expect(atom0.revTrackElement?.tagName).toBe('w:ins');
    expect(atom0.contentElement.textContent).toBe('New');
  });

  it('atomizes leaf nodes like breaks and tabs', () => {
    const document = el('w:r', {}, [
      el('w:t', {}, undefined, 'Before'),
      el('w:br'),
      el('w:t', {}, undefined, 'After'),
    ]);

    const { atoms } = atomizeTree(document, [], mockPart);

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

describe('atom boundary normalization', () => {
  const mockPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  it('merges contiguous w:t elements in same run', () => {
    const document = el('w:p', {}, [
      el('w:r', {}, [
        el('w:t', {}, undefined, 'Hello'),
        el('w:t', {}, undefined, ' '),
        el('w:t', {}, undefined, 'World'),
      ]),
    ]);

    const { atoms } = atomizeTree(document, [], mockPart);

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

  it('merges w:t elements across runs with same formatting', () => {
    const document = el('w:p', {}, [
      el('w:r', {}, [
        el('w:rPr', {}, [el('w:b')]),
        el('w:t', {}, undefined, 'Def'),
      ]),
      el('w:r', {}, [
        el('w:rPr', {}, [el('w:b')]),
        el('w:t', {}, undefined, 'initions'),
      ]),
    ]);

    const { atoms } = atomizeTree(document, [], mockPart);

    expect(atoms).toHaveLength(1);
    const atom0 = atoms[0];
    assertDefined(atom0, 'atoms[0]');
    expect(atom0.contentElement.textContent).toBe('Definitions');
  });

  it('does not merge across runs with different formatting', () => {
    const document = el('w:p', {}, [
      el('w:r', {}, [
        el('w:rPr', {}, [el('w:b')]),
        el('w:t', {}, undefined, 'Bold'),
      ]),
      el('w:r', {}, [
        el('w:rPr', {}, [el('w:i')]),
        el('w:t', {}, undefined, 'Italic'),
      ]),
    ]);

    const { atoms } = atomizeTree(document, [], mockPart);

    expect(atoms).toHaveLength(2);
    const atom0 = atoms[0];
    const atom1 = atoms[1];
    assertDefined(atom0, 'atoms[0]');
    assertDefined(atom1, 'atoms[1]');
    expect(atom0.contentElement.textContent).toBe('Bold');
    expect(atom1.contentElement.textContent).toBe('Italic');
  });

  it('does not merge across w:br elements', () => {
    const document = el('w:p', {}, [
      el('w:r', {}, [
        el('w:t', {}, undefined, 'Line1'),
        el('w:br'),
        el('w:t', {}, undefined, 'Line2'),
      ]),
    ]);

    const { atoms } = atomizeTree(document, [], mockPart);

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

  it('does not merge across track change boundaries', () => {
    const document = el('w:p', {}, [
      el('w:r', {}, [
        el('w:t', {}, undefined, 'Normal'),
      ]),
      el('w:ins', { 'w:id': '1', 'w:author': 'Test' }, [
        el('w:r', {}, [
          el('w:t', {}, undefined, 'Inserted'),
        ]),
      ]),
    ]);

    const { atoms } = atomizeTree(document, [], mockPart);

    expect(atoms).toHaveLength(2);
    const atom0 = atoms[0];
    const atom1 = atoms[1];
    assertDefined(atom0, 'atoms[0]');
    assertDefined(atom1, 'atoms[1]');
    expect(atom0.contentElement.textContent).toBe('Normal');
    expect(atom1.contentElement.textContent).toBe('Inserted');
    expect(atom1.revTrackElement?.tagName).toBe('w:ins');
  });

  it('does not merge across paragraph boundaries', () => {
    const document = el('w:body', {}, [
      el('w:p', {}, [
        el('w:r', {}, [
          el('w:t', {}, undefined, 'Para1'),
        ]),
      ]),
      el('w:p', {}, [
        el('w:r', {}, [
          el('w:t', {}, undefined, 'Para2'),
        ]),
      ]),
    ]);

    const { atoms } = atomizeTree(document, [], mockPart);

    expect(atoms).toHaveLength(2);
    const atom0 = atoms[0];
    const atom1 = atoms[1];
    assertDefined(atom0, 'atoms[0]');
    assertDefined(atom1, 'atoms[1]');
    expect(atom0.contentElement.textContent).toBe('Para1');
    expect(atom1.contentElement.textContent).toBe('Para2');
  });
});

describe('getAncestors', () => {
  it('returns empty array for node without parent', () => {
    const node = el('w:t');

    expect(getAncestors(node)).toEqual([]);
  });

  it('returns ancestors from root to immediate parent', () => {
    // Build a real DOM tree so parentElement references are set automatically
    const text = el('w:t');
    const run = el('w:r', {}, [text]);
    const para = el('w:p', {}, [run]);
    const body = el('w:body', {}, [para]);
    const root = el('w:document', {}, [body]);

    const ancestors = getAncestors(text);

    expect(ancestors).toHaveLength(4);
    expect(ancestors[0]).toBe(root);
    expect(ancestors[1]).toBe(body);
    expect(ancestors[2]).toBe(para);
    expect(ancestors[3]).toBe(run);
  });
});
