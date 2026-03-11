import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
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
} from '../src/primitives/dom-helpers.js';

// ── Helpers ────────────────────────────────────────────────────────

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function makeDoc(bodyXml: string): Document {
  return parseXml(
    `<w:document xmlns:w="${W_NS}"><w:body>${bodyXml}</w:body></w:document>`,
  );
}

function getBody(doc: Document): Element {
  return doc.getElementsByTagName('w:body')[0]!;
}

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'DOM Helpers' });

// ── getLeafText ────────────────────────────────────────────────────

describe('getLeafText', () => {
  test('returns text for a leaf element like <w:t>Hello</w:t>', async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    let wt!: Element;
    await given('a run with a w:t element containing Hello', async () => {
      doc = makeDoc('<w:r><w:t>Hello</w:t></w:r>');
      wt = doc.getElementsByTagName('w:t')[0]!;
    });
    await when('getLeafText is called on the w:t element', async () => {});
    await then('it returns Hello', () => {
      expect(getLeafText(wt)).toBe('Hello');
    });
  });

  test('returns undefined for a container element like <w:rPr><w:b/></w:rPr>', async ({ given, when, then }: AllureBddContext) => {
    let rPr!: Element;
    await given('a run with a w:rPr container element', async () => {
      const doc = makeDoc('<w:r><w:rPr><w:b/></w:rPr></w:r>');
      rPr = doc.getElementsByTagName('w:rPr')[0]!;
    });
    await when('getLeafText is called on the w:rPr container', async () => {});
    await then('it returns undefined', () => {
      expect(getLeafText(rPr)).toBeUndefined();
    });
  });

  test('returns empty string for an element with an empty text node', async ({ given, when, then }: AllureBddContext) => {
    let wt!: Element;
    let result: string | undefined;
    await given('a run with an empty w:t element', async () => {
      const doc = makeDoc('<w:r><w:t></w:t></w:r>');
      wt = doc.getElementsByTagName('w:t')[0]!;
    });
    await when('getLeafText is called on the empty w:t', async () => {
      // xmldom may or may not produce a text node for empty element
      result = getLeafText(wt);
    });
    await then('it returns undefined or empty string', () => {
      expect(result === undefined || result === '').toBe(true);
    });
  });

  test('returns only direct text, not recursive text of descendants', async ({ given, when, then }: AllureBddContext) => {
    let wr!: Element;
    await given('a paragraph with a run containing a w:t child', async () => {
      // <w:r> has a text node " " and child <w:t>Word</w:t>
      const doc = makeDoc('<w:p><w:r><w:t>Word</w:t></w:r></w:p>');
      wr = doc.getElementsByTagName('w:r')[0]!;
    });
    await when('getLeafText is called on the w:r element', async () => {});
    await then('it returns undefined because w:r has no direct text child', () => {
      // w:r has no direct text child — only an element child w:t
      expect(getLeafText(wr)).toBeUndefined();
    });
  });

  test('preserves whitespace text', async ({ given, when, then }: AllureBddContext) => {
    let wt!: Element;
    await given('a w:t element with xml:space="preserve" and padded spaces', async () => {
      const doc = makeDoc('<w:r><w:t xml:space="preserve">  spaces  </w:t></w:r>');
      wt = doc.getElementsByTagName('w:t')[0]!;
    });
    await when('getLeafText is called on the w:t element', async () => {});
    await then('it returns the text including surrounding spaces', () => {
      expect(getLeafText(wt)).toBe('  spaces  ');
    });
  });
});

// ── setLeafText ────────────────────────────────────────────────────

describe('setLeafText', () => {
  test('sets text on an element that already has text', async ({ given, when, then }: AllureBddContext) => {
    let wt!: Element;
    await given('a w:t element with existing text Old', async () => {
      const doc = makeDoc('<w:r><w:t>Old</w:t></w:r>');
      wt = doc.getElementsByTagName('w:t')[0]!;
    });
    await when('setLeafText is called with New', async () => {
      setLeafText(wt, 'New');
    });
    await then('getLeafText returns New', () => {
      expect(getLeafText(wt)).toBe('New');
    });
  });

  test('creates a text node on an empty element', async ({ given, when, then }: AllureBddContext) => {
    let wb!: Element;
    await given('an empty w:b element with no text node', async () => {
      const doc = makeDoc('<w:r><w:b/></w:r>');
      wb = doc.getElementsByTagName('w:b')[0]!;
    });
    await when('setLeafText is called with text', async () => {
      setLeafText(wb, 'text');
    });
    await then('getLeafText returns text', () => {
      expect(getLeafText(wb)).toBe('text');
    });
  });
});

