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
  backfillParentReferences,
  getAncestors,
} from './atomizer.js';
import { CorrelationStatus, WmlElement, OpcPart } from './core-types.js';
import { assertDefined } from './testing/test-utils.js';

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
    const element: WmlElement = {
      tagName: 'w:t',
      attributes: {},
    };

    const hash = hashElement(element);
    expect(hash).toHaveLength(40);
  });

  it('includes attributes in hash', () => {
    // Use a meaningful attribute (not xml:space which is intentionally ignored)
    const element1: WmlElement = {
      tagName: 'w:b',
      attributes: { 'w:val': 'true' },
    };

    const element2: WmlElement = {
      tagName: 'w:b',
      attributes: {},
    };

    expect(hashElement(element1)).not.toBe(hashElement(element2));
  });

  it('ignores xml:space attribute in hash', () => {
    // xml:space is a presentation hint that should not affect content comparison
    const element1: WmlElement = {
      tagName: 'w:t',
      attributes: { 'xml:space': 'preserve' },
      textContent: 'Hello',
    };

    const element2: WmlElement = {
      tagName: 'w:t',
      attributes: {},
      textContent: 'Hello',
    };

    // Same text content should produce same hash regardless of xml:space
    expect(hashElement(element1)).toBe(hashElement(element2));
  });

  it('includes text content in hash', () => {
    const element1: WmlElement = {
      tagName: 'w:t',
      attributes: {},
      textContent: 'Hello',
    };

    const element2: WmlElement = {
      tagName: 'w:t',
      attributes: {},
      textContent: 'World',
    };

    expect(hashElement(element1)).not.toBe(hashElement(element2));
  });

  it('produces deterministic hash regardless of attribute order', () => {
    const element1: WmlElement = {
      tagName: 'w:ins',
      attributes: { 'w:id': '1', 'w:author': 'John' },
    };

    const element2: WmlElement = {
      tagName: 'w:ins',
      attributes: { 'w:author': 'John', 'w:id': '1' },
    };

    expect(hashElement(element1)).toBe(hashElement(element2));
  });
});

describe('findRevisionTrackingElement', () => {
  it('returns undefined for empty ancestors', () => {
    expect(findRevisionTrackingElement([])).toBeUndefined();
  });

  it('finds w:ins in ancestors', () => {
    const ins: WmlElement = {
      tagName: 'w:ins',
      attributes: { 'w:id': '1', 'w:author': 'John' },
    };

    const ancestors = [ins];
    expect(findRevisionTrackingElement(ancestors)).toBe(ins);
  });

  it('finds w:del in ancestors', () => {
    const del: WmlElement = {
      tagName: 'w:del',
      attributes: { 'w:id': '2' },
    };

    const ancestors = [del];
    expect(findRevisionTrackingElement(ancestors)).toBe(del);
  });

  it('finds w:moveFrom in ancestors', () => {
    const moveFrom: WmlElement = {
      tagName: 'w:moveFrom',
      attributes: { 'w:id': '3' },
    };

    expect(findRevisionTrackingElement([moveFrom])).toBe(moveFrom);
  });

  it('finds w:moveTo in ancestors', () => {
    const moveTo: WmlElement = {
      tagName: 'w:moveTo',
      attributes: { 'w:id': '4' },
    };

    expect(findRevisionTrackingElement([moveTo])).toBe(moveTo);
  });

  it('returns nearest revision element', () => {
    const outerIns: WmlElement = {
      tagName: 'w:ins',
      attributes: { 'w:id': '1' },
    };

    const innerDel: WmlElement = {
      tagName: 'w:del',
      attributes: { 'w:id': '2' },
    };

    // innerDel is more recent (later in array = closer ancestor)
    const ancestors = [outerIns, innerDel];
    expect(findRevisionTrackingElement(ancestors)).toBe(innerDel);
  });

  it('ignores non-revision elements', () => {
    const paragraph: WmlElement = { tagName: 'w:p', attributes: {} };
    const run: WmlElement = { tagName: 'w:r', attributes: {} };
    const ins: WmlElement = { tagName: 'w:ins', attributes: { 'w:id': '1' } };

    const ancestors = [paragraph, ins, run];
    expect(findRevisionTrackingElement(ancestors)).toBe(ins);
  });
});

