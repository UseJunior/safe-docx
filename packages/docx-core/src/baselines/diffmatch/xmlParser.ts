/**
 * XML Parser for extracting paragraphs and runs from DOCX document.xml.
 *
 * Uses fast-xml-parser to parse OOXML and extract ParagraphInfo objects
 * suitable for comparison.
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { ParagraphInfo, RunInfo, RunProperties } from '../../shared/ooxml/types.js';
import { hashParagraph } from './paragraphAlignment.js';

/** Parser options for fast-xml-parser */
const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  textNodeName: '#text',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
};

/** Builder options for reconstructing XML */
const BUILDER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  textNodeName: '#text',
  format: false,
  suppressEmptyNode: false,
};

/**
 * Extended ParagraphInfo with original XML for reconstruction.
 */
export interface ExtendedParagraphInfo extends ParagraphInfo {
  /** Original paragraph properties XML (w:pPr) for preservation */
  pPrXml?: string;
  /** Original paragraph index in document */
  originalIndex: number;
}

/**
 * Extract paragraphs from document.xml content.
 *
 * @param documentXml - The raw document.xml content
 * @returns Array of ParagraphInfo objects with runs and metadata
 */
export function extractParagraphs(documentXml: string): ExtendedParagraphInfo[] {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(documentXml);

  const paragraphs: ExtendedParagraphInfo[] = [];

  // Navigate to w:body
  const body = findElement(doc, 'w:body');
  if (!body) {
    return paragraphs;
  }

  // Find all w:p elements in body
  let paragraphIndex = 0;
  for (const child of getChildren(body)) {
    if (getTagName(child) === 'w:p') {
      const para = extractParagraph(child, paragraphIndex);
      paragraphs.push(para);
      paragraphIndex++;
    }
    // Note: We skip w:tbl (tables) for v1 - could add support later
  }

  return paragraphs;
}

/**
 * Extract a single paragraph from a parsed w:p element.
 */
function extractParagraph(pElement: unknown, index: number): ExtendedParagraphInfo {
  const runs: RunInfo[] = [];
  let charOffset = 0;
  let pPrXml: string | undefined;

  const children = getChildren(pElement);

  for (const child of children) {
    const tagName = getTagName(child);

    if (tagName === 'w:pPr') {
      // Extract paragraph properties as XML for preservation
      pPrXml = elementToXml(child);
    } else if (tagName === 'w:r') {
      // Extract run
      const runInfo = extractRun(child, charOffset);
      if (runInfo.text.length > 0) {
        runs.push(runInfo);
        charOffset = runInfo.end;
      }
    }
    // Skip other elements (bookmarkStart, bookmarkEnd, etc.)
  }

  // Combine all run text
  const text = runs.map(r => r.text).join('');

  return {
    text,
    runs,
    hash: hashParagraph(text),
    pPrXml,
    originalIndex: index,
  };
}

/**
 * Extract a single run from a parsed w:r element.
 */
function extractRun(rElement: unknown, startOffset: number): RunInfo {
  let text = '';
  let properties: RunProperties | undefined;

  const children = getChildren(rElement);

  for (const child of children) {
    const tagName = getTagName(child);

    if (tagName === 'w:rPr') {
      properties = extractRunProperties(child);
    } else if (tagName === 'w:t') {
      // Get text content
      text += getTextContent(child);
    } else if (tagName === 'w:tab') {
      // Tab character
      text += '\t';
    } else if (tagName === 'w:br') {
      // Break (newline)
      text += '\n';
    }
    // Skip other elements (w:sym, w:drawing, etc.)
  }

  return {
    text,
    start: startOffset,
    end: startOffset + text.length,
    properties,
  };
}

/**
 * Extract run properties from a w:rPr element.
 */
export function extractRunProperties(rPrElement: unknown): RunProperties | undefined {
  const props: RunProperties = {};
  let hasProps = false;

  const children = getChildren(rPrElement);

  for (const child of children) {
    const tagName = getTagName(child);

    if (tagName === 'w:b') {
      props.bold = true;
      hasProps = true;
    } else if (tagName === 'w:i') {
      props.italic = true;
      hasProps = true;
    } else if (tagName === 'w:u') {
      const val = getAttribute(child, 'w:val');
      props.underline = val || 'single';
      hasProps = true;
    } else if (tagName === 'w:strike') {
      props.strikethrough = true;
      hasProps = true;
    } else if (tagName === 'w:highlight') {
      const val = getAttribute(child, 'w:val');
      if (val) {
        props.highlight = val;
        hasProps = true;
      }
    } else if (tagName === 'w:color') {
      const val = getAttribute(child, 'w:val');
      if (val) {
        props.color = val;
        hasProps = true;
      }
    } else if (tagName === 'w:sz') {
      const val = getAttribute(child, 'w:val');
      if (val) {
        props.fontSize = parseInt(val, 10);
        hasProps = true;
      }
    } else if (tagName === 'w:rFonts') {
      const ascii = getAttribute(child, 'w:ascii');
      if (ascii) {
        props.fontFamily = ascii;
        hasProps = true;
      }
    }
  }

  return hasProps ? props : undefined;
}