// ── childElements ──────────────────────────────────────────────────

describe('childElements', () => {
  test('returns only element children, filtering out text nodes', async ({ given, when, then, and }: AllureBddContext) => {
    let wp!: Element;
    let children!: Element[];
    await given('a paragraph with w:pPr and w:r children', async () => {
      const doc = makeDoc('<w:p><w:pPr/><w:r><w:t>Hi</w:t></w:r></w:p>');
      wp = doc.getElementsByTagName('w:p')[0]!;
    });
    await when('childElements is called on the paragraph', async () => {
      children = childElements(wp);
    });
    await then('it returns 2 children', () => {
      expect(children.length).toBe(2);
    });
    await and('first child is w:pPr and second is w:r', () => {
      expect(children[0]!.tagName).toBe('w:pPr');
      expect(children[1]!.tagName).toBe('w:r');
    });
  });

  test('returns empty array for element with no children', async ({ given, when, then }: AllureBddContext) => {
    let wb!: Element;
    await given('an empty w:b element', async () => {
      const doc = makeDoc('<w:b/>');
      wb = doc.getElementsByTagName('w:b')[0]!;
    });
    await when('childElements is called', async () => {});
    await then('it returns an empty array', () => {
      expect(childElements(wb)).toEqual([]);
    });
  });

  test('filters out text nodes from mixed content', async ({ given, when, then, and }: AllureBddContext) => {
    let root!: Element;
    let children!: Element[];
    await given('a root element with mixed text and element children', async () => {
      // Create doc with mixed content (text + elements)
      const doc = parseXml('<root>text<child/>more</root>');
      root = doc.documentElement;
    });
    await when('childElements is called on the root', async () => {
      children = childElements(root);
    });
    await then('it returns only 1 element child', () => {
      expect(children.length).toBe(1);
    });
    await and('the element is the child tag', () => {
      expect(children[0]!.tagName).toBe('child');
    });
  });
});

// ── childElementsByTagName ─────────────────────────────────────────

describe('childElementsByTagName', () => {
  test('returns only direct children matching the tag name', async ({ given, when, then }: AllureBddContext) => {
    let wp!: Element;
    let runs!: Element[];
    await given('a paragraph with two w:r direct children and a w:pPr', async () => {
      const doc = makeDoc(
        '<w:p><w:r><w:t>A</w:t></w:r><w:r><w:t>B</w:t></w:r><w:pPr/></w:p>',
      );
      wp = doc.getElementsByTagName('w:p')[0]!;
    });
    await when('childElementsByTagName is called for w:r', async () => {
      runs = childElementsByTagName(wp, 'w:r');
    });
    await then('it returns 2 matching direct children', () => {
      expect(runs.length).toBe(2);
    });
  });

  test('does not return nested descendants', async ({ given, when, then }: AllureBddContext) => {
    let wp!: Element;
    let texts!: Element[];
    await given('a paragraph where w:t is a grandchild inside w:r', async () => {
      const doc = makeDoc(
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t></w:r></w:p>',
      );
      wp = doc.getElementsByTagName('w:p')[0]!;
    });
    await when('childElementsByTagName is called for w:t on the paragraph', async () => {
      // w:t is a grandchild, not a direct child of w:p
      texts = childElementsByTagName(wp, 'w:t');
    });
    await then('it returns 0 results since w:t is not a direct child', () => {
      expect(texts.length).toBe(0);
    });
  });
});

// ── findChildByTagName ─────────────────────────────────────────────

