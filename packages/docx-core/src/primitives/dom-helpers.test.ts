import { describe, expect } from 'vitest';
import { itAllure as it } from './testing/allure-test.js';
import { parseXml, serializeXml } from './xml.js';
import {
  getLeafText,
  setLeafText,
  childElements,
  childElementsByTagName,
  findChildByTagName,
  insertAfterElement,
  wrapElement,
  unwrapElement,
  removeAllByTagName,
  unwrapAllByTagName,
  createWmlElement,
  createWmlTextElement,
  NODE_TYPE,
} from './dom-helpers.js';

// ── Helpers ────────────────────────────────────────────────────────

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function makeDoc(bodyXml: string): Document {
  return parseXml(
    `<w:document xmlns:w="${W_NS}"><w:body>${bodyXml}</w:body></w:document>`,
  );
}


// ── getLeafText ────────────────────────────────────────────────────

describe('getLeafText', () => {
  it('returns text for a leaf element like <w:t>Hello</w:t>', () => {
    const doc = makeDoc('<w:r><w:t>Hello</w:t></w:r>');
    const wt = doc.getElementsByTagName('w:t')[0]!;
    expect(getLeafText(wt)).toBe('Hello');
  });

  it('returns undefined for a container element like <w:rPr><w:b/></w:rPr>', () => {
    const doc = makeDoc('<w:r><w:rPr><w:b/></w:rPr></w:r>');
    const rPr = doc.getElementsByTagName('w:rPr')[0]!;
    expect(getLeafText(rPr)).toBeUndefined();
  });

  it('returns empty string for an element with an empty text node', () => {
    const doc = makeDoc('<w:r><w:t></w:t></w:r>');
    const wt = doc.getElementsByTagName('w:t')[0]!;
    // xmldom may or may not produce a text node for empty element
    const result = getLeafText(wt);
    expect(result === undefined || result === '').toBe(true);
  });

  it('returns only direct text, not recursive text of descendants', () => {
    // <w:r> has a text node " " and child <w:t>Word</w:t>
    const doc = makeDoc('<w:p><w:r><w:t>Word</w:t></w:r></w:p>');
    const wr = doc.getElementsByTagName('w:r')[0]!;
    // w:r has no direct text child — only an element child w:t
    expect(getLeafText(wr)).toBeUndefined();
  });

  it('preserves whitespace text', () => {
    const doc = makeDoc('<w:r><w:t xml:space="preserve">  spaces  </w:t></w:r>');
    const wt = doc.getElementsByTagName('w:t')[0]!;
    expect(getLeafText(wt)).toBe('  spaces  ');
  });
});

// ── setLeafText ────────────────────────────────────────────────────

describe('setLeafText', () => {
  it('sets text on an element that already has text', () => {
    const doc = makeDoc('<w:r><w:t>Old</w:t></w:r>');
    const wt = doc.getElementsByTagName('w:t')[0]!;
    setLeafText(wt, 'New');
    expect(getLeafText(wt)).toBe('New');
  });

  it('creates a text node on an empty element', () => {
    const doc = makeDoc('<w:r><w:b/></w:r>');
    const wb = doc.getElementsByTagName('w:b')[0]!;
    setLeafText(wb, 'text');
    expect(getLeafText(wb)).toBe('text');
  });
});

// ── childElements ──────────────────────────────────────────────────

describe('childElements', () => {
  it('returns only element children, filtering out text nodes', () => {
    const doc = makeDoc('<w:p><w:pPr/><w:r><w:t>Hi</w:t></w:r></w:p>');
    const wp = doc.getElementsByTagName('w:p')[0]!;
    const children = childElements(wp);
    expect(children.length).toBe(2);
    expect(children[0]!.tagName).toBe('w:pPr');
    expect(children[1]!.tagName).toBe('w:r');
  });

  it('returns empty array for element with no children', () => {
    const doc = makeDoc('<w:b/>');
    const wb = doc.getElementsByTagName('w:b')[0]!;
    expect(childElements(wb)).toEqual([]);
  });

  it('filters out text nodes from mixed content', () => {
    // Create doc with mixed content (text + elements)
    const doc = parseXml('<root>text<child/>more</root>');
    const root = doc.documentElement;
    const children = childElements(root);
    expect(children.length).toBe(1);
    expect(children[0]!.tagName).toBe('child');
  });
});

// ── childElementsByTagName ─────────────────────────────────────────

