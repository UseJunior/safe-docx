import { createHash } from 'node:crypto';
import { OOXML } from '@usejunior/docx-core';
import { canonicalNode } from './opaquePassthrough.js';
import { parseDocumentXml } from './xmlToWmlElement.js';

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
      ? createHash('sha256').update(canonicalNode(originalTextBox)).digest('hex')
      : undefined;
    const revisedSignature = revisedTextBox
      ? createHash('sha256').update(canonicalNode(revisedTextBox)).digest('hex')
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
