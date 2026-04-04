import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export type XmlDoc = Document;

export function parseXml(xml: string): XmlDoc {
  // application/xml ensures XML parsing rules (vs HTML-ish parsing).
  // xmldom 0.9.x returns its own module-scoped Document type; cast to global
  // Document to avoid type conflicts with the DOM lib.
  const doc = new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document;

  // xmldom uses a <parsererror> element for some failures; keep a minimal check.
  const parseErrors = doc.getElementsByTagName('parsererror');
  if (parseErrors && parseErrors.length > 0) {
    const msg = parseErrors[0]?.textContent?.trim() || 'XML parse error';
    throw new Error(msg);
  }
  return doc;
}

export function serializeXml(doc: XmlDoc): string {
  return new XMLSerializer().serializeToString(doc);
}

export function textContent(node: Node | null | undefined): string {
  return node?.textContent ?? '';
}
