import { DocxDocument, type ConvertCommentsToFootnotesOptions, type ConvertCommentsToFootnotesReport } from './document.js';

export type ConvertCommentsToFootnotesResult = {
  buffer: Buffer;
  report: ConvertCommentsToFootnotesReport;
};

/**
 * Convert comments on an isolated in-memory document and return a new DOCX.
 * The caller's source buffer and file remain unchanged when preflight fails.
 */
export async function convertCommentsToFootnotes(
  source: Buffer,
  options: ConvertCommentsToFootnotesOptions = {},
): Promise<ConvertCommentsToFootnotesResult> {
  const document = await DocxDocument.load(source);
  const report = await document.convertCommentsToFootnotes(options);
  const { buffer } = await document.toBuffer({ cleanBookmarks: true, preserveOriginalBookmarks: true });
  return { buffer, report };
}
