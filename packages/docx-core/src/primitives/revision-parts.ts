import { DocxZip } from './zip.js';
import { auditSectPr } from './sectPrAudit.js';

export const REVISION_STORY_PART_PATHS = [
  'word/footnotes.xml',
  'word/endnotes.xml',
  'word/comments.xml',
  'word/glossary/document.xml',
] as const;

export const REVISION_SIDE_PART_PATHS = [
  'word/comments.xml',
  'word/commentsExtended.xml',
  'word/people.xml',
  'word/footnotes.xml',
  'word/endnotes.xml',
] as const;

export const NUMBERED_HEADER_FOOTER_RE = /^word\/(?:header|footer)\d*\.xml$/;

export function isRevisionHeaderFooterPart(path: string): boolean {
  return NUMBERED_HEADER_FOOTER_RE.test(path);
}

/** Preserve the legacy filename-based synchronous inventory for callers. */
export function enumerateRevisionStoryPartPaths(zip: DocxZip): string[] {
  const paths = new Set<string>(REVISION_STORY_PART_PATHS);
  for (const entry of zip.listFiles()) {
    if (isRevisionHeaderFooterPart(entry)) paths.add(entry);
  }
  return [...paths].sort();
}

/**
 * Enumerate revision-bearing side stories. Header/footer membership is
 * relationship-selected, never inferred from allocation filenames, so orphan
 * parts remain untouched.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @see https://github.com/UseJunior/safe-docx/issues/998
 */
export async function enumerateSelectedRevisionStoryPartPaths(zip: DocxZip): Promise<string[]> {
  const paths = new Set<string>(REVISION_STORY_PART_PATHS);
  for (const partPath of await enumerateSelectedHeaderFooterPartPaths(zip)) paths.add(partPath);
  return [...paths].sort();
}

/** Enumerate only relationship-selected physical header/footer parts. */
export async function enumerateSelectedHeaderFooterPartPaths(zip: DocxZip): Promise<string[]> {
  const paths = new Set<string>();
  const documentXml = await zip.readTextOrNull('word/document.xml');
  const relationshipsXml = await zip.readTextOrNull('word/_rels/document.xml.rels');
  if (documentXml) {
    const audit = auditSectPr(documentXml, relationshipsXml);
    for (const binding of audit.bindings) {
      if (zip.hasFile(binding.targetPath)) paths.add(binding.targetPath);
    }
  }
  return [...paths].sort();
}
