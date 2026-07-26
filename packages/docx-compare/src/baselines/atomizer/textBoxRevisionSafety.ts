import { createHash } from 'node:crypto';
import { OOXML } from '@usejunior/docx-core';
import { parseDocumentXml } from './xmlToWmlElement.js';

const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const WORD_2010_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

export interface TextBoxRevisionChange {
  index: number;
  originalParagraphId?: string;
  revisedParagraphId?: string;
}

export class UnsupportedTextBoxRevisionError extends Error {
  readonly changes: TextBoxRevisionChange[];

  constructor(changes: TextBoxRevisionChange[]) {
    const locations = changes
      .map(({ index, originalParagraphId, revisedParagraphId }) => {
        const paragraphIds = [...new Set(
          [originalParagraphId, revisedParagraphId].filter(
            (value): value is string => value !== undefined,
          ),
        )];
        return paragraphIds.length > 0
          ? `w:txbxContent[${index}] (paragraph ${paragraphIds.join(' → ')})`
          : `w:txbxContent[${index}]`;
      })
      .join(', ');
    super(
      `Tracked revisions inside w:txbxContent are unsupported because the comparison ` +
        `engine cannot currently emit a Word-readable redline for that container. ` +
        `Changed container(s): ${locations}`,
    );
    this.name = 'UnsupportedTextBoxRevisionError';
    this.changes = changes;
  }
}

function structuralSignature(node: Node): string {
  if (node.nodeType === 3 || node.nodeType === 4) {
    return JSON.stringify(['text', node.nodeValue ?? '']);
  }
  if (node.nodeType !== 1) return '';

  const element = node as Element;
  const attributes = Array.from(element.attributes)
    .filter((attribute) => attribute.namespaceURI !== XMLNS_NS)
    .map((attribute) => [
      attribute.namespaceURI ?? '',
      attribute.localName,
      attribute.value,
    ] as const)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const children: string[] = [];
  for (let child = element.firstChild; child; child = child.nextSibling) {
    const signature = structuralSignature(child);
    if (signature) children.push(signature);
  }

  return JSON.stringify([
    element.namespaceURI ?? '',
    element.localName,
    attributes,
    children,
  ]);
}

function textBoxParagraphId(textBox: Element): string | undefined {
  const paragraph = textBox.getElementsByTagNameNS(OOXML.W_NS, 'p').item(0) as Element | null;
  return paragraph?.getAttributeNS(WORD_2010_NS, 'paraId') || undefined;
}

function textBoxes(documentXml: string): Element[] {
  const root = parseDocumentXml(documentXml);
  return Array.from(
    root.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  ) as Element[];
}

/**
 * Fail closed when a comparison would need to place tracked revision markup
 * inside a text-box story. The atomizer currently treats the containing VML or
 * DrawingML object as atomic, and wrapping the changed object produces a DOCX
 * that Microsoft Word rejects as unreadable.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/647
 */
export function assertTextBoxContentUnchanged(
  originalDocumentXml: string,
  revisedDocumentXml: string,
): void {
  const originalTextBoxes = textBoxes(originalDocumentXml);
  const revisedTextBoxes = textBoxes(revisedDocumentXml);
  const count = Math.max(originalTextBoxes.length, revisedTextBoxes.length);
  const changes: TextBoxRevisionChange[] = [];

  for (let index = 0; index < count; index++) {
    const originalTextBox = originalTextBoxes[index];
    const revisedTextBox = revisedTextBoxes[index];
    const originalSignature = originalTextBox
      ? createHash('sha256').update(structuralSignature(originalTextBox)).digest('hex')
      : undefined;
    const revisedSignature = revisedTextBox
      ? createHash('sha256').update(structuralSignature(revisedTextBox)).digest('hex')
      : undefined;
    if (originalSignature === revisedSignature) continue;

    changes.push({
      index,
      originalParagraphId: originalTextBox
        ? textBoxParagraphId(originalTextBox)
        : undefined,
      revisedParagraphId: revisedTextBox
        ? textBoxParagraphId(revisedTextBox)
        : undefined,
    });
  }

  if (changes.length > 0) throw new UnsupportedTextBoxRevisionError(changes);
}
