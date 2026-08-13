import { DocxDocument, computeContentFingerprint } from '@usejunior/docx-core';
import { sha256 } from './hash.js';
import type { ImportResult } from './types.js';

function escapeText(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_\[\]{}<>#!])/g, '\\$1')
    .replace(/^(\d+)\./, '$1\\.');
  // CommonMark discards syntactic whitespace at block boundaries. Character
  // references survive parsing as text, so preserve source-significant spaces
  // without introducing a second representation or raw OOXML.
  return escaped
    .replace(/^ +/, (spaces) => '&#32;'.repeat(spaces.length))
    .replace(/ +$/, (spaces) => '&#32;'.repeat(spaces.length));
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function importDocxToMarkdoc(source: Buffer): Promise<ImportResult> {
  const document = await DocxDocument.load(source);
  const attachmentId = sha256(source).slice(0, 16);
  document.insertParagraphBookmarks(attachmentId);
  const anchoredSource = (await document.toBuffer({ cleanBookmarks: false })).buffer;
  const anchored = await DocxDocument.load(anchoredSource);
  const { nodes } = anchored.buildDocumentView({ includeSemanticTags: false, showFormatting: false });
  const descriptor = { sha256: sha256(anchoredSource), paragraphs: nodes.length };
  const lines = [`{% source sha256="${descriptor.sha256}" paragraphs=${nodes.length} /%}`, ''];
  for (const node of nodes) {
    const text = node.raw_text ?? node.text;
    lines.push(
      `{% para id="${escapeAttribute(node.id)}" fingerprint="${computeContentFingerprint(text)}" style="${escapeAttribute(node.paragraph_style_id ?? node.style)}" %}`,
      escapeText(text),
      '{% /para %}',
      '',
    );
  }
  return { anchoredSource, markdoc: `${lines.join('\n').trimEnd()}\n`, source: descriptor };
}
