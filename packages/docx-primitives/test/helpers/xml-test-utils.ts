import { parseXml } from '../../src/xml.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Wraps body-level OOXML in a minimal w:document/w:body envelope.
 */
export function wrapInBody(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

/**
 * Creates a minimal w:document DOM with the given body-level XML.
 */
export function makeDoc(bodyXml: string): Document {
  return parseXml(wrapInBody(bodyXml));
}

/**
 * Creates a w:p element containing a single w:r/w:t with the given text.
 */
export function simpleParagraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}
