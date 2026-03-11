import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml, serializeXml, textContent } from '../src/primitives/xml.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'XML Parsing' });

describe('parseXml', () => {
  test('parses valid XML and returns a Document', async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    await given('a valid XML string with a root and child element', async () => {});
    await when('parseXml is called', async () => {
      doc = parseXml('<root><child>hello</child></root>');
    });
    await then('the document and documentElement are defined with the correct tag', () => {
      expect(doc).toBeDefined();
      expect(doc.documentElement).toBeDefined();
      expect(doc.documentElement.tagName).toBe('root');
    });
  });

  test('preserves element structure', async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    await given('a nested XML string with elements a and b', async () => {});
    await when('parseXml is called', async () => {
      doc = parseXml('<root><a><b>text</b></a></root>');
    });
    await then('the b element is present and contains the correct text', () => {
      const b = doc.getElementsByTagName('b').item(0);
      expect(b).not.toBeNull();
      expect(b!.textContent).toBe('text');
    });
  });

  test('handles namespaced XML', async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    let xml!: string;
    await given('a namespaced OOXML document string with a w:body element', async () => {
      xml =
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>';
    });
    await when('parseXml is called', async () => {
      doc = parseXml(xml);
    });
    await then('the w:body element is found by namespace', () => {
      const body = doc.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'body',
      );
      expect(body.length).toBe(1);
    });
  });

  test('handles attributes', async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    await given('an XML string with an attr attribute on the root', async () => {});
    await when('parseXml is called', async () => {
      doc = parseXml('<root attr="value"/>');
    });
    await then('the attribute value is accessible', () => {
      expect(doc.documentElement.getAttribute('attr')).toBe('value');
    });
  });

  test('handles empty elements', async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    await given('a self-closing root element XML string', async () => {});
    await when('parseXml is called', async () => {
      doc = parseXml('<root/>');
    });
    await then('the root element has the correct tag and no children', () => {
      expect(doc.documentElement.tagName).toBe('root');
      expect(doc.documentElement.childNodes.length).toBe(0);
    });
  });
});

describe('serializeXml', () => {
  test('round-trips simple XML back to string', async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    let serialized!: string;
    await given('a parsed document from simple XML', async () => {
      doc = parseXml('<root><child>hello</child></root>');
    });
    await when('serializeXml is called', async () => {
      serialized = serializeXml(doc);
    });
    await then('the serialized string contains all original elements', () => {
      expect(serialized).toContain('<root>');
      expect(serialized).toContain('<child>hello</child>');
      expect(serialized).toContain('</root>');
    });
  });

  test('round-trips namespaced XML', async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    let serialized!: string;
    await given('a parsed document from namespaced OOXML', async () => {
      const xml =
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>';
      doc = parseXml(xml);
    });
    await when('serializeXml is called', async () => {
      serialized = serializeXml(doc);
    });
    await then('the serialized string contains the namespaced element names', () => {
      expect(serialized).toContain('w:document');
      expect(serialized).toContain('w:body');
    });
  });

  test('preserves attributes through round-trip', async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    let serialized!: string;
    await given('a parsed document with id and name attributes on the root', async () => {
      doc = parseXml('<root id="123" name="test"/>');
    });
    await when('serializeXml is called', async () => {
      serialized = serializeXml(doc);
    });
    await then('both attributes appear in the serialized output', () => {
      expect(serialized).toContain('id="123"');
      expect(serialized).toContain('name="test"');
    });
  });

  test('preserves text content through round-trip', async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    let serialized!: string;
    await given('a parsed document with text content inside the root', async () => {
      doc = parseXml('<root>Some text content</root>');
    });
    await when('serializeXml is called', async () => {
      serialized = serializeXml(doc);
    });
    await then('the text content appears in the serialized output', () => {
      expect(serialized).toContain('Some text content');
    });
  });
});

describe('textContent', () => {
  test('returns text content of a node', async ({ given, when, then }: AllureBddContext) => {
    let node!: Element;
    await given('a document element with direct text hello world', async () => {
      const doc = parseXml('<root>hello world</root>');
      node = doc.documentElement;
    });
    await then('textContent returns the text string', () => {
      expect(textContent(node)).toBe('hello world');
    });
  });

  test('returns concatenated text of nested elements', async ({ given, when, then }: AllureBddContext) => {
    let node!: Element;
    await given('a root element with nested a and b child elements containing text', async () => {
      const doc = parseXml('<root><a>hello</a> <b>world</b></root>');
      node = doc.documentElement;
    });
    await then('textContent returns all text concatenated', () => {
      expect(textContent(node)).toBe('hello world');
    });
  });

  test('returns empty string for null', async ({ when, then }: AllureBddContext) => {
    await then('textContent of null returns empty string', () => {
      expect(textContent(null)).toBe('');
    });
  });

  test('returns empty string for undefined', async ({ then }: AllureBddContext) => {
    await then('textContent of undefined returns empty string', () => {
      expect(textContent(undefined)).toBe('');
    });
  });

  test('returns empty string for element with no text', async ({ given, then }: AllureBddContext) => {
    let child!: Element | null;
    await given('a child element with no text content', async () => {
      const doc = parseXml('<root><child/></root>');
      child = doc.getElementsByTagName('child').item(0);
    });
    await then('textContent returns an empty string', () => {
      expect(textContent(child)).toBe('');
    });
  });
});