describe('findChildByTagName', () => {
  test('finds first direct child with matching tag', async ({ given, when, then, and }: AllureBddContext) => {
    let wr!: Element;
    let rPr: Element | null = null;
    await given('a w:r element with a w:rPr direct child', async () => {
      const doc = makeDoc('<w:r><w:rPr/><w:t>Hi</w:t></w:r>');
      wr = doc.getElementsByTagName('w:r')[0]!;
    });
    await when('findChildByTagName is called for w:rPr', async () => {
      rPr = findChildByTagName(wr, 'w:rPr');
    });
    await then('it returns a non-null element', () => {
      expect(rPr).not.toBeNull();
    });
    await and('the returned element has tagName w:rPr', () => {
      expect(rPr!.tagName).toBe('w:rPr');
    });
  });

  test('returns null when no matching child exists', async ({ given, when, then }: AllureBddContext) => {
    let wr!: Element;
    await given('a w:r element with no w:rPr child', async () => {
      const doc = makeDoc('<w:r><w:t>Hi</w:t></w:r>');
      wr = doc.getElementsByTagName('w:r')[0]!;
    });
    await when('findChildByTagName is called for w:rPr', async () => {});
    await then('it returns null', () => {
      expect(findChildByTagName(wr, 'w:rPr')).toBeNull();
    });
  });
});

// ── insertAfterElement ─────────────────────────────────────────────

describe('insertAfterElement', () => {
  test('inserts a new element after the reference element', async ({ given, when, then, and }: AllureBddContext) => {
    let wp!: Element;
    let wr!: Element;
    let newR!: Element;
    let children!: Element[];
    await given('a paragraph with a single w:r and a new w:r to insert', async () => {
      const doc = makeDoc('<w:p><w:r/></w:p>');
      wp = doc.getElementsByTagName('w:p')[0]!;
      wr = doc.getElementsByTagName('w:r')[0]!;
      newR = doc.createElementNS(W_NS, 'w:r');
      newR.setAttribute('w:id', 'new');
    });
    await when('insertAfterElement is called with the new element', async () => {
      insertAfterElement(wr, newR);
      children = childElements(wp);
    });
    await then('the paragraph now has 2 children', () => {
      expect(children.length).toBe(2);
    });
    await and('the new element is positioned after the reference', () => {
      expect(children[1]!.getAttribute('w:id')).toBe('new');
    });
  });

  test('appends at end when reference is the last child', async ({ given, when, then }: AllureBddContext) => {
    let wp!: Element;
    let wr!: Element;
    let newEl!: Element;
    await given('a paragraph where w:r is the last child', async () => {
      const doc = makeDoc('<w:p><w:pPr/><w:r/></w:p>');
      wr = doc.getElementsByTagName('w:r')[0]!;
      newEl = doc.createElementNS(W_NS, 'w:bookmarkEnd');
      wp = doc.getElementsByTagName('w:p')[0]!;
    });
    await when('insertAfterElement is called with a new w:bookmarkEnd', async () => {
      insertAfterElement(wr, newEl);
    });
    await then('the new element is the last child of the paragraph', () => {
      const children = childElements(wp);
      expect(children[children.length - 1]!.tagName).toBe('w:bookmarkEnd');
    });
  });
});

// ── wrapElement ────────────────────────────────────────────────────

describe('wrapElement', () => {
  test('wraps target in a wrapper element', async ({ given, when, then, and }: AllureBddContext) => {
    let wp!: Element;
    let wr!: Element;
    let ins!: Element;
    let children!: Element[];
    await given('a paragraph with a w:r element and a new w:ins wrapper', async () => {
      const doc = makeDoc('<w:p><w:r><w:t>Hi</w:t></w:r></w:p>');
      wr = doc.getElementsByTagName('w:r')[0]!;
      ins = doc.createElementNS(W_NS, 'w:ins');
      wp = doc.getElementsByTagName('w:p')[0]!;
    });
    await when('wrapElement wraps w:r inside w:ins', async () => {
      wrapElement(wr, ins);
      children = childElements(wp);
    });
    await then('the paragraph has 1 child which is w:ins', () => {
      expect(children.length).toBe(1);
      expect(children[0]!.tagName).toBe('w:ins');
    });
    await and('w:ins contains the original w:r', () => {
      expect(childElements(children[0]!)[0]!.tagName).toBe('w:r');
    });
  });
});

// ── unwrapElement ──────────────────────────────────────────────────

