/**
 * XML Parser for extracting paragraphs and runs from DOCX document.xml.
 *
 * Uses xmldom to parse OOXML and extract ParagraphInfo objects
 * suitable for comparison.
 */

import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml } from '../../primitives/xml.js';
import type { ParagraphInfo, RunInfo, RunProperties } from '../../shared/ooxml/types.js';
import { hashParagraph } from './paragraphAlignment.js';

const ELEMENT_NODE = 1;
const serializer = new XMLSerializer();

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
  const doc = parseXml(documentXml);
  const paragraphs: ExtendedParagraphInfo[] = [];

  // Navigate to w:body
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) {
    return paragraphs;
  }

  // Find direct w:p children in body.
  let paragraphIndex = 0;
  for (const child of childElements(body)) {
    if (child.tagName === 'w:p') {
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
function extractParagraph(pElement: Element, index: number): ExtendedParagraphInfo {
  const runs: RunInfo[] = [];
  let charOffset = 0;
  let pPrXml: string | undefined;

  for (const child of childElements(pElement)) {
    if (child.tagName === 'w:pPr') {
      // Extract paragraph properties as XML for preservation
      pPrXml = elementToXml(child);
    } else if (child.tagName === 'w:r') {
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
function extractRun(rElement: Element, startOffset: number): RunInfo {
  let text = '';
  let properties: RunProperties | undefined;

  for (const child of childElements(rElement)) {
    if (child.tagName === 'w:rPr') {
      properties = extractRunProperties(child);
    } else if (child.tagName === 'w:t') {
      // Get text content
      text += child.textContent ?? '';
    } else if (child.tagName === 'w:tab') {
      // Tab character
      text += '\t';
    } else if (child.tagName === 'w:br') {
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
export function extractRunProperties(rPrElement: Element): RunProperties | undefined {
  const props: RunProperties = {};
  let hasProps = false;

  for (const child of childElements(rPrElement)) {
    if (child.tagName === 'w:b') {
      props.bold = true;
      hasProps = true;
    } else if (child.tagName === 'w:i') {
      props.italic = true;
      hasProps = true;
    } else if (child.tagName === 'w:u') {
      const val = child.getAttribute('w:val');
      props.underline = val || 'single';
      hasProps = true;
    } else if (child.tagName === 'w:strike') {
      props.strikethrough = true;
      hasProps = true;
    } else if (child.tagName === 'w:highlight') {
      const val = child.getAttribute('w:val');
      if (val) {
        props.highlight = val;
        hasProps = true;
      }
    } else if (child.tagName === 'w:color') {
      const val = child.getAttribute('w:val');
      if (val) {
        props.color = val;
        hasProps = true;
      }
    } else if (child.tagName === 'w:sz') {
      const val = child.getAttribute('w:val');
      if (val) {
        const parsed = Number.parseInt(val, 10);
        if (!Number.isNaN(parsed)) {
          props.fontSize = parsed;
          hasProps = true;
        }
      }
    } else if (child.tagName === 'w:rFonts') {
      const ascii = child.getAttribute('w:ascii');
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

/**
 * Convert an element back to XML string.
 */
function elementToXml(element: Element): string {
  return serializer.serializeToString(element);
}

/**
 * Get direct element children.
 */
function childElements(element: Element): Element[] {
  const children: Element[] = [];
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes[i];
    if (child && child.nodeType === ELEMENT_NODE) {
      children.push(child as Element);
    }
  }
  return children;
}