/**
 * Get the document body content (everything inside w:body).
 * Useful for document reconstruction.
 */
export function getBodyContent(documentXml: string): {
  beforeBody: string;
  bodyContent: string;
  afterBody: string;
} {
  // Use regex to extract body content while preserving structure
  const bodyMatch = documentXml.match(/(<w:body[^>]*>)([\s\S]*?)(<\/w:body>)/);

  if (!bodyMatch) {
    return {
      beforeBody: documentXml,
      bodyContent: '',
      afterBody: '',
    };
  }

  const bodyStart = documentXml.indexOf(bodyMatch[0]);
  const bodyEnd = bodyStart + bodyMatch[0].length;

  return {
    beforeBody: documentXml.slice(0, bodyStart) + bodyMatch[1],
    bodyContent: bodyMatch[2]!,
    afterBody: bodyMatch[3]! + documentXml.slice(bodyEnd),
  };
}

/**
 * Extract sectPr (section properties) from body content if present.
 * sectPr must remain at the end of body.
 */
export function extractSectPr(bodyContent: string): {
  content: string;
  sectPr: string | null;
} {
  // Find the last w:sectPr in the body
  const sectPrMatch = bodyContent.match(/<w:sectPr[^>]*>[\s\S]*?<\/w:sectPr>\s*$/);

  if (!sectPrMatch) {
    return { content: bodyContent, sectPr: null };
  }

  const sectPrStart = bodyContent.lastIndexOf(sectPrMatch[0]);
  return {
    content: bodyContent.slice(0, sectPrStart),
    sectPr: sectPrMatch[0],
  };
}

// Helper functions for navigating parsed XML

/**
 * Find an element by tag name in a parsed structure.
 */
function findElement(obj: unknown, tagName: string): unknown | null {
  if (!obj || typeof obj !== 'object') return null;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findElement(item, tagName);
      if (found) return found;
    }
    return null;
  }

  const objRecord = obj as Record<string, unknown>;
  if (tagName in objRecord) {
    return objRecord[tagName];
  }

  // Search in children
  for (const key of Object.keys(objRecord)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const found = findElement(objRecord[key], tagName);
    if (found) return found;
  }

  return null;
}

/**
 * Get children of a parsed element.
 * With preserveOrder, children are in an array.
 */
function getChildren(element: unknown): unknown[] {
  if (!element || typeof element !== 'object') return [];

  if (Array.isArray(element)) {
    return element;
  }

  // With preserveOrder: true, the structure is an array of objects
  // where each object has a single key (the tag name)
  const objRecord = element as Record<string, unknown>;
  const result: unknown[] = [];

  for (const key of Object.keys(objRecord)) {
    if (key.startsWith('@_') || key === '#text' || key === ':@') continue;
    const value = objRecord[key];
    if (Array.isArray(value)) {
      result.push(...value);
    } else {
      result.push({ [key]: value });
    }
  }

  return result;
}

/**
 * Get the tag name of a parsed element.
 */
function getTagName(element: unknown): string | null {
  if (!element || typeof element !== 'object') return null;

  if (Array.isArray(element)) return null;

  const objRecord = element as Record<string, unknown>;
  for (const key of Object.keys(objRecord)) {
    if (!key.startsWith('@_') && key !== '#text' && key !== ':@') {
      return key;
    }
  }
  return null;
}

/**
 * Get an attribute value from a parsed element.
 */
function getAttribute(element: unknown, attrName: string): string | null {
  if (!element || typeof element !== 'object') return null;

  const objRecord = element as Record<string, unknown>;

  // Check in :@ for attributes (preserveOrder format)
  const attrs = objRecord[':@'] as Record<string, unknown> | undefined;
  if (attrs) {
    const prefixedName = '@_' + attrName;
    if (prefixedName in attrs) {
      return String(attrs[prefixedName]);
    }
  }

  // Also check directly on object
  const prefixedName = '@_' + attrName;
  if (prefixedName in objRecord) {
    return String(objRecord[prefixedName]);
  }

  return null;
}

/**
 * Get text content from an element.
 */
function getTextContent(element: unknown): string {
  if (!element || typeof element !== 'object') return '';

  const objRecord = element as Record<string, unknown>;

  // With preserveOrder, text is in #text
  if ('#text' in objRecord) {
    return String(objRecord['#text']);
  }

  // Check nested children for text
  for (const key of Object.keys(objRecord)) {
    if (key === '#text') {
      return String(objRecord[key]);
    }
    if (Array.isArray(objRecord[key])) {
      for (const item of objRecord[key] as unknown[]) {
        if (item && typeof item === 'object' && '#text' in (item as Record<string, unknown>)) {
          return String((item as Record<string, unknown>)['#text']);
        }
      }
    }
  }

  return '';
}

/**
 * Convert a parsed element back to XML string.
 */
function elementToXml(element: unknown): string {
  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return builder.build([element]);
}
