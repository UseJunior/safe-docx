import { DocxZip } from './zip.js';

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

export function enumerateRevisionStoryPartPaths(zip: DocxZip): string[] {
  const paths = new Set<string>(REVISION_STORY_PART_PATHS);
  for (const entry of zip.listFiles()) {
    if (isRevisionHeaderFooterPart(entry)) {
      paths.add(entry);
    }
  }
  return [...paths].sort();
}
