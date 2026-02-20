import { describe, expect } from 'vitest';
import { itAllure as it } from '../test/helpers/allure-test.js';
import { parseXml, serializeXml, textContent } from './xml.js';

describe('parseXml', () => {
  it('parses valid XML and returns a Document', () => {
    const doc = parseXml('<root><child>hello</child></root>');
    expect(doc).toBeDefined();
    expect(doc.documentElement).toBeDefined();
    expect(doc.documentElement.tagName).toBe('root');
  });

  it('preserves element structure', () => {
    const doc = parseXml('<root><a><b>text</b></a></root>');
    const b = doc.getElementsByTagName('b').item(0);
    expect(b).not.toBeNull();
    expect(b!.textContent).toBe('text');
  });

  it('handles namespaced XML', () => {
    const xml =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>';
    const doc = parseXml(xml);
    const body = doc.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'body',
    );
    expect(body.length).toBe(1);
  });

  it('handles attributes', () => {
    const doc = parseXml('<root attr="value"/>');
    expect(doc.documentElement.getAttribute('attr')).toBe('value');
  });

  it('handles empty elements', () => {
    const doc = parseXml('<root/>');
    expect(doc.documentElement.tagName).toBe('root');
    expect(doc.documentElement.childNodes.length).toBe(0);
  });
});

describe('serializeXml', () => {
  it('round-trips simple XML back to string', () => {
    const doc = parseXml('<root><child>hello</child></root>');
    const serialized = serializeXml(doc);
    expect(serialized).toContain('<root>');
    expect(serialized).toContain('<child>hello</child>');
    expect(serialized).toContain('</root>');
  });

  it('round-trips namespaced XML', () => {
    const xml =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>';
    const doc = parseXml(xml);
    const serialized = serializeXml(doc);
    expect(serialized).toContain('w:document');
    expect(serialized).toContain('w:body');
  });

  it('preserves attributes through round-trip', () => {
    const doc = parseXml('<root id="123" name="test"/>');
    const serialized = serializeXml(doc);
    expect(serialized).toContain('id="123"');
    expect(serialized).toContain('name="test"');
  });

  it('preserves text content through round-trip', () => {
    const doc = parseXml('<root>Some text content</root>');
    const serialized = serializeXml(doc);
    expect(serialized).toContain('Some text content');
  });
});

describe('textContent', () => {
  it('returns text content of a node', () => {
    const doc = parseXml('<root>hello world</root>');
    expect(textContent(doc.documentElement)).toBe('hello world');
  });

  it('returns concatenated text of nested elements', () => {
    const doc = parseXml('<root><a>hello</a> <b>world</b></root>');
    expect(textContent(doc.documentElement)).toBe('hello world');
  });

  it('returns empty string for null', () => {
    expect(textContent(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(textContent(undefined)).toBe('');
  });

  it('returns empty string for element with no text', () => {
    const doc = parseXml('<root><child/></root>');
    const child = doc.getElementsByTagName('child').item(0);
    expect(textContent(child)).toBe('');
  });
});