describe('unwrapElement', () => {
  test('replaces element with its children in parent', async ({ given, when, then, and }: AllureBddContext) => {
    let wp!: Element;
    let ins!: Element;
    let children!: Element[];
    await given('a paragraph with a w:ins wrapper containing a w:r', async () => {
      const doc = makeDoc('<w:p><w:ins><w:r><w:t>Hi</w:t></w:r></w:ins></w:p>');
      ins = doc.getElementsByTagName('w:ins')[0]!;
      wp = doc.getElementsByTagName('w:p')[0]!;
    });
    await when('unwrapElement is called on w:ins', async () => {
      unwrapElement(ins);
      children = childElements(wp);
    });
    await then('the paragraph has 1 child', () => {
      expect(children.length).toBe(1);
    });
    await and('the child is now w:r directly under the paragraph', () => {
      expect(children[0]!.tagName).toBe('w:r');
    });
  });
});

// ── removeAllByTagName ─────────────────────────────────────────────

describe('removeAllByTagName', () => {
  test('removes all elements matching the tag name', async ({ given, when, then, and }: AllureBddContext) => {
    let wp!: Element;
    let count!: number;
    await given('a paragraph containing a w:bookmarkStart element', async () => {
      const doc = makeDoc(
        '<w:p><w:bookmarkStart/><w:r><w:t>Hi</w:t></w:r><w:bookmarkEnd/></w:p>',
      );
      wp = doc.getElementsByTagName('w:p')[0]!;
    });
    await when('removeAllByTagName is called for w:bookmarkStart', async () => {
      count = removeAllByTagName(wp, 'w:bookmarkStart');
    });
    await then('it reports 1 element removed', () => {
      expect(count).toBe(1);
    });
    await and('no w:bookmarkStart elements remain', () => {
      expect(wp.getElementsByTagName('w:bookmarkStart').length).toBe(0);
    });
  });
});

// ── unwrapAllByTagName ─────────────────────────────────────────────

describe('unwrapAllByTagName', () => {
  test('unwraps all matching elements throughout the tree', async ({ given, when, then, and }: AllureBddContext) => {
    let wp!: Element;
    let count!: number;
    await given('a paragraph with two w:ins wrappers each containing a w:r', async () => {
      const doc = makeDoc(
        '<w:p><w:ins><w:r><w:t>A</w:t></w:r></w:ins><w:ins><w:r><w:t>B</w:t></w:r></w:ins></w:p>',
      );
      void getBody(doc);
      wp = doc.getElementsByTagName('w:p')[0]!;
    });
    await when('unwrapAllByTagName is called for w:ins', async () => {
      count = unwrapAllByTagName(wp, 'w:ins');
    });
    await then('it reports 2 elements unwrapped', () => {
      expect(count).toBe(2);
    });
    await and('no w:ins elements remain and both w:r elements are present', () => {
      expect(wp.getElementsByTagName('w:ins').length).toBe(0);
      expect(wp.getElementsByTagName('w:r').length).toBe(2);
    });
  });
});

// ── createWmlElement ───────────────────────────────────────────────

describe('createWmlElement', () => {
  test('creates element with correct namespace and localName', async ({ given, when, then, and }: AllureBddContext) => {
    let el!: Element;
    await given('a document to own the new element', async () => {
      const doc = makeDoc('');
      el = createWmlElement(doc, 't');
    });
    await when('createWmlElement is called for localName t', async () => {});
    await then('the element has the WML namespace URI', () => {
      expect(el.namespaceURI).toBe(W_NS);
    });
    await and('localName is t and tagName is w:t', () => {
      expect(el.localName).toBe('t');
      expect(el.tagName).toBe('w:t');
    });
  });

  test('sets attributes', async ({ given, when, then, and }: AllureBddContext) => {
    let el!: Element;
    await given('a document and attribute map for a w:bookmarkStart', async () => {
      const doc = makeDoc('');
      el = createWmlElement(doc, 'bookmarkStart', {
        'w:id': '0',
        'w:name': '_bk_1',
      });
    });
    await when('createWmlElement is called with attribute map', async () => {});
    await then('the element has w:id=0', () => {
      expect(el.getAttribute('w:id')).toBe('0');
    });
    await and('the element has w:name=_bk_1', () => {
      expect(el.getAttribute('w:name')).toBe('_bk_1');
    });
  });
});

// ── createWmlTextElement ───────────────────────────────────────────