describe('getStatusFromRevisionTracking', () => {
  it('returns Unknown for undefined', () => {
    expect(getStatusFromRevisionTracking(undefined)).toBe(CorrelationStatus.Unknown);
  });

  it('returns Inserted for w:ins', () => {
    const ins: WmlElement = { tagName: 'w:ins', attributes: {} };
    expect(getStatusFromRevisionTracking(ins)).toBe(CorrelationStatus.Inserted);
  });

  it('returns Deleted for w:del', () => {
    const del: WmlElement = { tagName: 'w:del', attributes: {} };
    expect(getStatusFromRevisionTracking(del)).toBe(CorrelationStatus.Deleted);
  });

  it('returns MovedSource for w:moveFrom', () => {
    const moveFrom: WmlElement = { tagName: 'w:moveFrom', attributes: {} };
    expect(getStatusFromRevisionTracking(moveFrom)).toBe(CorrelationStatus.MovedSource);
  });

  it('returns MovedDestination for w:moveTo', () => {
    const moveTo: WmlElement = { tagName: 'w:moveTo', attributes: {} };
    expect(getStatusFromRevisionTracking(moveTo)).toBe(CorrelationStatus.MovedDestination);
  });

  it('returns Unknown for unrecognized element', () => {
    const other: WmlElement = { tagName: 'w:r', attributes: {} };
    expect(getStatusFromRevisionTracking(other)).toBe(CorrelationStatus.Unknown);
  });
});

describe('extractAncestorUnids', () => {
  it('returns empty array for no ancestors', () => {
    expect(extractAncestorUnids([])).toEqual([]);
  });

  it('extracts w:Unid attributes', () => {
    const ancestors: WmlElement[] = [
      { tagName: 'w:p', attributes: { 'w:Unid': 'unid-1' } },
      { tagName: 'w:r', attributes: { 'w:Unid': 'unid-2' } },
    ];

    expect(extractAncestorUnids(ancestors)).toEqual(['unid-1', 'unid-2']);
  });

  it('skips elements without Unid', () => {
    const ancestors: WmlElement[] = [
      { tagName: 'w:p', attributes: { 'w:Unid': 'unid-1' } },
      { tagName: 'w:r', attributes: {} },
      { tagName: 'w:ins', attributes: { 'w:Unid': 'unid-3' } },
    ];

    expect(extractAncestorUnids(ancestors)).toEqual(['unid-1', 'unid-3']);
  });
});

describe('isLeafNode', () => {
  it('returns true for w:t', () => {
    const text: WmlElement = { tagName: 'w:t', attributes: {}, textContent: 'Hello' };
    expect(isLeafNode(text)).toBe(true);
  });

  it('returns true for w:br', () => {
    const br: WmlElement = { tagName: 'w:br', attributes: {} };
    expect(isLeafNode(br)).toBe(true);
  });

  it('returns true for w:tab', () => {
    const tab: WmlElement = { tagName: 'w:tab', attributes: {} };
    expect(isLeafNode(tab)).toBe(true);
  });

  it('returns true for w:footnoteReference', () => {
    const fnRef: WmlElement = { tagName: 'w:footnoteReference', attributes: { 'w:id': '1' } };
    expect(isLeafNode(fnRef)).toBe(true);
  });

  it('returns false for w:p', () => {
    const paragraph: WmlElement = { tagName: 'w:p', attributes: {} };
    expect(isLeafNode(paragraph)).toBe(false);
  });

  it('returns false for w:r', () => {
    const run: WmlElement = { tagName: 'w:r', attributes: {} };
    expect(isLeafNode(run)).toBe(false);
  });
});

