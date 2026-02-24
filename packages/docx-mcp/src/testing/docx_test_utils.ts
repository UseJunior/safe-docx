import fs from 'node:fs/promises';
import { createZipBuffer, readZipText } from '@usejunior/docx-core';

function xmlEscape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export async function makeMinimalDocx(paragraphTexts: string[]): Promise<Buffer> {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>` +
    paragraphTexts.map((t) => `<w:p><w:r><w:t>${xmlEscape(t)}</w:t></w:r></w:p>`).join('') +
    `</w:body></w:document>`;
  return makeDocxWithDocumentXml(xml);
}

export async function makeDocxWithDocumentXml(documentXml: string, extraFiles?: Record<string, string>): Promise<Buffer> {
  return createZipBuffer({
    'word/document.xml': documentXml,
    ...(extraFiles ?? {}),
  });
}

export async function readDocumentXmlFromPath(filePath: string): Promise<string> {
  const outBuf = await fs.readFile(filePath);
  const text = await readZipText(outBuf, 'word/document.xml');
  if (text === null) {
    throw new Error('Missing file in .docx: word/document.xml');
  }
  return text;
}

export function extractParaIdsFromToon(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('_bk_'))
    .map((l) => l.split('|')[0]!.trim());
}

export function firstParaIdFromToon(content: string): string {
  const ids = extractParaIdsFromToon(content);
  if (ids.length === 0) throw new Error('No paragraph IDs found in TOON content');
  return ids[0]!;
}