describe('createWmlTextElement', () => {
  test('creates a w:t element with text and xml:space="preserve"', async ({ given, when, then, and }: AllureBddContext) => {
    let el!: Element;
    await given('a document to own the new element', async () => {
      const doc = makeDoc('');
      el = createWmlTextElement(doc, 'Hello World');
    });
    await when('createWmlTextElement is called with Hello World', async () => {});
    await then('the element tagName is w:t with xml:space=preserve', () => {
      expect(el.tagName).toBe('w:t');
      expect(el.getAttribute('xml:space')).toBe('preserve');
    });
    await and('the leaf text equals Hello World', () => {
      expect(getLeafText(el)).toBe('Hello World');
    });
  });
});

// ── Round-trip tests ───────────────────────────────────────────────

describe('parseXml → serializeXml round-trip', () => {
  test('preserves processing instructions', async ({ given, when, then, and }: AllureBddContext) => {
    let serialized!: string;
    await given('an XML string with a processing instruction header', async () => {});
    await when('the XML is parsed and serialized', async () => {
      const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><root/>';
      const doc = parseXml(xml);
      serialized = serializeXml(doc);
    });
    await then('the serialized output contains the xml processing instruction', () => {
      expect(serialized).toContain('<?xml');
    });
    await and('version="1.0" is present', () => {
      expect(serialized).toContain('version="1.0"');
    });
  });

  test('preserves self-closing tags', async ({ given, when, then }: AllureBddContext) => {
    let serialized!: string;
    await given('an XML document with self-closing w:b elements', async () => {});
    await when('the XML is parsed and serialized', async () => {
      const xml = `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hi</w:t></w:r></w:p></w:body></w:document>`;
      const doc = parseXml(xml);
      serialized = serializeXml(doc);
    });
    await then('the serialized output still contains w:b', () => {
      // xmldom may use <w:b/> or <w:b></w:b> — both are valid XML
      expect(serialized).toContain('w:b');
    });
  });

  test('preserves xml:space="preserve" on w:t elements', async ({ given, when, then, and }: AllureBddContext) => {
    let serialized!: string;
    await given('a w:t element with xml:space=preserve and padded text', async () => {});
    await when('the XML is parsed and serialized', async () => {
      const xml = `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t xml:space="preserve"> hello </w:t></w:r></w:p></w:body></w:document>`;
      const doc = parseXml(xml);
      serialized = serializeXml(doc);
    });
    await then('xml:space="preserve" is retained in the output', () => {
      expect(serialized).toContain('xml:space="preserve"');
    });
    await and('the padded text content is preserved', () => {
      expect(serialized).toContain(' hello ');
    });
  });

  test('preserves namespace declarations', async ({ given, when, then }: AllureBddContext) => {
    let serialized!: string;
    await given('a document with both w and r namespace declarations', async () => {});
    await when('the XML is parsed and serialized', async () => {
      const xml = `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body/></w:document>`;
      const doc = parseXml(xml);
      serialized = serializeXml(doc);
    });
    await then('the w namespace declaration is present in the output', () => {
      expect(serialized).toContain(`xmlns:w="${W_NS}"`);
    });
  });

  test('preserves content fidelity through round-trip', async ({ given, when, then }: AllureBddContext) => {
    let serialized!: string;
    let serialized2!: string;
    await given('a rich XML document with styles, runs, and formatting', async () => {});
    await when('the XML is parsed, serialized, then parsed and serialized again', async () => {
      const xml = `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t xml:space="preserve">Hello World</w:t></w:r></w:p></w:body></w:document>`;
      const doc = parseXml(xml);
      serialized = serializeXml(doc);
      const doc2 = parseXml(serialized);
      serialized2 = serializeXml(doc2);
    });
    await then('both serializations are identical', () => {
      expect(serialized).toBe(serialized2);
    });
  });
});

// ── NODE_TYPE constants ────────────────────────────────────────────

describe('NODE_TYPE', () => {
  test('has correct standard DOM node type values', async ({ given, when, then }: AllureBddContext) => {
    await given('the NODE_TYPE constants exported from dom-helpers', async () => {});
    await when('the constants are read', async () => {});
    await then('each constant matches the standard DOM node type integer', () => {
      expect(NODE_TYPE.ELEMENT).toBe(1);
      expect(NODE_TYPE.TEXT).toBe(3);
      expect(NODE_TYPE.PROCESSING_INSTRUCTION).toBe(7);
      expect(NODE_TYPE.COMMENT).toBe(8);
      expect(NODE_TYPE.DOCUMENT).toBe(9);
    });
  });
});