describe('createComparisonUnitAtom', () => {
  const mockPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  it('creates atom with basic properties', () => {
    const textElement: WmlElement = {
      tagName: 'w:t',
      attributes: {},
      textContent: 'Hello',
    };

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
    const textElement: WmlElement = { tagName: 'w:t', attributes: {}, textContent: 'New' };
    const insElement: WmlElement = { tagName: 'w:ins', attributes: { 'w:id': '1' } };

    const atom = createComparisonUnitAtom({
      contentElement: textElement,
      ancestors: [insElement],
      part: mockPart,
    });

    expect(atom.correlationStatus).toBe(CorrelationStatus.Inserted);
    expect(atom.revTrackElement).toBe(insElement);
  });

  it('detects deleted status from w:del ancestor', () => {
    const textElement: WmlElement = { tagName: 'w:delText', attributes: {}, textContent: 'Old' };
    const delElement: WmlElement = { tagName: 'w:del', attributes: { 'w:id': '2' } };

    const atom = createComparisonUnitAtom({
      contentElement: textElement,
      ancestors: [delElement],
      part: mockPart,
    });

    expect(atom.correlationStatus).toBe(CorrelationStatus.Deleted);
    expect(atom.revTrackElement).toBe(delElement);
  });

  it('extracts ancestor unids', () => {
    const textElement: WmlElement = { tagName: 'w:t', attributes: {}, textContent: 'Test' };
    const paragraph: WmlElement = { tagName: 'w:p', attributes: { 'w:Unid': 'para-1' } };
    const run: WmlElement = { tagName: 'w:r', attributes: { 'w:Unid': 'run-1' } };

    const atom = createComparisonUnitAtom({
      contentElement: textElement,
      ancestors: [paragraph, run],
      part: mockPart,
    });

    expect(atom.ancestorUnids).toEqual(['para-1', 'run-1']);
  });

  it('copies ancestors to avoid mutation', () => {
    const textElement: WmlElement = { tagName: 'w:t', attributes: {}, textContent: 'Test' };
    const ancestors = [{ tagName: 'w:p', attributes: {} }];

    const atom = createComparisonUnitAtom({
      contentElement: textElement,
      ancestors,
      part: mockPart,
    });

    // Modify original array
    ancestors.push({ tagName: 'w:r', attributes: {} });

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
    const document: WmlElement = {
      tagName: 'w:p',
      attributes: {},
      children: [
        {
          tagName: 'w:r',
          attributes: {},
          children: [
            {
              tagName: 'w:t',
              attributes: {},
              textContent: 'Hello World',
            },
          ],
        },
      ],
    };

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
    const document: WmlElement = {
      tagName: 'w:p',
      attributes: {},
      children: [
        {
          tagName: 'w:r',
          attributes: {},
          children: [{ tagName: 'w:t', attributes: {}, textContent: 'Hello ' }],
        },
        {
          tagName: 'w:r',
          attributes: {},
          children: [{ tagName: 'w:t', attributes: {}, textContent: 'World' }],
        },
      ],
    };

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
    const document: WmlElement = {
      tagName: 'w:p',
      attributes: { 'w:Unid': 'para-1' },
      children: [
        {
          tagName: 'w:r',
          attributes: { 'w:Unid': 'run-1' },
          children: [{ tagName: 'w:t', attributes: {}, textContent: 'Test' }],
        },
      ],
    };

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
    const document: WmlElement = {
      tagName: 'w:p',
      attributes: {},
      children: [
        {
          tagName: 'w:ins',
          attributes: { 'w:id': '1', 'w:author': 'John' },
          children: [
            {
              tagName: 'w:r',
              attributes: {},
              children: [{ tagName: 'w:t', attributes: {}, textContent: 'New text' }],
            },
          ],
        },
      ],
    };

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
    const document: WmlElement = {
      tagName: 'w:r',
      attributes: {},
      children: [
        { tagName: 'w:t', attributes: {}, textContent: 'Before' },
        { tagName: 'w:br', attributes: {} },
        { tagName: 'w:t', attributes: {}, textContent: 'After' },
      ],
    };

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
    const document: WmlElement = {
      tagName: 'w:p',
      attributes: {},
      children: [
        {
          tagName: 'w:r',
          attributes: {},
          children: [
            { tagName: 'w:t', attributes: {}, textContent: 'Hello' },
            { tagName: 'w:t', attributes: {}, textContent: ' ' },
            { tagName: 'w:t', attributes: {}, textContent: 'World' },
          ],
        },
      ],
    };

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
    const rPr: WmlElement = { tagName: 'w:rPr', attributes: {}, children: [{ tagName: 'w:b', attributes: {} }] };
    const document: WmlElement = {
      tagName: 'w:p',
      attributes: {},
      children: [
        {
          tagName: 'w:r',
          attributes: {},
          children: [
            { ...rPr },
            { tagName: 'w:t', attributes: {}, textContent: 'Def' },
          ],
        },
        {
          tagName: 'w:r',
          attributes: {},
          children: [
            { tagName: 'w:rPr', attributes: {}, children: [{ tagName: 'w:b', attributes: {} }] },
            { tagName: 'w:t', attributes: {}, textContent: 'initions' },
          ],
        },
      ],
    };

    const { atoms } = atomizeTree(document, [], mockPart);

    expect(atoms).toHaveLength(1);
    const atom0 = atoms[0];
    assertDefined(atom0, 'atoms[0]');
    expect(atom0.contentElement.textContent).toBe('Definitions');
  });

  it('does not merge across runs with different formatting', () => {
    const document: WmlElement = {
      tagName: 'w:p',
      attributes: {},
      children: [
        {
          tagName: 'w:r',
          attributes: {},
          children: [
            { tagName: 'w:rPr', attributes: {}, children: [{ tagName: 'w:b', attributes: {} }] },
            { tagName: 'w:t', attributes: {}, textContent: 'Bold' },
          ],
        },
        {
          tagName: 'w:r',
          attributes: {},
          children: [
            { tagName: 'w:rPr', attributes: {}, children: [{ tagName: 'w:i', attributes: {} }] },
            { tagName: 'w:t', attributes: {}, textContent: 'Italic' },
          ],
        },
      ],
    };

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
    const document: WmlElement = {
      tagName: 'w:p',
      attributes: {},
      children: [
        {
          tagName: 'w:r',
          attributes: {},
          children: [
            { tagName: 'w:t', attributes: {}, textContent: 'Line1' },
            { tagName: 'w:br', attributes: {} },
            { tagName: 'w:t', attributes: {}, textContent: 'Line2' },
          ],
        },
      ],
    };

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
    const document: WmlElement = {
      tagName: 'w:p',
      attributes: {},
      children: [
        {
          tagName: 'w:r',
          attributes: {},
          children: [{ tagName: 'w:t', attributes: {}, textContent: 'Normal' }],
        },
        {
          tagName: 'w:ins',
          attributes: { 'w:id': '1', 'w:author': 'Test' },
          children: [
            {
              tagName: 'w:r',
              attributes: {},
              children: [{ tagName: 'w:t', attributes: {}, textContent: 'Inserted' }],
            },
          ],
        },
      ],
    };

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
    const document: WmlElement = {
      tagName: 'w:body',
      attributes: {},
      children: [
        {
          tagName: 'w:p',
          attributes: {},
          children: [
            {
              tagName: 'w:r',
              attributes: {},
              children: [{ tagName: 'w:t', attributes: {}, textContent: 'Para1' }],
            },
          ],
        },
        {
          tagName: 'w:p',
          attributes: {},
          children: [
            {
              tagName: 'w:r',
              attributes: {},
              children: [{ tagName: 'w:t', attributes: {}, textContent: 'Para2' }],
            },
          ],
        },
      ],
    };

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

describe('backfillParentReferences', () => {
  it('sets parent reference on children', () => {
    const parent: WmlElement = {
      tagName: 'w:r',
      attributes: {},
      children: [
        { tagName: 'w:t', attributes: {}, textContent: 'Hello' },
      ],
    };

    backfillParentReferences(parent);

    const child0 = parent.children![0];
    assertDefined(child0, 'parent.children![0]');
    expect(child0.parent).toBe(parent);
  });

  it('handles nested structure', () => {
    const grandparent: WmlElement = {
      tagName: 'w:p',
      attributes: {},
      children: [
        {
          tagName: 'w:r',
          attributes: {},
          children: [{ tagName: 'w:t', attributes: {}, textContent: 'Test' }],
        },
      ],
    };

    backfillParentReferences(grandparent);

    const run = grandparent.children![0];
    assertDefined(run, 'grandparent.children![0]');
    const text = run.children![0];
    assertDefined(text, 'run.children![0]');

    expect(run.parent).toBe(grandparent);
    expect(text.parent).toBe(run);
  });

  it('root has undefined parent', () => {
    const root: WmlElement = { tagName: 'w:document', attributes: {} };

    backfillParentReferences(root);

    expect(root.parent).toBeUndefined();
  });
});

describe('getAncestors', () => {
  it('returns empty array for node without parent', () => {
    const node: WmlElement = { tagName: 'w:t', attributes: {} };

    expect(getAncestors(node)).toEqual([]);
  });

  it('returns ancestors from root to immediate parent', () => {
    const root: WmlElement = { tagName: 'w:document', attributes: {} };
    const body: WmlElement = { tagName: 'w:body', attributes: {}, parent: root };
    const para: WmlElement = { tagName: 'w:p', attributes: {}, parent: body };
    const run: WmlElement = { tagName: 'w:r', attributes: {}, parent: para };
    const text: WmlElement = { tagName: 'w:t', attributes: {}, parent: run };

    const ancestors = getAncestors(text);

    expect(ancestors).toHaveLength(4);
    expect(ancestors[0]).toBe(root);
    expect(ancestors[1]).toBe(body);
    expect(ancestors[2]).toBe(para);
    expect(ancestors[3]).toBe(run);
  });
});
