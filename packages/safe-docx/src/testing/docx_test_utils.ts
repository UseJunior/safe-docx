import fs from 'node:fs/promises';
import JSZip from 'jszip';

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
  const zip = new JSZip();
  zip.file('word/document.xml', documentXml);
  if (extraFiles) {
    for (const [name, text] of Object.entries(extraFiles)) zip.file(name, text);
  }
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

export async function readDocumentXmlFromPath(filePath: string): Promise<string> {
  const outBuf = await fs.readFile(filePath);
  const outZip = await JSZip.loadAsync(outBuf);
  return outZip.file('word/document.xml')!.async('text');
}

export function extractParaIdsFromToon(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('jr_para_'))
    .map((l) => l.split('|')[0]!.trim());
}

export function firstParaIdFromToon(content: string): string {
  const ids = extractParaIdsFromToon(content);
  if (ids.length === 0) throw new Error('No paragraph IDs found in TOON content');
  return ids[0]!;
}
