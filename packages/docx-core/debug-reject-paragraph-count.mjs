#!/usr/bin/env node
/**
 * Debug helper: compare paragraph counts between an original docx and
 * a redlined docx after applying the library's rejectAllChanges() XML pass.
 *
 * This does NOT execute Word's accept/reject; it's a fast proxy that helps
 * detect "paragraph stub" issues (extra empty paragraphs left behind).
 *
 * Usage:
 *   node packages/docx-comparison/debug-reject-paragraph-count.mjs <original.docx> <redlined.docx>
 */

import { readFile } from 'fs/promises';
import { DocxArchive } from './dist/shared/docx/DocxArchive.js';
import { rejectAllChanges } from './dist/baselines/atomizer/trackChangesAcceptorAst.js';

function countParagraphs(xml) {
  const matches = xml.match(/<w:p(\s|>)/g);
  return matches ? matches.length : 0;
}

function countEmptyParagraphs(xml) {
  // Very rough heuristic: <w:p> that contains no <w:t> or <w:delText>.
  const paras = xml.split(/<w:p(\s|>)/).slice(1); // odd/even fragments; good enough for debug
  let empty = 0;
  for (const frag of paras) {
    const endIdx = frag.indexOf('</w:p>');
    if (endIdx === -1) continue;
    const body = frag.slice(0, endIdx);
    if (!body.includes('<w:t') && !body.includes('<w:delText')) empty++;
  }
  return empty;
}

async function main() {
  const [originalPath, redlinedPath] = process.argv.slice(2);
  if (!originalPath || !redlinedPath) {
    console.error('Usage: debug-reject-paragraph-count.mjs <original.docx> <redlined.docx>');
    process.exit(2);
  }

  const [originalBuf, redlinedBuf] = await Promise.all([
    readFile(originalPath),
    readFile(redlinedPath),
  ]);

  const originalArchive = await DocxArchive.load(originalBuf);
  const redlinedArchive = await DocxArchive.load(redlinedBuf);

  const originalXml = await originalArchive.getDocumentXml();
  const redlinedXml = await redlinedArchive.getDocumentXml();
  const rejectedXml = rejectAllChanges(redlinedXml);

  const result = {
    original: {
      paragraphs: countParagraphs(originalXml),
      empty_paragraphs: countEmptyParagraphs(originalXml),
    },
    redlined: {
      paragraphs: countParagraphs(redlinedXml),
      empty_paragraphs: countEmptyParagraphs(redlinedXml),
    },
    rejected: {
      paragraphs: countParagraphs(rejectedXml),
      empty_paragraphs: countEmptyParagraphs(rejectedXml),
    },
  };

  console.log(JSON.stringify(result, null, 2));
  if (result.rejected.paragraphs !== result.original.paragraphs) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