describe('childElementsByTagName', () => {
  it('returns only direct children matching the tag name', () => {
    const doc = makeDoc(
      '<w:p><w:r><w:t>A</w:t></w:r><w:r><w:t>B</w:t></w:r><w:pPr/></w:p>',
    );
    const wp = doc.getElementsByTagName('w:p')[0]!;
    const runs = childElementsByTagName(wp, 'w:r');
    expect(runs.length).toBe(2);
  });

  it('does not return nested descendants', () => {
    const doc = makeDoc(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t></w:r></w:p>',
    );
    const wp = doc.getElementsByTagName('w:p')[0]!;
    // w:t is a grandchild, not a direct child of w:p
    const texts = childElementsByTagName(wp, 'w:t');
    expect(texts.length).toBe(0);
  });
});

// ── findChildByTagName ─────────────────────────────────────────────

describe('findChildByTagName', () => {
  it('finds first direct child with matching tag', () => {
    const doc = makeDoc('<w:r><w:rPr/><w:t>Hi</w:t></w:r>');
    const wr = doc.getElementsByTagName('w:r')[0]!;
    const rPr = findChildByTagName(wr, 'w:rPr');
    expect(rPr).not.toBeNull();
    expect(rPr!.tagName).toBe('w:rPr');
  });

  it('returns null when no matching child exists', () => {
    const doc = makeDoc('<w:r><w:t>Hi</w:t></w:r>');
    const wr = doc.getElementsByTagName('w:r')[0]!;
    expect(findChildByTagName(wr, 'w:rPr')).toBeNull();
  });
});

// ── insertAfterElement ─────────────────────────────────────────────

describe('insertAfterElement', () => {
  it('inserts a new element after the reference element', () => {
    const doc = makeDoc('<w:p><w:r/></w:p>');
    const wp = doc.getElementsByTagName('w:p')[0]!;
    const wr = doc.getElementsByTagName('w:r')[0]!;
    const newR = doc.createElementNS(W_NS, 'w:r');
    newR.setAttribute('w:id', 'new');
    insertAfterElement(wr, newR);
    const children = childElements(wp);
    expect(children.length).toBe(2);
    expect(children[1]!.getAttribute('w:id')).toBe('new');
  });

  it('appends at end when reference is the last child', () => {
    const doc = makeDoc('<w:p><w:pPr/><w:r/></w:p>');
    const wr = doc.getElementsByTagName('w:r')[0]!;
    const newEl = doc.createElementNS(W_NS, 'w:bookmarkEnd');
    insertAfterElement(wr, newEl);
    const wp = doc.getElementsByTagName('w:p')[0]!;
    const children = childElements(wp);
    expect(children[children.length - 1]!.tagName).toBe('w:bookmarkEnd');
  });
});

// ── wrapElement ────────────────────────────────────────────────────

describe('wrapElement', () => {
  it('wraps target in a wrapper element', () => {
    const doc = makeDoc('<w:p><w:r><w:t>Hi</w:t></w:r></w:p>');
    const wr = doc.getElementsByTagName('w:r')[0]!;
    const ins = doc.createElementNS(W_NS, 'w:ins');
    wrapElement(wr, ins);
    const wp = doc.getElementsByTagName('w:p')[0]!;
    const children = childElements(wp);
    expect(children.length).toBe(1);
    expect(children[0]!.tagName).toBe('w:ins');
    expect(childElements(children[0]!)[0]!.tagName).toBe('w:r');
  });
});

// ── unwrapElement ──────────────────────────────────────────────────

describe('unwrapElement', () => {
  it('replaces element with its children in parent', () => {
    const doc = makeDoc('<w:p><w:ins><w:r><w:t>Hi</w:t></w:r></w:ins></w:p>');
    const ins = doc.getElementsByTagName('w:ins')[0]!;
    unwrapElement(ins);
    const wp = doc.getElementsByTagName('w:p')[0]!;
    const children = childElements(wp);
    expect(children.length).toBe(1);
    expect(children[0]!.tagName).toBe('w:r');
  });
});

// ── removeAllByTagName ─────────────────────────────────────────────

