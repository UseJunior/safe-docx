import { readFile } from 'node:fs/promises';

import JSZip from 'jszip';

import {
  acceptAllChanges,
  compareDocumentsAtomizer,
  extractTextWithParagraphs,
  rejectAllChanges,
} from '../../../../packages/docx-compare/dist/index.js';

const original = await readFile(new URL(
  '../../../../tests/test_documents/nvca-regression/source.docx',
  import.meta.url,
));
const revised = await readFile(new URL(
  '../../../../tests/test_documents/nvca-regression/filled.docx',
  import.meta.url,
));
const result = await compareDocumentsAtomizer(original, revised, {
  author: 'Rollback validation',
  comparisonStrategy: 'legacy',
  date: new Date('2026-08-22T00:00:00.000Z'),
});
const [originalZip, revisedZip, resultZip] = await Promise.all([
  JSZip.loadAsync(original),
  JSZip.loadAsync(revised),
  JSZip.loadAsync(result.document),
]);
const readDocumentXml = (zip) => zip.file('word/document.xml').async('string');
const [originalXml, revisedXml, resultXml] = await Promise.all([
  readDocumentXml(originalZip),
  readDocumentXml(revisedZip),
  readDocumentXml(resultZip),
]);
const text = (xml) => extractTextWithParagraphs(xml).replace(/\s+/g, ' ').trim();
const acceptedMatchesRevised = text(acceptAllChanges(resultXml)) === text(revisedXml);
const rejectedMatchesOriginal = text(rejectAllChanges(resultXml)) === text(originalXml);

if (result.comparisonStrategyUsed !== 'legacy') {
  throw new Error(`Expected legacy authority, got ${String(result.comparisonStrategyUsed)}`);
}
if (!acceptedMatchesRevised || !rejectedMatchesOriginal) {
  throw new Error('Legacy rollback projections did not match their source documents');
}

console.log(JSON.stringify({
  engine: result.engine,
  comparisonStrategyRequested: result.comparisonStrategyRequested,
  comparisonStrategyUsed: result.comparisonStrategyUsed,
  acceptedMatchesRevised,
  rejectedMatchesOriginal,
  outputZipEntries: Object.keys(resultZip.files).length,
}, null, 2));
