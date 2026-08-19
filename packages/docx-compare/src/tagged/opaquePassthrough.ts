import {
  classifyFieldInstruction as classifySharedFieldInstruction,
} from '@usejunior/docx-core';

const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

function isXmlnsAttribute(attribute: Attr): boolean {
  return attribute.namespaceURI === XMLNS_NS ||
    attribute.name === 'xmlns' ||
    attribute.name.startsWith('xmlns:');
}

/** Expanded-name canonical subtree form used by preservation safety checks. */
export function canonicalNode(node: Node): string {
  if (node.nodeType === 1) {
    const element = node as Element;
    const attributes: string[] = [];
    for (let index = 0; index < element.attributes.length; index++) {
      const attribute = element.attributes.item(index)!;
      if (isXmlnsAttribute(attribute)) continue;
      attributes.push(
        `{${attribute.namespaceURI ?? ''}}${attribute.localName ?? attribute.name}=` +
          JSON.stringify(attribute.value),
      );
    }
    attributes.sort();
    const children = Array.from(element.childNodes).map(canonicalNode);
    return `E{${element.namespaceURI ?? ''}}${element.localName ?? element.tagName}` +
      `[${attributes.join(',')}](${children.join('')})`;
  }
  if (node.nodeType === 3 || node.nodeType === 4) {
    return `T${JSON.stringify(node.nodeValue ?? '')}`;
  }
  if (node.nodeType === 8) return `C${JSON.stringify(node.nodeValue ?? '')}`;
  return `N${node.nodeType}:${JSON.stringify(node.nodeValue ?? '')}`;
}

export type SupportedComplexField = 'PAGE' | 'NUMPAGES' | 'REF' | 'PAGEREF';

/** Classify only complex fields whose comparison projection is supported. */
export function classifyFieldInstruction(instruction: string): SupportedComplexField | null {
  const classification = classifySharedFieldInstruction(instruction);
  if (
    classification.preservationSupported &&
    (classification.kind === 'PAGE' ||
      classification.kind === 'NUMPAGES' ||
      classification.kind === 'REF' ||
      classification.kind === 'PAGEREF')
  ) {
    return classification.kind;
  }
  return null;
}