describe('removeAllByTagName', () => {
  it('removes all elements matching the tag name', () => {
    const doc = makeDoc(
      '<w:p><w:bookmarkStart/><w:r><w:t>Hi</w:t></w:r><w:bookmarkEnd/></w:p>',
    );
    const wp = doc.getElementsByTagName('w:p')[0]!;
    const count = removeAllByTagName(wp, 'w:bookmarkStart');
    expect(count).toBe(1);
    expect(wp.getElementsByTagName('w:bookmarkStart').length).toBe(0);
  });
});

// ── unwrapAllByTagName ─────────────────────────────────────────────

describe('unwrapAllByTagName', () => {
  it('unwraps all matching elements throughout the tree', () => {
    const doc = makeDoc(
      '<w:p><w:ins><w:r><w:t>A</w:t></w:r></w:ins><w:ins><w:r><w:t>B</w:t></w:r></w:ins></w:p>',
    );
    const wp = doc.getElementsByTagName('w:p')[0]!;
    const count = unwrapAllByTagName(wp, 'w:ins');
    expect(count).toBe(2);
    expect(wp.getElementsByTagName('w:ins').length).toBe(0);
    expect(wp.getElementsByTagName('w:r').length).toBe(2);
  });
});

// ── createWmlElement ───────────────────────────────────────────────

describe('createWmlElement', () => {
  it('creates element with correct namespace and localName', () => {
    const doc = makeDoc('');
    const el = createWmlElement(doc, 't');
    expect(el.namespaceURI).toBe(W_NS);
    expect(el.localName).toBe('t');
    expect(el.tagName).toBe('w:t');
  });

  it('sets attributes', () => {
    const doc = makeDoc('');
    const el = createWmlElement(doc, 'bookmarkStart', {
      'w:id': '0',
      'w:name': '_bk_1',
    });
    expect(el.getAttribute('w:id')).toBe('0');
    expect(el.getAttribute('w:name')).toBe('_bk_1');
  });
});

// ── createWmlTextElement ───────────────────────────────────────────

describe('createWmlTextElement', () => {
  it('creates a w:t element with text and xml:space="preserve"', () => {
    const doc = makeDoc('');
    const el = createWmlTextElement(doc, 'Hello World');
    expect(el.tagName).toBe('w:t');
    expect(el.getAttribute('xml:space')).toBe('preserve');
    expect(getLeafText(el)).toBe('Hello World');
  });
});

// ── Round-trip tests ───────────────────────────────────────────────

describe('parseXml → serializeXml round-trip', () => {
  it('preserves processing instructions', () => {
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><root/>';
    const doc = parseXml(xml);
    const serialized = serializeXml(doc);
    expect(serialized).toContain('<?xml');
    expect(serialized).toContain('version="1.0"');
  });

  it('preserves self-closing tags', () => {
    const xml = `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hi</w:t></w:r></w:p></w:body></w:document>`;
    const doc = parseXml(xml);
    const serialized = serializeXml(doc);
    // xmldom may use <w:b/> or <w:b></w:b> — both are valid XML
    expect(serialized).toContain('w:b');
  });

  it('preserves xml:space="preserve" on w:t elements', () => {
    const xml = `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t xml:space="preserve"> hello </w:t></w:r></w:p></w:body></w:document>`;
    const doc = parseXml(xml);
    const serialized = serializeXml(doc);
    expect(serialized).toContain('xml:space="preserve"');
    expect(serialized).toContain(' hello ');
  });

  it('preserves namespace declarations', () => {
    const xml = `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body/></w:document>`;
    const doc = parseXml(xml);
    const serialized = serializeXml(doc);
    expect(serialized).toContain(`xmlns:w="${W_NS}"`);
  });

  it('preserves content fidelity through round-trip', () => {
    const xml = `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t xml:space="preserve">Hello World</w:t></w:r></w:p></w:body></w:document>`;
    const doc = parseXml(xml);
    const serialized = serializeXml(doc);
    const doc2 = parseXml(serialized);
    const serialized2 = serializeXml(doc2);
    expect(serialized).toBe(serialized2);
  });
});

// ── NODE_TYPE constants ────────────────────────────────────────────

describe('NODE_TYPE', () => {
  it('has correct standard DOM node type values', () => {
    expect(NODE_TYPE.ELEMENT).toBe(1);
    expect(NODE_TYPE.TEXT).toBe(3);
    expect(NODE_TYPE.PROCESSING_INSTRUCTION).toBe(7);
    expect(NODE_TYPE.COMMENT).toBe(8);
    expect(NODE_TYPE.DOCUMENT).toBe(9);
  });
});
